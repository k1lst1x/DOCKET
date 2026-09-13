"""Discovery: turn a fetched source page into the documents to ingest, one level deep.

Each registry parser reads the seed page exactly as fetched and returns DocumentRefs. The
ingestor then fetches each ref (or uses its inline text when the listing record is the
document itself). Parsers only read what the page contains; nothing is inferred.
"""

import html as html_lib
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import parse_qs, urlsplit

from core.fetcher import Artifact
from core.registry import Source, get_source

MD_LINK = re.compile(r'\[([^\]]+)\]\((https?://[^)\s]+)(?:\s+"([^"]*)")?\)')


@dataclass
class DocumentRef:
    url: str
    title: str
    doc_type: str
    published_at: datetime | None = None
    inline_text: str | None = None  # listing records that are documents in their own right
    locator: str | None = None  # locator used for inline records


def _markdown(artifact: Artifact) -> str:
    return artifact.text if artifact.text is not None else artifact.raw.decode("utf-8", "replace")


def _date(value: str, formats: tuple[str, ...]) -> datetime | None:
    for fmt in formats:
        try:
            return datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
    return None


def _visible_text(fragment: str) -> str:
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", fragment, flags=re.S | re.I)
    text = html_lib.unescape(re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"\s+", " ", text).strip()


def _dedupe(refs: list[DocumentRef]) -> list[DocumentRef]:
    seen: set[str] = set()
    unique = []
    for ref in refs:
        if ref.url not in seen:
            seen.add(ref.url)
            unique.append(ref)
    return unique


def _iqm2_calendar(source: Source, artifact: Artifact) -> list[DocumentRef]:
    refs = []
    for text, url, tooltip in MD_LINK.findall(_markdown(artifact)):
        if "Detail_Meeting.aspx?ID=" not in url:
            continue
        board = re.search(r"Board:\s*(.+?)\s+Type:", tooltip or "")
        kind = re.search(r"Type:\s*(.+?)\s+Status:", tooltip or "")
        title = " ".join(
            part for part in (board.group(1) if board else "Meeting", kind.group(1) if kind else "") if part
        )
        refs.append(
            DocumentRef(url, f"{title} – {text}", "meeting_agenda", _date(text, ("%b %d, %Y %I:%M %p",)))
        )
    return _dedupe(refs)


AGENDA_ROW = re.compile(
    r"^\|\s*(\d{2}[/-]\d{2}[/-]\d{4})\s*(\d{1,2}:\d{2} [AP]M)?\s*(?:<br>)?\s*([^|]*)\|(.*)$", re.M
)


def _unsplash(url: str) -> str:
    query = parse_qs(urlsplit(url).query)
    return query["splash"][0] if "splash" in query else url


def _civicplus_agenda_center(source: Source, artifact: Artifact) -> list[DocumentRef]:
    refs = []
    for date_text, time_text, first_cell, rest in AGENDA_ROW.findall(_markdown(artifact)):
        when = _date(
            f"{date_text.replace('-', '/')} {time_text}".strip(), ("%m/%d/%Y %I:%M %p", "%m/%d/%Y")
        )
        cells = [first_cell, *rest.split("|")]
        meeting = first_cell.strip()
        for cell in cells:
            for text, url, _ in MD_LINK.findall(cell):
                if "AgendaCenter" in url and not meeting:
                    meeting = text
        for cell in cells:
            for text, url, _ in MD_LINK.findall(cell):
                target = _unsplash(url)
                if not re.search(r"/home/show(?:published)?document", target, re.I):
                    continue
                label = text.lower()
                if "minute" in label:
                    kind = "minutes"
                else:
                    kind = "agenda" if "agenda" in label else "meeting_document"
                title = f"{meeting or source.name} – {text} ({date_text})"
                refs.append(DocumentRef(target, title, kind, when))
    return _dedupe(refs)


NEWS_ITEM = re.compile(
    r"\[([^\]]+)\]\((https://www\.fremont\.gov/Home/Components/News/News/\d+/\d+)[^)]*\)"
    r"\s*(\d{2}/\d{2}/\d{4} \d{1,2}:\d{2} [AP]M)?"
)


