"""Ingest team-supplied documents from a manifest in the raw bucket (uploads/<name>.json).

scripts/prepare_uploads.py extracts and redacts the files locally and uploads the manifest; this
script stores them exactly like crawled documents: page-aware chunks, Titan embeddings, the
extracted text as the raw original in S3, rows in DSQL and vectors in S3 Vectors. Idempotent by
content hash. Embeddings need Bedrock, so it runs in the pipeline runtime (action ingest_manifest).

Usage: python scripts/ingest_manifest.py uploads/<name>.json
"""

import argparse
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import boto3
from core import settings
from core.chunking import chunk_pages
from core.db import connect
from core.embed import embed_text
from core.extract import content_hash
from core.registry import Source, get_source
from core.store import EmbeddedChunk, finish_run, has_hash, put_raw, start_run, store_document, upsert_source
from core.vectors import S3VectorStore

MANIFEST_PREFIX = "uploads/"
DOC_TYPES = {"agenda", "meeting_document", "notice", "public_comment", "research_note"}


def ingest_document(conn, vectors, s3, source: Source, doc: dict) -> str:
    if doc.get("doc_type") not in DOC_TYPES:
        raise ValueError(f"unknown doc_type {doc.get('doc_type')!r}")
    pages = [(int(number), text) for number, text in doc["pages"] if text.strip()]
    text = "\n\n".join(page for _, page in pages)
    if not text.strip():
        return "empty"
    digest = content_hash(text)
    if has_hash(conn, digest):
        return "skipped_same_hash"
    embedded = []
    for piece in chunk_pages(pages):
        vector, token_count = embed_text(f"{doc['title']}\n{piece.locator}\n\n{piece.text}")
        embedded.append(EmbeddedChunk(piece.ordinal, piece.text, piece.locator, token_count, vector))
    published_at = datetime.fromisoformat(doc["published_at"]) if doc.get("published_at") else None
    document_id = store_document(
        conn,
        vectors,
        source_id=source.id,
        url=doc["url"],
        title=doc["title"],
        published_at=published_at,
        digest=digest,
        raw_s3_key=put_raw(s3, source.id, digest, text.encode("utf-8"), "md"),
        doc_type=doc["doc_type"],
        fetched_at=datetime.now(UTC),
        chunks=embedded,
    )
    return f"stored:{len(embedded)}" if document_id else "skipped_same_hash"


def ingest_manifest(manifest_key: str) -> dict:
    if not manifest_key.startswith(MANIFEST_PREFIX) or not manifest_key.endswith(".json") or ".." in manifest_key:
        raise ValueError("manifest_key must be uploads/<name>.json")
    s3 = boto3.client("s3", region_name=settings.AWS_REGION)
    manifest = json.loads(s3.get_object(Bucket=settings.S3_BUCKET, Key=manifest_key)["Body"].read())
    vectors = S3VectorStore()
    totals: Counter[str] = Counter()
    with connect() as conn:
        run_id = start_run(conn, "ingest_manifest")
    status = "succeeded"
    try:
        with connect() as conn:
            registered: set[str] = set()
            for doc in manifest["documents"]:
                source = get_source(doc["source_id"])
                if source.id not in registered:
                    upsert_source(conn, source, None)  # supplied files: robots.txt does not apply
                    registered.add(source.id)
                try:
                    outcome = ingest_document(conn, vectors, s3, source, doc)
                except Exception as error:
                    outcome = f"error:{type(error).__name__}"
                    print(f"    ! {doc.get('title')}: {str(error)[:160]}")
                kind, _, chunks = outcome.partition(":")
                totals[kind if not kind.startswith("error") else "errors"] += 1
                if kind == "stored":
                    totals["chunks_stored"] += int(chunks)
                print(f"  - {outcome:<20} {doc['title'][:90]}")
    except BaseException:
        status = "failed"
        raise
    finally:
        with connect() as conn:
            finish_run(conn, run_id, status, dict(totals))
    return {"run_id": run_id, "counts": dict(totals)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest_key")
    summary = ingest_manifest(parser.parse_args().manifest_key)
    print(f"\nrun {summary['run_id']}: {summary['counts']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
