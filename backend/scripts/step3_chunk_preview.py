"""Step 3 preview (no AWS): fetch one real document and show its chunks and locators."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.chunking import chunk_markdown, chunk_pages
from core.fetcher import Fetcher

DEFAULT_URL = "https://www.fremont.gov/home/showdocument?id=21152"  # City Council minutes, July 21, 2026


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    artifact = Fetcher().fetch(url, "firecrawl", send_user_agent=False, main_content=True)
    chunks = chunk_pages(artifact.pages) if artifact.pages else chunk_markdown(artifact.text or "")
    mode = f"pdf pages={len(artifact.pages)}" if artifact.pages else "html"
    print(f"url={url} status={artifact.status} {mode} chars={len(artifact.text or '')} chunks={len(chunks)}")
    for chunk in chunks:
        preview = " ".join(chunk.text.split())[:140]
        print(f"\n#{chunk.ordinal} ~{chunk.est_tokens} tokens | locator: {chunk.locator}\n  {preview}...")


if __name__ == "__main__":
    main()
