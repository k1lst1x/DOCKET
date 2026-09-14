"""System one: the ingestion and generation pipeline, built as a Strands GraphBuilder graph.

    crawler -> ingestor -> researcher -> summarizer  -> verifier
                           researcher -> deliberator -> verifier
                           researcher -> insufficient_evidence   (fewer than 3 relevant chunks)

Grounding is enforced in code around the agents:
- the researcher's evidence is exactly what its retrieval tools returned, recorded as the tools run;
- the edge to insufficient_evidence is decided from that recorded evidence, not from model prose;
- the summarizer and deliberator return structured output citing evidence numbers;
- the verifier judges each claim against the text it cites, and code independently requires every fact
  to appear verbatim in that text. Nothing reaches agent_outputs unless both checks pass.

Tools hand documents between agents by id, so page text never has to pass through the model to move.
"""

import json
import logging
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import boto3
import psycopg
from strands import Agent, tool
from strands.models import BedrockModel
from strands.multiagent import GraphBuilder
from strands.multiagent.base import MultiAgentBase, MultiAgentResult, Status
from strands.multiagent.graph import GraphState

from core import legislature, retrieval, settings
from core.chat_agent import TurnEvidence
from core.chunking import Chunk, chunk_markdown, chunk_pages
from core.db import connect
from core.discovery import DocumentRef, discover
from core.embed import embed_text
from core.extract import content_hash, document_text
from core.fetcher import Artifact, Fetcher
from core.generation_models import (
    ClaimVerdict,
    ProsConsOutput,
    SummaryOutput,
    VerificationOutput,
    assemble_verified,
    candidate_claims,
    check_facts,
    store_output,
)
from core.registry import Source, get_source, load_sources
from core.store import EmbeddedChunk, finish_run, has_hash, has_url, put_raw, start_run
from core.store import store_document as store_document_row
from core.vectors import S3VectorStore

log = logging.getLogger("docket.pipeline")

MIN_RELEVANT_CHUNKS = 3
RELEVANT_SIMILARITY = 0.40  # cosine similarity from the vector index
RELEVANT_BM25 = 3.0  # BM25 score from keyword search
LOOKBACK_DAYS = 120
LOOKAHEAD_DAYS = 14
FREMONT_TZ = ZoneInfo("America/Los_Angeles")
IMMUTABLE_TYPES = {"minutes", "agenda", "meeting_document", "news"}

CRAWLER_PROMPT = """You crawl public City of Fremont sources for Docket.
For each source returned by list_sources: call check_robots with the source id and URL and skip the
source when crawling is not allowed; otherwise call fetch_url on the source URL and then discover_links
on the returned artifact_id. Do not read, summarize or judge page content.
Finish with a single line: DISCOVERED: followed by every ref_id discover_links returned, comma separated."""

INGESTOR_PROMPT = """You ingest documents for Docket. The input lists ref_ids discovered by the crawler.
For each ref_id, call extract_text, then chunk_document, then embed_chunks, then store_document, in that
order. When extract_text reports already_stored, skipped or an error, move on to the next ref_id.
Do not summarize or describe any content. Finish with one line counting stored and skipped documents."""

RESEARCHER_PROMPT = """You retrieve evidence for Docket. You never write summaries, conclusions or prose.
Search for the topic in the input with vector_search and keyword_search, using at least two different
phrasings, and use fetch_chunks or get_document to pull more of a promising document.
Reply only with the evidence numbers you found relevant, for example: RELEVANT: 1, 4, 7."""

SUMMARIZER_PROMPT = """You write a {kind} for Fremont residents using ONLY the numbered evidence provided.
- Every claim is one plain-language sentence and cites the evidence numbers that support it.
- Stay under 200 words in total. Explain municipal terms in plain words (for example, "consent calendar"
  means routine items approved together in one vote).
- Copy numbers, dollar amounts, dates, addresses, section numbers and case ids exactly as written.
- Add nothing that the evidence does not say. Use fetch_chunks only to read cited evidence in full.
- A visual is optional. Use bar or pie only when the evidence gives comparable numbers, timeline for
  cited dates, and facts otherwise. Every visual value must be copied exactly from the evidence.
- Use only evidence about the topic. If none of the evidence is about the topic, return no claims."""

