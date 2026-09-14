"""Public-comment sentiment from letters filed in the public record (agenda packets, ZA correspondence).

Each public_comment document is one topic: an agenda item or application named in its title. The model
reads each chunk and lists the letters it contains, with stance, date, the area the writer says they
live in, a short excerpt and themes. Code decides what is stored:
- an excerpt is kept only if it appears verbatim in the chunk (whitespace aside); then emails, phone
  numbers and street addresses in it are replaced with "[redacted]";
- a date is kept only if that calendar date appears in the chunk;
- an area is kept only if it appears in the chunk and names an official Fremont neighborhood, a council
  district or a part of Fremont; names of people are never stored;
- counts are computed from the stored comments.
Writes agent_comment_topics and agent_comments (migrations/0002). Needs Bedrock: runs in the pipeline
runtime (action public_sentiment).

Usage: python scripts/public_sentiment.py
"""

import asyncio
import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Literal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import settings
from core.citations import canonical_date, dates_in
from core.db import connect, run_with_retry
from core.generation_graph import _model
from pydantic import BaseModel, Field
from strands import Agent

TITLE = re.compile(
    r"^(?P<body>City Council|Zoning Administrator) (?P<date>[A-Z][a-z]{2} \d{1,2}, \d{4}) [–-] (?P<rest>.+)$"
)
BODY_CODES = {"City Council": ("city_council", "cc"), "Zoning Administrator": ("zoning_administrator", "za")}
ITEM = re.compile(r"\bItem (\d+[A-Z])")
APPLICATION = re.compile(r"\bPLN\d{4}-\d{5}\b")
AREA_WORDS = re.compile(
    r"\b(?:district\s+\d|north(?:ern)?\s+fremont|south(?:ern)?\s+fremont|central\s+fremont)\b", re.IGNORECASE
)

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")
STREET = re.compile(
    r"\b\d{2,6},?\s+(?:[A-Z][a-z]+\s+){1,3}"
    r"(?:Terrace|Ter|Drive|Dr|Road|Rd|Street|St|Avenue|Ave|Court|Ct|Way|Lane|Ln|Boulevard|Blvd|Place|Pl)\b\.?"
)

PROMPT = """You read public comments filed with the City of Fremont and list each comment in the text.

Rules:
- One entry per letter or email that begins in this text (it has a From/Date/Subject header or an opening
  line). Skip text that only continues a letter started earlier, and skip city staff forwarding notes.
- stance toward the agenda item or application named in the task: support, oppose, mixed or neutral.
- sent_date: the letter's own date as YYYY-MM-DD, or null.
- author_area: only the neighborhood, district or part of Fremont the writer says they live in, copied as
  written (e.g. "Ardenwood", "District 1"). Never a person's name or a street address. Null if not stated.
- excerpt: one sentence copied exactly, character for character, from the letter that best shows its
  stance. At most 250 characters. Do not paraphrase.
- themes: one to three short themes in plain words, such as "distance to existing centers".
Return an empty list if the text has no comments."""


class FiledComment(BaseModel):
    stance: Literal["support", "oppose", "mixed", "neutral"]
    sent_date: str | None = None
    author_area: str | None = None
    excerpt: str
    themes: list[str] = Field(default_factory=list)


class ChunkComments(BaseModel):
    comments: list[FiledComment] = Field(default_factory=list)


def squash(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace(" ", " ")).strip()


def redact_contacts(text: str) -> str:
    return STREET.sub("[redacted]", PHONE.sub("[redacted]", EMAIL.sub("[redacted]", text)))


def topic_for(document_id: str, title: str, url: str) -> dict | None:
    match = TITLE.match(title)
    if not match:
        return None
    body, code = BODY_CODES[match.group("body")]
    meeting_date = datetime.strptime(match.group("date"), "%b %d, %Y").date()
    rest = match.group("rest")
    item = ITEM.search(rest)
    application = APPLICATION.search(rest)
    label = f"Item {item.group(1)}" if item else (application.group(0) if application else rest[:60])
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
    return {
        "id": f"{code}-{meeting_date.isoformat()}-{slug}",
        "document_id": document_id,
        "body": body,
        "meeting_date": meeting_date,
        "item_label": label,
        "title": rest,
        "source_url": url,
    }


def checked(comment: FiledComment, chunk_text: str, neighborhoods: dict[str, str]) -> dict | None:
    excerpt = squash(comment.excerpt)
    if not excerpt or len(excerpt) > 300 or excerpt.lower() not in squash(chunk_text).lower():
        return None
    sent_at = None
    if comment.sent_date and canonical_date(comment.sent_date) in dates_in(chunk_text):
        sent_at = comment.sent_date
    area = squash(comment.author_area or "") or None
    if area and (area.lower() not in squash(chunk_text).lower() or not area_is_place(area, neighborhoods)):
        area = None
    return {
        "stance": comment.stance,
        "sent_at": sent_at,
        "author_area": area,
        "excerpt": redact_contacts(excerpt),
        "themes": [squash(theme).lower() for theme in comment.themes[:3] if squash(theme)],
    }


