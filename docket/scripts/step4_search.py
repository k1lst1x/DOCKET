"""Step 4 check: hybrid retrieval (S3 Vectors + BM25) for test queries against the real corpus."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.retrieval import hybrid_search

QUERIES = [
    "homeless encampment reports in Fremont",
    "FUSD board consent calendar lunch shelter projects",
    "who represents Fremont in the California State Assembly",
]


def main() -> None:
    queries = sys.argv[1:] or QUERIES
    for query in queries:
        results = hybrid_search(query, k=5)
        print(f"\n=== {query!r}: {len(results)} results")
        for rank, item in enumerate(results, start=1):
            print(
                f"{rank}. score={item.score} sim={item.similarity} bm25={item.keyword_score} "
                f"via={'+'.join(item.matched_by)}"
            )
            print(f"   {item.title[:80]} | {item.locator[:70]}")
            print(f"   {item.url}")
            print(f"   {' '.join(item.text.split())[:160]}")


if __name__ == "__main__":
    main()