DELIBERATOR_PROMPT = """You list pros and cons of a Fremont topic for residents, using ONLY the numbered
evidence.
- Label each point "stated in the document" when the evidence says it, or "reasonable inference" when it
  follows from the evidence without being said. Never blur the two.
- Every point cites the evidence numbers it rests on and copies facts exactly.
- If the evidence supports only one side, leave the other list empty and say so in one_sided_note.
  Never invent balance.
- Use only evidence about the topic. If none of it is about the topic, return empty lists."""

VERIFIER_PROMPT = """You verify claims for Docket before anything is published.
For every claim id in the input, call check_claim_support and read the cited text it returns.
A claim is supported only if the cited text actually says it (for "stated in the document" points and
summary sentences) or clearly implies it (for "reasonable inference" points). Mark a claim unsupported
if it adds any detail the cited text does not contain, or if it is not about the topic named in the
input, even when the cited text supports it. Return one verdict for every claim id."""


@dataclass
class PipelineRun:
    topic: str
    kind: str
    group_id: str | None = None
    crawl: bool = False
    sources: list[str] = field(default_factory=list)
    max_docs: int = 5
    evidence: TurnEvidence = field(default_factory=TurnEvidence)
    artifacts: dict[str, tuple[Source, Artifact]] = field(default_factory=dict)
    refs: dict[str, tuple[Source, DocumentRef]] = field(default_factory=dict)
    texts: dict[str, dict] = field(default_factory=dict)
    summary: SummaryOutput | None = None
    proscons: ProsConsOutput | None = None
    output_id: str | None = None
    insufficient: bool = False
    stripped: list[dict] = field(default_factory=list)
    counts: Counter = field(default_factory=Counter)

    @property
    def needs_summary(self) -> bool:
        return self.kind in ("summary", "announcement")

    @property
    def needs_proscons(self) -> bool:
        return self.kind == "proscons"

    def relevant_evidence(self) -> list[retrieval.Evidence]:
        return [
            item
            for item in self.evidence.by_ref.values()
            if (item.similarity or 0) >= RELEVANT_SIMILARITY or (item.keyword_score or 0) >= RELEVANT_BM25
        ]

    def evidence_block(self) -> str:
        relevant = {item.chunk_id for item in self.relevant_evidence()}
        blocks = []
        for ref, item in self.evidence.by_ref.items():
            if item.chunk_id in relevant:
                date = f" | {item.published_at[:10]}" if item.published_at else ""
                blocks.append(f"[{ref}] {item.title} | {item.locator}{date}\n{item.text}")
        return "\n\n".join(blocks)


class CodeNode(MultiAgentBase):
    """A graph node whose work is a coroutine: wraps structured-output agents or pure code."""

    def __init__(self, name: str, work) -> None:
        self.name = name
        self._work = work

    async def invoke_async(self, task, invocation_state=None, **kwargs) -> MultiAgentResult:
        started = time.monotonic()
        await self._work()
        return MultiAgentResult(
            status=Status.COMPLETED, execution_time=int((time.monotonic() - started) * 1000)
        )


def _model() -> BedrockModel:
    from core.bedrock_session import bedrock_session

    return BedrockModel(model_id=settings.BEDROCK_MODEL_ID, boto_session=bedrock_session())


def _select(refs: list[DocumentRef], max_docs: int) -> list[DocumentRef]:
    now = datetime.now()
    cutoff, horizon = now - timedelta(days=LOOKBACK_DAYS), now + timedelta(days=LOOKAHEAD_DAYS)
    recent = [r for r in refs if r.published_at is None or cutoff <= r.published_at <= horizon]
    dated = sorted((r for r in recent if r.published_at), key=lambda r: r.published_at, reverse=True)
    return (dated + [r for r in recent if not r.published_at])[:max_docs]


