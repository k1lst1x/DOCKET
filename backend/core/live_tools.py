"""Live, read-only lookups for the resident chat agent.

Docket's own data in Aurora DSQL (issues with neighbors' votes and reviews, recorded meeting decisions, feed
posts), the public real-time feeds behind the website's Places map (CHP, Caltrans, USGS, CAL FIRE, power
outages, National Weather Service), local news, Google Places and the web. Every result is a
retrieval.Evidence with a "lookup:" chunk id, so an answer built on it goes through the same citation
enforcement as stored documents and is never saved as a stored-chunk citation.

Rules kept here:
- read-only: nothing writes, posts, sends or contacts anyone;
- sample rows (is_sample) never appear, and a feed post appears only once all its photos and videos passed review;
- neighbors' votes, reviews and posts are labeled as residents' opinions;
- web pages are read only where robots.txt allows Docket, and never from sites that need a login;
- feed and news filters mirror frontend/src/lib/live and frontend/src/lib/news, so chat and the website agree.
"""

import html
import logging
import math
import re
import threading
import time
import unicodedata
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode, urlparse
from urllib.robotparser import RobotFileParser
from zoneinfo import ZoneInfo

import httpx
import psycopg

from core import retrieval, settings
from core.geo import slugify

log = logging.getLogger("docket.live")

FREMONT_TZ = ZoneInfo("America/Los_Angeles")
TIMEOUT_S = 12
MAX_TEXT_CHARS = 2500


class LiveUnavailable(Exception):
    """A source that isn't set up or can't answer right now. The message is shown to the model."""


# ---------------------------------------------------------------------------------------------------------
# Shared helpers


@dataclass(frozen=True)
class Bounds:
    north: float
    south: float
    east: float
    west: float

    def padded(self, degrees: float) -> "Bounds":
        return Bounds(self.north + degrees, self.south - degrees, self.east + degrees, self.west - degrees)

    def contains(self, lat: float, lng: float) -> bool:
        return self.south <= lat <= self.north and self.west <= lng <= self.east

    @property
    def center(self) -> tuple[float, float]:
        return ((self.north + self.south) / 2, (self.east + self.west) / 2)


# The 32 official neighborhoods together (frontend/src/data/fremont-neighborhoods.json).
FREMONT_BOUNDS = Bounds(north=37.606679, south=37.454193, east=-121.870124, west=-122.069859)
# Fremont plus about 8 km on every side, for road, traffic and outage feeds.
NEARBY_BOUNDS = FREMONT_BOUNDS.padded(0.08)


def km_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1 = map(math.radians, a)
    lat2, lng2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def fremont_date(value: datetime | date) -> str:
    """ "September 14, 2026" in Fremont, a form citation enforcement recognizes."""
    if isinstance(value, datetime):
        value = value.astimezone(FREMONT_TZ)
    return f"{value:%B} {value.day}, {value.year}"


def fremont_time(value: datetime) -> str:
    local = value.astimezone(FREMONT_TZ)
    hour = local.hour % 12 or 12
    return f"{fremont_date(local)} at {hour}:{local:%M} {'AM' if local.hour < 12 else 'PM'}"


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=FREMONT_TZ)


