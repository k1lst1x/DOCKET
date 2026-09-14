"""Docket posts in neighborhood feeds, built only from verified rows (no model writes post text).

- Public comments: for each agent_comment_topics row with at least MIN_COMMENTS comments, a post with the
  stance counts and top themes to each neighborhood the letters name (at most MAX_NEIGHBORHOODS), or to
  all of Fremont when none is named.
- Upcoming agendas: for each meeting with published issues in the next week, one all-of-Fremont post
  listing its items, plus a post to each neighborhood an item names.
Every post links its sources. A post is never repeated: the same body from Docket is skipped. Contract
with the web app (frontend/db/migrations/0005): member DOCKET_MEMBER_ID, kind 'docket', sources jsonb,
body of at most 500 characters.

Usage: python scripts/publish_posts.py [--dry-run]
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.db import connect, run_with_retry

DOCKET_MEMBER_ID = "00000000-0000-4000-8000-00000000d0c7"
FREMONT_TZ = ZoneInfo("America/Los_Angeles")
MAX_BODY = 500
MIN_COMMENTS = 3
MAX_NEIGHBORHOODS = 4
BODY_NAMES = {
    "city_council": "City Council",
    "planning_commission": "Planning Commission",
    "zoning_administrator": "Zoning Administrator",
    "school_board": "FUSD Board of Education",
}


def fit(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= MAX_BODY else text[: MAX_BODY - 1].rsplit(" ", 1)[0] + "…"


def day(value) -> str:
    return f"{value:%b} {value.day}"


def comment_post(topic: dict) -> str:
    counts = [
        (topic["support_count"], "support"),
        (topic["oppose_count"], "oppose"),
        (topic["mixed_count"], "mixed"),
        (topic["neutral_count"], "neutral"),
    ]
    tally = ", ".join(f"{n} {label}" for n, label in counts if n)
    themes = [entry["theme"] for entry in topic["themes"][:3]]
    theme_text = f" Most mentioned: {'; '.join(themes)}." if themes else ""
    body = BODY_NAMES.get(topic["body"], topic["body"])
    return fit(
        f"Public comment on the {day(topic['meeting_date'])} {body} {topic['item_label']} "
        f"({topic['title']}): {topic['comment_count']} letters filed in the city's record, {tally}.{theme_text} "
        "Counted by Docket from the published letters."
    )


def agenda_post(meeting: dict, issues: list[dict]) -> str:
    local = meeting["meeting_at"].astimezone(FREMONT_TZ)
    listing = "; ".join(f"{issue['ref'].rsplit('-', 1)[-1]} {issue['title']}" for issue in issues[:5])
    more = f" and {len(issues) - 5} more" if len(issues) > 5 else ""
    return fit(
        f"{meeting['body_name']} meets {day(local)} at {local:%I:%M %p}".replace(" 0", " ")
        + f". On the agenda: {listing}{more}. Public comment is open until the meeting."
    )


def neighborhood_post(issue: dict, neighborhood_name: str) -> str:
    local = issue["meeting_at"].astimezone(FREMONT_TZ)
    return fit(
        f"For {neighborhood_name}: the {day(local)} {issue['body'].split(',')[0]} agenda includes "
        f"{issue['title']}. {issue['summary']}"
    )


def writer_neighborhoods(areas: list[str], neighborhoods: dict[str, str]) -> list[str]:
    """Neighborhoods the letter writers said they live in, most often named first. A place a letter only
    mentions (an existing community center across town) is not a reason to post in that neighborhood."""
    counts: dict[str, int] = {}
    for area in areas:
        lowered = area.lower()
        for slug, name in neighborhoods.items():
            if re.search(rf"\b{re.escape(name.lower())}\b", lowered):
                counts[slug] = counts.get(slug, 0) + 1
    return sorted(counts, key=lambda slug: (-counts[slug], slug))


def planned_posts(
    topics: list[dict], issues: list[dict], neighborhoods: dict[str, str], writer_areas: dict[str, list[str]]
) -> list[dict]:
    posts = []
    for topic in topics:
        if topic["comment_count"] < MIN_COMMENTS:
            continue
        sources = [{"title": f"{topic['item_label']} public correspondence", "url": topic["source_url"]}]
        targets = writer_neighborhoods(writer_areas.get(topic["id"], []), neighborhoods)[:MAX_NEIGHBORHOODS]
        for slug in targets or [None]:
            posts.append({"neighborhood_slug": slug, "body": comment_post(topic), "sources": sources})

    by_meeting: dict[tuple, list[dict]] = defaultdict(list)
    for issue in issues:
        by_meeting[(issue["body"].split(",")[0], issue["meeting_at"])].append(issue)
    for (body_name, meeting_at), items in by_meeting.items():
        sources = [{"title": items[0]["citation"].split(",")[0], "url": items[0]["source_url"]}]
        meeting = {"body_name": body_name, "meeting_at": meeting_at}
        posts.append({"neighborhood_slug": None, "body": agenda_post(meeting, items), "sources": sources})
        for item in items:
            for slug in item["neighborhood_slugs"][:MAX_NEIGHBORHOODS]:
                if slug in neighborhoods:
                    body = neighborhood_post(item, neighborhoods[slug])
                    posts.append({"neighborhood_slug": slug, "body": body, "sources": sources})
    return posts


def run(dry_run: bool = False) -> dict:
    with connect() as conn:
        neighborhoods = dict(
            run_with_retry(conn, lambda c: c.execute("SELECT slug, name FROM neighborhoods").fetchall())
        )
        topic_rows = run_with_retry(
            conn,
            lambda c: c.execute(
                "SELECT id, body, meeting_date, item_label, title, neighborhood_slugs, comment_count, support_count, "
                "oppose_count, mixed_count, neutral_count, themes, source_url FROM agent_comment_topics"
            ).fetchall(),
        )
        area_rows = run_with_retry(
            conn,
            lambda c: c.execute(
                "SELECT topic_id, author_area FROM agent_comments WHERE author_area IS NOT NULL"
            ).fetchall(),
        )
        issue_rows = run_with_retry(
            conn,
            lambda c: c.execute(
                """
                SELECT i.ref, i.title, i.body, i.meeting_at, i.neighborhood_slugs, i.source_url, i.citation, a.summary
                FROM issues i JOIN issue_analyses a ON a.issue_id = i.id
                WHERE i.is_sample = false AND i.status IN ('approved', 'watching')
                  AND i.meeting_at >= now() AND i.meeting_at <= %s
                ORDER BY i.meeting_at, i.ref
                """,
                (datetime.now().astimezone() + timedelta(days=7),),
            ).fetchall(),
        )
    writer_areas: dict[str, list[str]] = defaultdict(list)
    for topic_id, area in area_rows:
        writer_areas[topic_id].append(area)
    topic_keys = ("id", "body", "meeting_date", "item_label", "title", "neighborhood_slugs", "comment_count",
                  "support_count", "oppose_count", "mixed_count", "neutral_count", "themes", "source_url")
    issue_keys = ("ref", "title", "body", "meeting_at", "neighborhood_slugs", "source_url", "citation", "summary")
    topics = [dict(zip(topic_keys, row, strict=True)) for row in topic_rows]
    issues = [dict(zip(issue_keys, row, strict=True)) for row in issue_rows]
    posts = planned_posts(topics, issues, neighborhoods, writer_areas)
    if dry_run:
        for post in posts:
            print(f"[{post['neighborhood_slug'] or 'all of Fremont'}] {post['body']}")
        return {"planned": len(posts)}

    def write(c) -> int:
        written = 0
        for post in posts:
            exists = c.execute(
                "SELECT 1 FROM posts WHERE member_id = %s AND kind = 'docket' AND body = %s AND deleted_at IS NULL "
                "AND neighborhood_slug IS NOT DISTINCT FROM %s LIMIT 1",
                (DOCKET_MEMBER_ID, post["body"], post["neighborhood_slug"]),
            ).fetchone()
            if exists:
                continue
            c.execute(
                "INSERT INTO posts (id, member_id, neighborhood_slug, parent_id, body, kind, sources, is_sample) "
                "VALUES (gen_random_uuid(), %s, %s, NULL, %s, 'docket', %s::jsonb, false)",
                (DOCKET_MEMBER_ID, post["neighborhood_slug"], post["body"], json.dumps(post["sources"])),
            )
            written += 1
        return written

    with connect() as conn:
        conn.autocommit = False
        written = run_with_retry(conn, write)
    return {"planned": len(posts), "posted": written, "skipped_existing": len(posts) - written}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    print(run(parser.parse_args().dry_run))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
