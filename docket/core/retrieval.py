"""Hybrid retrieval over the stored corpus: S3 Vectors similarity plus BM25 keyword search.

Every result is a real stored chunk with its document title, URL and locator. Nothing in this
module generates text; it only returns evidence.
"""

import re
import threading
import time
from dataclasses import asdict, dataclass, field

import psycopg
from rank_bm25 import BM25Okapi

from core.db import connect
from core.embed import embed_text
from core.vectors import S3VectorStore

TOP_K = 12
RRF_K = 60  # reciprocal rank fusion constant
KEYWORD_INDEX_TTL_S = 600

TOKEN = re.compile(r"[a-z0-9]+(?:[.\-][a-z0-9]+)*")
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is", "it", "its",
    "of", "on", "or", "that", "the", "this", "to", "was", "were", "what", "when", "where", "which",
    "who", "will", "with", "about", "does", "do", "how", "any", "there", "me", "my", "i", "you",
}

EVIDENCE_SQL = """
SELECT c.id, c.document_id, d.source_id, s.name, d.title, d.url, c.locator, d.doc_type,
       d.published_at, c.text
FROM agent_chunks c
JOIN agent_documents d ON d.id = c.document_id
JOIN agent_sources s ON s.id = d.source_id
WHERE c.id = ANY(%s::uuid[])
"""


@dataclass
class Evidence:
    chunk_id: str
    document_id: str
    source_id: str
    source_name: str
    title: str
    url: str
    locator: str
    doc_type: str
    published_at: str | None
    text: str
    score: float = 0.0  # fused rank score (hybrid) or the single retriever's score
    similarity: float | None = None  # cosine similarity from the vector index
    keyword_score: float | None = None  # BM25 score
    matched_by: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    def cited_text(self) -> str:
        """What a citation to this chunk vouches for: the chunk plus its document's title, locator and
        date. A meeting's date is often only in the document title, not in the agenda row being cited."""
        date = self.published_at[:10] if self.published_at else ""
        return f"{self.title}\n{self.locator}\n{date}\n{self.text}"


_lock = threading.Lock()
_connection: psycopg.Connection | None = None


def _query(sql: str, params: tuple = ()) -> list[tuple]:
    global _connection
    for attempt in range(2):
        with _lock:
            try:
                if _connection is None or _connection.closed:
                    _connection = connect()
                    _connection.autocommit = True
                return _connection.execute(sql, params).fetchall()
            except psycopg.OperationalError:
                _connection = None  # IAM tokens and DSQL connections expire; reconnect once
                if attempt == 1:
                    raise
    return []


def tokenize(text: str) -> list[str]:
    return [token for token in TOKEN.findall(text.lower()) if token not in STOPWORDS]


def fetch_chunks(chunk_ids: list[str]) -> list[Evidence]:
    if not chunk_ids:
        return []
    rows = _query(EVIDENCE_SQL, (list(chunk_ids),))
    by_id = {
        str(row[0]): Evidence(
            chunk_id=str(row[0]),
            document_id=str(row[1]),
            source_id=row[2],
            source_name=row[3],
            title=row[4] or "",
            url=row[5],
            locator=row[6],
            doc_type=row[7],
            published_at=row[8].isoformat() if row[8] else None,
            text=row[9],
        )
        for row in rows
    }
    return [by_id[chunk_id] for chunk_id in chunk_ids if chunk_id in by_id]


class _KeywordIndex:
    def __init__(self) -> None:
        self.ids: list[str] = []
        self.bm25: BM25Okapi | None = None
        self.count = -1
        self.loaded = 0.0

    def _ensure(self) -> None:
        count = _query("SELECT count(*) FROM agent_chunks")[0][0]
        if count == self.count and time.monotonic() - self.loaded < KEYWORD_INDEX_TTL_S:
            return
        rows = _query(
            "SELECT c.id, d.title, c.locator, c.text FROM agent_chunks c "
            "JOIN agent_documents d ON d.id = c.document_id"
        )
        self.ids = [str(row[0]) for row in rows]
        # Same context as the embeddings: document title and locator, then the verbatim chunk text.
        corpus = [tokenize(f"{row[1] or ''} {row[2]} {row[3]}") or ["_"] for row in rows]
        self.bm25 = BM25Okapi(corpus) if corpus else None
        self.count, self.loaded = count, time.monotonic()

    def search(self, query: str, k: int) -> list[tuple[str, float]]:
        self._ensure()
        tokens = tokenize(query)
        if self.bm25 is None or not tokens:
            return []
        scores = self.bm25.get_scores(tokens)
        ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:k]
        return [(self.ids[i], float(scores[i])) for i in ranked if scores[i] > 0]


_keyword_index = _KeywordIndex()


def vector_search(query: str, k: int = TOP_K) -> list[Evidence]:
    vector, _ = embed_text(query)
    hits = S3VectorStore().query(vector, top_k=k)
    evidence = {item.chunk_id: item for item in fetch_chunks([hit.key for hit in hits])}
    results = []
    for hit in hits:
        item = evidence.get(hit.key)
        if item is None:
            continue
        item.similarity = round(1 - hit.distance, 4) if hit.distance is not None else None
        item.score = item.similarity or 0.0
        item.matched_by = ["vector"]
        results.append(item)
    return results