def crawler_agent(run: PipelineRun, fetcher: Fetcher) -> Agent:
    @tool
    def list_sources() -> str:
        """Enabled public sources from the Docket registry: id, name, URL and kind."""
        sources = [s for s in load_sources() if not run.sources or s.id in run.sources]
        return json.dumps(
            [{"source_id": s.id, "name": s.name, "url": s.url, "kind": s.kind} for s in sources]
        )

    @tool
    def check_robots(source_id: str, url: str) -> str:
        """Whether robots.txt allows Docket to crawl a URL for this source, and any crawl delay."""
        source = get_source(source_id)
        allowed, delay = fetcher.check_robots(url, source.fetcher, source.send_user_agent)
        return json.dumps({"source_id": source_id, "allowed": allowed, "crawl_delay": delay})

    @tool
    def fetch_url(source_id: str, url: str) -> str:
        """Fetch a source page politely (robots.txt, rate limits). Returns an artifact_id, not page text."""
        source = get_source(source_id)
        artifact = fetcher.fetch(
            url, source.fetcher, source.params.get("wait_for_ms"), source.send_user_agent
        )
        artifact_id = f"a{len(run.artifacts) + 1}"
        run.artifacts[artifact_id] = (source, artifact)
        return json.dumps(
            {"artifact_id": artifact_id, "status": artifact.status, "chars": len(artifact.text or "")}
        )

    @tool
    def discover_links(artifact_id: str) -> str:
        """Linked documents and detail pages one level deep from a fetched source page, as ref_ids."""
        if artifact_id not in run.artifacts:
            return json.dumps({"error": "unknown artifact_id"})
        source, artifact = run.artifacts[artifact_id]
        try:
            refs = _select(discover(source, artifact), run.max_docs)
        except NotImplementedError as error:
            return json.dumps({"error": str(error)})
        expanded: list[DocumentRef] = []
        for ref in refs:
            expanded += legislature.expand(fetcher, source, ref) if ref.doc_type == "bulk_pubinfo" else [ref]
        listed = []
        for ref in expanded[: run.max_docs]:
            ref_id = f"r{len(run.refs) + 1}"
            run.refs[ref_id] = (source, ref)
            listed.append({"ref_id": ref_id, "title": ref.title, "doc_type": ref.doc_type})
        return json.dumps({"source_id": source.id, "refs": listed})

    return Agent(
        name="crawler",
        model=_model(),
        system_prompt=CRAWLER_PROMPT,
        tools=[list_sources, check_robots, fetch_url, discover_links],
        callback_handler=None,
    )


