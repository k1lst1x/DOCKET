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

import asyncio
import json
import logging
import re
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import asdict, dataclass, field

from strands import Agent, tool
from strands.hooks import AfterToolCallEvent, HookProvider, HookRegistry
from strands.models import BedrockModel

from core import retrieval, settings
from core.citations import STRONG_FACT_KINDS, enforce, extract_facts, split_sentences, supports_any
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
# Questions unrelated to Fremont or government may be answered from general knowledge, labeled as such.
GENERAL_TAG = re.compile(r"^\s*\[general\]\s*:?\s*", re.IGNORECASE)  # shown to clients as grounded=False
# A question matching this is about Fremont or government, and only a cited answer from the documents is
# allowed, whatever the model tags its reply.
LOCAL_TOPIC = re.compile(
    r"\b(?:"
    # places: Fremont, its neighborhoods, the county and state
    r"fremont|niles|irvington|mission\s+san\s+jose|warm\s+springs|centerville|ardenwood|sundale|cabrillo|"
    r"glenmoor|kimber|parkmont|lake\s+elizabeth|newark|union\s+city|alameda\s+county|california|bay\s+area|"
    # local and state government
    r"city\s+(?:of|council|hall|manager|attorney|clerk|staff|budget|services?|government|ordinance|code)|"
    r"the\s+city\b|council(?:member|man|woman|\s+member)?|mayor|planning\s+commission|meeting\s+minutes|"
    r"agendas?|public\s+(?:meeting|hearing|comment)|board\s+(?:meeting|of\s+education)|school\s+board|"
    r"school\s+district|fusd|superintendent|(?:council|assembly|senate|congressional)\s+district|"
    r"legislat\w*|state\s+(?:assembly|senat\w*|law|bill)|assembly\s?member|governor|[AS]B\s?\d{1,4}|"
    r"ordinances?|ballot|measure\s+[A-Z]{1,2}|elections?|voting|polling\s+place|"
    # taxes, land use, housing and services residents ask the city about
    r"tax(?:es)?|zoning|zoned|permits?|building\s+code|housing\s+element|affordable\s+housing|adu|"
    r"accessory\s+dwelling|rent\s+(?:control|increase)|evictions?|bart|ac\s+transit|crosswalk|speed\s+limit|"
    r"code\s+enforcement|(?:trash|garbage|recycling)\s+(?:pickup|collection|day)|"
    # legal questions
    r"legal\s+advice|illegal|legally|allowed\s+to|permitted\s+to|required\s+to|(?:city|local|state)\s+laws?|"
    # street addresses
    r"\d{2,6}\s+[a-z]+(?:\s+[a-z]+)?\s+(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|way|lane|ln|"
    r"court|ct|parkway|pkwy|place|pl)"
    r")\b",
    re.IGNORECASE,
)
GROUNDED_REQUEST = (
    "This question is about Fremont or government, so it must be answered only from the documents. "
    "Search with vector_search, keyword_search or search_by_address, then answer with cited evidence "
    f"numbers, or reply exactly: {REFUSAL}"
)
EMPHASIS = re.compile(r"(?<![\w*])([*_])(?=\S)([^*_\n]+?)(?<=\S)\1(?![\w*])")

