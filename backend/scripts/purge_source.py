"""Remove every stored document for one source so it can be re-ingested.

Deletes chunk vectors from S3 Vectors first, then citation links, chunks and documents in
Aurora DSQL, keeping each transaction under the 3,000-row limit. Requires --yes.

Usage: python scripts/purge_source.py <source_id> --yes
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.db import connect, run_with_retry
from core.vectors import S3VectorStore

BATCH = 1000  # rows per delete transaction, well under DSQL's 3,000


def delete_in_batches(conn, table: str, column: str, ids: list[str]) -> int:
    deleted = 0
    for start in range(0, len(ids), BATCH):
        batch = ids[start : start + BATCH]
        deleted += run_with_retry(
            conn,
            lambda c, b=batch: c.execute(
                f"DELETE FROM {table} WHERE {column} = ANY(%s::uuid[])", (b,)
            ).rowcount,
        )
    return deleted


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_id")
    parser.add_argument("--yes", action="store_true", help="confirm deletion")
    args = parser.parse_args()

    with connect() as conn:
        conn.autocommit = False
        documents = [
            str(row[0])
            for row in run_with_retry(
                conn,
                lambda c: c.execute(
                    "SELECT id FROM agent_documents WHERE source_id = %s", (args.source_id,)
                ).fetchall(),
            )
        ]
        chunks = []
        for start in range(0, len(documents), BATCH):
            batch = documents[start : start + BATCH]
            chunks += [
                str(row[0])
                for row in run_with_retry(
                    conn,
                    lambda c, b=batch: c.execute(
                        "SELECT id FROM agent_chunks WHERE document_id = ANY(%s::uuid[])", (b,)
                    ).fetchall(),
                )
            ]
        print(f"{args.source_id}: {len(documents)} documents, {len(chunks)} chunks")
        if not args.yes:
            print("nothing deleted (pass --yes to delete)")
            return 0

        S3VectorStore().delete(chunks)
        print(f"deleted {len(chunks)} vectors")
        for table in ("agent_claim_chunks", "agent_message_chunks"):
            print(f"deleted {delete_in_batches(conn, table, 'chunk_id', chunks)} rows from {table}")
        print(f"deleted {delete_in_batches(conn, 'agent_chunks', 'id', chunks)} chunks")
        print(f"deleted {delete_in_batches(conn, 'agent_documents', 'id', documents)} documents")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
