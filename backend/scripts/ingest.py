"""Crawl and ingest: fetch sources, discover documents one level deep, extract, chunk, embed, store.

Idempotent: a document whose normalized content hash is already stored adds no rows. Minutes,
agendas and news already stored under the same URL are skipped before fetching. Per-record
documents (service requests, public safety alerts, GIS features) are skipped when their record URL
is already stored, so a later status change does not add a second document for the same record.

Bulk refs (a daily bill change file, the Fremont App API, a Nixle listing, a GIS layer) are expanded
into their documents, and the expanded list is selected again (lookback window, newest first, max_docs).

Usage: python scripts/ingest.py [source_id ...] [--schedule daily|weekly|monthly] [--max-docs N] [--lookback-days N]

--schedule keeps only sources whose registry schedule matches, so each scheduled run crawls its own cadence.
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
from core.expanders import EXPANDERS
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
# Inline records identified by a stable per-record URL; the first stored version of a record is kept.
URL_KEYED_INLINE_TYPES = {"service_request", "public_safety_alert", "gis_feature"}
# A daily bill change file is itself the recency filter: a bill version whose action date is older than
# the lookback window can still be today's change (a bill last amended in spring, passed in September).
LOOKBACK_EXEMPT_TYPES = frozenset({"bill_version"})


LOOKAHEAD_DAYS = 14  # meetings further out rarely have an agenda posted yet
SCHEDULES = ("daily", "weekly", "monthly")


def select_sources(sources: list[Source], ids: list[str], schedule: str | None) -> list[Source]:
    return [
        source
        for source in sources
        if (not ids or source.id in ids) and (schedule is None or source.schedule == schedule)
    ]


def select_refs(
    refs: list[DocumentRef], lookback_days: int, max_docs: int, exempt_types: frozenset[str] = frozenset()
) -> list[DocumentRef]:
    now = datetime.now()
    cutoff, horizon = now - timedelta(days=lookback_days), now + timedelta(days=LOOKAHEAD_DAYS)
    recent = [
        ref
        for ref in refs
        if ref.published_at is None or ref.doc_type in exempt_types or cutoff <= ref.published_at <= horizon
    ]
    dated = sorted((r for r in recent if r.published_at), key=lambda r: r.published_at, reverse=True)
    undated = [r for r in recent if not r.published_at]
    return (dated + undated)[:max_docs]


def skips_known_url(ref: DocumentRef) -> bool:
    if ref.inline_text:
        return ref.doc_type in URL_KEYED_INLINE_TYPES
    return ref.doc_type in IMMUTABLE_TYPES


def inline_chunks(ref: DocumentRef, text: str) -> list[Chunk]:
    base = ref.locator or "record"
    return [
        Chunk(
            piece.ordinal,
            piece.text,
            base if piece.locator == "document start" else f"{base} › {piece.locator}",
            piece.est_tokens,
        )
        for piece in chunk_markdown(text)
    ]


def ingest_ref(conn, fetcher: Fetcher, vectors, s3, source: Source, ref: DocumentRef) -> str:
    if skips_known_url(ref) and has_url(conn, ref.url):
        return "skipped_known_url"
    if ref.inline_text:
        text, pages = ref.inline_text, None
        raw, extension, fetched_at = text.encode("utf-8"), "txt", datetime.now(UTC)
    else:
        for attempt in range(2):  # Firecrawl occasionally fails a page once, then succeeds
            try:
                artifact = fetcher.fetch(
                    ref.url,
                    source.fetcher,
                    source.params.get("wait_for_ms"),
                    source.send_user_agent,
                    main_content=True,
                )
                break
            except Exception:
                if attempt == 1:
                    raise
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
        pieces = inline_chunks(ref, text)
    else:
        pieces = chunk_pages(pages) if pages else chunk_markdown(text)
    embedded = []
    for piece in pieces:
        # The title and locator give short chunks (a member card, one agenda row) retrievable
        # context; the stored chunk text itself stays verbatim.
        vector, token_count = embed_text(f"{ref.title}\n{piece.locator}\n\n{piece.text}")
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


def expand_bulk(fetcher: Fetcher, source: Source, refs: list[DocumentRef]) -> list[DocumentRef]:
    expanded = []
    for ref in refs:
        expander = EXPANDERS.get(ref.doc_type)
        if expander is None:
            expanded.append(ref)
            continue
        documents = expander(fetcher, source, ref)
        print(f"  {ref.title}: expanded into {len(documents)} documents")
        expanded.extend(documents)
    return expanded


def discover_and_select(fetcher: Fetcher, source: Source, lookback_days: int, max_docs: int):
    """(discovered refs, expanded refs, selected refs) for one source; raises NotImplementedError for
    parsers that are not built."""
    refs = []
    for _ in range(2):  # client-rendered listings sometimes finish loading after capture
        seed = fetcher.fetch(
            source.url,
            source.fetcher,
            source.params.get("wait_for_ms"),
            source.send_user_agent,
        )
        refs = discover(source, seed)
        if refs:
            break
    expanded = expand_bulk(fetcher, source, select_refs(refs, lookback_days, max_docs))
    return refs, expanded, select_refs(expanded, lookback_days, max_docs, LOOKBACK_EXEMPT_TYPES)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="*", help="source ids (default: all enabled)")
    parser.add_argument("--schedule", choices=SCHEDULES, help="only sources on this registry schedule")
    parser.add_argument("--max-docs", type=int, default=10, help="documents per source")
    parser.add_argument("--lookback-days", type=int, default=120)
    args = parser.parse_args()

    fetcher = Fetcher()
    vectors = S3VectorStore()
    s3 = boto3.client("s3", region_name=settings.AWS_REGION)
    totals: Counter[str] = Counter()
    # DSQL closes connections after one hour and a crawl with 60 s crawl delays can run longer, so the
    # run record and each source get their own connection.
    with connect() as conn:
        run_id = start_run(conn, "ingest")
    status = "succeeded"
    try:
        for source in select_sources(load_sources(), args.sources, args.schedule):
            with connect() as conn:
                ingest_source(conn, fetcher, vectors, s3, source, args, totals)
    except BaseException:
        status = "failed"
        raise
    finally:
        with connect() as conn:
            finish_run(conn, run_id, status, dict(totals))
    print(f"\nrun {run_id}: {dict(totals)}")
    return 0


def ingest_source(conn, fetcher: Fetcher, vectors, s3, source: Source, args, totals: Counter[str]) -> None:
    allowed, _ = fetcher.check_robots(source.url, source.fetcher, source.send_user_agent)
    upsert_source(conn, source, allowed)
    print(f"\n[{source.id}] robots_allowed={allowed}")
    if not allowed:
        totals["sources_robots_blocked"] += 1
        return
    try:
        refs, expanded, selected = discover_and_select(fetcher, source, args.lookback_days, args.max_docs)
    except NotImplementedError as error:
        print(f"  {error}")
        totals["sources_not_built"] += 1
        return
    print(f"  discovered={len(refs)} expanded={len(expanded)} selected={len(selected)}")
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


if __name__ == "__main__":
    raise SystemExit(main())
