"""Real issues for the web app from upcoming meeting agendas in the corpus.

For each stored agenda of a meeting in the next LOOKAHEAD_DAYS, the model lists the substantive business
items. Code decides what is written:
- an item's title must appear verbatim in the agenda chunk it came from;
- every amount, date, section, record id and address in its summary must be in that chunk
  (core.citations.enforce), and each fact value must appear in the chunk;
- neighborhoods are only official neighborhoods named in the item's text, plus the neighborhood its street
  address geocodes into (US Census geocoder + City of Fremont Neighborhoods GIS layer);
- items that fail are skipped, never guessed.
Writes the web app's issues, issue_analyses and a stance poll (contract agreed with the web app session):
is_sample=false, status 'approved', deadline = meeting start with deadline_kind 'Public comment'.
Needs Bedrock: runs in the pipeline runtime (action publish_issues).

Usage: python scripts/publish_issues.py
"""

import asyncio
import json
import re
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import settings
from core.citations import enforce
from core.db import connect, run_with_retry
from core.generation_graph import _model
from core.geo import geocode, neighborhood_at
from pydantic import BaseModel, Field
from strands import Agent

FREMONT_TZ = ZoneInfo("America/Los_Angeles")  # ids and refs use the meeting's local date
# Business items are numbered like "2C" or "5A". A bare letter is an attachment row ("a. Draft Resolution")
# or an item seen without its section number; either way it is not stored as its own issue.
ITEM_NUMBER = re.compile(r"\d{1,2}[A-Z]?")
PROCEDURAL = re.compile(
    r"\b(?:waive (?:further )?reading|approv\w* (?:of )?(?:the )?minutes|call to order|roll call|closed session|"
    r"adjournment|acronyms?|meeting schedule|pledge of allegiance|salute (?:to )?the flag)\b",
    re.IGNORECASE,
)
# IQM2 agendas print sections as "| **2.** | **Consent Calendar** |" and items as "|  | C. | Title |";
# attachment rows are indented one more cell and use lower-case letters.
SECTION_ROW = re.compile(r"^\|\s*\*\*(\d{1,2})\.\*\*\s*\|")
ITEM_ROW = re.compile(r"^\|\s*\|\s*([A-Z])\.\s*\|\s*(.+?)\s*\|?\s*$")
LOOKAHEAD_DAYS = 21
MAX_ITEMS_PER_AGENDA = 12
BODIES = {
    "fremont-council-iqm2": ("City Council", "cc"),
    "fremont-agenda-center-council": ("City Council", "cc"),
    "fremont-planning-commission": ("Planning Commission", "pc"),
    "fremont-zoning-administrator": ("Zoning Administrator", "za"),
    "fusd-board-meetings": ("FUSD Board of Education", "fusd"),
}
AGENDA_TYPES = ("meeting_agenda", "agenda")

PROMPT = """You read one part of a public meeting agenda and list its substantive business items.

Skip procedural items: call to order, roll call, pledge or flag salute, closed session reports,
announcements, approval of minutes, adjournment, acronym lists and meeting schedules.

For each business item:
- number: the item number as printed, e.g. "2D" or "5A" (letters and digits only).
- section: the agenda section in lowercase words, e.g. "consent calendar", "public hearings",
  "scheduled items", "council referrals", "other business".
- title: the item title copied exactly from the agenda, without the recommendation text.
- summary: one or two plain-language sentences using only what this agenda text says. No opinions.
- topic: one or two words, e.g. "Housing", "Public safety", "Budget", "Transportation".
- street_address: a street address copied exactly if the item names one, else null.
- facts: up to four {label, value} pairs copied exactly from the agenda (amounts, code sections,
  record numbers, dates). Empty if none.
Return an empty list when this text has no business items."""


class Fact(BaseModel):
    label: str
    value: str


class AgendaItem(BaseModel):
    number: str
    section: str
    title: str
    summary: str
    topic: str
    street_address: str | None = None
    facts: list[Fact] = Field(default_factory=list)


class AgendaItems(BaseModel):
    items: list[AgendaItem] = Field(default_factory=list)