SYSTEM_PROMPT = """You are Docket's assistant for residents of Fremont, California.

Two kinds of questions:
1. Anything about Fremont or local or state government: the City Council, Planning Commission, school board,
   agendas, minutes, city news, transportation, taxes, budgets, zoning, permits, laws, legislators,
   neighborhoods or street addresses. For these, answer only from evidence returned by your tools in this
   turn, following the rules below. Never use your own knowledge for these.
2. Questions with nothing to do with Fremont or government: greetings, thanks, questions about you, jokes,
   or general knowledge (science, history, how-to, definitions). For these, do not call tools. Start your
   reply with the tag [general], then answer briefly and helpfully. If asked what you can do, say you answer
   questions about Fremont city documents with linked sources and can also help with general questions.
   Never use [general] for anything in the first kind.

Rules for Fremont and government questions:
- Call vector_search, keyword_search or search_by_address before every factual answer.
- Cite every factual sentence with evidence numbers in square brackets, like [2] or [1, 3]. Cite only
  numbers that a tool returned in this turn.
- Copy numbers, dollar amounts, dates, addresses, section numbers and case or request ids exactly as they
  appear in the evidence.
- Each sentence cites the evidence number whose own text contains that sentence's facts. Do not combine
  facts from different documents or meetings in one sentence; write a separate cited sentence for each.
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
    date: str | None = None  # the document's Fremont date (meeting or post date), ISO; None when undated


@dataclass
class ChatResponse:
    answer: str
    cited_chunk_ids: list[str]
    citations: list[Citation]
    refused: bool
    sources_searched: list[str]
    session_id: str = ""
    removed_sentences: list[dict] = field(default_factory=list)
    grounded: bool = True  # False only for a labeled general-knowledge answer to a non-Fremont question

    def to_dict(self) -> dict:
        return asdict(self)


class TurnEvidence:
    """Evidence handed to the model during one turn, numbered in the order it was returned."""

    def __init__(self, progress: Callable[[str], None] | None = None) -> None:
        self.by_ref: dict[int, retrieval.Evidence] = {}
        self.ref_of: dict[str, int] = {}
        self.retrieval_calls = 0
        self.progress = progress

    def report(self, message: str) -> None:
        """Tell a streaming client what the agent is doing. Progress must never break an answer."""
        if self.progress is not None:
            try:
                self.progress(message)
            except Exception:
                log.debug("progress callback failed", exc_info=True)

    def add(self, items: list[retrieval.Evidence]) -> str:
        blocks = []
        for item in items:
            ref = self.ref_of.get(item.chunk_id)
            if ref is None:
                ref = len(self.by_ref) + 1
                self.ref_of[item.chunk_id] = ref
                self.by_ref[ref] = item
            date = f" | {item.local_date()}" if item.published_at else ""
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
        turn.report("Searching Fremont city documents")
        return turn.add(retrieval.vector_search(query))

    @tool
    def keyword_search(query: str) -> str:
        """Keyword (BM25) search over the scraped Fremont documents. Use for names, ids and exact terms."""
        turn.report("Searching Fremont city documents")
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
        turn.report("Looking up the address and its neighborhood")
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


PLANNING_SENTENCE = re.compile(
    r"\b(?:we\s+(?:must|need\s+to|should|can)|the\s+user\s+(?:asks|wants|is\s+asking)|let['’]s\b|"
    r"now\s+answer|provide\s+(?:a\s+)?(?:concise|short|brief|final)?\s*answer|use\s+evidence|"
    r"cite\s+(?:the\s+)?evidence|final\s+answer\s*:)",
    re.IGNORECASE,
)
GLUED_SENTENCE = re.compile(r"(?<=[a-z][.!?])(?=[A-Z])")


def strip_planning(text: str) -> str:
    """Drop sentences in which the model talks about producing the answer instead of answering."""
    lines = []
    for line in text.splitlines():
        sentences = re.split(r"(?<=[.!?])\s+", GLUED_SENTENCE.sub(" ", line))
        kept = [sentence for sentence in sentences if not PLANNING_SENTENCE.search(sentence)]
        if kept or not line.strip():
            lines.append(" ".join(kept))
    return "\n".join(lines).strip()


def drop_padding_citations(text: str, turn: TurnEvidence) -> str:
    """Within a sentence citing several evidence numbers, drop the numbers whose text holds none of the
    sentence's strong facts (amounts, dates, sections, record ids, addresses). Enforcement checks facts
    against all cited chunks together, so an unrelated extra citation would otherwise ride along."""
    lines = []
    for line in text.splitlines():
        sentences = []
        for sentence in split_sentences(line):
            facts = extract_facts(sentence)
            refs = [ref for ref in _refs_in(sentence) if ref in turn.by_ref]
            if len(refs) > 1 and any(kind in STRONG_FACT_KINDS for kind, _ in facts):
                keep = {ref for ref in refs if supports_any(facts, turn.by_ref[ref].cited_text())}
                if keep:

                    def only_supporting(match: re.Match, keep: set[int] = keep) -> str:
                        cited = [n.strip() for n in match.group(1).split(",") if int(n) in keep]
                        return f"[{', '.join(cited)}]" if cited else ""

                    sentence = re.sub(r"\s+(?=[.!?]?$)", "", MARKER.sub(only_supporting, sentence))
            sentences.append(sentence)
        lines.append(" ".join(sentences))
    return "\n".join(lines).strip()


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
    text = re.sub(r"【(\d+)(?:†[^】]*)?】", r"[\1]", raw_answer).replace("**", "").replace("__", "")
    # Single-character emphasis (*Purchase of ...*, _term_) too; bullets and snake_case ids stay.
    text = EMPHASIS.sub(r"\2", text)
    # A refusal sentence is not an answer: drop it wherever it appears and judge what remains.
    text = REFUSAL_SENTENCE.sub("", text).strip()
    # gpt-oss occasionally writes its planning into the answer ("Now answer: ... We must cite. Use evidence
    # [1]. Provide concise answer.The agreement ..."). Those sentences are about writing the answer, never
    # part of it, and can carry supported facts and markers, so enforcement alone would let them through.
    text = strip_planning(text)

    # A general-knowledge answer is allowed only for a question unrelated to Fremont or government. It is
    # labeled, carries no citations and is marked grounded=False. An untagged reply counts as general only
    # when no retrieval ran: once the model searched the documents, an uncited reply is not an answer.
    tagged = bool(GENERAL_TAG.match(text))
    if (tagged or turn.retrieval_calls == 0) and not LOCAL_TOPIC.search(question):
        body = MARKER.sub("", GENERAL_TAG.sub("", text, count=1))
        body = re.sub(r"\s+([.,;:!?])", r"\1", re.sub(r"[ \t]{2,}", " ", body)).strip()
        if body:
            return ChatResponse(
                answer=body,
                cited_chunk_ids=[],
                citations=[],
                refused=False,
                sources_searched=[],
                grounded=False,
            )
    text = GENERAL_TAG.sub("", text, count=1)
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
    text = drop_padding_citations(enforced.text, turn)
    remaining = _refs_in(text)
    if not text or not remaining:
        return refusal(removed)
    if LEGAL_QUESTION.search(question) and "not legal advice" not in text.lower():
        text = f"{text} {DISCLAIMER}"

    # Evidence numbers count every chunk returned this turn ([13] is the 13th), and several chunks can come
    # from one document. Number what the answer cites 1..n by each document's first use, so markers match
    # the source list shown to residents and one meeting never appears as two sources.
    first_ref_of_document: dict[str, int] = {}
    number: dict[int, int] = {}
    for ref in remaining:
        document = turn.by_ref[ref].document_id
        first_ref_of_document.setdefault(document, ref)
        number[ref] = list(first_ref_of_document).index(document) + 1

    def renumber(match: re.Match) -> str:
        cited = dict.fromkeys(number[int(n)] for n in match.group(1).split(","))
        return f"[{', '.join(str(n) for n in cited)}]"

    text = MARKER.sub(renumber, text)
    text = re.sub(r"(\[\d+(?:, \d+)*\])(?:\s*\1)+", r"\1", text)  # "[1][1]" once two chunks share a document
    citations = []
    for ref in first_ref_of_document.values():
        item = turn.by_ref[ref]
        citations.append(
            Citation(
                number[ref], item.chunk_id, item.title, item.locator, item.url, item.local_date() or None
            )
        )
    return ChatResponse(
        answer=text,
        cited_chunk_ids=[turn.by_ref[ref].chunk_id for ref in remaining],
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


def recite_request(removed: list[dict]) -> str:
    """Feedback for one re-citation attempt: the sentences that failed and the facts not in their citation."""
    failures = "\n".join(
        f"- {item['sentence']} (not in the cited evidence: {', '.join(item['unsupported'])})"
        for item in removed
    )
    return (
        "Your answer was not shown because these sentences state facts that are not in the evidence "
        f"they cite:\n{failures}\n"
        "Rewrite the answer using only the evidence already returned in this turn. Give each fact the "
        "evidence number whose text contains it, and use one document per sentence. If the evidence does "
        "not contain a fact, leave it out. If nothing in the evidence answers the question, reply "
        f"exactly: {REFUSAL}"
    )


def _model() -> BedrockModel:
    return BedrockModel(model_id=settings.BEDROCK_MODEL_ID, region_name=settings.AWS_REGION)


def is_general(raw_answer: str) -> bool:
    return bool(GENERAL_TAG.match(raw_answer.replace("*", "").strip()))


async def answer(
    question: str,
    session_id: str | None = None,
    user_id: str | None = None,
    group_id: str | None = None,
    progress: Callable[[str], None] | None = None,
) -> ChatResponse:
    question = question.strip()[:MAX_QUESTION_CHARS]
    session = resolve_session(session_id, user_id)
    turn = TurnEvidence(progress)
    agent = Agent(
        model=_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=build_tools(turn),
        messages=load_history(session),
        hooks=[RetrievalRecorder(turn)],
        callback_handler=None,
    )
    result = await agent.invoke_async(question)
    raw = final_text(result)
    if is_general(raw) and LOCAL_TOPIC.search(question):
        # The model treated a Fremont or government question as general knowledge. Ask once to answer it from
        # the documents; finalize never lets a general answer through for such a question.
        log.warning("general-knowledge reply to a local question; asking for a cited answer")
        raw = final_text(await agent.invoke_async(GROUNDED_REQUEST))
    turn.report("Checking every fact against its source")
    response = finalize(question, raw, turn)
    if response.refused and response.removed_sentences:
        # Nothing survived enforcement, usually because a fact was cited to the wrong evidence number or
        # facts from two documents were merged. Ask once to re-cite from the same evidence; the retry goes
        # through the same enforcement, so a wrong answer can still only become a refusal.
        first_removed = response.removed_sentences
        retry = await agent.invoke_async(recite_request(first_removed))
        response = finalize(question, final_text(retry), turn)
        response.removed_sentences = first_removed + response.removed_sentences
        log.warning("chat answer re-cited after enforcement removed everything; refused=%s", response.refused)
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
    """Status events while the agent works, then the checked answer in small pieces, then a final event.

    Progress is streamed live (searches, address lookups, citation checks). Nothing the model writes is
    streamed before enforcement has run over the whole answer.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str] = asyncio.Queue()

    def progress(message: str) -> None:  # tools run in worker threads
        loop.call_soon_threadsafe(queue.put_nowait, message)

    yield {"type": "status", "message": "Reading your question"}
    task = asyncio.create_task(answer(question, session_id, user_id, group_id, progress=progress))
    last = None
    while not task.done() or not queue.empty():
        try:
            message = await asyncio.wait_for(queue.get(), timeout=0.25)
        except TimeoutError:
            continue
        if message != last:
            last = message
            yield {"type": "status", "message": message}
    response = task.result()
    words = response.answer.split(" ")
    for start in range(0, len(words), 8):
        piece = " ".join(words[start : start + 8])
        yield {"type": "text", "text": piece if start == 0 else f" {piece}"}
    yield {"type": "final", **response.to_dict()}
