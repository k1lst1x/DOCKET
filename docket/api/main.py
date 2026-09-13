"""DOCKET API (FastAPI).

Run locally from docket/:  uv run uvicorn api.main:app --port 8000
"""

import asyncio
import json
import logging
import sys
import uuid
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from core import retrieval, settings  # noqa: E402
from core.chat_agent import MAX_QUESTION_CHARS, stream_answer  # noqa: E402
from core.embed import embed_text  # noqa: E402
from core.jobs import IngestFailed, run_ingest  # noqa: E402

log = logging.getLogger("docket.api")
app = FastAPI(title="DOCKET API", version="0.1.0")
NO_STORE = {"Cache-Control": "no-store"}


class ChatRequest(BaseModel):
    session_id: str | None = None
    text: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    group_id: str | None = None
    user_id: str | None = None


class GenerateRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=300)
    kind: Literal["summary", "announcement", "proscons"]
    group_id: str | None = None


class IngestRequest(BaseModel):
    sources: list[str] = []
    max_docs: int = Field(default=10, ge=1, le=200)
    lookback_days: int = Field(default=120, ge=1, le=3650)


def _require_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError as error:
        raise HTTPException(status_code=404, detail="not found") from error


@app.get("/health")
def health() -> dict:
    status: dict = {"db": False, "embedding_model": False, "source_count": 0}
    try:
        status["source_count"] = len(retrieval.list_sources())
        status["db"] = True
    except Exception as error:
        status["db_error"] = type(error).__name__
    try:
        vector, _ = embed_text("health check")
        status["embedding_model"] = len(vector) == settings.EMBED_DIMENSIONS
    except Exception as error:
        status["embedding_error"] = type(error).__name__
    status["ok"] = status["db"] and status["embedding_model"]
    return status


@app.get("/sources")
def sources() -> list[dict]:
    return retrieval.list_sources()


@app.get("/chunks/{chunk_id}")
def chunk(chunk_id: str) -> dict:
    items = retrieval.fetch_chunks([_require_uuid(chunk_id)])
    if not items:
        raise HTTPException(status_code=404, detail="chunk not found")
    return items[0].to_dict()


@app.get("/outputs/{output_id}")
def output(output_id: str) -> dict:
    found = retrieval.get_output(_require_uuid(output_id))
    if found is None:
        raise HTTPException(status_code=404, detail="output not found")
    return found


@app.post("/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    async def events():
        try:
            async for event in stream_answer(
                request.text, request.session_id, request.user_id, request.group_id
            ):
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except Exception:
            log.exception("chat failed")
            error = {"type": "error", "message": "The assistant is unavailable right now."}
            yield f"data: {json.dumps(error)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers=NO_STORE)


@app.post("/generate")
def generate(request: GenerateRequest) -> dict:
    raise HTTPException(status_code=501, detail="The generation graph is not available yet.")


@app.post("/ingest/run")
async def ingest_run(request: IngestRequest) -> dict:
    """Runs one crawl-and-ingest cycle (the same script the scheduler uses) and returns its counts."""
    try:
        return await asyncio.to_thread(run_ingest, request.sources, request.max_docs, request.lookback_days)
    except IngestFailed as error:
        log.error("ingest failed: %s", error)
        raise HTTPException(status_code=500, detail="ingest run failed") from error
