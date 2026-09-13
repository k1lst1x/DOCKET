"""Resident chat agent: one Strands agent with read-only retrieval tools.

Grounding is enforced in code, not only in the prompt:
- an answer is accepted only if a retrieval tool actually ran during the turn (a hook counts it);
- only the model's final answer text is used; reasoning is never shown or checked as an answer;
- the answer must cite evidence returned in this turn with [n] markers; unknown markers are dropped;
- every number, amount, date, address, section and record id must appear in the cited chunks
  (core.citations), or its sentence is removed;
- when nothing grounded remains, the reply is a fixed refusal that names the sources searched.
A chat session is only continued by the user who started it. The agent has no tool that writes, sends,
publishes or contacts anyone.
"""

import json
import logging
import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass, field

from strands import Agent, tool
from strands.hooks import AfterToolCallEvent, HookProvider, HookRegistry
from strands.models import BedrockModel

from core import retrieval, settings
from core.citations import enforce
from core.db import connect, run_with_retry
from core.geo import geocode, neighborhood_at

log = logging.getLogger("docket.chat")

MAX_QUESTION_CHARS = 2000
HISTORY_MESSAGES = 6
RETRIEVAL_TOOLS = {"vector_search", "keyword_search", "search_by_address", "fetch_chunks", "get_document"}
REFUSAL = "I don't have anything in my sources about that."
REFUSAL_SENTENCE = re.compile(r"I don['’]t have anything in my sources about that\.?", re.IGNORECASE)
REASONING_SPAN = re.compile(r"<reasoning>.*?</reasoning>", re.DOTALL | re.IGNORECASE)
DISCLAIMER = "This is the text of the source documents, not legal advice."
LEGAL_QUESTION = re.compile(
    r"\b(allowed|permitted|legal|illegal|required|requirements?|must i|can i|may i|zoning|permits?|"
    r"ordinances?|laws?|code)\b",
    re.IGNORECASE,
)
MARKER = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")

SYSTEM_PROMPT = """You are Docket's assistant for residents of Fremont, California.

Rules:
- Answer only from evidence returned by your tools in this conversation turn. Call vector_search,
  keyword_search or search_by_address before every factual answer. Never use your own knowledge about
  Fremont, California law or local government.
- Cite every factual sentence with evidence numbers in square brackets, like [2] or [1, 3]. Cite only
  numbers that a tool returned in this turn.
- Copy numbers, dollar amounts, dates, addresses, section numbers and case or request ids exactly as they
  appear in the evidence.
- If the evidence does not answer the question, reply exactly: I don't have anything in my sources about that.
- When asked what someone is legally allowed or required to do, quote the relevant text, cite it, and say
  that this is the text of the source documents, not legal advice.
- Keep answers to two or three sentences unless the user asks for detail. No greeting. Do not restate the
  question.
"""


@dataclass
class Citation:
    ref: int
    chunk_id: str
    title: str
    locator: str
    url: str


@dataclass
class ChatResponse:
    answer: str
    cited_chunk_ids: list[str]
    citations: list[Citation]
    refused: bool
    sources_searched: list[str]
    session_id: str = ""
    removed_sentences: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class TurnEvidence:
    """Evidence handed to the model during one turn, numbered in the order it was returned."""

    def __init__(self) -> None:
        self.by_ref: dict[int, retrieval.Evidence] = {}
        self.ref_of: dict[str, int] = {}
        self.retrieval_calls = 0

    def add(self, items: list[retrieval.Evidence]) -> str:
        blocks = []
        for item in items:
            ref = self.ref_of.get(item.chunk_id)
            if ref is None:
                ref = len(self.by_ref) + 1
                self.ref_of[item.chunk_id] = ref
                self.by_ref[ref] = item
            date = f" | {item.published_at[:10]}" if item.published_at else ""
            blocks.append(
                f"[{ref}] {item.title} | {item.locator}{date} | {item.url} "
                f"| chunk_id={item.chunk_id} document_id={item.document_id}\n{item.text}"
            )
        return "\n\n".join(blocks) if blocks else "No matching evidence."


class RetrievalRecorder(HookProvider):
    """Counts retrieval tool calls that really executed, independent of what the model says."""

    def __init__(self, turn: TurnEvidence) -> None:
        self.turn = turn

    def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
        registry.add_callback(AfterToolCallEvent, self._after_tool_call)

    def _after_tool_call(self, event: AfterToolCallEvent) -> None:
        name = (event.tool_use or {}).get("name")
        if name in RETRIEVAL_TOOLS and event.exception is None:
            self.turn.retrieval_calls += 1


