"""Crawl and ingest: fetch sources, discover documents one level deep, extract, chunk, embed, store.

Idempotent: a document whose normalized content hash is already stored adds no rows. Minutes,
agendas and news already stored under the same URL are skipped before fetching.

Usage: python scripts/ingest.py [source_id ...] [--max-docs N] [--lookback-days N]
"""

import argparse
import sys
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import boto3

from core import settings
from core.chunking import Chunk, chunk_markdown, chunk_pages
from core.db import connect
from core.discovery import DocumentRef, discover
from core.embed import embed_text
from core.extract import content_hash, document_text
from core.fetcher import Fetcher
from core.registry import Source, load_sources
from core.store import (
    EmbeddedChunk,
    finish_run,
    has_hash,
    has_url,
    mark_crawled,
    put_raw,
    start_run,
    store_document,
    upsert_source,
)
from core.vectors import S3VectorStore

FREMONT_TZ = ZoneInfo("America/Los_Angeles")  # city pages print local meeting times
IMMUTABLE_TYPES = {"minutes", "agenda", "meeting_document", "news"}


def select_refs(refs: list[DocumentRef], lookback_days: int, max_docs: int) -> list[DocumentRef]:
    cutoff = datetime.now() - timedelta(days=lookback_days)
    recent = [ref for ref in refs if ref.published_at is None or ref.published_at >= cutoff]
    dated = sorted((r for r in recent if r.published_at), key=lambda r: r.published_at, reverse=True)
    undated = [r for r in recent if not r.published_at]
    return (dated + undated)[:max_docs]


def ingest_ref(conn, fetcher: Fetcher, vectors, s3, source: Source, ref: DocumentRef) -> str:
    if not ref.inline_text and ref.doc_type in IMMUTABLE_TYPES and has_url(conn, ref.url):
        return "skipped_known_url"
    if ref.inline_text:
        text, pages = ref.inline_text, None
        raw, extension, fetched_at = text.encode("utf-8"), "txt", datetime.now(UTC)
    else:
        artifact = fetcher.fetch(
            ref.url,
            source.fetcher,
            source.params.get("wait_for_ms"),
            source.send_user_agent,
            main_content=True,
        )
        if not artifact.status or artifact.status >= 400:
            return "http_error"
        text, pages, fetched_at = document_text(artifact), artifact.pages, artifact.fetched_at
        if artifact.raw and not pages:
            raw, extension = artifact.raw, "html"
        else:  # Firecrawl returns PDF text, not PDF bytes; keep the extracted text as the original
            raw, extension = text.encode("utf-8"), "md"
    if not text.strip():
        return "empty"
    digest = content_hash(text)
    if has_hash(conn, digest):
        return "skipped_same_hash"

    if ref.inline_text:
        pieces = [Chunk(0, text, ref.locator or "record", 1)]
    else:
        pieces = chunk_pages(pages) if pages else chunk_markdown(text)
    embedded = []
    for piece in pieces:
        vector, token_count = embed_text(piece.text)
        embedded.append(EmbeddedChunk(piece.ordinal, piece.text, piece.locator, token_count, vector))

    published_at = ref.published_at.replace(tzinfo=FREMONT_TZ) if ref.published_at else None
    document_id = store_document(
        conn,
        vectors,
        source_id=source.id,
        url=ref.url,
        title=ref.title,
        published_at=published_at,
        digest=digest,
        raw_s3_key=put_raw(s3, source.id, digest, raw, extension),
        doc_type=ref.doc_type,
        fetched_at=fetched_at,
        chunks=embedded,
    )
    return f"stored:{len(embedded)}" if document_id else "skipped_same_hash"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="*", help="source ids (default: all enabled)")
    parser.add_argument("--max-docs", type=int, default=10, help="documents per source")
    parser.add_argument("--lookback-days", type=int, default=120)
    args = parser.parse_args()

    fetcher = Fetcher()
    vectors = S3VectorStore()
    s3 = boto3.client("s3", region_name=settings.AWS_REGION)
    totals: Counter[str] = Counter()
    with connect() as conn:
        conn.autocommit = False
        run_id = start_run(conn, "ingest")
        status = "succeeded"
        try:
            for source in load_sources():
                if args.sources and source.id not in args.sources:
                    continue
                allowed, _ = fetcher.check_robots(source.url, source.fetcher, source.send_user_agent)
                upsert_source(conn, source, allowed)
                print(f"\n[{source.id}] robots_allowed={allowed}")
                if not allowed:
                    totals["sources_robots_blocked"] += 1
                    continue
                try:
                    seed = fetcher.fetch(
                        source.url, source.fetcher, source.params.get("wait_for_ms"), source.send_user_agent
                    )
                    refs = discover(source, seed)
                except NotImplementedError as error:
                    print(f"  {error}")
                    totals["sources_not_built"] += 1
                    continue
                selected = select_refs(refs, args.lookback_days, args.max_docs)
                print(f"  discovered={len(refs)} selected={len(selected)}")
                for ref in selected:
                    try:
                        outcome = ingest_ref(conn, fetcher, vectors, s3, source, ref)
                    except Exception as error:
                        outcome = f"error:{type(error).__name__}"
                        print(f"    ! {ref.url}: {str(error)[:160]}")
                    kind, _, chunks = outcome.partition(":")
                    totals[kind if not kind.startswith("error") else "errors"] += 1
                    if kind == "stored":
                        totals["chunks_stored"] += int(chunks)
                    print(f"  - {outcome:<20} {ref.title[:90]}")
                mark_crawled(conn, source.id)
        except BaseException:
            status = "failed"
            raise
        finally:
            finish_run(conn, run_id, status, dict(totals))
    print(f"\nrun {run_id}: {dict(totals)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
