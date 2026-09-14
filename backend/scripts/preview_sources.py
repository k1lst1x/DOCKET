"""Preview sources end to end on the live network without AWS: robots.txt, seed fetch, discovery,
expansion and selection. Nothing is embedded or stored.

Usage: python scripts/preview_sources.py <source_id ...> [--limit-pages N] [--max-docs N] [--lookback-days N]

--limit-pages caps listing or query pages (params.max_pages) for Nixle and GIS sources.
"""

import argparse
import dataclasses
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.fetcher import Fetcher
from core.jobs import MAX_INGEST_DOCS
from core.registry import get_source
from scripts.ingest import discover_and_select

NEIGHBORHOOD_LINE = re.compile(r"^- Neighborhoods?(?: mentioned)?: (.+)$", re.M)


def neighborhoods_of(text: str | None) -> list[str]:
    names = [name.strip() for line in NEIGHBORHOOD_LINE.findall(text or "") for name in line.split(", ")]
    return names or ["(none)"]


def preview(fetcher: Fetcher, source_id: str, args) -> None:
    source = get_source(source_id)
    if args.limit_pages:
        source = dataclasses.replace(source, params={**source.params, "max_pages": args.limit_pages})
    print(f"\n[{source.id}] parser={source.parser} fetcher={source.fetcher}")
    allowed, delay = fetcher.check_robots(source.url, source.fetcher, source.send_user_agent)
    print(f"  robots_allowed={allowed} crawl_delay={delay}")
    if not allowed:
        return
    started = time.monotonic()
    try:
        refs, expanded, selected = discover_and_select(fetcher, source, args.lookback_days, args.max_docs)
    except Exception as error:
        print(f"  FAILED: {type(error).__name__}: {str(error)[:300]}")
        return
    print(
        f"  discovered={len(refs)} expanded={len(expanded)} selected={len(selected)} "
        f"({time.monotonic() - started:.0f} s)"
    )
    for label, group in (("expanded", expanded), ("selected", selected)):
        dated = sorted(ref.published_at for ref in group if ref.published_at)
        if dated:
            print(f"  {label} published_at: newest={dated[-1]} oldest={dated[0]} undated={len(group) - len(dated)}")
    tally = Counter(name for ref in selected for name in neighborhoods_of(ref.inline_text))
    print(f"  neighborhoods (top 10 of {len(tally)}): {tally.most_common(10)}")
    for ref in selected[:2]:
        print(f"  sample: [{ref.doc_type}] {ref.published_at or '-'} | {ref.title}\n          {ref.url}")
    sample = next((ref for ref in selected if ref.inline_text), None)
    if sample:
        print("  inline_text sample:\n    " + sample.inline_text[:1500].replace("\n", "\n    "))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="+", help="source ids")
    parser.add_argument("--limit-pages", type=int, default=None, help="max listing or query pages")
    parser.add_argument("--max-docs", type=int, default=MAX_INGEST_DOCS)
    parser.add_argument("--lookback-days", type=int, default=120)
    args = parser.parse_args()
    fetcher = Fetcher()
    for source_id in args.sources:
        preview(fetcher, source_id, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
