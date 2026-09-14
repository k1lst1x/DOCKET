"""Fremont App (CitySourced) service requests from the portal's own JSON API, one document per request.

The public "nearby" page sets session cookies and embeds a CSRF token; the page's script then POSTs a
NEARBYREQUEST query to callapiendpoint.ashx. One query from anywhere in Fremont returns every request
in the city (contract verified 2026-09-14), so a crawl needs two plain HTTP requests and no Firecrawl.

Stored per request: category, reported and updated times (Fremont local), status, street address,
official neighborhood, coordinates and description. Reporter and parent-case identifiers
(ReportedById, ParentCaseId) are never copied into a document.
"""

import ast
import html
import json
import math
import re
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from core import neighborhoods
from core.discovery import DocumentRef, _dedupe
from core.fetcher import Fetcher
from core.registry import Source

API_URL = "https://fremontca.citysourced.com/pages/ajax/callapiendpoint.ashx"
REQUEST_URL = "https://fremontca.citysourced.com/servicerequests/{id}"
FREMONT_TZ = ZoneInfo("America/Los_Angeles")
QUERY_POINT = ("-121.9886", "37.5485")  # any point in Fremont; the endpoint returns the whole city
TOKEN_INPUT = re.compile(r'<input\b[^>]*\bid="hdnCsrfToken"[^>]*>', re.I)
VALUE_ATTRIBUTE = re.compile(r'\bvalue="([^"]*)"')
GUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
TIME_FORMAT = "%m/%d/%Y %I:%M:%S %p"


def csrf_token(page: str) -> str | None:
    tag = TOKEN_INPUT.search(page)
    value = VALUE_ATTRIBUTE.search(tag.group(0)) if tag else None
    return html.unescape(value.group(1)) if value and value.group(1) else None


def query_form(token: str) -> dict[str, str]:
    body = {
        "Endpoint": "NEARBYREQUEST",
        "XCoordinate": QUERY_POINT[0],
        "YCoordinate": QUERY_POINT[1],
        "IncludeAttachmentInfo": "false",
    }
    request = {
        "Path": "rst_oneviewcustomactions",
        "AuthType": 2,
        "HTTPVerb": "POST",
        "Body": json.dumps(body),
        "IsCustomAction": True,
    }
    return {
        "uniqueid": "docket-civic-research",
        "verb": "Post",
        "endpoint": "D365Proxy",
        "token": token,
        "json": json.dumps(request),
    }


def _clean(value: object) -> str:
    return " ".join(str(value).split()) if value is not None else ""


def _name_by_regex(text: str) -> str:
    # For a repr that literal_eval rejects, e.g. an unescaped apostrophe inside single quotes: take the
    # quoted value up to the quote that is followed by the next key or the closing brace.
    for key in ("NameEN", "Name"):
        match = re.search(
            rf"""['"]{key}['"]\s*:\s*(['"])(.*?)\1\s*(?:,\s*['"]\w+['"]\s*:|\}}|$)""", text, re.S
        )
        if match and match.group(2).strip():
            return _clean(match.group(2).replace("\\'", "'").replace('\\"', '"'))
    return ""


def lookup_name(value: object) -> str:
    """NameEN (or Name) of a lookup field, which arrives as a JSON object or as its Python-repr text."""
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return ""
        if not text.startswith("{"):
            return _clean(text)
        parsed = None
        if len(text) <= 4000:
            try:
                parsed = ast.literal_eval(text)  # literals only; nothing is executed
            except (ValueError, SyntaxError, MemoryError, RecursionError):
                try:
                    parsed = json.loads(text)
                except ValueError:
                    parsed = None
        if not isinstance(parsed, dict):
            return _name_by_regex(text)
        value = parsed
    if isinstance(value, dict):
        return _clean(value.get("NameEN") or value.get("Name") or "")
    return ""


