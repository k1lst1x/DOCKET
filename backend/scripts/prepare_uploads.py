"""Prepare team-supplied PDFs for the corpus: extract text, redact private contact details, attach
real titles, dates and links, and upload a manifest for the pipeline's ingest_manifest action.

Nothing here invents metadata. Titles, dates and links come from each document's own text, or from
the stored City Council meeting page the attachment belongs to. Private residents' email addresses
and home addresses are redacted from public correspondence; the unredacted PDFs are never uploaded.

Usage (from backend/, AWS_PROFILE with S3 write access):
  uv run python scripts/prepare_uploads.py "C:/Users/you/Desktop" [--dry-run]
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import settings
from pypdf import PdfReader

RESEARCH_DATE = "2026-09-13T12:00:00-07:00"  # "research date: September 13, 2026" in every note
COUNCIL_SEP_8 = "https://fremontcityca.iqm2.com/Citizens/Detail_Meeting.aspx?ID=2090"  # stored meeting page
ZONING_ADMINISTRATOR = "https://city.fremont.gov/zoningadministrator"  # printed on the ZA agenda

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
HOME_ADDRESS = re.compile(
    r"\b\d{3,6},?\s+(?:[A-Z][a-z]+\s+){1,3}"
    r"(?:Terrace|Ter|Drive|Dr|Road|Rd|Street|St|Avenue|Ave|Court|Ct|Way|Lane|Ln|Boulevard|Blvd|Place|Pl)\b\.?"
    r"(?:,?\s*Fremont,?\s*(?:CA)?[-\s]*\d{5})?"
)
# Civic buildings and project sites named in public records stay; they are not anyone's home.
PUBLIC_ADDRESSES = ("3300 capitol", "39550 liberty", "3800 beard", "3100 mowry")
# Neighbors' house numbers listed after a street address ("4402, 4405, 4410, ... Calypso Terrace").
HOUSE_NUMBER_LIST = re.compile(
    r"\b\d{4}(?:,\s*\d{4})+,?\s+(?=[A-Z][a-z]+\s+(?:Terrace|Ter|Drive|Dr|Road|Rd|Court|Ct)\b)"
)


def redact(text: str) -> tuple[str, int]:
    count = 0

    def email(match: re.Match) -> str:
        nonlocal count
        if match.group(0).lower().endswith("@fremont.gov"):
            return match.group(0)
        count += 1
        return "[email redacted]"

    def address(match: re.Match) -> str:
        nonlocal count
        flat = re.sub(r"\s+", " ", match.group(0)).lower()
        if flat.startswith(PUBLIC_ADDRESSES):
            return match.group(0)
        count += 1
        return "[home address redacted]"

    def numbers(match: re.Match) -> str:
        nonlocal count
        count += 1
        return "[house numbers redacted] "

    text = EMAIL.sub(email, text)
    text = HOUSE_NUMBER_LIST.sub(numbers, text)
    return HOME_ADDRESS.sub(address, text), count


@dataclass
class Upload:
    filename: str
    source_id: str
    title: str
    url: str
    published_at: str
    doc_type: str
    keep_pages: tuple[int, ...] | None = None  # physical pages to keep; None keeps all
    redact: bool = False


CITY_UPLOADS = [
    Upload(
        "260818 ZA Final Reports_Agenda.pdf",
        "fremont-zoning-administrator",
        "Zoning Administrator Public Hearing Agenda – Aug 18, 2026 3:00 PM",
        ZONING_ADMINISTRATOR,
        "2026-08-18T15:00:00-07:00",
        "agenda",
    ),
    Upload(
        "260818 ZA Public Correspondence PLN2026_00162.pdf",
        "fremont-zoning-administrator",
        "Zoning Administrator Aug 18, 2026 – Public Correspondence on PLN2026-00162 (FCSN, 3800 Beard Road)",
        ZONING_ADMINISTRATOR,
        "2026-08-15T13:42:00-07:00",
        "public_comment",
        redact=True,
    ),
    Upload(
        "260915 ZA cancellation notice.pdf",
        "fremont-zoning-administrator",
        "Zoning Administrator Meeting Cancellation Notice – Sep 15, 2026",
        ZONING_ADMINISTRATOR,
        "2026-09-15T15:00:00-07:00",
        "notice",
    ),
    Upload(
        "Agenda Item 2C Security InfoMgt Sys Green Sheet.pdf",
        "fremont-council-iqm2",
        "City Council Sep 8, 2026 – Item 2C Correction to Staff Report #5800 (Security Information and Event "
        "Management System)",
        COUNCIL_SEP_8,
        "2026-09-08T19:00:00-07:00",
        "meeting_document",
    ),
    Upload(
        "Agenda Item 4A Public Communications.pdf",
        "fremont-council-iqm2",
        "City Council Sep 8, 2026 – Item 4A Written Public Communications",
        COUNCIL_SEP_8,
        "2026-09-08T19:00:00-07:00",
        "public_comment",
        # Pages 3-4 are a letter of unverified criminal accusations against named officers that lists
        # neighbors' home addresses; it is left out of the corpus.
        keep_pages=(1, 2),
        redact=True,
    ),
    Upload(
        "Agenda Item 7A1 Councilmember Keng Referral  Public Corr.pdf",
        "fremont-council-iqm2",
        "City Council Sep 8, 2026 – Item 7A1 Public Correspondence on Councilmember Keng's Referral (North "
        "Fremont Community Center, District 1)",
        COUNCIL_SEP_8,
        "2026-09-08T19:00:00-07:00",
        "public_comment",
        redact=True,
    ),
]

BILL_SOURCE = re.compile(r"California / bill source:\s*(https?://\S+)")


def research_note(path: Path, pages: list[tuple[int, str]]) -> Upload:
    text = pages[0][1]
    heading = text.split("California State Legislation and Its Direct Connection to Fremont")[0]
    title = re.sub(r"\s+", " ", heading).strip()
    link = BILL_SOURCE.search(text)
    if not title or not link:
        raise ValueError(f"{path.name}: could not read the bill title or source link")
    return Upload(
        path.name,
        "docket-bill-research-notes",
        f"{title} – research note on Fremont impact (Sep 13, 2026)",
        link.group(1),
        RESEARCH_DATE,
        "research_note",
    )


def build_manifest(folder: Path) -> tuple[list[dict], list[str]]:
    documents, report = [], []
    notes = sorted(folder.glob("*_Fremont.pdf"))
    specs = {spec.filename: spec for spec in CITY_UPLOADS}
    for path in [*notes, *(folder / name for name in specs)]:
        if not path.exists():
            raise FileNotFoundError(path)
        pages = [(n, page.extract_text() or "") for n, page in enumerate(PdfReader(path).pages, start=1)]
        spec = specs.get(path.name) or research_note(path, pages)
        if spec.keep_pages:
            pages = [(n, text) for n, text in pages if n in spec.keep_pages]
        redactions = 0
        if spec.redact:
            cleaned = []
            for n, text in pages:
                text, count = redact(text)
                redactions += count
                cleaned.append((n, text))
            pages = cleaned
        datetime.fromisoformat(spec.published_at)  # fail early on a bad date
        documents.append(
            {
                "source_id": spec.source_id,
                "title": spec.title,
                "url": spec.url,
                "published_at": spec.published_at,
                "doc_type": spec.doc_type,
                "pages": pages,
                "file": path.name,
            }
        )
        report.append(f"{path.name}: {len(pages)} page(s), {redactions} redaction(s) -> {spec.source_id}")
    return documents, report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--name", default=f"team-files-{datetime.now():%Y%m%d-%H%M%S}")
    args = parser.parse_args()
    documents, report = build_manifest(args.folder)
    print("\n".join(report))
    body = json.dumps({"documents": documents}, ensure_ascii=False).encode("utf-8")
    key = f"uploads/{args.name}.json"
    if args.dry_run:
        print(f"dry run: {len(documents)} documents, {len(body)} bytes (not uploaded)")
        return 0
    import boto3

    boto3.client("s3", region_name=settings.AWS_REGION).put_object(
        Bucket=settings.S3_BUCKET, Key=key, Body=body, ContentType="application/json"
    )
    print(f"uploaded {len(documents)} documents to s3://{settings.S3_BUCKET}/{key}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