def build_tools(turn: TurnEvidence) -> list:
    @tool
    def vector_search(query: str) -> str:
        """Semantic search over the Fremont documents Docket has scraped. Returns numbered evidence."""
        return turn.add(retrieval.vector_search(query))

    @tool
    def keyword_search(query: str) -> str:
        """Keyword (BM25) search over the scraped Fremont documents. Use for names, ids and exact terms."""
        return turn.add(retrieval.keyword_search(query))

    @tool
    def fetch_chunks(chunk_ids: list[str]) -> str:
        """Return the full text of specific chunks by chunk_id, as numbered evidence."""
        return turn.add(retrieval.fetch_chunks(chunk_ids[:12]))

    @tool
    def get_document(document_id: str) -> str:
        """Outline of one stored document: title, URL, date and its chunks with locators and chunk ids."""
        return json.dumps(retrieval.get_document(document_id) or {"error": "document not found"})

    @tool
    def list_sources() -> str:
        """The public sources Docket scrapes, with last crawl time and document counts."""
        return json.dumps(retrieval.list_sources())

    @tool
    def get_recent_outputs(limit: int = 5) -> str:
        """Recent verified summaries and pros/cons analyses produced by Docket's pipeline."""
        return json.dumps(retrieval.recent_outputs(limit), default=str)

    @tool
    def search_by_address(address: str) -> str:
        """Find evidence about a Fremont street address and the official neighborhood it is in."""
        located = geocode(address)
        neighborhood = neighborhood_at(located["lat"], located["lng"]) if located else None
        items = retrieval.keyword_search(address)
        if neighborhood:
            items += retrieval.keyword_search(neighborhood)
        if located:
            header = (
                f"US Census geocoder match: {located['matched_address']}. City of Fremont Neighborhoods "
                f"GIS layer: {neighborhood or 'no neighborhood contains this point'}."
            )
        else:
            header = "The US Census geocoder found no match for that address."
        return f"{header}\n\n{turn.add(items)}"

    return [
        vector_search,
        keyword_search,
        fetch_chunks,
        get_document,
        list_sources,
        get_recent_outputs,
        search_by_address,
    ]


def final_text(result) -> str:
    """The model's answer text only. Reasoning blocks are skipped, and leaked <reasoning> spans removed."""
    message = getattr(result, "message", None)
    blocks = message.get("content", []) if isinstance(message, dict) else []
    text = "\n".join(
        block["text"] for block in blocks if isinstance(block, dict) and isinstance(block.get("text"), str)
    )
    return REASONING_SPAN.sub("", text).strip()


def _searched_source_names() -> list[str]:
    return [source["name"] for source in retrieval.list_sources() if source["document_count"]]


def _refs_in(text: str) -> list[int]:
    refs: list[int] = []
    for match in MARKER.finditer(text):
        for ref in (int(n) for n in match.group(1).split(",")):
            if ref not in refs:
                refs.append(ref)
    return refs


def finalize(question: str, raw_answer: str, turn: TurnEvidence) -> ChatResponse:
    searched = _searched_source_names()

    def refusal(removed: list | None = None) -> ChatResponse:
        return ChatResponse(
            answer=f"{REFUSAL} I searched: {'; '.join(searched)}.",
            cited_chunk_ids=[],
            citations=[],
            refused=True,
            sources_searched=searched,
            removed_sentences=removed or [],
        )

    # gpt-oss cites as 【1†L31-L38】; normalize to [1]. Markdown emphasis would show as raw asterisks.
    text = re.sub(r"【(\d+)(?:†[^】]*)?】", r"[\1]", raw_answer).replace("**", "")
    # A refusal sentence is not an answer: drop it wherever it appears and judge what remains.
    text = REFUSAL_SENTENCE.sub("", text).strip()
    if turn.retrieval_calls == 0 or not text:
        return refusal()

    def keep_known(match: re.Match) -> str:
        refs = [ref for ref in (int(n) for n in match.group(1).split(",")) if ref in turn.by_ref]
        return f"[{', '.join(str(ref) for ref in refs)}]" if refs else ""

    text = MARKER.sub(keep_known, text)
    refs = _refs_in(text)
    if not refs:
        return refusal()

    enforced = enforce(text, [turn.by_ref[ref].cited_text() for ref in refs])
    removed = [asdict(item) for item in enforced.removed]
    text = enforced.text
    remaining = _refs_in(text)
    if not text or not remaining:
        return refusal(removed)
    if LEGAL_QUESTION.search(question) and "not legal advice" not in text.lower():
        text = f"{text} {DISCLAIMER}"

    citations = []
    for ref in remaining:
        item = turn.by_ref[ref]
        citations.append(Citation(ref, item.chunk_id, item.title, item.locator, item.url))
    return ChatResponse(
        answer=text,
        cited_chunk_ids=[citation.chunk_id for citation in citations],
        citations=citations,
        refused=False,
        sources_searched=searched,
        removed_sentences=removed,
    )


