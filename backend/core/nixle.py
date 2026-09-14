"""Nixle alerts from City of Fremont agencies (police, city), one document per alert.

An agency listing (base URL, then ?page=N) gives each alert's publication id, priority and headline.
The alert page (https://local.nixle.com/alert/<id>/) gives the agency, the posting time and the full
message. robots.txt on local.nixle.com disallows only /region_search/ and /agency_search/.
params: max_pages (listing pages to read, default 10).
"""

import html
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from core import neighborhoods
from core.discovery import DocumentRef, _dedupe
from core.fetcher import Fetcher
from core.registry import Source

ALERT_URL = "https://local.nixle.com/alert/{id}/"
FREMONT_TZ = ZoneInfo("America/Los_Angeles")
DEFAULT_MAX_PAGES = 10

ITEM = re.compile(r'<li id="pub_(\d+)"[^>]*>(.*?)</li>', re.S)
PRIORITY = re.compile(r'<span class="priority ([\w-]+)">\s*(.*?)\s*</span>', re.S)
ENTERED = re.compile(r'<h2 class="time">\s*(.*?)\s*</h2>', re.S)
LISTING_HEADLINE = re.compile(r'<p class="headline_agency">(.*?)(?:<a\b|</p>)', re.S)

POSTED = re.compile(r'<dl class="last[^"]*">\s*<dd>\s*(.*?)\s*</dd>', re.S)
AGENCY = re.compile(r'<dd class="certified">(.*?)</dd>', re.S)
DETAIL_HEADLINE = re.compile(r'<div class="full_message_info">.*?<h2[^>]*>(.*?)</h2>', re.S)
DETAIL_PRIORITY = re.compile(r'<div class="full_message_info">.*?<span class="priority [\w-]+">\s*(.*?)\s*</span>', re.S)
PAGE_TITLE = re.compile(r"<title>(.*?)</title>", re.S)
BODY = re.compile(r'<div id="alert-body">(.*?)</div>\s*(?=<p class="agency|<div|</div>)', re.S)
POSTED_TIME = re.compile(
    r"([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\s*(?:::|,|at)?\s*"
    r"(?:(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?|(noon|midnight))",
    re.I,
)
RELATIVE_PART = re.compile(r"(\d+)\s+(minute|hour|day|week|month|year)s?", re.I)
RELATIVE_UNITS = {
    "minute": timedelta(minutes=1),
    "hour": timedelta(hours=1),
    "day": timedelta(days=1),
    "week": timedelta(weeks=1),
    "month": timedelta(days=30),
    "year": timedelta(days=365),
}
INLINE_TAGS = re.compile(r"</?(?:a|b|i|em|strong|span|sup|sub|u|font)\b[^>]*>", re.I)
BREAKS = re.compile(r"<br\s*/?>|</p>|</div>|</li>|</h\d>|</tr>", re.I)
# A neighborhood name that is really a street or school name ("Warm Springs Blvd", "Weibel Elementary").
NOT_A_PLACE = (
    r"(?!\s+(?:Blvd|Boulevard|Rd|Road|Dr|Drive|Ave?|Avenue|St|Street|Pkwy|Parkway|Way|Ct|Court|Ln|Lane|"
    r"Pl|Place|Elementary|Middle|High|School)\b)"
)


@dataclass
class ListingItem:
    pub_id: str
    priority: str
    entered: str
    headline: str