def _civicplus_news(source: Source, artifact: Artifact) -> list[DocumentRef]:
    refs = [
        DocumentRef(url, title, "news", _date(when, ("%m/%d/%Y %I:%M %p",)) if when else None)
        for title, url, when in NEWS_ITEM.findall(_markdown(artifact))
    ]
    return _dedupe(refs)


REQUEST_CARD = re.compile(
    r"\[!\[Image attached to service request with ID (CAS-[\w-]+)\]\([^)]*\)(.*?)\]"
    r"\((https://fremontca\.citysourced\.com/servicerequests/[0-9a-fA-F-]{36})\)",
    re.S,
)


def _citysourced_requests(source: Source, artifact: Artifact) -> list[DocumentRef]:
    refs = []
    for request_id, body, url in REQUEST_CARD.findall(_markdown(artifact)):
        parts = [part.strip(" \\\n") for part in re.split(r"\\+\s*\n", body)]
        parts = [part for part in parts if part and not part.startswith("ID #") and "Updated:" not in part]
        category = parts[0] if parts else "Service request"
        refs.append(DocumentRef(url, f"Fremont App request {request_id}: {category}", "service_request"))
    return _dedupe(refs)


def _civicplus_page(source: Source, artifact: Artifact) -> list[DocumentRef]:
    base = source.url.rstrip("/")
    refs = [DocumentRef(source.url, source.name, "page")]
    for text, url, _ in MD_LINK.findall(_markdown(artifact)):
        clean = url.split("#")[0].rstrip("/")
        if clean.startswith(base + "/"):
            refs.append(DocumentRef(clean, text, "page"))
    return _dedupe(refs)


def _districts() -> tuple[int, int]:
    params = get_source("ca-legislature-bills").params
    return int(params["assembly_district"]), int(params["senate_district"])


def _assembly_members(source: Source, artifact: Artifact) -> list[DocumentRef]:
    page = artifact.raw.decode("utf-8", "replace")
    assembly_district, _ = _districts()
    refs = []
    for match in re.finditer(rf'href="/assemblymembers/{assembly_district}"', page):
        start = page.rfind("<li", 0, match.start())
        end = page.find("</li>", match.end())
        if start == -1 or end == -1:
            continue
        text = _visible_text(page[start:end])
        refs.append(
            DocumentRef(
                f"https://www.assembly.ca.gov/assemblymembers/{assembly_district}",
                f"California State Assembly District {assembly_district} member",
                "legislator",
                inline_text=text,
                locator=f"member card, district {assembly_district}",
            )
        )
        break
    return refs


def _senate_members(source: Source, artifact: Artifact) -> list[DocumentRef]:
    page = artifact.raw.decode("utf-8", "replace")
    _, senate_district = _districts()
    page = page.split("<footer")[0]  # the last card otherwise runs into the page footer
    cards = re.split(r'(?=<div class="page-members__member")', page)
    marker = f'data-district="{senate_district}"'
    for card in cards:
        if card.startswith('<div class="page-members__member"') and marker in card[:300]:
            return [
                DocumentRef(
                    source.url,
                    f"California State Senate District {senate_district} member",
                    "legislator",
                    inline_text=_visible_text(card),
                    locator=f"member card, district {senate_district}",
                )
            ]
    return []


def _not_built(source: Source, artifact: Artifact) -> list[DocumentRef]:
    raise NotImplementedError(f"discovery for parser {source.parser!r} is not built yet")


PARSERS: dict[str, Callable[[Source, Artifact], list[DocumentRef]]] = {
    "iqm2_calendar": _iqm2_calendar,
    "civicplus_agenda_center": _civicplus_agenda_center,
    "civicplus_news": _civicplus_news,
    "citysourced_requests": _citysourced_requests,
    "civicplus_page": _civicplus_page,
    "assembly_members": _assembly_members,
    "senate_members": _senate_members,
    "simbli_meetings": _not_built,
    "leginfo_pubinfo": _not_built,
    "arcgis_featureserver": _not_built,
}


def discover(source: Source, artifact: Artifact) -> list[DocumentRef]:
    return PARSERS[source.parser](source, artifact)
