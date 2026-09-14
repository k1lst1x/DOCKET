"""Offline checks for citation enforcement (no AWS). Run: python scripts/test_citations.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.citations import canonical_date, enforce, extract_facts
from core.retrieval import Evidence

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
    # The meeting date is only in the document title; the cited agenda row does not repeat it.
    row = Evidence(
        chunk_id="c1",
        document_id="d1",
        source_id="fremont-council-iqm2",
        source_name="IQM2",
        title="City Council Regular Meeting – Sep 1, 2026 7:00 PM",
        url="https://example.invalid/2089",
        locator="2. Consent Calendar › G. Purchase of Trash Can Liners",
        doc_type="meeting_document",
        published_at="2026-09-01T19:00:00-07:00",
        text=(
            "| G. | Purchase of Trash Can Liners - Approval of Multi-Year Purchase Order with "
            "Wardley Industrial Inc. |"
        ),
    )
    for name, sentence, should_keep in (
        (
            "date only in document title",
            "The September 1, 2026 agenda lists Wardley Industrial Inc. [1].",
            True,
        ),
        (
            "date not in title either",
            "The September 15, 2026 agenda lists Wardley Industrial Inc. [1].",
            False,
        ),
    ):
        kept = bool(enforce(sentence, [row.cited_text()]).text)
        failures += kept != should_keep
        print(f"{'PASS' if kept == should_keep else 'FAIL'}  {name}: kept={kept}")
    # A news post gives the day without a year; its post date supplies the year. The model writes "§" and
    # narrow no-break spaces where the agenda says "Section".
    notice = Evidence(
        chunk_id="c2",
        document_id="d2",
        source_id="fremont-news",
        source_name="City of Fremont news",
        title="City Offices Closed in Observance of Labor Day",
        url="https://example.invalid/news",
        locator="document start",
        doc_type="news",
        published_at="2026-09-04T21:31:00+00:00",
        text="Post Date:09/04/2026 2:31 PMCity of Fremont offices will be closed Monday, September 7 in "
        "observance of Labor Day.",
    )
    agenda = "Second Reading and Adoption of an Ordinance Amending Fremont Municipal Code Section 2.05.060"
    for name, sentence, evidence, should_keep in (
        ("day without year, year from post date", "Offices closed Monday, September 7, 2026 [1].", notice, True),
        ("narrow no-break spaces in the date", "Offices closed Monday, September 7, 2026 [1].", notice, True),
        ("day without year, wrong day", "Offices closed Tuesday, September 8, 2026 [1].", notice, False),
        ("day without year, wrong year", "Offices closed Monday, September 7, 2025 [1].", notice, False),
        ("section sign for Section", "It amends Fremont Municipal Code § 2.05.060 [1].", None, True),
        ("section sign, wrong section", "It amends Fremont Municipal Code § 2.05.070 [1].", None, False),
    ):
        texts = [evidence.cited_text()] if evidence else [agenda]
        kept = bool(enforce(sentence, texts).text)
        failures += kept != should_keep
        print(f"{'PASS' if kept == should_keep else 'FAIL'}  {name}: kept={kept}")
    date_cases = (("Sep. 8th 2026", "2026-09-08"), ("2026-09-08", "2026-09-08"), ("Sept 2026", "2026-09"))
    for value, expected in date_cases:
        ok = canonical_date(value) == expected
        failures += not ok
        print(f"{'PASS' if ok else 'FAIL'}  canonical_date({value!r}) = {canonical_date(value)!r}")
    print(f"\n{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