def _parse_iso(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return _aware(datetime.fromisoformat(value.strip().replace("Z", "+00:00")))
    except ValueError:
        return None


def _from_epoch_ms(value: object) -> datetime | None:
    return datetime.fromtimestamp(value / 1000, UTC) if isinstance(value, int | float) and value > 0 else None


def _clean(text: str | None) -> str:
    """Plain single-spaced text. NFKC turns the narrow and thin spaces feeds use into ordinary spaces."""
    return re.sub(r"[ \t]+", " ", unicodedata.normalize("NFKC", text or "")).strip()


def _clip(text: str, limit: int = MAX_TEXT_CHARS) -> str:
    text = re.sub(r"\n{3,}", "\n\n", _clean(text))
    return text if len(text) <= limit else f"{text[: limit - 1].rstrip()}…"


def evidence(
    kind: str,
    key: str,
    *,
    source: str,
    title: str,
    url: str | None,
    locator: str,
    text: str,
    when: datetime | None = None,
) -> retrieval.Evidence:
    return retrieval.Evidence(
        chunk_id=f"lookup:{uuid.uuid4()}",
        document_id=f"lookup:{kind}:{key}"[:300],
        source_id=f"live:{kind}",
        source_name=source,
        title=_clean(title)[:300],
        url=url or "",
        locator=locator,
        doc_type=f"live_{kind}",
        published_at=when.astimezone(UTC).isoformat() if when else None,
        text=_clip(text),
    )


_cache: dict[str, tuple[float, object]] = {}
_cache_lock = threading.Lock()


def _cached(key: str, ttl_s: float, load: Callable[[], object]) -> object:
    """Keep a feed for its refresh interval, so a busy chat doesn't hammer public sources."""
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl_s:
            return hit[1]
    value = load()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _http_get(url: str, *, params: dict | None = None, accept: str = "*/*", timeout: float = TIMEOUT_S) -> httpx.Response:
    response = httpx.get(
        url,
        params=params,
        headers={"User-Agent": settings.USER_AGENT, "Accept": accept},
        timeout=timeout,
        follow_redirects=True,
    )
    response.raise_for_status()
    return response


def _db(sql: str, params: tuple | dict = ()) -> list[tuple]:
    try:
        return retrieval._query(sql, params)
    except (psycopg.errors.UndefinedTable, psycopg.errors.UndefinedColumn):
        # A table or column another part of Docket hasn't created yet: nothing to report from it.
        log.warning("live lookup skipped a missing table or column", exc_info=True)
        return []
    except psycopg.OperationalError as error:
        raise LiveUnavailable("Docket's database can't be reached right now.") from error


def _keywords(query: str) -> list[str]:
    ignored = {"fremont", "docket", "neighborhood", "neighborhoods", "neighbors", "issue", "issues", "news", "city"}
    words = [word for word in retrieval.tokenize(query or "") if len(word) > 2 and word not in ignored]
    return list(dict.fromkeys(words))[:6]


def _match_count(text: str, words: list[str]) -> int:
    lower = text.casefold()
    return sum(word in lower for word in words)


# ---------------------------------------------------------------------------------------------------------
# Neighborhoods


@dataclass(frozen=True)
class Neighborhood:
    slug: str
    name: str
    bounds: Bounds


def _bounds_of(boundary: object) -> Bounds | None:
    points: list[tuple[float, float]] = []

    def walk(value: object) -> None:
        if isinstance(value, list | tuple):
            if len(value) == 2 and all(isinstance(n, int | float) for n in value):
                points.append((float(value[1]), float(value[0])))  # stored as [lng, lat]
            else:
                for item in value:
                    walk(item)

    walk(boundary)
    if not points:
        return None
    lats = [lat for lat, _ in points]
    lngs = [lng for _, lng in points]
    return Bounds(max(lats), min(lats), max(lngs), min(lngs))


def neighborhoods() -> list[Neighborhood]:
    def load() -> list[Neighborhood]:
        rows = _db("SELECT slug, name, boundary FROM neighborhoods ORDER BY name")
        return [Neighborhood(slug, name, _bounds_of(boundary) or FREMONT_BOUNDS) for slug, name, boundary in rows]

    return _cached("neighborhoods", 3600, load)  # type: ignore[return-value]


def resolve_neighborhood(name: str) -> Neighborhood | None:
    """The official neighborhood a name refers to. Blank or "Fremont" means the whole city."""
    citywide = {"", "all", "all of", "all of fremont", "citywide", "fremont", "fremont, ca", "fremont, california"}
    wanted = _clean(name)
    if wanted.casefold() in citywide:
        return None
    wanted = re.sub(r",?\s*fremont(,?\s*(ca|california))?$", "", wanted, flags=re.IGNORECASE).strip()
    if wanted.casefold() in citywide:
        return None
    try:
        known = neighborhoods()
    except LiveUnavailable:
        return None  # without the database, look across all of Fremont
    key = slugify(wanted)
    for area in known:
        if area.slug == key or area.name.casefold() == wanted.casefold():
            return area
    for area in known:
        if key and (key in area.slug or area.slug in key):
            return area
    if not known:
        return None
    names = ", ".join(area.name for area in known)
    raise LiveUnavailable(f"{name} is not one of Fremont's official neighborhoods ({names}).")


def _neighborhood_names(slugs: object) -> list[str]:
    if not isinstance(slugs, list):
        return []
    try:
        by_slug = {area.slug: area.name for area in neighborhoods()}
    except LiveUnavailable:
        by_slug = {}
    return [by_slug.get(slug, slug) for slug in slugs if isinstance(slug, str)]


# ---------------------------------------------------------------------------------------------------------
# Docket's own data: issues, decisions and the neighborhood feed

MEETING_BODIES = {
    "city_council": "City Council",
    "planning_commission": "Planning Commission",
    "zoning_administrator": "Zoning Administrator",
    "school_board": "FUSD Board of Education",
}
RESULTS = {
    "approved": "approved",
    "denied": "denied",
    "continued": "continued to a later meeting",
    "referred": "referred",
    "received": "received and filed",
    "no_action": "no action taken",
}

ISSUES_SQL = """
SELECT i.id, i.ref, i.title, i.body, i.status, i.topic, i.meeting_at, i.deadline, i.deadline_kind,
       i.neighborhood_slugs, i.group_slug, i.source_url, i.surfaced_at, a.summary, a.pros, a.cons
FROM issues i
LEFT JOIN issue_analyses a ON a.issue_id = i.id AND a.is_sample = false
WHERE i.is_sample = false AND i.status <> 'dismissed'
  AND (%(slug)s::text IS NULL
       OR %(slug)s IN (SELECT jsonb_array_elements_text(i.neighborhood_slugs))
       OR i.group_slug IN (SELECT g.slug FROM groups g WHERE g.neighborhood_slug = %(slug)s))
  AND (cardinality(%(patterns)s::text[]) = 0
       OR concat_ws(' ', i.ref, i.title, i.body, i.topic, a.summary) ILIKE ANY(%(patterns)s::text[]))
ORDER BY coalesce(i.deadline, i.meeting_at, i.surfaced_at) DESC
LIMIT 40
"""

STANCE_VOTES_SQL = """
SELECT p.issue_id, v.choice, count(*)::int
FROM polls p
JOIN votes v ON v.poll_id = p.id
JOIN members m ON m.id = v.member_id
WHERE p.issue_id = ANY(%s::text[]) AND p.kind = 'stance' AND m.is_sample = false
GROUP BY p.issue_id, v.choice
"""

REVIEWS_SQL = """
SELECT r.issue_id, count(*)::int, avg(r.rating)::float
FROM reviews r
JOIN members m ON m.id = r.member_id
WHERE r.issue_id = ANY(%s::text[]) AND m.is_sample = false
GROUP BY r.issue_id
"""

ISSUE_OUTCOMES_SQL = """
SELECT issue_id, body, meeting_date, item_label, result, action_text, vote
FROM agent_meeting_outcomes
WHERE issue_id = ANY(%s::text[])
ORDER BY meeting_date DESC
"""

COMMENT_TOPICS_SQL = """
SELECT issue_id, body, meeting_date, comment_count, support_count, oppose_count, mixed_count, neutral_count
FROM agent_comment_topics
WHERE issue_id = ANY(%s::text[])
"""


def _patterns(words: list[str]) -> list[str]:
    return [f"%{word}%" for word in words]


def vote_text(vote: object) -> str:
    """ "Vote: 5 ayes (Mei, Salwan, ...), 2 noes" from a recorded roll call."""
    if not isinstance(vote, dict):
        return ""
    parts = []
    for key, label in (("ayes", "ayes"), ("noes", "noes"), ("abstain", "abstaining"), ("absent", "absent")):
        value = vote.get(key)
        if isinstance(value, list):
            names = [str(name) for name in value if str(name).strip()]
            if names:
                parts.append(f"{len(names)} {label} ({', '.join(names)})")
        elif isinstance(value, int) and value > 0:
            parts.append(f"{value} {label}")
    return f"Vote: {', '.join(parts)}." if parts else ""


def _claims(label: str, items: object) -> list[str]:
    if not isinstance(items, list) or not items:
        return []
    lines = [f"{label}:"]
    for item in items[:5]:
        if isinstance(item, dict) and isinstance(item.get("text"), str):
            basis = " (Docket's inference)" if item.get("basis") == "inference" else ""
            lines.append(f"- {item['text']}{basis}")
    return lines if len(lines) > 1 else []


def issue_text(row: dict, votes: dict[str, int], review: tuple[int, float] | None, outcomes: list, comments: list) -> str:
    lines = [f"{row['ref']}: {row['title']}"]
    status = f"Status on Docket: {row['status']}."
    if row.get("topic"):
        status += f" Topic: {row['topic']}."
    lines.append(status)
    if row.get("meeting_at"):
        lines.append(f"Meeting: {fremont_time(row['meeting_at'])}.")
    if row.get("deadline"):
        lines.append(f"{row.get('deadline_kind') or 'Deadline'}: {fremont_time(row['deadline'])}.")
    names = _neighborhood_names(row.get("neighborhood_slugs"))
    if names:
        lines.append(f"Neighborhoods affected: {', '.join(names)}.")
    lines.append(f"Summary: {row['summary']}" if row.get("summary") else f"Details: {row['body']}")
    lines += _claims("Pros", row.get("pros"))
    lines += _claims("Cons", row.get("cons"))
    if votes:
        tally = ", ".join(
            f"{votes[choice]} {label}"
            for choice, label in (("support", "support"), ("oppose", "oppose"), ("pass", "passed"))
            if votes.get(choice)
        )
        lines.append(
            f"Neighbors' stance votes on Docket (residents' opinions, not an official vote): {tally}."
            if tally
            else "No neighbor votes on Docket yet."
        )
    else:
        lines.append("No neighbor votes on Docket yet.")
    if review and review[0]:
        lines.append(f"Neighbor reviews on Docket: {review[0]}, average rating {review[1]:.1f} out of 5.")
    for body, meeting_date, item_label, result, action_text, vote in outcomes:
        lines.append(
            f"Recorded outcome: {RESULTS.get(result, result)} at the {MEETING_BODIES.get(body, 'meeting')} "
            f"meeting on {fremont_date(meeting_date)} (item {item_label}). {action_text} {vote_text(vote)}".strip()
        )
    for body, meeting_date, total, support, oppose, mixed, neutral in comments:
        lines.append(
            f"Public comments sent for the {MEETING_BODIES.get(body, 'meeting')} meeting on "
            f"{fremont_date(meeting_date)}: {total} in total, {support} in support, {oppose} opposed, "
            f"{mixed} mixed and {neutral} neutral."
        )
    if row.get("source_url"):
        lines.append(f"Official record: {row['source_url']}")
    return "\n".join(lines)


ISSUE_COLUMNS = (
    "id", "ref", "title", "body", "status", "topic", "meeting_at", "deadline", "deadline_kind",
    "neighborhood_slugs", "group_slug", "source_url", "surfaced_at", "summary", "pros", "cons",
)  # fmt: skip


def docket_issues(query: str = "", neighborhood: str = "") -> list[retrieval.Evidence]:
    area = resolve_neighborhood(neighborhood)
    words = _keywords(query)
    rows = [
        dict(zip(ISSUE_COLUMNS, row, strict=True))
        for row in _db(ISSUES_SQL, {"slug": area.slug if area else None, "patterns": _patterns(words)})
    ]
    rows.sort(key=lambda r: -_match_count(f"{r['ref']} {r['title']} {r['body']} {r.get('summary') or ''}", words))
    rows = rows[:6]
    if not rows:
        return []
    ids = [row["id"] for row in rows]
    votes: dict[str, dict[str, int]] = {}
    for issue_id, choice, count in _db(STANCE_VOTES_SQL, (ids,)):
        votes.setdefault(issue_id, {})[choice] = count
    reviews = {issue_id: (count, average or 0.0) for issue_id, count, average in _db(REVIEWS_SQL, (ids,))}
    outcomes: dict[str, list] = {}
    for issue_id, *rest in _db(ISSUE_OUTCOMES_SQL, (ids,)):
        outcomes.setdefault(issue_id, []).append(rest)
    comments: dict[str, list] = {}
    for issue_id, *rest in _db(COMMENT_TOPICS_SQL, (ids,)):
        comments.setdefault(issue_id, []).append(rest)

    items = []
    for row in rows:
        url = (
            f"{settings.APP_URL}/g/{row['group_slug']}?issue={row['id']}"
            if row.get("group_slug")
            else row.get("source_url") or f"{settings.APP_URL}/groups"
        )
        items.append(
            evidence(
                "issue",
                row["id"],
                source="Docket issues",
                title=f"{row['ref']}: {row['title']}",
                url=url,
                locator="Docket's tracked issues, votes and reviews",
                text=issue_text(
                    row, votes.get(row["id"], {}), reviews.get(row["id"]), outcomes.get(row["id"], []),
                    comments.get(row["id"], []),
                ),
                when=row.get("meeting_at") or row.get("surfaced_at"),
            )
        )
    return items


DECISIONS_SQL = """
SELECT o.id, o.body, o.meeting_date, o.item_label, o.title, o.result, o.action_text, o.vote, o.source_url
FROM agent_meeting_outcomes o
LEFT JOIN issues i ON i.id = o.issue_id
WHERE (i.is_sample IS NOT TRUE)
  AND (%(slug)s::text IS NULL OR %(slug)s IN (SELECT jsonb_array_elements_text(o.neighborhood_slugs)))
  AND (cardinality(%(patterns)s::text[]) = 0
       OR concat_ws(' ', o.title, o.action_text, o.item_label) ILIKE ANY(%(patterns)s::text[]))
ORDER BY o.meeting_date DESC
LIMIT 40
"""


def meeting_decisions(query: str = "", neighborhood: str = "") -> list[retrieval.Evidence]:
    area = resolve_neighborhood(neighborhood)
    words = _keywords(query)
    rows = _db(DECISIONS_SQL, {"slug": area.slug if area else None, "patterns": _patterns(words)})
    rows = sorted(rows, key=lambda r: -_match_count(f"{r[4]} {r[6]}", words))[:8]
    items = []
    for decision_id, body, meeting_date, item_label, title, result, action_text, vote, source_url in rows:
        body_name = MEETING_BODIES.get(body, "Meeting")
        items.append(
            evidence(
                "decision",
                decision_id,
                source="Meeting minutes",
                title=f"{body_name}, {fremont_date(meeting_date)}: {title}",
                url=source_url,
                locator=f"Item {item_label}",
                text=(
                    f"At the {body_name} meeting on {fremont_date(meeting_date)}, item {item_label} ({title}) was "
                    f"{RESULTS.get(result, result)}. {action_text} {vote_text(vote)}"
                ),
                when=datetime(meeting_date.year, meeting_date.month, meeting_date.day, 12, tzinfo=FREMONT_TZ),
            )
        )
    return items


POSTS_SQL = """
SELECT p.id, p.body, p.created_at, p.neighborhood_slug, p.kind, p.sources, p.media, m.name,
       (SELECT count(*)::int FROM post_likes l WHERE l.post_id = p.id),
       (SELECT count(*)::int FROM posts r WHERE r.parent_id = p.id AND r.deleted_at IS NULL)
FROM posts p
JOIN members m ON m.id = p.member_id
WHERE p.deleted_at IS NULL AND p.parent_id IS NULL AND p.is_sample = false AND m.is_sample = false
  AND p.created_at > now() - interval '60 days'
  AND (%(slug)s::text IS NULL OR p.neighborhood_slug = %(slug)s)
  AND (cardinality(%(patterns)s::text[]) = 0 OR p.body ILIKE ANY(%(patterns)s::text[]))
ORDER BY p.created_at DESC
LIMIT 30
"""


def _media_keys(media: object) -> list[str]:
    if not isinstance(media, list):
        return []
    return [item["key"] for item in media if isinstance(item, dict) and isinstance(item.get("key"), str)]


def neighborhood_posts(query: str = "", neighborhood: str = "") -> list[retrieval.Evidence]:
    area = resolve_neighborhood(neighborhood)
    rows = _db(POSTS_SQL, {"slug": area.slug if area else None, "patterns": _patterns(_keywords(query))})
    keys = [key for row in rows for key in _media_keys(row[6])]
    approved = {key for key, status in _db("SELECT object_key, status FROM media_reviews WHERE object_key = ANY(%s::text[])", (keys,)) if status == "approved"} if keys else set()  # fmt: skip
    try:
        names = {n.slug: n.name for n in neighborhoods()}
    except LiveUnavailable:
        names = {}

    items = []
    for post_id, body, created_at, slug, kind, sources, media, author, likes, replies in rows:
        # Neighbors see a post only once every photo and video on it passed review; chat follows the same rule.
        if any(key not in approved for key in _media_keys(media)) or not (body or "").strip():
            continue
        where = names.get(slug, slug) if slug else "All of Fremont"
        by = "Docket" if kind == "docket" else author
        lines = [
            f"{by} posted to {where} on Docket's neighborhood feed on {fremont_time(created_at)}:",
            f'"{body.strip()}"',
            f"{likes} likes and {replies} replies.",
        ]
        if kind == "docket" and isinstance(sources, list):
            cited = [f"{s.get('title')} ({s.get('url')})" for s in sources if isinstance(s, dict) and s.get("url")]
            if cited:
                lines.append(f"Docket's sources: {'; '.join(cited)}.")
        else:
            lines.append("This is a neighbor's own post: their words and opinion, not verified by Docket.")
        items.append(
            evidence(
                "post",
                str(post_id),
                source="Docket neighborhood feed",
                title=f"Post by {by} in {where}",
                url=f"{settings.APP_URL}/",
                locator="Neighborhood feed",
                text="\n".join(lines),
                when=created_at,
            )
        )
        if len(items) == 10:
            break
    return items


# ---------------------------------------------------------------------------------------------------------
# Live incident feeds (mirrors frontend/src/lib/live/parsers.ts)

FREMONT_CENTER = FREMONT_BOUNDS.center
QUAKE_RADIUS_KM = 150
QUAKE_NEARBY_KM = 40
QUAKE_NOTABLE_MAG = 2.5
FIRE_RADIUS_KM = 200


@dataclass
class Incident:
    id: str
    kind: str  # traffic | closure | quake | fire | outage
    title: str
    detail: str
    severity: str  # minor | moderate | severe
    lat: float
    lng: float
    started: datetime | None
    ends: datetime | None
    source: str
    url: str


@dataclass
class Alert:
    id: str
    event: str
    headline: str
    severity: str
    area: str
    description: str
    instruction: str
    effective: datetime | None
    ends: datetime | None
    url: str


def _finite(value: object) -> bool:
    return isinstance(value, int | float) and math.isfinite(value)


def parse_usgs(data: dict) -> list[Incident]:
    incidents = []
    for feature in (data or {}).get("features") or []:
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        mag = props.get("mag")
        if len(coords) < 2 or not _finite(coords[0]) or not _finite(coords[1]) or not _finite(mag):
            continue
        lng, lat = coords[0], coords[1]
        km = km_between(FREMONT_CENTER, (lat, lng))
        if km > QUAKE_RADIUS_KM or (mag < QUAKE_NOTABLE_MAG and km > QUAKE_NEARBY_KM):
            continue
        incidents.append(
            Incident(
                id=f"quake-{feature.get('id')}",
                kind="quake",
                title=f"Magnitude {mag:.1f} earthquake",
                detail=props.get("place") or "",
                severity="severe" if mag >= 4.5 else "moderate" if mag >= 3 else "minor",
                lat=lat,
                lng=lng,
                started=_from_epoch_ms(props.get("time")),
                ends=None,
                source="USGS",
                url=props.get("url") or "https://earthquake.usgs.gov/earthquakes/map/",
            )
        )
    return incidents


def parse_calfire(data: dict) -> list[Incident]:
    incidents = []
    for feature in (data or {}).get("features") or []:
        p = feature.get("properties") or {}
        if p.get("Final") or p.get("IsActive") is False:
            continue
        lat, lng = p.get("Latitude"), p.get("Longitude")
        if not _finite(lat) or not _finite(lng) or km_between(FREMONT_CENTER, (lat, lng)) > FIRE_RADIUS_KM:
            continue
        acres = p.get("AcresBurned") if _finite(p.get("AcresBurned")) else None
        contained = p.get("PercentContained") if _finite(p.get("PercentContained")) else None
        detail = [
            f"{acres:,.0f} acres" if acres is not None else "",
            f"{round(contained)}% contained" if contained is not None else "",
            f"{p['County'].strip()} County" if p.get("County") else "",
            (p.get("Location") or "").strip(),
        ]
        incidents.append(
            Incident(
                id=f"fire-{p.get('UniqueId') or f'{lat},{lng}'}",
                kind="fire",
                title=(p.get("Name") or "Wildfire").strip(),
                detail="; ".join(part for part in detail if part),
                severity="severe" if (acres or 0) >= 1000 else "moderate" if (acres or 0) >= 100 else "minor",
                lat=lat,
                lng=lng,
                started=_parse_iso(p.get("Started")),
                ends=None,
                source="CAL FIRE",
                url=p.get("Url") or "https://www.fire.ca.gov/incidents",
            )
        )
    return incidents


CHP_CODES = {
    "1144": "Fatal collision",
    "1179": "Collision, ambulance responding",
    "1180": "Collision, major injuries",
    "1181": "Collision, minor injuries",
    "1182": "Collision, no injuries",
    "1183": "Collision, injuries unknown",
    "1125": "Traffic hazard",
    "1166": "Traffic signal out",
    "20001": "Hit and run, injuries",
    "20002": "Hit and run, no injuries",
    "23114": "Object thrown from vehicle",
}
CHP_SEVERE = {"1144", "1179", "1180", "20001"}
CHP_MODERATE = {"1181", "1183", "1125", "WW", "FIRE", "CFIRE", "SIG"}
CHP_WORDS = [
    (re.compile(r"\btrfc\b", re.IGNORECASE), "traffic"),
    (re.compile(r"\bveh\b", re.IGNORECASE), "vehicle"),
    (re.compile(r"\binj\b", re.IGNORECASE), "injury"),
    (re.compile(r"\bobstr\b", re.IGNORECASE), "obstruction"),
    (re.compile(r"\breq\b", re.IGNORECASE), "request"),
    (re.compile(r"\bambl?\b", re.IGNORECASE), "ambulance"),
    (re.compile(r"\bunkn?\b", re.IGNORECASE), "unknown"),
    (re.compile(r"\bped\b", re.IGNORECASE), "pedestrian"),
    (re.compile(r"\bconstr\b", re.IGNORECASE), "construction"),
    (re.compile(r"\bmaint\b", re.IGNORECASE), "maintenance"),
]
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def humanize_chp_type(raw: str) -> tuple[str, str]:
    text = raw.strip()
    match = re.match(r"^([A-Za-z0-9]+)\s*-\s*(.+)$", text)
    code = match.group(1).upper() if match else ""
    label = CHP_CODES.get(code) or (match.group(2) if match else text)
    if code not in CHP_CODES:
        for pattern, word in CHP_WORDS:
            label = pattern.sub(word, label)
        label = re.sub(r"\s*-\s*", ", ", label.lower())
        label = label[:1].upper() + label[1:]
    severity = "severe" if code in CHP_SEVERE else "moderate" if code in CHP_MODERATE else "minor"
    return label or "Traffic incident", severity


def pacific_time(text: str) -> datetime | None:
    """ "Sep 13 2026  6:34AM" in Pacific time."""
    match = re.match(r"^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$", text.strip(), re.IGNORECASE)
    if not match or match.group(1).lower() not in MONTHS:
        return None
    hour = int(match.group(4)) % 12 + (12 if match.group(6).upper() == "PM" else 0)
    month = MONTHS.index(match.group(1).lower()) + 1
    return datetime(int(match.group(3)), month, int(match.group(2)), hour, int(match.group(5)), tzinfo=FREMONT_TZ)


def _xml_field(block: str, tag: str) -> str:
    match = re.search(rf"<{tag}>(.*?)</{tag}>", block, re.DOTALL)
    return html.unescape(match.group(1)).strip().strip('"').strip() if match else ""


def parse_chp(xml: str) -> list[Incident]:
    incidents = []
    for match in re.finditer(r'<Log ID\s*=\s*"([^"]+)"\s*>(.*?)</Log>', xml, re.DOTALL):
        log_id, block = match.groups()
        coords = re.match(r"^(\d+):(\d+)$", _xml_field(block, "LATLON"))
        if not coords:
            continue
        lat, lng = int(coords.group(1)) / 1e6, -int(coords.group(2)) / 1e6
        if not NEARBY_BOUNDS.contains(lat, lng):
            continue
        title, severity = humanize_chp_type(_xml_field(block, "LogType"))
        area = _xml_field(block, "Area")
        detail = "; ".join(part for part in (_xml_field(block, "Location"), f"CHP {area}" if area else "") if part)
        incidents.append(
            Incident(
                id=f"chp-{log_id}",
                kind="traffic",
                title=title,
                detail=detail,
                severity=severity,
                lat=lat,
                lng=lng,
                started=pacific_time(_xml_field(block, "LogTime")),
                ends=None,
                source="CHP",
                url="https://cad.chp.ca.gov/Traffic.aspx",
            )
        )
    return incidents


def parse_closures(data: dict, now: datetime) -> list[Incident]:
    incidents = []
    now_s = now.timestamp()
    for record in (data or {}).get("data") or []:
        lcs = record.get("lcs") or {}
        closure = lcs.get("closure") or {}
        location = lcs.get("location") or {}
        begin = location.get("begin") or {}
        end = location.get("end") or {}
        if not lcs.get("index") or not closure or not begin:
            continue
        # 10-97: crew on scene and closure in place. 10-98: closure picked up. 10-22: cancelled.
        if (
            (closure.get("code1097") or {}).get("isCode1097") != "true"
            or (closure.get("code1098") or {}).get("isCode1098") == "true"
            or (closure.get("code1022") or {}).get("isCode1022") == "true"
        ):
            continue
        stamps = closure.get("closureTimestamp") or {}
        try:
            start = float(stamps.get("closureStartEpoch") or "nan")
            finish = float(stamps.get("closureEndEpoch") or "nan")
            lat, lng = float(begin.get("beginLatitude")), float(begin.get("beginLongitude"))
        except (TypeError, ValueError):
            continue
        indefinite = stamps.get("isClosureEndIndefinite") == "true"
        if math.isfinite(start) and start > now_s:
            continue
        if not indefinite and math.isfinite(finish) and 0 < finish < now_s:
            continue
        if not NEARBY_BOUNDS.contains(lat, lng):
            continue
        kind = (closure.get("typeOfClosure") or "Lane").strip()
        route = (begin.get("beginRoute") or "").strip()
        direction = re.sub(r"\s*/\s*", "/", location.get("travelFlowDirection") or "").strip()
        places = [p.strip() for p in (begin.get("beginLocationName"), end.get("endLocationName")) if p and p.strip()]
        try:
            lanes, total = int(closure.get("lanesClosed")), int(closure.get("totalExistingLanes"))
        except (TypeError, ValueError):
            lanes, total = None, None
        detail = [
            f"{places[0]} to {places[1]}" if len(places) == 2 and places[0] != places[1] else (places[0] if places else ""),
            (closure.get("typeOfWork") or "").strip(),
            f"{lanes} of {total} lanes closed" if lanes is not None and total else "",
        ]
        incidents.append(
            Incident(
                id=f"closure-{lcs['index']}",
                kind="closure",
                title=f"{kind} closure" + (f" on {route}" if route else "") + (f" {direction}" if direction else ""),
                detail="; ".join(part for part in detail if part),
                severity="severe"
                if re.search("full", kind, re.IGNORECASE)
                else "moderate"
                if lanes is not None and total and lanes / total >= 0.5
                else "minor",
                lat=lat,
                lng=lng,
                started=datetime.fromtimestamp(start, UTC) if math.isfinite(start) else None,
                ends=datetime.fromtimestamp(finish, UTC) if not indefinite and math.isfinite(finish) and finish > 0 else None,
                source="Caltrans",
                url="https://quickmap.dot.ca.gov/",
            )
        )
    return incidents


UTILITIES = {
    "PGE": ("PG&E", "https://pgealerts.alerts.pge.com/outage-tools/outage-map/"),
    "SCE": ("SCE", "https://www.sce.com/outage-center/check-outage-status"),
    "SDGE": ("SDG&E", "https://www.sdge.com/outage-map"),
}


def parse_outages(data: dict) -> list[Incident]:
    incidents = []
    for feature in (data or {}).get("features") or []:
        p = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates") or [] if geometry.get("type") == "Point" else []
        if len(coords) < 2 or not _finite(coords[0]) or not _finite(coords[1]):
            continue
        lng, lat = coords[0], coords[1]
        if not NEARBY_BOUNDS.contains(lat, lng):
            continue
        if p.get("OutageStatus") and not re.search("active", p["OutageStatus"], re.IGNORECASE):
            continue
        customers = p.get("ImpactedCustomers") if _finite(p.get("ImpactedCustomers")) else None
        company = (p.get("UtilityCompany") or "").upper()
        utility, url = UTILITIES.get(company, (p.get("UtilityCompany") or "Utility", ""))
        detail = [utility, (p.get("OutageType") or "").lower(), (p.get("Cause") or "").lower()]
        incidents.append(
            Incident(
                id=f"outage-{company or 'utility'}-{p.get('IncidentId') or p.get('OBJECTID') or f'{lat},{lng}'}",
                kind="outage",
                title=f"Power outage affecting {customers:,.0f} customers" if customers is not None else "Power outage",
                detail="; ".join(part for part in detail if part),
                severity="severe" if (customers or 0) >= 1000 else "moderate" if (customers or 0) >= 100 else "minor",
                lat=lat,
                lng=lng,
                started=_from_epoch_ms(p.get("StartDate")),
                ends=_from_epoch_ms(p.get("EstimatedRestoreDate")),
                source=utility,
                url=url,
            )
        )
    return incidents


ALERT_RANK = {"Extreme": 0, "Severe": 1, "Moderate": 2, "Minor": 3, "Unknown": 4}


def parse_nws_alerts(data: dict, now: datetime) -> list[Alert]:
    alerts, seen = [], set()
    lat, lng = FREMONT_CENTER
    for feature in (data or {}).get("features") or []:
        p = feature.get("properties") or {}
        alert_id = p.get("id") or feature.get("id")
        if not alert_id or not p.get("event") or alert_id in seen:
            continue
        if p.get("status") != "Actual" or p.get("messageType") == "Cancel":
            continue
        ends = _parse_iso(p.get("ends")) or _parse_iso(p.get("expires"))
        if ends and ends < now:
            continue
        seen.add(alert_id)
        alerts.append(
            Alert(
                id=alert_id,
                event=p["event"],
                headline=p.get("headline") or "",
                severity=p.get("severity") if p.get("severity") in ALERT_RANK else "Unknown",
                area=p.get("areaDesc") or "",
                description=p.get("description") or "",
                instruction=p.get("instruction") or "",
                effective=_parse_iso(p.get("effective")),
                ends=ends,
                url=f"https://forecast.weather.gov/MapClick.php?lat={lat:.4f}&lon={lng:.4f}",
            )
        )
    return sorted(alerts, key=lambda alert: ALERT_RANK[alert.severity])


@dataclass(frozen=True)
class Feed:
    kind: str
    name: str
    ttl_s: int
    load: Callable[[datetime], list]


def _load_chp(now: datetime) -> list[Incident]:
    return parse_chp(_http_get("https://media.chp.ca.gov/sa_xml/sa.xml", accept="text/xml").text)


def _load_closures(now: datetime) -> list[Incident]:
    return parse_closures(
        _http_get("https://cwwp2.dot.ca.gov/data/d4/lcs/lcsStatusD04.json", accept="application/json", timeout=25).json(),
        now,
    )


def _load_quakes(now: datetime) -> list[Incident]:
    lat, lng = FREMONT_CENTER
    params = {
        "format": "geojson",
        "latitude": f"{lat:.4f}",
        "longitude": f"{lng:.4f}",
        "maxradiuskm": str(QUAKE_RADIUS_KM),
        "starttime": (now - timedelta(hours=48)).strftime("%Y-%m-%dT%H:%M:%S"),
        "minmagnitude": "1",
        "orderby": "time",
        "limit": "100",
    }
    return parse_usgs(_http_get("https://earthquake.usgs.gov/fdsnws/event/1/query", params=params, accept="application/json").json())


def _load_fires(now: datetime) -> list[Incident]:
    url = "https://www.fire.ca.gov/umbraco/api/IncidentApi/GeoJsonList?inactive=false"
    return parse_calfire(_http_get(url, accept="application/json").json())


def _load_outages(now: datetime) -> list[Incident]:
    b = NEARBY_BOUNDS
    params = {
        "where": "1=1",
        "geometry": f"{b.west},{b.south},{b.east},{b.north}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "outSR": "4326",
        "f": "geojson",
    }
    url = "https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/Power_Outages_(View)/FeatureServer/0/query"
    return parse_outages(_http_get(url, params=params, accept="application/json").json())


def _load_alerts(now: datetime) -> list[Alert]:
    # CAZ508 is Fremont's forecast and fire-weather zone; CAC001 is Alameda County.
    url = "https://api.weather.gov/alerts/active?zone=CAZ508,CAC001"
    return parse_nws_alerts(_http_get(url, accept="application/geo+json").json(), now)


FEEDS = [
    Feed("traffic", "CHP live incidents", 60, _load_chp),
    Feed("closure", "Caltrans lane closures", 300, _load_closures),
    Feed("quake", "USGS earthquakes", 60, _load_quakes),
    Feed("fire", "CAL FIRE incidents", 300, _load_fires),
    Feed("outage", "power outages", 300, _load_outages),
    Feed("alert", "National Weather Service alerts", 60, _load_alerts),
]
KIND_ALIASES = {
    "traffic": "traffic", "crash": "traffic", "crashes": "traffic", "collision": "traffic", "chp": "traffic",
    "closure": "closure", "closures": "closure", "road": "closure", "roads": "closure", "caltrans": "closure",
    "quake": "quake", "quakes": "quake", "earthquake": "quake", "earthquakes": "quake",
    "fire": "fire", "fires": "fire", "wildfire": "fire", "wildfires": "fire",
    "outage": "outage", "outages": "outage", "power": "outage",
    "alert": "alert", "alerts": "alert", "weather": "alert",
}  # fmt: skip
KIND_LABELS = {
    "traffic": "CHP traffic incidents",
    "closure": "Caltrans lane closures",
    "quake": "earthquakes",
    "fire": "CAL FIRE wildfires",
    "outage": "power outages",
    "alert": "National Weather Service alerts",
}
SEVERITY_RANK = {"severe": 0, "moderate": 1, "minor": 2}
LOCAL_KINDS = {"traffic", "closure", "outage"}  # narrowed to a neighborhood; quakes, fires and alerts are regional


def live_incidents(kind: str = "", neighborhood: str = "", now: datetime | None = None) -> list[retrieval.Evidence]:
    now = now or datetime.now(UTC)
    area = resolve_neighborhood(neighborhood)
    wanted = KIND_ALIASES.get(kind.strip().lower()) if kind and kind.strip() else None
    feeds = [feed for feed in FEEDS if wanted in (None, feed.kind)]

    def run(feed: Feed) -> tuple[Feed, list | None]:
        try:
            return feed, _cached(f"feed:{feed.kind}", feed.ttl_s, lambda: feed.load(now))  # type: ignore[return-value]
        except Exception:
            log.warning("live feed failed: %s", feed.name, exc_info=True)
            return feed, None

    with ThreadPoolExecutor(max_workers=len(feeds)) as pool:
        results = list(pool.map(run, feeds))
    if all(items is None for _, items in results):
        raise LiveUnavailable("The live incident feeds can't be reached right now.")

    place = area.name if area else "Fremont"
    center = area.bounds.center if area else FREMONT_CENTER
    local_bounds = area.bounds.padded(0.01) if area else None
    incidents: list[Incident] = []
    alerts: list[Alert] = []
    counts: dict[str, int] = {}
    failed: list[str] = []
    for feed, items in results:
        if items is None:
            failed.append(feed.name)
            continue
        if feed.kind == "alert":
            alerts += items
            counts["alert"] = len(items)
            continue
        kept = [i for i in items if not (local_bounds and feed.kind in LOCAL_KINDS and not local_bounds.contains(i.lat, i.lng))]
        incidents += kept
        counts[feed.kind] = len(kept)

    checked = fremont_time(now)
    summary = [f"As of {checked}, Docket checked the live feeds near {place}."]
    summary += [f"{KIND_LABELS[k]}: {n}." for k, n in counts.items()]
    if failed:
        summary.append(f"Could not reach: {', '.join(failed)}.")
    items = [
        evidence(
            "incidents",
            f"summary:{wanted or 'all'}:{area.slug if area else 'fremont'}",
            source="Live incident feeds",
            title=f"Live incidents and alerts near {place}",
            url="",
            locator=f"Checked {checked}",
            text=" ".join(summary),
            when=now,
        )
    ]

    incidents.sort(key=lambda i: (SEVERITY_RANK.get(i.severity, 3), -(i.started.timestamp() if i.started else 0)))
    for incident in incidents[:12]:
        km = max(1, round(km_between(center, (incident.lat, incident.lng))))
        text = [f"{incident.source} reports: {incident.title}."]
        if incident.detail:
            text.append(f"{incident.detail}.")
        if incident.started:
            text.append(f"Started {fremont_time(incident.started)}.")
        if incident.ends:
            text.append(f"Expected to end {fremont_time(incident.ends)}.")
        text.append(f"About {km} km from {place}. Severity on Docket's map: {incident.severity}. Checked {checked}.")
        items.append(
            evidence(
                incident.kind,
                incident.id,
                source=incident.source,
                title=f"{incident.source}: {incident.title}",
                url=incident.url,
                locator=f"Live feed, checked {checked}",
                text=" ".join(text),
                when=incident.started,
            )
        )
    for alert in alerts[:5]:
        text = [f"National Weather Service: {alert.event}."]
        if alert.headline:
            text.append(alert.headline)
        if alert.area:
            text.append(f"Areas: {alert.area}.")
        text.append(f"Severity: {alert.severity}.")
        if alert.ends:
            text.append(f"In effect until {fremont_time(alert.ends)}.")
        if alert.description:
            text.append(alert.description[:1200])
        if alert.instruction:
            text.append(f"What to do: {alert.instruction[:600]}")
        items.append(
            evidence(
                "alert",
                alert.id,
                source="National Weather Service",
                title=f"National Weather Service: {alert.event}",
                url=alert.url,
                locator=f"Active alert, checked {checked}",
                text="\n".join(text),
                when=alert.effective,
            )
        )
    return items


# ---------------------------------------------------------------------------------------------------------
# Local news (mirrors frontend/src/lib/news)

DISTRICT_ALIASES = {
    "Niles": ["Niles", "Niles Canyon", "Niles Boulevard", "Niles Blvd"],
    "Irvington": ["Irvington", "Five Corners"],
    "Mission San Jose": ["Mission San Jose", "Mission Peak", "Ohlone College"],
    "Centerville": ["Centerville"],
    "Warm Springs": ["Warm Springs"],
}
FREMONT_NAMES = [
    "fremont", "mission san jose", "ardenwood", "pacific commons", "mission peak", "lake elizabeth",
    "coyote hills", "ohlone college", "niles canyon", "warm springs bart", "irvington bart", "fusd",
]  # fmt: skip
LOCAL_SOURCES = [
    "tri city voice", "tri-city voice", "patch", "east bay times", "mercury news", "sfgate",
    "san francisco chronicle", "kron4", "ktvu", "abc7", "nbc bay area", "kqed", "kpix", "cbs san francisco",
    "cbs news bay area", "bay city news", "caltrans", "california department of transportation", "city of fremont",
    "fremont police", "pleasanton weekly", "the oaklandside", "sfist", "fremont unified",
]  # fmt: skip
PROMOTIONAL_SOURCES = re.compile(
    r"(openpr|financialcontent|einpresswire|ein presswire|accesswire|newswire|press release|attorneys?|"
    r"law (group|firm|offices?)|\blaw\b|injury lawyers?|lawyers?|maxpreps)",
    re.IGNORECASE,
)
PROMOTIONAL_TITLE = re.compile(r"\b(top|best) [a-z ]*realtor|named #1|passes \d+ client reviews", re.IGNORECASE)
OTHER_FREMONTS = re.compile(
    r"\bfremont,?\s+(neb|nebraska|ohio|oh|mich|michigan|ind|indiana|wis|wisconsin|n\.?\s?c|north carolina|wyo?|"
    r"wyoming|n\.?\s?h|new hampshire|iowa|mo|missouri)\b|fremont tribune|news-messenger|fremont county|"
    r"fremont street experience|seattle'?s fremont|fremont, seattle|fremont bridge|wnax|kfor",
    re.IGNORECASE,
)
NEWS_MAX_AGE_DAYS = 45
NEWS_FEEDS = [
    ("Tri-City Voice", "https://www.tricityvoice.com/feed/", "article"),
    ("Patch Fremont", "https://patch.com/feeds/aol/california/fremont", "article"),
    ("r/Fremont", "https://www.reddit.com/r/fremont/new/.rss", "community"),
]


def _fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).lower()


