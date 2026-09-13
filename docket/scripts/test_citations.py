"""Offline checks for citation enforcement (no AWS). Run: python scripts/test_citations.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.citations import canonical_date, enforce, extract_facts

CHUNK = (
    "| | C. | Security Information And Management System Renewal - Authorize the City Manager or her "
    "designee to execute an agreement with AMS.NET, LLC D/B/A MGT Impact Solutions, for the annual "
    "software licenses ... in an amount not to exceed $396,000 for a 3-year term. |\n"
    "Fremont City Council<br>Regular Meeting<br>9/8/2026 7:00 PM<br> City Council Chambers<br>"
    "3300 Capitol Avenue Building A Fremont, CA 94538\n"
    "OLIVE AVENUE HOMES - 2057 Olive Avenue - PLN2025-00182 ... CEQA Guidelines Section 15332"
)

CASES = [
    ("supported dollar amount", "The renewal is capped at $396,000 for a 3-year term [1].", True),
    ("wrong dollar amount", "The renewal is capped at $400,000 [1].", False),
    ("supported date format", "The council met on 9/8/2026 [1].", True),
    ("same date, different format", "The council met on September 8, 2026 [1].", True),
    ("same date, narrow no-break spaces", "The council met on September 8 2026 [1].", True),
    ("same month only", "The council met in September 2026 [1].", True),
    ("different date", "The council met on September 9, 2026 [1].", False),
    ("supported address and record id", "The project at 2057 Olive Avenue is PLN2025-00182 [1].", True),
    ("invented address", "The project is at 2100 Olive Avenue [1].", False),
    ("supported section", "It relies on CEQA Guidelines Section 15332 [1].", True),
    ("invented section", "It relies on Section 15183 [1].", False),
    ("no facts at all", "The item was placed on the consent calendar [1].", True),
]


def main() -> int:
    failures = 0
    for name, sentence, should_keep in CASES:
        result = enforce(sentence, [CHUNK])
        kept = bool(result.text)
        ok = kept == should_keep
        failures += not ok
        facts = extract_facts(sentence)
        removed = [r.unsupported for r in result.removed]
        print(f"{'PASS' if ok else 'FAIL'}  {name}: kept={kept} facts={facts} removed={removed}")
    mixed = enforce("Capped at $396,000 [1]. It was approved unanimously on 9/9/2026 [1].", [CHUNK])
    print(f"\nmixed answer -> {mixed.text!r}; removed {[r.unsupported for r in mixed.removed]}")
    failures += mixed.text != "Capped at $396,000 [1]."
    date_cases = (("Sep. 8th 2026", "2026-09-08"), ("2026-09-08", "2026-09-08"), ("Sept 2026", "2026-09"))
    for value, expected in date_cases:
        ok = canonical_date(value) == expected
        failures += not ok
        print(f"{'PASS' if ok else 'FAIL'}  canonical_date({value!r}) = {canonical_date(value)!r}")
    print(f"\n{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
