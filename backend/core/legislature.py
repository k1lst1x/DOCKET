"""California Legislature daily change files (pubinfo_<Day>.zip) into bill-version documents.

Keeps bill versions authored by the legislators who represent Fremont, resolved at run time
from the official Assembly and Senate member pages in the registry, plus bill versions whose
text mentions a configured term. Text and metadata come straight from the official tables.
"""

import html
import io
import re
import zipfile
from datetime import datetime

from core.discovery import DocumentRef, discover
from core.fetcher import Fetcher
from core.registry import Source, get_source

BILL_PAGE = "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id={bill_id}"
MEMBER_SOURCES = (("ca-assembly-members", "ASSEMBLY"), ("ca-senate-members", "SENATE"))


def _value(cell: str) -> str | None:
    cell = cell.strip()
    if cell == "NULL":
        return None
    return cell[1:-1] if len(cell) >= 2 and cell[0] == cell[-1] == "`" else cell


def _rows(archive: zipfile.ZipFile, name: str) -> list[list[str | None]]:
    if name not in archive.namelist():
        return []
    data = archive.read(name).decode("utf-8", "replace")
    return [[_value(cell) for cell in line.split("\t")] for line in data.splitlines() if line.strip()]


def bill_text(xml: str) -> str:
    text = re.sub(r"</(?:[\w:]*p|[\w:]*h\d|[\w:]*li|[\w:]*div)>|<br\s*/?>", "\n", xml)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    lines = (re.sub(r"[ \t\r]+", " ", line).strip() for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def fremont_members(fetcher: Fetcher) -> list[tuple[str, str]]:
    """(house, surname) for each seated member in the districts configured for Fremont."""
    members = []
    for source_id, house in MEMBER_SOURCES:
        source = get_source(source_id)
        artifact = fetcher.fetch(source.url, source.fetcher, None, source.send_user_agent)
        for ref in discover(source, artifact):
            card = ref.inline_text or ""
            if card.startswith("Member Vacant"):
                continue
            surname = re.match(r"([A-Z][A-Za-z'\-]+),\s", card)  # cards read "Lee, Alex District: 24 ..."
            if surname:
                members.append((house, surname.group(1)))
            else:
                print(f"  warning: could not read a member name from {source_id} card: {card[:80]!r}")
    return members


def expand(fetcher: Fetcher, source: Source, ref: DocumentRef) -> list[DocumentRef]:
    artifact = fetcher.fetch(ref.url, "http", None, True)
    if not artifact.status or artifact.status >= 400:
        raise RuntimeError(f"download of {ref.url} failed with status {artifact.status}")
    archive = zipfile.ZipFile(io.BytesIO(artifact.raw))
    members = {(house, name.lower()) for house, name in fremont_members(fetcher)}
    terms = [term.lower() for term in source.params.get("mention_terms", [])]
    bills = {row[0]: row for row in _rows(archive, "BILL_TBL.dat")}
    authors: dict[str, list[tuple[str | None, str]]] = {}
    for row in _rows(archive, "BILL_VERSION_AUTHORS_TBL.dat"):
        authors.setdefault(row[0], []).append((row[2], row[3] or ""))

    refs = []
    for version in _rows(archive, "BILL_VERSION_TBL.dat"):
        version_id, bill_id, action_date, action, subject, lob = (
            version[0], version[1], version[3], version[4], version[6], version[14],
        )
        text = bill_text(archive.read(lob).decode("utf-8", "replace")) if lob in archive.namelist() else ""
        by_member = [name for house, name in authors.get(version_id, []) if (house, name.lower()) in members]
        mentions = [term for term in terms if term in text.lower()]
        if not text or not (by_member or mentions):
            continue
        bill = bills.get(bill_id)
        measure = f"{bill[3]} {bill[4]}" if bill else bill_id
        header = "\n".join(
            [
                f"Measure: {measure}",
                f"Subject: {subject or ''}",
                f"Version: {version_id} ({action or ''}, {action_date or ''})",
                f"Authors: {', '.join(name for _, name in authors.get(version_id, []))}",
            ]
        )
        published = datetime.strptime(action_date, "%Y-%m-%d %H:%M:%S") if action_date else None
        refs.append(
            DocumentRef(
                BILL_PAGE.format(bill_id=bill_id),
                f"{measure}: {subject or version_id}",
                "bill_version",
                published,
                inline_text=f"{header}\n\n{text}",
                locator=f"{measure} version {version_id}",
            )
        )
    return refs
