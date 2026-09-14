"""Step 3 check: inspect what ingestion wrote to Aurora DSQL and S3 Vectors."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import boto3

from core import settings
from core.db import connect


def main() -> None:
    with connect() as conn:
        print("== documents per source")
        for row in conn.execute(
            """
            SELECT s.id, s.robots_allowed, s.last_crawled_at, count(d.id)
            FROM agent_sources s LEFT JOIN agent_documents d ON d.source_id = s.id
            GROUP BY s.id, s.robots_allowed, s.last_crawled_at ORDER BY s.id
            """
        ).fetchall():
            print(f"  {row[0]:<32} robots={row[1]!s:<5} last_crawled={row[2]} documents={row[3]}")

        total, embedded = conn.execute("SELECT count(*), count(embedded_at) FROM agent_chunks").fetchone()
        print(f"\n== chunks: {total} total, {embedded} embedded")

        print("\n== sample chunks")
        samples = conn.execute(
            """
            SELECT c.id, d.title, d.url, c.ordinal, c.locator, c.token_count, left(c.text, 200)
            FROM agent_chunks c JOIN agent_documents d ON d.id = c.document_id
            ORDER BY d.fetched_at DESC, c.ordinal LIMIT 5
            """
        ).fetchall()
        for chunk_id, title, url, ordinal, locator, tokens, text in samples:
            print(f"  [{chunk_id}] {title[:80]}\n    {url}")
            print(f"    #{ordinal} locator={locator!r} tokens={tokens}")
            print(f"    {' '.join(text.split())}")

        print("\n== last runs")
        for row in conn.execute(
            "SELECT started_at, finished_at, status, counts FROM agent_runs ORDER BY started_at DESC LIMIT 3"
        ).fetchall():
            print(f"  {row[0]} -> {row[1]} {row[2]} {row[3]}")

    if samples:
        keys = [str(row[0]) for row in samples]
        found = boto3.client("s3vectors", region_name=settings.AWS_REGION).get_vectors(
            vectorBucketName=settings.S3_VECTORS_BUCKET,
            indexName=settings.S3_VECTORS_INDEX,
            keys=keys,
            returnMetadata=True,
        )["vectors"]
        print(f"\n== S3 Vectors: {len(found)}/{len(keys)} sample chunk ids have vectors")
        for vector in found[:2]:
            print(f"  {vector['key']} metadata={vector.get('metadata')}")


if __name__ == "__main__":
    main()
