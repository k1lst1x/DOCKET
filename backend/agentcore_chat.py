"""Amazon Bedrock AgentCore Runtime entrypoint for docket_chat, the resident chat agent.

Payload: {"prompt": "...", "session_id": "...", "user_id": "...", "group_id": "..."}. "text" is accepted as
an alias for "prompt". Streams the same events as POST /chat: status, text pieces, then a final event with
the enforced answer, cited_chunk_ids and citations.

Local run (no AgentCore): uv run python agentcore_chat.py, then POST to http://localhost:8080/invocations.
"""

import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bedrock_agentcore.runtime import BedrockAgentCoreApp  # noqa: E402

from core.chat_agent import MAX_QUESTION_CHARS, stream_answer, warm  # noqa: E402

app = BedrockAgentCoreApp()
log = app.logger
_warm_lock = threading.Lock()
_warm_started = False


def start_warm_up() -> None:
    """Load the database connection, keyword index and clients in the background, once per process."""
    global _warm_started
    with _warm_lock:
        if _warm_started:
            return
        _warm_started = True
    threading.Thread(target=warm, name="chat-warm-up", daemon=True).start()


def _optional_string(payload: dict, key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) and value.strip() else None


@app.entrypoint
async def invoke(payload, context):
    if not isinstance(payload, dict):
        yield {"type": "error", "message": "payload must be a JSON object"}
        return
    if payload.get("warm") is True:
        # The website pings a new session when the chat opens, so the runtime has started by the time the
        # first question arrives. No model runs and nothing is saved.
        start_warm_up()
        yield {"type": "ready"}
        return
    prompt = payload.get("prompt", payload.get("text", ""))
    if not isinstance(prompt, str) or not prompt.strip():
        yield {"type": "error", "message": "prompt must be a non-empty string"}
        return
    session_id = _optional_string(payload, "session_id") or getattr(context, "session_id", None)
    try:
        async for event in stream_answer(
            prompt[:MAX_QUESTION_CHARS],
            session_id,
            _optional_string(payload, "user_id"),
            _optional_string(payload, "group_id"),
        ):
            yield event
    except Exception:
        # Without this the stream would just end and the website would show the assistant as disconnected.
        log.exception("chat turn failed")
        yield {"type": "error", "message": "The assistant is unavailable right now. Please try again."}


if __name__ == "__main__":
    start_warm_up()  # a new runtime session usually gets its first question within seconds
    app.run()