def _contains_word(haystack: str, needle: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", haystack) is not None


def mentions_fremont_area(text: str) -> bool:
    folded = _fold(text)
    return any(_contains_word(folded, name) for name in FREMONT_NAMES)


def is_local_source(source: str | None) -> bool:
    name = _fold(source or "")
    return bool(name) and any(local in name for local in LOCAL_SOURCES)


def is_promotional(source: str | None, title: str) -> bool:
    return bool(PROMOTIONAL_SOURCES.search(source or "") or PROMOTIONAL_TITLE.search(title))


def _feed_text(value: str | None) -> str:
    """Feed text to plain text: CDATA unwrapped, HTML (often escaped twice) removed, whitespace collapsed."""
    unwrapped = html.unescape(re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", value or "", flags=re.DOTALL))
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", unwrapped))).strip()


def _tag(block: str, pattern: str) -> str | None:
    match = re.search(pattern, block, re.DOTALL)
    return match.group(1) if match else None


def _feed_date(value: str | None) -> datetime | None:
    text = _feed_text(value)
    if not text:
        return None
    try:
        return _aware(parsedate_to_datetime(text))
    except (TypeError, ValueError):
        return _parse_iso(text)


@dataclass
class Story:
    title: str
    url: str
    source: str | None
    published: datetime | None
    snippet: str


def parse_feed(xml: str) -> list[Story]:
    stories = []
    for match in re.finditer(r"<(item|entry)\b[^>]*>(.*?)</\1>", xml, re.DOTALL):
        block = match.group(2)
        title = _feed_text(_tag(block, r"<title\b[^>]*>(.*?)</title>"))
        url = _feed_text(_tag(block, r"<link\b[^>]*>(.*?)</link>")) or _feed_text(_tag(block, r'<link\b[^>]*href="([^"]+)"'))
        if not title or not re.match(r"^https?://", url):
            continue
        source = _feed_text(_tag(block, r"<source\b[^>]*>(.*?)</source>")) or None
        if source and title.endswith(f" - {source}"):  # Google News titles end with " - Publisher"
            title = title[: -(len(source) + 3)].strip()
        snippet = _feed_text(_tag(block, r"<description\b[^>]*>(.*?)</description>") or _tag(block, r"<content\b[^>]*>(.*?)</content>"))
        snippet = re.sub(r"submitted by\s+/u/\S+.*$", "", snippet, flags=re.IGNORECASE)
        snippet = re.sub(r"\[(link|comments)\]", "", snippet, flags=re.IGNORECASE).strip()
        if snippet and (snippet.lower().startswith(title.lower()) or snippet == source):
            snippet = ""  # Google News descriptions only repeat the headline and publisher
        published = _feed_date(
            _tag(block, r"<pubDate>(.*?)</pubDate>") or _tag(block, r"<published>(.*?)</published>") or _tag(block, r"<updated>(.*?)</updated>")
        )
        stories.append(Story(title, url, source, published, snippet[:700]))
    return stories


def _google_news(query: str) -> str:
    return "https://news.google.com/rss/search?" + urlencode({"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"})


def local_news(query: str = "", neighborhood: str = "", now: datetime | None = None) -> list[retrieval.Evidence]:
    now = now or datetime.now(UTC)
    area = resolve_neighborhood(neighborhood)
    words = _keywords(query)
    aliases = DISTRICT_ALIASES.get(area.name, [area.name]) if area else []
    topic = " ".join(words)
    if aliases:
        search = f"({' OR '.join(f'{a!r}'.replace(chr(39), chr(34)) for a in aliases[:3])}) Fremont {topic} when:30d"
    elif topic:
        search = f"{topic} Fremont California when:30d"
    else:
        search = '"Fremont, CA" OR "Fremont, Calif" when:7d'
    sources = [("Google News", _google_news(search), "article", True)] + [(n, u, k, False) for n, u, k in NEWS_FEEDS]

    def fetch(spec: tuple[str, str, str, bool]) -> tuple[tuple, list[Story] | None]:
        name, url, _, _ = spec
        try:
            feed = _cached(f"news:{url}", 300, lambda: parse_feed(_http_get(url, accept="application/rss+xml, application/xml, text/xml").text))
            return spec, feed  # type: ignore[return-value]
        except Exception:
            log.warning("news feed failed: %s", name, exc_info=True)
            return spec, None

    with ThreadPoolExecutor(max_workers=len(sources)) as pool:
        results = list(pool.map(fetch, sources))
    if all(stories is None for _, stories in results):
        raise LiveUnavailable("The news feeds can't be reached right now.")

    oldest = now - timedelta(days=NEWS_MAX_AGE_DAYS)
    seen: set[str] = set()
    kept: list[tuple[Story, str, str]] = []
    for (name, _, kind, searched), stories in results:
        for story in stories or []:
            text = f"{story.title} {story.snippet}"
            publisher = story.source or name
            if OTHER_FREMONTS.search(f"{text} {publisher}") or is_promotional(publisher, story.title):
                continue
            if story.published and story.published < oldest:
                continue
            names_area = bool(aliases) and any(_contains_word(_fold(text), _fold(a)) for a in aliases)
            fremont = mentions_fremont_area(text)
            if searched and not (fremont or names_area or (aliases and is_local_source(publisher))):
                continue
            if not searched and words and not _match_count(text, words):
                continue  # an outlet's whole feed: keep only stories about the topic asked
            if not searched and aliases and not names_area:
                continue
            if kind == "community" and not (words or aliases):
                continue  # r/Fremont chatter only when it matches a topic or neighborhood
            key = re.sub(r"[^a-z0-9]+", " ", _fold(story.title)).strip()
            if not key or key in seen:
                continue
            seen.add(key)
            kept.append((story, publisher, kind))

    kept.sort(key=lambda entry: -(entry[0].published.timestamp() if entry[0].published else 0))
    items = []
    for story, publisher, kind in kept[:8]:
        text = [story.title + ("" if story.title.endswith((".", "?", "!")) else ".")]
        if story.snippet:
            text.append(story.snippet)
        label = "Posted on r/Fremont (a resident's post, not news reporting)" if kind == "community" else f"Published by {publisher}"
        text.append(f"{label}" + (f" on {fremont_date(story.published)}." if story.published else "."))
        items.append(
            evidence(
                "news",
                story.url,
                source=publisher,
                title=story.title,
                url=story.url,
                locator="News story",
                text=" ".join(text),
                when=story.published,
            )
        )
    return items


# ---------------------------------------------------------------------------------------------------------
# Google Places

PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
PLACES_FIELDS = ",".join(
    f"places.{name}"
    for name in (
        "id", "displayName", "formattedAddress", "primaryTypeDisplayName", "rating", "userRatingCount",
        "currentOpeningHours.openNow", "regularOpeningHours.weekdayDescriptions", "nationalPhoneNumber",
        "websiteUri", "googleMapsUri", "businessStatus",
    )
)  # fmt: skip


def _places_key() -> str:
    try:
        key = settings.google_places_api_key()
    except Exception as error:
        log.warning("Google Places key could not be read", exc_info=True)
        raise LiveUnavailable("Place lookups aren't set up right now.") from error
    if not key:
        raise LiveUnavailable("Place lookups aren't set up yet, so say you can't look up places right now.")
    return key


def place_text(place: dict) -> str:
    name = (place.get("displayName") or {}).get("text") or "Unnamed place"
    kind = (place.get("primaryTypeDisplayName") or {}).get("text")
    lines = [f"{name}" + (f" ({kind})" if kind else "") + "."]
    if place.get("formattedAddress"):
        lines.append(f"Address: {place['formattedAddress']}.")
    if place.get("businessStatus") and place["businessStatus"] != "OPERATIONAL":
        lines.append(f"Business status: {place['businessStatus'].replace('_', ' ').lower()}.")
    if _finite(place.get("rating")):
        count = place.get("userRatingCount")
        lines.append(f"Rated {place['rating']} out of 5" + (f" from {count:,} Google reviews." if _finite(count) else " on Google."))
    open_now = (place.get("currentOpeningHours") or {}).get("openNow")
    if isinstance(open_now, bool):
        lines.append("Open now." if open_now else "Closed now.")
    hours = (place.get("regularOpeningHours") or {}).get("weekdayDescriptions") or []
    if hours:
        lines.append(f"Hours: {'; '.join(hours)}.")
    if place.get("nationalPhoneNumber"):
        lines.append(f"Phone: {place['nationalPhoneNumber']}.")
    if place.get("websiteUri"):
        lines.append(f"Website: {place['websiteUri']}")
    return " ".join(lines)


def find_places(query: str, neighborhood: str = "", open_now: bool = False) -> list[retrieval.Evidence]:
    if not _clean(query):
        return []
    key = _places_key()
    area = resolve_neighborhood(neighborhood)
    bounds = area.bounds.padded(0.005) if area else FREMONT_BOUNDS.padded(0.01)
    where = f"{area.name}, Fremont, CA" if area else "Fremont, CA"
    body: dict = {
        "textQuery": f"{_clean(query)} in {where}",
        "maxResultCount": 8,
        "languageCode": "en",
        "regionCode": "US",
        "locationRestriction": {
            "rectangle": {
                "low": {"latitude": bounds.south, "longitude": bounds.west},
                "high": {"latitude": bounds.north, "longitude": bounds.east},
            }
        },
    }
    if open_now:
        body["openNow"] = True
    try:
        response = httpx.post(
            PLACES_URL,
            json=body,
            headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": PLACES_FIELDS},
            timeout=TIMEOUT_S,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        log.warning("Google Places returned %s: %s", error.response.status_code, error.response.text[:300])
        raise LiveUnavailable("Google Places didn't accept the request just now.") from error
    except httpx.HTTPError as error:
        raise LiveUnavailable("Google Places can't be reached right now.") from error
    items = []
    for place in response.json().get("places") or []:
        name = (place.get("displayName") or {}).get("text") or "Place"
        items.append(
            evidence(
                "place",
                place.get("id") or name,
                source="Google Maps",
                title=name,
                url=place.get("googleMapsUri") or place.get("websiteUri"),
                locator="Google Maps place details",
                text=place_text(place),
            )
        )
    return items


# ---------------------------------------------------------------------------------------------------------
# The web

# Sites that need an account to read, or whose terms forbid automated reading: search snippets only.
NO_READ_HOSTS = ("facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "nextdoor.com", "tiktok.com")
WEB_RESULTS = 6
WEB_PAGES_READ = 3
ROBOTS_AGENT = settings.USER_AGENT.split("/")[0]


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower().removeprefix("www.")


def _no_read(url: str) -> bool:
    host = _host(url)
    return any(host == blocked or host.endswith(f".{blocked}") for blocked in NO_READ_HOSTS)


def robots_allows(url: str) -> bool:
    """RFC 9309: a 4xx robots.txt allows everything; an unreachable one or a 5xx disallows everything."""
    parts = urlparse(url)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return False
    origin = f"{parts.scheme}://{parts.netloc}"

    def load() -> RobotFileParser | None:
        try:
            response = httpx.get(
                f"{origin}/robots.txt", headers={"User-Agent": settings.USER_AGENT}, timeout=6, follow_redirects=True
            )
        except httpx.HTTPError:
            return None
        parser = RobotFileParser()
        if 400 <= response.status_code < 500:
            parser.allow_all = True
            return parser
        if response.status_code >= 500:
            return None
        parser.parse(response.text.splitlines())
        return parser

    parser = _cached(f"robots:{origin}", 3600, load)
    return parser is not None and parser.can_fetch(ROBOTS_AGENT, url)  # type: ignore[union-attr]


def _markdown_text(markdown: str) -> str:
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", markdown or "")  # images
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)  # links keep their words
    return re.sub(r"[ \t]*\n[ \t]*", "\n", text)


def _firecrawl():
    from firecrawl import Firecrawl

    try:
        key = settings.firecrawl_api_key()
    except Exception as error:
        log.warning("Firecrawl key could not be read", exc_info=True)
        raise LiveUnavailable("Web search isn't available right now.") from error
    if not key:
        raise LiveUnavailable("Web search isn't set up, so say you can't search the web right now.")
    return Firecrawl(api_key=key, timeout=60, max_retries=0)


def web_search(query: str) -> list[retrieval.Evidence]:
    if not _clean(query):
        return []
    client = _firecrawl()
    try:
        data = client.search(_clean(query)[:300], limit=WEB_RESULTS)
    except Exception as error:
        log.warning("web search failed", exc_info=True)
        raise LiveUnavailable("Web search isn't responding right now.") from error
    results = []
    for result in getattr(data, "web", None) or []:
        url = getattr(result, "url", None) or getattr(getattr(result, "metadata", None), "url", None)
        if isinstance(url, str) and re.match(r"^https?://", url):
            title = getattr(result, "title", None) or getattr(getattr(result, "metadata", None), "title", None) or url
            results.append((url, str(title), str(getattr(result, "description", None) or "")))

    def read(url: str) -> str:
        if _no_read(url) or not robots_allows(url):
            return ""
        try:
            document = client.scrape(url, formats=["markdown"], only_main_content=True)
            return _markdown_text(getattr(document, "markdown", None) or "")
        except Exception:
            log.warning("web page could not be read: %s", url, exc_info=True)
            return ""

    to_read = [url for url, _, _ in results[:WEB_PAGES_READ]]
    with ThreadPoolExecutor(max_workers=WEB_PAGES_READ) as pool:
        pages = dict(zip(to_read, pool.map(read, to_read), strict=True))

    items = []
    for url, title, description in results:
        page = pages.get(url, "")
        text = page if page.strip() else description
        if not text.strip():
            continue
        items.append(
            evidence(
                "web",
                url,
                source=_host(url) or "Web",
                title=title,
                url=url,
                locator="Web page" if page.strip() else "Search result summary",
                text=text,
            )
        )
    return items