def ingestor_agent(run: PipelineRun, fetcher: Fetcher, conn: psycopg.Connection) -> Agent:
    vectors = S3VectorStore()
    s3 = boto3.client("s3", region_name=settings.AWS_REGION)

    @tool
    def extract_text(ref_id: str) -> str:
        """Fetch a discovered document and extract its text. Reports size and whether it is stored."""
        if ref_id not in run.refs:
            return json.dumps({"ref_id": ref_id, "error": "unknown ref_id"})
        source, ref = run.refs[ref_id]
        if not ref.inline_text and ref.doc_type in IMMUTABLE_TYPES and has_url(conn, ref.url):
            run.counts["skipped_known_url"] += 1
            return json.dumps({"ref_id": ref_id, "already_stored": True})
        if ref.inline_text:
            text, pages, raw, ext, fetched_at = (
                ref.inline_text,
                None,
                ref.inline_text.encode(),
                "txt",
                datetime.now(UTC),
            )
        else:
            artifact = fetcher.fetch(
                ref.url,
                source.fetcher,
                source.params.get("wait_for_ms"),
                source.send_user_agent,
                main_content=True,
            )
            if not artifact.status or artifact.status >= 400:
                return json.dumps({"ref_id": ref_id, "error": f"HTTP {artifact.status}"})
            text, pages, fetched_at = document_text(artifact), artifact.pages, artifact.fetched_at
            raw, ext = (artifact.raw, "html") if artifact.raw and not pages else (text.encode(), "md")
        if not text.strip():
            return json.dumps({"ref_id": ref_id, "skipped": "empty"})
        digest = content_hash(text)
        if has_hash(conn, digest):
            run.counts["skipped_same_hash"] += 1
            return json.dumps({"ref_id": ref_id, "already_stored": True})
        run.texts[ref_id] = {
            "text": text,
            "pages": pages,
            "raw": raw,
            "ext": ext,
            "digest": digest,
            "at": fetched_at,
        }
        return json.dumps(
            {"ref_id": ref_id, "chars": len(text), "pages": len(pages or []), "already_stored": False}
        )

    @tool
    def chunk_document(ref_id: str) -> str:
        """Split extracted text into ~700-token chunks on headings, agenda items and section numbers."""
        entry = run.texts.get(ref_id)
        if entry is None:
            return json.dumps({"ref_id": ref_id, "error": "call extract_text first"})
        source, ref = run.refs[ref_id]
        if ref.inline_text:
            base = ref.locator or "record"
            entry["chunks"] = [
                Chunk(
                    c.ordinal, c.text, base if c.locator == "document start" else f"{base} › {c.locator}", 1
                )
                for c in chunk_markdown(entry["text"])
            ]
        else:
            entry["chunks"] = chunk_pages(entry["pages"]) if entry["pages"] else chunk_markdown(entry["text"])
        return json.dumps({"ref_id": ref_id, "chunks": len(entry["chunks"])})

    @tool
    def embed_chunks(ref_id: str) -> str:
        """Embed each chunk with Titan Text Embeddings V2 (1024 dimensions)."""
        entry = run.texts.get(ref_id)
        if entry is None or "chunks" not in entry:
            return json.dumps({"ref_id": ref_id, "error": "call chunk_document first"})
        _, ref = run.refs[ref_id]
        embedded = []
        for piece in entry["chunks"]:
            vector, tokens = embed_text(f"{ref.title}\n{piece.locator}\n\n{piece.text}")
            embedded.append(EmbeddedChunk(piece.ordinal, piece.text, piece.locator, tokens, vector))
        entry["embedded"] = embedded
        return json.dumps({"ref_id": ref_id, "embedded": len(embedded)})

    @tool
    def store_document(ref_id: str) -> str:
        """Store the document, its chunks with locators, its raw original and its vectors. Idempotent."""
        entry = run.texts.get(ref_id)
        if entry is None or "embedded" not in entry:
            return json.dumps({"ref_id": ref_id, "error": "call embed_chunks first"})
        source, ref = run.refs[ref_id]
        document_id = store_document_row(
            conn,
            vectors,
            source_id=source.id,
            url=ref.url,
            title=ref.title,
            published_at=ref.published_at.replace(tzinfo=FREMONT_TZ) if ref.published_at else None,
            digest=entry["digest"],
            raw_s3_key=put_raw(s3, source.id, entry["digest"], entry["raw"], entry["ext"]),
            doc_type=ref.doc_type,
            fetched_at=entry["at"],
            chunks=entry["embedded"],
        )
        run.counts["stored" if document_id else "skipped_same_hash"] += 1
        return json.dumps({"ref_id": ref_id, "document_id": document_id, "stored": bool(document_id)})

    return Agent(
        name="ingestor",
        model=_model(),
        system_prompt=INGESTOR_PROMPT,
        tools=[extract_text, chunk_document, embed_chunks, store_document],
        callback_handler=None,
    )