def area_is_place(area: str, neighborhoods: dict[str, str]) -> bool:
    lowered = area.lower()
    return bool(AREA_WORDS.search(area)) or any(name.lower() in lowered for name in neighborhoods.values())


def slugs_named(texts: list[str], neighborhoods: dict[str, str]) -> list[str]:
    joined = " ".join(texts).lower()
    return sorted(slug for slug, name in neighborhoods.items() if re.search(rf"\b{re.escape(name.lower())}\b", joined))


async def comments_in(topic: dict, chunk_text: str, locator: str) -> list[FiledComment]:
    agent = Agent(name="comment_reader", model=_model(), system_prompt=PROMPT, callback_handler=None)
    task = (
        f"Agenda item or application: {topic['item_label']} – {topic['title']}\n"
        f"Location in document: {locator}\n\nText:\n{chunk_text}"
    )
    result = await agent.invoke_async(task, structured_output_model=ChunkComments)
    return result.structured_output.comments


def run() -> dict:
    with connect() as conn:
        rows = run_with_retry(
            conn,
            lambda c: c.execute(
                """
                SELECT d.id, d.title, d.url, c.id, c.text, c.locator
                FROM agent_documents d JOIN agent_chunks c ON c.document_id = d.id
                WHERE d.doc_type = 'public_comment' ORDER BY d.id, c.ordinal
                """
            ).fetchall(),
        )
        neighborhoods = dict(
            run_with_retry(conn, lambda c: c.execute("SELECT slug, name FROM neighborhoods").fetchall())
        )
    documents: dict[str, dict] = {}
    for document_id, title, url, chunk_id, text, locator in rows:
        entry = documents.setdefault(str(document_id), {"title": title, "url": url, "chunks": []})
        entry["chunks"].append((str(chunk_id), text, locator))

    totals: Counter[str] = Counter()
    for document_id, doc in documents.items():
        topic = topic_for(document_id, doc["title"], doc["url"])
        if topic is None:
            totals["topics_skipped_untitled"] += 1
            continue
        stored = []
        for chunk_id, text, locator in doc["chunks"]:
            try:
                found = asyncio.run(comments_in(topic, text, locator))
            except Exception as error:
                print(f"  ! {topic['id']} {locator}: {type(error).__name__}: {str(error)[:120]}")
                totals["chunks_failed"] += 1
                continue
            for comment in found:
                row = checked(comment, text, neighborhoods)
                if row is None:
                    totals["comments_rejected"] += 1
                    continue
                stored.append({**row, "chunk_id": chunk_id, "locator": locator})
        save_topic(topic, stored, neighborhoods, [text for _, text, _ in doc["chunks"]])
        totals["topics"] += 1
        totals["comments"] += len(stored)
        print(f"  {topic['id']}: {len(stored)} comments, {Counter(c['stance'] for c in stored)}")
    return dict(totals)


def save_topic(topic: dict, comments: list[dict], neighborhoods: dict[str, str], texts: list[str]) -> None:
    stances = Counter(comment["stance"] for comment in comments)
    themes = Counter(theme for comment in comments for theme in comment["themes"])
    theme_list = [{"theme": theme, "count": count} for theme, count in themes.most_common(8)]

    def write(c) -> None:
        c.execute("DELETE FROM agent_comments WHERE topic_id = %s", (topic["id"],))
        c.execute(
            """
            INSERT INTO agent_comment_topics
              (id, body, meeting_date, item_label, title, neighborhood_slugs, comment_count, support_count,
               oppose_count, mixed_count, neutral_count, themes, source_url, generated_at, model)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s::jsonb, %s, now(), %s)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title, neighborhood_slugs = EXCLUDED.neighborhood_slugs,
              comment_count = EXCLUDED.comment_count, support_count = EXCLUDED.support_count,
              oppose_count = EXCLUDED.oppose_count, mixed_count = EXCLUDED.mixed_count,
              neutral_count = EXCLUDED.neutral_count, themes = EXCLUDED.themes,
              source_url = EXCLUDED.source_url, generated_at = now(), model = EXCLUDED.model
            """,
            (
                topic["id"],
                topic["body"],
                topic["meeting_date"],
                topic["item_label"],
                topic["title"],
                json.dumps(slugs_named(texts, neighborhoods)),
                len(comments),
                stances["support"],
                stances["oppose"],
                stances["mixed"],
                stances["neutral"],
                json.dumps(theme_list),
                topic["source_url"],
                settings.BEDROCK_MODEL_ID,
            ),
        )
        for comment in comments:
            c.execute(
                """
                INSERT INTO agent_comments (topic_id, stance, sent_at, author_area, excerpt, chunk_id, locator)
                VALUES (%s, %s, %s, %s, %s, %s::uuid, %s)
                """,
                (
                    topic["id"],
                    comment["stance"],
                    comment["sent_at"],
                    comment["author_area"],
                    comment["excerpt"],
                    comment["chunk_id"],
                    comment["locator"],
                ),
            )

    with connect() as conn:
        conn.autocommit = False
        run_with_retry(conn, write)


def main() -> int:
    print(run())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
