"""Amazon Bedrock AgentCore Runtime entrypoint for docket_pipeline (ingestion and generation).

Payloads:
  {"action": "ingest", "sources": [...], "max_docs": 10, "lookback_days": 120}
      Starts a crawl-and-ingest cycle in the background and returns {"job_id", "status": "running"}.
  {"action": "status", "job_id": "..."}
      Job state in this runtime session (reuse the same runtimeSessionId), plus the latest runs from DSQL.
  {"action": "generate", "topic": "...", "kind": "summary|announcement|proscons", "group_id": "..."}
Long jobs are registered with add_async_task, so the runtime reports HEALTHY_BUSY until they finish.

Local run (no AgentCore): uv run python agentcore_pipeline.py, then POST to http://localhost:8080/invocations.
"""

import sys
import threading
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bedrock_agentcore.runtime import BedrockAgentCoreApp  # noqa: E402

from core.db import connect  # noqa: E402
from core.jobs import IngestFailed, run_ingest  # noqa: E402

app = BedrockAgentCoreApp()
log = app.logger

JOBS: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _bounded_int(payload: dict, key: str, default: int, low: int, high: int) -> int:
    value = payload.get(key, default)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{key} must be an integer")
    return max(low, min(high, value))


def _latest_runs(limit: int = 5) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, kind, status, counts, started_at, finished_at FROM agent_runs "
            "ORDER BY started_at DESC LIMIT %s",
            (limit,),
        ).fetchall()
    return [
        {
            "run_id": str(row[0]),
            "kind": row[1],
            "status": row[2],
            "counts": row[3],
            "started_at": row[4].isoformat() if row[4] else None,
            "finished_at": row[5].isoformat() if row[5] else None,
        }
        for row in rows
    ]


def _run_ingest_job(job_id: str, task_id: int, sources: list[str], max_docs: int, lookback_days: int) -> None:
    state: dict = {"status": "failed"}
    try:
        state = {"status": "succeeded", **run_ingest(sources, max_docs, lookback_days)}
    except IngestFailed as error:
        log.error("ingest job %s failed: %s", job_id, error)
    except Exception:
        log.exception("ingest job %s crashed", job_id)
    finally:
        with _jobs_lock:
            JOBS[job_id] = {**JOBS.get(job_id, {}), **state}
        app.complete_async_task(task_id)


@app.entrypoint
def invoke(payload, context):
    if not isinstance(payload, dict):
        return {"error": "payload must be a JSON object"}
    action = payload.get("action")
    try:
        if action == "ingest":
            sources = payload.get("sources", [])
            if not isinstance(sources, list) or not all(isinstance(source, str) for source in sources):
                return {"error": "sources must be a list of source ids"}
            max_docs = _bounded_int(payload, "max_docs", 10, 1, 200)
            lookback_days = _bounded_int(payload, "lookback_days", 120, 1, 3650)
            job_id = str(uuid.uuid4())
            task_id = app.add_async_task("ingest", {"job_id": job_id})
            with _jobs_lock:
                JOBS[job_id] = {"status": "running", "sources": sources, "max_docs": max_docs}
            threading.Thread(
                target=_run_ingest_job,
                args=(job_id, task_id, sources, max_docs, lookback_days),
                daemon=True,
            ).start()
            return {"job_id": job_id, "status": "running"}
        if action == "status":
            with _jobs_lock:
                job = JOBS.get(payload.get("job_id")) if isinstance(payload.get("job_id"), str) else None
            return {"job": job, "latest_runs": _latest_runs()}
        if action == "generate":
            return {"error": "the generation graph is not available yet"}
    except ValueError as error:
        return {"error": str(error)}
    return {"error": "action must be one of: ingest, status, generate"}


if __name__ == "__main__":
    app.run()