def researcher_agent(run: PipelineRun) -> Agent:
    @tool
    def vector_search(query: str) -> str:
        """Semantic search over the stored corpus. Returns numbered evidence."""
        return run.evidence.add(retrieval.vector_search(query))

    @tool
    def keyword_search(query: str) -> str:
        """Keyword (BM25) search over the stored corpus. Returns numbered evidence."""
        return run.evidence.add(retrieval.keyword_search(query))

    @tool
    def fetch_chunks(chunk_ids: list[str]) -> str:
        """Full text of specific chunks by chunk_id, as numbered evidence."""
        return run.evidence.add(retrieval.fetch_chunks(chunk_ids[:12]))

    @tool
    def get_document(document_id: str) -> str:
        """Outline of a stored document with its chunk ids and locators."""
        return json.dumps(retrieval.get_document(document_id) or {"error": "document not found"})

    return Agent(
        name="researcher",
        model=_model(),
        system_prompt=RESEARCHER_PROMPT,
        tools=[vector_search, keyword_search, fetch_chunks, get_document],
        callback_handler=None,
    )


def _evidence_tool(run: PipelineRun):
    @tool
    def fetch_chunks(refs: list[int]) -> str:
        """Full text of evidence items by their evidence numbers."""
        items = [run.evidence.by_ref[r] for r in refs if r in run.evidence.by_ref]
        return "\n\n".join(
            f"[{run.evidence.ref_of[i.chunk_id]}] {i.title} | {i.locator}\n{i.text}" for i in items
        )

    return fetch_chunks


def summarizer_node(run: PipelineRun) -> CodeNode:
    async def work() -> None:
        if not run.needs_summary:
            return
        agent = Agent(
            name="summarizer",
            model=_model(),
            system_prompt=SUMMARIZER_PROMPT.format(kind=run.kind),
            tools=[_evidence_tool(run)],
            callback_handler=None,
        )
        prompt = f"Topic: {run.topic}\n\nNumbered evidence:\n{run.evidence_block()}"
        result = await agent.invoke_async(prompt, structured_output_model=SummaryOutput)
        run.summary = result.structured_output

    return CodeNode("summarizer", work)


def deliberator_node(run: PipelineRun) -> CodeNode:
    async def work() -> None:
        if not run.needs_proscons:
            return
        agent = Agent(
            name="deliberator",
            model=_model(),
            system_prompt=DELIBERATOR_PROMPT,
            tools=[_evidence_tool(run)],
            callback_handler=None,
        )
        prompt = f"Topic: {run.topic}\n\nNumbered evidence:\n{run.evidence_block()}"
        result = await agent.invoke_async(prompt, structured_output_model=ProsConsOutput)
        run.proscons = result.structured_output

    return CodeNode("deliberator", work)


def verifier_node(run: PipelineRun) -> CodeNode:
    async def work() -> None:
        candidates = candidate_claims(
            run.summary if run.needs_summary else None, run.proscons if run.needs_proscons else None
        )
        if not candidates:
            return
        by_id = {claim.claim_id: claim for claim in candidates}

        @tool
        def check_claim_support(claim_id: str) -> str:
            """The claim, the full text it cites, and whether its facts appear verbatim in that text."""
            claim = by_id.get(claim_id)
            if claim is None:
                return json.dumps({"error": "unknown claim_id"})
            facts_ok, unsupported, cited = check_facts(claim, run.evidence.by_ref)
            return json.dumps(
                {
                    "claim_id": claim_id,
                    "claim": claim.text,
                    "basis": claim.basis,
                    "facts_found_verbatim": facts_ok,
                    "unsupported_facts": unsupported,
                    "cited_text": cited,
                }
            )

        agent = Agent(
            name="verifier",
            model=_model(),
            system_prompt=VERIFIER_PROMPT,
            tools=[_evidence_tool(run), check_claim_support],
            callback_handler=None,
        )
        listing = "\n".join(f"{c.claim_id}: {c.text} (cites {c.refs})" for c in candidates)
        result = await agent.invoke_async(
            f"Topic: {run.topic}\n\nClaims to verify:\n{listing}", structured_output_model=VerificationOutput
        )
        verdicts: dict[str, ClaimVerdict] = {v.claim_id: v for v in result.structured_output.verdicts}
        verified = assemble_verified(
            run.kind, run.topic, run.summary, run.proscons, verdicts, run.evidence.by_ref
        )
        run.stripped = verified.stripped
        for item in verified.stripped:
            log.warning("verifier stripped claim %s: %s", item.get("claim_id"), item)
        if verified.claims:
            run.output_id = store_output(run.kind, run.topic, run.group_id, verified)

    return CodeNode("verifier", work)


