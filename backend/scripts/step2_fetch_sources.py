"""Step 2 check: fetch every enabled source in config/sources.yaml and show what came back."""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.fetcher import Fetcher
from core.registry import load_sources


def main() -> int:
    fetcher = Fetcher()
    failures = 0
    for source in load_sources():
        allowed, delay = fetcher.check_robots(source.url, source.fetcher, source.send_user_agent)
        print(f"\n[{source.id}] {source.name}")
        print(f"  url: {source.url}")
        print(
            f"  fetcher={source.fetcher} send_user_agent={source.send_user_agent} "
            f"schedule={source.schedule} robots_allowed={allowed} crawl_delay={delay}"
        )
        if not allowed:
            print("  SKIPPED: disallowed by robots.txt (or robots.txt unreachable)")
            failures += 1
            continue
        try:
            artifact = fetcher.fetch(
                source.url, source.fetcher, source.params.get("wait_for_ms"), source.send_user_agent
            )
        except Exception as error:
            print(f"  FAILED: {type(error).__name__}: {str(error)[:200]}")
            failures += 1
            continue
        body = artifact.text if artifact.text is not None else artifact.raw.decode("utf-8", "replace")
        matches = re.findall(source.verify_pattern, body) if source.verify_pattern else []
        print(
            f"  status={artifact.status} type={artifact.content_type} raw_bytes={len(artifact.raw)} "
            f"text_chars={len(artifact.text or '')} sha256={artifact.content_hash[:12]}"
        )
        print(f"  verify {source.verify_pattern!r}: {len(matches)} matches")
        first = re.search(source.verify_pattern, body) if source.verify_pattern else None
        if first:
            snippet = re.sub(r"\s+", " ", body[max(0, first.start() - 100) : first.end() + 160])
            print(f"  sample: ...{snippet}...")
        if not (artifact.status and artifact.status < 400 and matches):
            failures += 1
    print(f"\n{failures} source(s) failed verification")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