def _text(fragment: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def listing_url(base: str, page: int) -> str:
    return base if page == 1 else f"{base}?page={page}"


def listing_items(page: str) -> list[ListingItem]:
    items = []
    for pub_id, body in ITEM.findall(page):
        priority = PRIORITY.search(body)
        entered = ENTERED.search(body)
        headline = LISTING_HEADLINE.search(body)
        items.append(
            ListingItem(
                pub_id,
                _text(priority.group(2)) if priority else "",
                _text(entered.group(1)) if entered else "",
                _text(headline.group(1)) if headline else "",
            )
        )
    return items


def parse_posted(text: str) -> datetime | None:
    """'Wednesday September 9th, 2026 :: 11:43 a.m. PDT' as naive Fremont local time."""
    match = POSTED_TIME.search(text)
    if not match:
        return None
    month, day, year, hour, minute, meridiem, word = match.groups()
    if word:
        hour, minute, meridiem = "12", "00", "p" if word.lower() == "noon" else "a"
    stamp = f"{month} {day} {year} {hour}:{minute} {meridiem.upper()}M"
    for fmt in ("%B %d %Y %I:%M %p", "%b %d %Y %I:%M %p"):
        try:
            return datetime.strptime(stamp, fmt)
        except ValueError:
            continue
    return None


def parse_entered(text: str, now: datetime) -> datetime | None:
    """'Entered: 5 days, 1 hour ago' relative to when the listing was fetched."""
    parts = RELATIVE_PART.findall(text)
    if not parts:
        return None
    return now - sum((int(count) * RELATIVE_UNITS[unit.lower()] for count, unit in parts), timedelta())


def message_text(fragment: str) -> str:
    fragment = re.sub(r'<span class="__cf_email__"[^>]*>.*?</span>', "(email address on the Nixle page)", fragment, flags=re.S)
    fragment = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", fragment, flags=re.S | re.I)
    fragment = INLINE_TAGS.sub("", BREAKS.sub("\n", fragment))
    text = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    lines = [" ".join(line.split()) for line in text.splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def mentioned_neighborhoods(text: str, names: list[str]) -> list[str]:
    found = []
    for name in names:
        variants = {name, *(part.strip() for part in name.split("/") if len(part.strip()) > 3)}
        if any(re.search(rf"(?<![\w-]){re.escape(variant)}(?![\w-]){NOT_A_PLACE}", text) for variant in variants):
            found.append(name)
    return sorted(found)


def _fremont_time(value: datetime) -> str:
    return f"{value:%B} {value.day}, {value.year}, {value.strftime('%I:%M %p').lstrip('0')}"


def alert_ref(
    item: ListingItem, page: str, url: str, agency_name: str, fetched_at: datetime, names: list[str]
) -> DocumentRef | None:
    headline_match = DETAIL_HEADLINE.search(page)
    headline = _text(headline_match.group(1)) if headline_match else item.headline
    agency_match = AGENCY.search(page)
    agency = _text(agency_match.group(1)) if agency_match else agency_name
    title_match = PAGE_TITLE.search(page)
    if title_match and not headline:
        quoted = re.match(r"^[“\"](.*)[”\"] from (.+?) : Nixle$", _text(title_match.group(1)))
        headline = quoted.group(1) if quoted else ""
    if not headline:
        return None
    priority_match = DETAIL_PRIORITY.search(page)
    priority = _text(priority_match.group(1)) if priority_match else item.priority
    posted_match = POSTED.search(page)
    posted = parse_posted(_text(posted_match.group(1))) if posted_match else None
    approximate = False
    if posted is None:
        # The alert page normally prints an absolute time ("Wednesday September 9th, 2026 :: 11:43 a.m.
        # PDT"). Without it, fall back to the listing's relative "Entered: 5 days, 1 hour ago" measured
        # from when the page was fetched; that is only accurate to the largest unit it names.
        now = fetched_at.astimezone(FREMONT_TZ).replace(tzinfo=None) if fetched_at.tzinfo else fetched_at
        posted = parse_entered(item.entered, now)
        approximate = posted is not None
    body_match = BODY.search(page)
    body = message_text(body_match.group(1)) if body_match else ""

    lines = [f"# {headline}", "", f"- Agency: {agency}"]
    if priority:
        lines.append(f"- Priority: {priority}")
    if posted:
        suffix = " (approximate, from the listing's relative time)" if approximate else " (Fremont time)"
        lines.append(f"- Posted: {_fremont_time(posted)}{suffix}")
    mentioned = mentioned_neighborhoods(f"{headline}\n{body}", names) if names else []
    if mentioned:
        lines.append(f"- Neighborhoods mentioned: {', '.join(mentioned)}")
    if body:
        lines += ["", "## Full notification", body]
    return DocumentRef(url, headline, "public_safety_alert", posted, inline_text="\n".join(lines) + "\n", locator="alert")


def expand(fetcher: Fetcher, source: Source, ref: DocumentRef) -> list[DocumentRef]:
    base = source.url.split("?")[0]
    max_pages = max(1, int(source.params.get("max_pages", DEFAULT_MAX_PAGES)))
    items: list[ListingItem] = []
    seen: set[str] = set()
    for number in range(1, max_pages + 1):
        listing = fetcher.fetch(listing_url(base, number), "http", None, source.send_user_agent)
        if listing.status == 404 and number > 1:
            break  # past the last page
        if not listing.status or listing.status >= 400:
            raise RuntimeError(f"Nixle listing page {number} returned status {listing.status}")
        found = [item for item in listing_items(listing.raw.decode("utf-8", "replace")) if item.pub_id not in seen]
        if not found:
            break
        items.extend(found)
        seen.update(item.pub_id for item in found)

    try:
        names = neighborhoods.names(fetcher)
    except Exception as error:  # neighborhood mentions are optional context
        print(f"  warning: neighborhood names unavailable: {type(error).__name__}: {str(error)[:120]}")
        names = []
    refs = []
    for item in items:
        url = ALERT_URL.format(id=item.pub_id)
        try:
            detail = fetcher.fetch(url, "http", None, source.send_user_agent)
        except Exception as error:
            print(f"  warning: skipped {url}: {type(error).__name__}: {str(error)[:120]}")
            continue
        if not detail.status or detail.status >= 400:
            print(f"  warning: skipped {url}: status {detail.status}")
            continue
        ref_ = alert_ref(item, detail.raw.decode("utf-8", "replace"), url, source.name, detail.fetched_at, names)
        if ref_:
            refs.append(ref_)
    return _dedupe(refs)
