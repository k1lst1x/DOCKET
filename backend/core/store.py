"""Persistence for ingested documents: rows in Aurora DSQL, raw originals in S3, vectors in S3 Vectors.

A document and its chunks are written in one transaction. agent_documents.content_hash is
UNIQUE and inserts use ON CONFLICT DO NOTHING, so re-ingesting unchanged content adds no rows.
Vectors are uploaded after the commit; chunks are marked embedded only once their vectors exist.
"""

from dataclasses import dataclass
from datetime import datetime

import psycopg
from psycopg.types.json import Jsonb

from core import settings
from core.db import run_with_retry
from core.registry import Source
from core.vectors import VectorItem, VectorStore

MAX_ROWS_PER_TRANSACTION = 2900  # DSQL allows 3,000; one row is the document itself


@dataclass
class EmbeddedChunk:
    ordinal: int
    text: str
    locator: str
    token_count: int
    vector: list[float]


def upsert_source(conn: psycopg.Connection, source: Source, robots_allowed: bool | None) -> None:
    run_with_retry(
        conn,
        lambda c: c.execute(
            """
            INSERT INTO agent_sources (id, name, url, kind, crawl_strategy, robots_allowed, enabled)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name, url = EXCLUDED.url, kind = EXCLUDED.kind,
              crawl_strategy = EXCLUDED.crawl_strategy, robots_allowed = EXCLUDED.robots_allowed,
              enabled = EXCLUDED.enabled
            """,
            (
                source.id,
                source.name,
                source.url,
                source.kind,
                source.crawl_strategy,
                robots_allowed,
                source.enabled,
            ),
        ),
    )


def mark_crawled(conn: psycopg.Connection, source_id: str) -> None:
    run_with_retry(
        conn,
        lambda c: c.execute(
            "UPDATE agent_sources SET last_crawled_at = now() WHERE id = %s", (source_id,)
        ),
    )


def has_hash(conn: psycopg.Connection, digest: str) -> bool:
    return run_with_retry(
        conn,
        lambda c: c.execute("SELECT 1 FROM agent_documents WHERE content_hash = %s", (digest,)).fetchone(),
    ) is not None


def has_url(conn: psycopg.Connection, url: str) -> bool:
    return run_with_retry(
        conn, lambda c: c.execute("SELECT 1 FROM agent_documents WHERE url = %s LIMIT 1", (url,)).fetchone()
    ) is not None


def put_raw(s3, source_id: str, digest: str, body: bytes, extension: str) -> str:
    key = f"raw/{source_id}/{digest}.{extension}"
    s3.put_object(Bucket=settings.S3_BUCKET, Key=key, Body=body)
    return key


def store_document(
    conn: psycopg.Connection,
    vectors: VectorStore,
    *,
    source_id: str,
    url: str,
    title: str,
    published_at: datetime | None,
    digest: str,
    raw_s3_key: str,
    doc_type: str,
    fetched_at: datetime,
    chunks: list[EmbeddedChunk],
) -> str | None:
    """Returns the new document id, or None when this content hash is already stored."""
    if len(chunks) > MAX_ROWS_PER_TRANSACTION:
        raise ValueError(f"{len(chunks)} chunks exceed the DSQL per-transaction row limit")

    def insert(c: psycopg.Connection) -> tuple[object | None, list[object]]:
        row = c.execute(
            """
            INSERT INTO agent_documents
              (source_id, url, title, published_at, content_hash, raw_s3_key, doc_type, fetched_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (content_hash) DO NOTHING
            RETURNING id
            """,
            (source_id, url, title, published_at, digest, raw_s3_key, doc_type, fetched_at),
        ).fetchone()
        if row is None:
            return None, []
        chunk_ids = [
            c.execute(
                """
                INSERT INTO agent_chunks (document_id, ordinal, text, locator, token_count)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
                """,
                (row[0], chunk.ordinal, chunk.text, chunk.locator, chunk.token_count),
            ).fetchone()[0]
            for chunk in chunks
        ]
        return row[0], chunk_ids

    document_id, chunk_ids = run_with_retry(conn, insert)
    if document_id is None:
        return None
    published = published_at.date().isoformat() if published_at else ""
    vectors.upsert(
        [
            VectorItem(
                str(chunk_id),
                chunk.vector,
                {
                    "document_id": str(document_id),
                    "source_id": source_id,
                    "doc_type": doc_type,
                    "published_at": published,
                },
            )
            for chunk_id, chunk in zip(chunk_ids, chunks, strict=True)
        ]
    )
    run_with_retry(
        conn,
        lambda c: c.execute(
            "UPDATE agent_chunks SET embedded_at = now() WHERE document_id = %s", (document_id,)
        ),
    )
    return str(document_id)


def start_run(conn: psycopg.Connection, kind: str) -> str:
    return str(
        run_with_retry(
            conn,
            lambda c: c.execute(
                "INSERT INTO agent_runs (kind, status) VALUES (%s, 'running') RETURNING id", (kind,)
            ).fetchone()[0],
        )
    )


def finish_run(conn: psycopg.Connection, run_id: str, status: str, counts: dict) -> None:
    run_with_retry(
        conn,
        lambda c: c.execute(
            "UPDATE agent_runs SET status = %s, counts = %s, finished_at = now() WHERE id = %s",
            (status, Jsonb(counts), run_id),
        ),
    )