def utc_to_fremont(value: object) -> datetime | None:
    """CreatedOn and ModifiedOn are UTC; documents carry naive Fremont local time like other parsers."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.strptime(value.strip(), TIME_FORMAT)
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC).astimezone(FREMONT_TZ).replace(tzinfo=None)


def fremont_time(value: datetime) -> str:
    return f"{value:%B} {value.day}, {value.year}, {value.strftime('%I:%M %p').lstrip('0')}"


def _coordinate(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number != 0 else None


def _description(value: object) -> str:
    if not isinstance(value, str):
        return ""
    lines = [" ".join(line.split()) for line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def record_ref(record: dict, today: date, fetcher: Fetcher | None = None) -> DocumentRef | None:
    request_id = _clean(record.get("Id"))
    if not GUID.fullmatch(request_id):
        return None
    case = _clean(record.get("CaseNumber")) or request_id
    category = lookup_name(record.get("RequestDetail")) or "Service request"
    created = utc_to_fremont(record.get("CreatedOn"))
    modified = utc_to_fremont(record.get("ModifiedOn"))
    status = lookup_name(record.get("ServiceActivityStatus"))
    reason = lookup_name(record.get("ServiceActivityStatusReason"))
    lat, lng = _coordinate(record.get("Latitude")), _coordinate(record.get("Longitude"))
    neighborhood = neighborhoods.neighborhood_for(lat, lng, fetcher) if lat is not None and lng is not None else None

    title = f"Fremont App request {case}: {category}" + (f" – {neighborhood}" if neighborhood else "")
    lines = [f"# {title}", "", f"- Case number: {case}", f"- Category: {category}"]
    if created:
        lines.append(f"- Reported: {fremont_time(created)} (Fremont time)")
    if modified:
        lines.append(f"- Last updated: {fremont_time(modified)} (Fremont time)")
    if status:
        detail = f" ({reason})" if reason and reason.lower() != status.lower() else ""
        lines.append(f"- Status as of {today:%B} {today.day}, {today.year}: {status}{detail}")
    street = _clean(record.get("Line1"))
    city, state, zip_code = lookup_name(record.get("City")), lookup_name(record.get("State")), _clean(record.get("ZipCode"))
    if street:
        place = " ".join(part for part in (", ".join(p for p in (city, state) if p), zip_code) if part)
        lines.append(f"- Address: {street}" + (f", {place}" if place else ""))
    elif zip_code:
        lines.append(f"- ZIP code: {zip_code}")
    lines.append(f"- Neighborhood: {neighborhood or 'unknown'}")
    if lat is not None and lng is not None:
        lines.append(f"- Coordinates: {lat:.5f}, {lng:.5f}")
    description = _description(record.get("Description"))
    if description:
        lines += ["", "## Description", description]
    return DocumentRef(
        REQUEST_URL.format(id=request_id.lower()),
        title,
        "service_request",
        created,
        inline_text="\n".join(lines) + "\n",
        locator="service request",
    )


def parse_response(raw: bytes) -> list[dict]:
    data = json.loads(raw.decode("utf-8"))
    if isinstance(data, str):  # tolerate a JSON document wrapped in a JSON string
        data = json.loads(data)
    if not isinstance(data, dict):
        raise RuntimeError("Fremont App API returned an unexpected payload")
    if data.get("HasErrors"):
        raise RuntimeError(f"Fremont App API reported errors: {str(data.get('Errors'))[:300]}")
    results = data.get("Results") or []
    if not isinstance(results, list):
        raise RuntimeError("Fremont App API returned no Results list")
    count = data.get("ResultsCount")
    if isinstance(count, int) and count != len(results):
        print(f"  warning: Fremont App API ResultsCount={count} but {len(results)} results were returned")
    return [record for record in results if isinstance(record, dict)]


def expand(fetcher: Fetcher, source: Source, ref: DocumentRef) -> list[DocumentRef]:
    # A fresh GET gives this crawl its own session cookies and CSRF token for the POST that follows.
    page = fetcher.fetch(source.url, "http", None, source.send_user_agent)
    if not page.status or page.status >= 400:
        raise RuntimeError(f"Fremont App page returned status {page.status}")
    token = csrf_token(page.raw.decode("utf-8", "replace"))
    if not token:
        raise RuntimeError("Fremont App page has no CSRF token (hdnCsrfToken)")
    response = fetcher.post_form(
        API_URL, query_form(token), {"X-Requested-With": "XMLHttpRequest", "Referer": source.url}
    )
    if not response.status or response.status >= 400:
        raise RuntimeError(f"Fremont App API returned status {response.status}")
    today = datetime.now(FREMONT_TZ).date()
    refs = [record_ref(record, today, fetcher) for record in parse_response(response.raw)]
    return _dedupe([ref for ref in refs if ref])