def _session_uuid(session_id: str) -> str:
    try:
        return str(uuid.UUID(session_id))
    except ValueError:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"docket-chat:{session_id}"))


def resolve_session(session_id: str | None, user_id: str | None) -> str:
    """Continue a session only for the user who started it (both None for signed-out chats)."""
    if not session_id:
        return str(uuid.uuid4())
    candidate = _session_uuid(session_id)
    with connect() as conn:
        row = conn.execute(
            "SELECT user_id FROM agent_chat_sessions WHERE id = %s::uuid", (candidate,)
        ).fetchone()
    if row is None or row[0] == user_id:
        return candidate
    log.warning("chat session requested by a different user; starting a new session instead")
    return str(uuid.uuid4())


def load_history(session_id: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT role, text FROM agent_chat_messages WHERE session_id = %s::uuid "
            "ORDER BY created_at DESC LIMIT %s",
            (session_id, HISTORY_MESSAGES),
        ).fetchall()
    messages = [{"role": role, "content": [{"text": text}]} for role, text in reversed(rows)]
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    return messages


def persist_turn(
    session_id: str, user_id: str | None, group_id: str | None, question: str, response: ChatResponse
) -> None:
    def work(c):
        c.execute(
            "INSERT INTO agent_chat_sessions (id, group_id, user_id) VALUES (%s::uuid, %s, %s) "
            "ON CONFLICT (id) DO NOTHING",
            (session_id, group_id, user_id),
        )
        c.execute(
            "INSERT INTO agent_chat_messages (session_id, role, text) VALUES (%s::uuid, 'user', %s)",
            (session_id, question),
        )
        message_id = c.execute(
            "INSERT INTO agent_chat_messages (session_id, role, text) VALUES (%s::uuid, 'assistant', %s) "
            "RETURNING id",
            (session_id, response.answer),
        ).fetchone()[0]
        for chunk_id in response.cited_chunk_ids:
            c.execute(
                "INSERT INTO agent_message_chunks (message_id, chunk_id) VALUES (%s, %s::uuid) "
                "ON CONFLICT DO NOTHING",
                (message_id, chunk_id),
            )

    with connect() as conn:
        conn.autocommit = False
        run_with_retry(conn, work)
    if settings.MEMORY_ID:
        from bedrock_agentcore.memory import MemoryClient

        MemoryClient(region_name=settings.AWS_REGION).create_event(
            memory_id=settings.MEMORY_ID,
            actor_id=user_id or "anonymous",
            session_id=session_id,
            messages=[(question, "USER"), (response.answer, "ASSISTANT")],
        )


def _model() -> BedrockModel:
    return BedrockModel(model_id=settings.BEDROCK_MODEL_ID, region_name=settings.AWS_REGION)


async def answer(
    question: str, session_id: str | None = None, user_id: str | None = None, group_id: str | None = None
) -> ChatResponse:
    question = question.strip()[:MAX_QUESTION_CHARS]
    session = resolve_session(session_id, user_id)
    turn = TurnEvidence()
    agent = Agent(
        model=_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=build_tools(turn),
        messages=load_history(session),
        hooks=[RetrievalRecorder(turn)],
        callback_handler=None,
    )
    result = await agent.invoke_async(question)
    response = finalize(question, final_text(result), turn)
    response.session_id = session
    if response.removed_sentences:
        log.warning(
            "chat answer had %d sentence(s) removed by citation enforcement", len(response.removed_sentences)
        )
    persist_turn(session, user_id, group_id, question, response)
    return response


async def stream_answer(
    question: str, session_id: str | None = None, user_id: str | None = None, group_id: str | None = None
) -> AsyncIterator[dict]:
    """Status first, then the enforced answer in small pieces, then a final event with citations.

    Nothing the model writes is streamed before enforcement has run over the whole answer.
    """
    yield {"type": "status", "message": "Searching Docket's sources"}
    response = await answer(question, session_id, user_id, group_id)
    words = response.answer.split(" ")
    for start in range(0, len(words), 8):
        piece = " ".join(words[start : start + 8])
        yield {"type": "text", "text": piece if start == 0 else f" {piece}"}
    yield {"type": "final", **response.to_dict()}