def squash(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\\", "").replace("*", "")).strip().lower()


def neighborhoods_in(text: str, neighborhoods: dict[str, str]) -> list[str]:
    lowered = text.lower()
    return sorted(slug for slug, name in neighborhoods.items() if re.search(rf"\b{re.escape(name.lower())}\b", lowered))


def agenda_numbers(text: str) -> dict[str, str]:
    """Item numbers as the agenda prints them: the section header's number plus the item row's capital letter
    ("2C"), keyed by the row's title. The first occurrence wins, since stored chunks overlap."""
    numbers: dict[str, str] = {}
    section = None
    for line in text.splitlines():
        header = SECTION_ROW.match(line)
        if header:
            section = header.group(1)
            continue
        row = ITEM_ROW.match(line)
        if row and section:
            numbers.setdefault(squash(row.group(2)), f"{section}{row.group(1)}")
    return numbers


def number_for(title: str, numbers: dict[str, str]) -> str | None:
    key = squash(title)
    for row_title, number in numbers.items():
        if row_title.startswith(key) or key.startswith(row_title):
            return number
    return None


def verified_item(
    item: AgendaItem, chunk_text: str, neighborhoods: dict[str, str], numbers: dict[str, str] | None = None
) -> dict | None:
    """The item as it will be stored, or None when its title or summary can't be verified in the chunk.

    When the agenda's own numbering could be read (numbers), the item number comes from it and a title that
    matches no item row (an attachment, a heading) is rejected; otherwise the model's number is used."""
    title = re.sub(r"\s+", " ", item.title).strip(" |-")
    if numbers:
        number = number_for(title, numbers) or ""
    else:
        number = re.sub(r"[^0-9A-Za-z]", "", item.number).upper()
    if not ITEM_NUMBER.fullmatch(number) or len(title) < 8 or PROCEDURAL.search(title):
        return None
    if squash(title) not in squash(chunk_text):
        return None
    summary = enforce(item.summary.strip(), [chunk_text]).text
    if not summary:
        return None
    facts = [
        {"label": fact.label.strip()[:60], "value": fact.value.strip()[:120]}
        for fact in item.facts[:4]
        if fact.value.strip() and squash(fact.value) in squash(chunk_text)
    ]
    address = (item.street_address or "").strip() or None
    if address and squash(address) not in squash(chunk_text):
        address = None
    return {
        "number": number,
        "section": re.sub(r"\s+", " ", item.section).strip().lower()[:60] or "agenda",
        "title": title[:200],
        "summary": summary,
        "topic": re.sub(r"\s+", " ", item.topic).strip()[:40] or None,
        "address": address,
        "facts": facts,
        "neighborhood_slugs": neighborhoods_in(f"{title} {summary}", neighborhoods),
    }


def issue_rows(doc: dict, item: dict, groups: dict[str, str]) -> dict:
    body_name, code = BODIES[doc["source_id"]]
    meeting_at: datetime = doc["published_at"]
    local = meeting_at.astimezone(FREMONT_TZ)
    issue_id = f"{code}-{local:%Y-%m-%d}-{item['number'].lower()}"
    group_slug = next((groups[slug] for slug in item["neighborhood_slugs"] if slug in groups), None)
    return {
        "id": issue_id,
        "ref": f"{code.upper()}-{local:%y-%m%d}-{item['number']}",
        "group_slug": group_slug,
        "title": item["title"],
        "body": f"{body_name}, {item['section']}",
        "meeting_at": meeting_at,
        "topic": item["topic"],
        "location": item.get("location"),
        "neighborhood_slugs": item["neighborhood_slugs"],
        "source_url": doc["url"],
        "citation": f"{doc['title']}, {item['locator']}",
        "summary": item["summary"],
        "facts": item["facts"],
    }


async def items_in(doc: dict, chunk_text: str, locator: str) -> list[AgendaItem]:
    agent = Agent(name="agenda_reader", model=_model(), system_prompt=PROMPT, callback_handler=None)
    task = f"Meeting: {doc['title']}\nPart of agenda: {locator}\n\nAgenda text:\n{chunk_text}"
    result = await agent.invoke_async(task, structured_output_model=AgendaItems)
    return result.structured_output.items


def locate(address: str, neighborhoods: dict[str, str]) -> tuple[dict | None, str | None]:
    try:
        found = geocode(address)
        if not found:
            return None, None
        name = neighborhood_at(found["lat"], found["lng"])
    except Exception:
        return None, None
    slug = next((s for s, n in neighborhoods.items() if name and n.lower() == name.lower()), None)
    return {"lat": found["lat"], "lng": found["lng"], "label": address}, slug


def save(rows: list[dict]) -> None:
    def write(c) -> None:
        for row in rows:
            c.execute(
                """
                INSERT INTO issues (id, ref, group_slug, title, body, meeting_at, deadline, deadline_kind, topic,
                  status, location, neighborhood_slugs, source_url, citation, is_sample, surfaced_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'Public comment', %s, 'approved', %s::jsonb, %s::jsonb, %s, %s,
                  false, now(), now())
                ON CONFLICT (id) DO UPDATE SET
                  ref = EXCLUDED.ref, group_slug = EXCLUDED.group_slug, title = EXCLUDED.title, body = EXCLUDED.body,
                  meeting_at = EXCLUDED.meeting_at, deadline = EXCLUDED.deadline, topic = EXCLUDED.topic,
                  location = EXCLUDED.location, neighborhood_slugs = EXCLUDED.neighborhood_slugs,
                  source_url = EXCLUDED.source_url, citation = EXCLUDED.citation, updated_at = now()
                """,
                (
                    row["id"],
                    row["ref"],
                    row["group_slug"],
                    row["title"],
                    row["body"],
                    row["meeting_at"],
                    row["meeting_at"],
                    row["topic"],
                    json.dumps(row["location"]) if row["location"] else None,
                    json.dumps(row["neighborhood_slugs"]),
                    row["source_url"],
                    row["citation"],
                ),
            )
            c.execute(
                """
                INSERT INTO issue_analyses (issue_id, summary, pros, cons, facts, model, generated_at, is_sample)
                VALUES (%s, %s, '[]'::jsonb, '[]'::jsonb, %s::jsonb, %s, now(), false)
                ON CONFLICT (issue_id) DO UPDATE SET
                  summary = EXCLUDED.summary, facts = EXCLUDED.facts, model = EXCLUDED.model, generated_at = now()
                """,
                (row["id"], row["summary"], json.dumps(row["facts"]), settings.BEDROCK_MODEL_ID),
            )
            c.execute(
                """
                INSERT INTO polls (id, issue_id, question, kind, options, position)
                VALUES (%s, %s, %s, 'stance', %s::jsonb, 0) ON CONFLICT (id) DO NOTHING
                """,
                (
                    f"{row['id']}-stance",
                    row["id"],
                    "Do you support this agenda item?",
                    json.dumps([{"id": "support", "label": "Support"}, {"id": "oppose", "label": "Oppose"}]),
                ),
            )

    with connect() as conn:
        conn.autocommit = False
        run_with_retry(conn, write)


def run() -> dict:
    with connect() as conn:
        rows = run_with_retry(
            conn,
            lambda c: c.execute(
                """
                SELECT d.id, d.source_id, d.title, d.url, d.published_at, c.text, c.locator
                FROM agent_documents d JOIN agent_chunks c ON c.document_id = d.id
                WHERE d.doc_type = ANY(%s) AND d.published_at >= now() AND d.published_at <= %s
                ORDER BY d.published_at, d.id, c.ordinal
                """,
                (list(AGENDA_TYPES), datetime.now().astimezone() + timedelta(days=LOOKAHEAD_DAYS)),
            ).fetchall(),
        )
        neighborhoods = dict(
            run_with_retry(conn, lambda c: c.execute("SELECT slug, name FROM neighborhoods").fetchall())
        )
        groups = {
            neighborhood: slug
            for slug, neighborhood in run_with_retry(
                conn, lambda c: c.execute("SELECT slug, neighborhood_slug FROM groups").fetchall()
            )
        }
    documents: dict[str, dict] = {}
    for doc_id, source_id, title, url, published_at, text, locator in rows:
        if source_id not in BODIES:
            continue
        doc = documents.setdefault(
            str(doc_id),
            {"source_id": source_id, "title": title, "url": url, "published_at": published_at, "chunks": []},
        )
        doc["chunks"].append((text, locator))

    totals: Counter[str] = Counter()
    for doc in documents.values():
        seen: dict[str, dict] = {}
        numbers = agenda_numbers("\n".join(text for text, _ in doc["chunks"]))
        for text, locator in doc["chunks"]:
            try:
                found = asyncio.run(items_in(doc, text, locator))
            except Exception as error:
                print(f"  ! {doc['title']} {locator}: {type(error).__name__}: {str(error)[:120]}")
                totals["chunks_failed"] += 1
                continue
            for item in found:
                checked = verified_item(item, text, neighborhoods, numbers)
                if checked is None:
                    totals["items_rejected"] += 1
                    continue
                title_key = squash(checked["title"])[:120]
                if checked["number"] in seen or any(squash(s["title"])[:120] == title_key for s in seen.values()):
                    continue
                checked["locator"] = locator
                if checked["address"]:
                    checked["location"], slug = locate(checked["address"], neighborhoods)
                    if slug and slug not in checked["neighborhood_slugs"]:
                        checked["neighborhood_slugs"].append(slug)
                seen[checked["number"]] = checked
        items = list(seen.values())[:MAX_ITEMS_PER_AGENDA]
        save([issue_rows(doc, item, groups) for item in items])
        totals["agendas"] += 1
        totals["issues"] += len(items)
        print(f"  {doc['title']}: {len(items)} issues")
    return dict(totals)


def main() -> int:
    print(run())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