def insufficient_evidence_node(run: PipelineRun) -> CodeNode:
    async def work() -> None:
        run.insufficient = True
        log.info(
            "insufficient evidence for topic %r: %d relevant chunks", run.topic, len(run.relevant_evidence())
        )

    return CodeNode("insufficient_evidence", work)


def build_graph(run: PipelineRun, fetcher: Fetcher | None, conn: psycopg.Connection | None):
    def enough(state: GraphState) -> bool:
        return len(run.relevant_evidence()) >= MIN_RELEVANT_CHUNKS

    def not_enough(state: GraphState) -> bool:
        return not enough(state)

    def both_drafts_done(state: GraphState) -> bool:
        return {"summarizer", "deliberator"} <= {node.node_id for node in state.completed_nodes}

    builder = GraphBuilder()
    if run.crawl:
        builder.add_node(crawler_agent(run, fetcher), "crawler")
        builder.add_node(ingestor_agent(run, fetcher, conn), "ingestor")
    builder.add_node(researcher_agent(run), "researcher")
    builder.add_node(summarizer_node(run), "summarizer")
    builder.add_node(deliberator_node(run), "deliberator")
    builder.add_node(verifier_node(run), "verifier")
    builder.add_node(insufficient_evidence_node(run), "insufficient_evidence")
    if run.crawl:
        builder.add_edge("crawler", "ingestor")
        builder.add_edge("ingestor", "researcher")
        builder.set_entry_point("crawler")
    else:
        builder.set_entry_point("researcher")
    builder.add_edge("researcher", "summarizer", condition=enough)
    builder.add_edge("researcher", "deliberator", condition=enough)
    builder.add_edge("researcher", "insufficient_evidence", condition=not_enough)
    builder.add_edge("summarizer", "verifier", condition=both_drafts_done)
    builder.add_edge("deliberator", "verifier", condition=both_drafts_done)
    # The topology has no cycles; these limits are a safety cap on cost and runtime.
    builder.set_max_node_executions(20)
    builder.set_execution_timeout(3600 if run.crawl else 900)
    return builder.build()


async def generate(
    topic: str,
    kind: str,
    group_id: str | None = None,
    crawl: bool = False,
    sources: list[str] | None = None,
    max_docs: int = 5,
) -> dict:
    """Run the graph for one topic. crawl=True starts at the crawler; otherwise at the researcher."""
    run = PipelineRun(
        topic=topic, kind=kind, group_id=group_id, crawl=crawl, sources=sources or [], max_docs=max_docs
    )
    with connect() as conn:
        conn.autocommit = False
        run_id = start_run(conn, "generate")
        status = "failed"
        try:
            graph = build_graph(run, Fetcher() if crawl else None, conn if crawl else None)
            result = await graph.invoke_async(f"Topic: {topic}\nKind: {kind}")
            if run.insufficient:
                status = "insufficient_evidence"
            elif run.output_id:
                status = "verified"
            else:
                status = "nothing_verified"
            return {
                "status": status,
                "run_id": run_id,
                "output_id": run.output_id,
                "relevant_chunks": len(run.relevant_evidence()),
                "retrieved_chunks": len(run.evidence.by_ref),
                "stripped_claims": run.stripped,
                "execution_order": [node.node_id for node in result.execution_order],
                "ingest_counts": dict(run.counts),
            }
        finally:
            finish_run(
                conn,
                run_id,
                status,
                {
                    "topic": topic,
                    "kind": kind,
                    "output_id": run.output_id,
                    "relevant_chunks": len(run.relevant_evidence()),
                    "stripped_claims": len(run.stripped),
                    **dict(run.counts),
                },
            )