def keyword_search(query: str, k: int = TOP_K) -> list[Evidence]:
    hits = _keyword_index.search(query, k)
    evidence = {item.chunk_id: item for item in fetch_chunks([chunk_id for chunk_id, _ in hits])}
    results = []
    for chunk_id, score in hits:
        item = evidence.get(chunk_id)
        if item is None:
            continue
        item.keyword_score = round(score, 4)
        item.score = item.keyword_score
        item.matched_by = ["keyword"]
        results.append(item)
    return results


def hybrid_search(query: str, k: int = TOP_K) -> list[Evidence]:
    """Vector and keyword results merged by reciprocal rank fusion and deduplicated."""
    fused: dict[str, tuple[Evidence, float]] = {}
    for results in (vector_search(query, k), keyword_search(query, k)):
        for rank, item in enumerate(results):
            current, score = fused.get(item.chunk_id, (item, 0.0))
            if current is not item:
                current.similarity = current.similarity if current.similarity is not None else item.similarity
                current.keyword_score = (
                    current.keyword_score if current.keyword_score is not None else item.keyword_score
                )
                current.matched_by = sorted(set(current.matched_by) | set(item.matched_by))
            fused[item.chunk_id] = (current, score + 1 / (RRF_K + rank + 1))
    ranked = sorted(fused.values(), key=lambda pair: pair[1], reverse=True)[:k]
    for item, score in ranked:
        item.score = round(score, 5)
    return [item for item, _ in ranked]


def get_document(document_id: str) -> dict | None:
    rows = _query(
        """
        SELECT d.id, d.source_id, d.url, d.title, d.published_at, d.doc_type, d.fetched_at
        FROM agent_documents d WHERE d.id = %s::uuid
        """,
        (document_id,),
    )
    if not rows:
        return None
    doc = rows[0]
    chunks = _query(
        "SELECT id, ordinal, locator, token_count FROM agent_chunks "
        "WHERE document_id = %s::uuid ORDER BY ordinal",
        (document_id,),
    )
    return {
        "document_id": str(doc[0]),
        "source_id": doc[1],
        "url": doc[2],
        "title": doc[3],
        "published_at": doc[4].isoformat() if doc[4] else None,
        "doc_type": doc[5],
        "fetched_at": doc[6].isoformat() if doc[6] else None,
        "chunks": [
            {"chunk_id": str(c[0]), "ordinal": c[1], "locator": c[2], "token_count": c[3]} for c in chunks
        ],
    }


def get_output(output_id: str) -> dict | None:
    """One pipeline output with its claims and each claim's cited chunks resolved to title/URL/locator."""
    rows = _query(
        "SELECT id, kind, topic, group_id, body_json, status, created_at FROM agent_outputs "
        "WHERE id = %s::uuid",
        (output_id,),
    )
    if not rows:
        return None
    output = rows[0]
    claims = _query(
        "SELECT id, claim_text, verified_bool FROM agent_claims "
        "WHERE output_id = %s::uuid ORDER BY claim_text",
        (output_id,),
    )
    links = _query(
        """
        SELECT cc.claim_id, cc.chunk_id FROM agent_claim_chunks cc
        JOIN agent_claims cl ON cl.id = cc.claim_id WHERE cl.output_id = %s::uuid
        """,
        (output_id,),
    )
    evidence = {item.chunk_id: item for item in fetch_chunks(sorted({str(link[1]) for link in links}))}
    by_claim: dict[str, list[dict]] = {}
    for claim_id, chunk_id in links:
        item = evidence.get(str(chunk_id))
        if item:
            by_claim.setdefault(str(claim_id), []).append(
                {"chunk_id": item.chunk_id, "title": item.title, "url": item.url, "locator": item.locator}
            )
    return {
        "output_id": str(output[0]),
        "kind": output[1],
        "topic": output[2],
        "group_id": output[3],
        "body": output[4],
        "status": output[5],
        "created_at": output[6].isoformat() if output[6] else None,
        "claims": [
            {"claim_id": str(c[0]), "text": c[1], "verified": c[2], "citations": by_claim.get(str(c[0]), [])}
            for c in claims
        ],
    }


def recent_outputs(limit: int = 5, group_id: str | None = None) -> list[dict]:
    rows = _query(
        """
        SELECT id, kind, topic, group_id, status, created_at, body_json FROM agent_outputs
        WHERE status = 'verified' AND (%s::text IS NULL OR group_id = %s::text)
        ORDER BY created_at DESC LIMIT %s
        """,
        (group_id, group_id, max(1, min(limit, 20))),
    )
    return [
        {
            "output_id": str(r[0]),
            "kind": r[1],
            "topic": r[2],
            "group_id": r[3],
            "status": r[4],
            "created_at": r[5].isoformat() if r[5] else None,
            "body": r[6],
        }
        for r in rows
    ]


def list_sources() -> list[dict]:
    rows = _query(
        """
        SELECT s.id, s.name, s.url, s.kind, s.last_crawled_at, count(d.id)
        FROM agent_sources s LEFT JOIN agent_documents d ON d.source_id = s.id
        GROUP BY s.id, s.name, s.url, s.kind, s.last_crawled_at ORDER BY s.id
        """
    )
    return [
        {
            "source_id": r[0],
            "name": r[1],
            "url": r[2],
            "kind": r[3],
            "last_crawled_at": r[4].isoformat() if r[4] else None,
            "document_count": r[5],
        }
        for r in rows
    ]
