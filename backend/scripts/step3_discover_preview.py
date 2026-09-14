"""Step 3 preview (no AWS): fetch each source's seed page and list the documents discovered."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.discovery import discover
from core.fetcher import Fetcher
from core.registry import load_sources


def main() -> None:
    fetcher = Fetcher()
    for source in load_sources():
        print(f"\n[{source.id}] parser={source.parser}")
        try:
            artifact = fetcher.fetch(
                source.url, source.fetcher, source.params.get("wait_for_ms"), source.send_user_agent
            )
            refs = discover(source, artifact)
        except NotImplementedError as error:
            print(f"  {error}")
            continue
        except Exception as error:
            print(f"  FAILED: {type(error).__name__}: {str(error)[:200]}")
            continue
        kinds: dict[str, int] = {}
        for ref in refs:
            kinds[ref.doc_type] = kinds.get(ref.doc_type, 0) + 1
        print(f"  status={artifact.status} discovered={len(refs)} by type={kinds}")
        for ref in refs[:4]:
            when = ref.published_at.isoformat(sep=" ") if ref.published_at else "-"
            print(f"  - [{ref.doc_type}] {when} | {ref.title[:90]}\n    {ref.url}")
            if ref.inline_text:
                print(f"    inline ({ref.locator}): {ref.inline_text[:200]}")


if __name__ == "__main__":
    main()
