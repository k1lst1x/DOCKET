# DOCKET backend

Python 3.12 + FastAPI, with uv for dependency management.

```bash
uv sync --locked
cp .env.example .env
uv run uvicorn app.main:app --reload --port 8000
```

Run commands from `backend/`. `uv` manages `.venv` automatically.

## API

`GET /api/v1/health` returns:

```json
{"status":"ok","service":"docket-api"}
```

This is process health only, not a database or AWS readiness probe. Swagger UI is
at `/docs`, and the generated API schema is at `/openapi.json`.

Add HTTP routes under `app/api/` and include them in `app/api/router.py`. Keep
configuration under `app/core/`. Product services and persistence will be added
when their contracts are agreed.

`DOCKET_CORS_ORIGINS` is a JSON array of allowed frontend origins, configured in
`.env`. Defaults allow localhost and 127.0.0.1 on port 5173. Production origins
must be configured explicitly. Cookie authentication is not configured yet.

## Agent development

```bash
uv sync --locked --extra agent
```

This installs the pinned Strands Agents SDK. `app/agents/` is reserved for the
future background workflow; no agent is implemented or invoked by the API yet.
Model/provider configuration, scheduling, persistence, and AWS deployment will be
introduced with that workflow. Never commit AWS credentials.

## Checks

```bash
uv run ruff check .
uv run ruff format --check .
```

Add dependencies with `uv add <package>` (or `uv add --dev <package>`), and commit
both `pyproject.toml` and `uv.lock`.
