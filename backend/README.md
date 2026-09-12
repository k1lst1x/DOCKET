# DOCKET backend

Python 3.12 + FastAPI, with uv for dependency management.

```bash
uv sync --locked
cp .env.example .env
uv run alembic upgrade head
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
configuration under `app/core/`. Product services and data models will be added
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
uv run python -m unittest discover -s tests
```

Add dependencies with `uv add <package>` (or `uv add --dev <package>`), and commit
both `pyproject.toml` and `uv.lock`.

## Database

SQLite is the initial database. `DOCKET_DATABASE_URL=sqlite:///./docket.db` creates
`backend/docket.db` when commands run from `backend/`. The file and SQLite journals
are ignored by Git. No database server is required. Use an absolute SQLite URL if
you need to run commands from another directory.

SQLAlchemy provides the shared `Base` in `app/db/base.py` and `SessionDep` in
`app/db/session.py`. Use `SessionDep` in synchronous routes; explicitly call
`session.commit()` after successful writes. The dependency closes the session and
rolls back uncommitted changes. SQLite foreign keys are enabled on every connection.
The application disposes its engine on shutdown and does not create tables on startup.

Alembic owns schema changes. The baseline only initializes migration history;
there are no product tables yet. After defining models, import them in
`app/db/__init__.py` so Alembic discovers their metadata, then run:

```bash
uv run alembic revision --autogenerate -m "add neighborhood models"
# Review the generated migration before applying it.
uv run alembic upgrade head
uv run alembic current
```

SQLite migrations use Alembic batch mode for table alterations. Give CHECK
constraints explicit names to match the shared metadata naming convention.
See [Alembic batch migrations](https://alembic.sqlalchemy.org/en/latest/batch.html).

### Later: PostgreSQL

```bash
uv sync --locked --extra postgres
# Set DOCKET_DATABASE_URL in .env to your PostgreSQL connection URL, e.g.:
# postgresql+psycopg://docket:password@localhost:5432/docket
uv run alembic upgrade head
```

Use portable SQLAlchemy types and queries when adding models. Changing the URL
and applying migrations creates the schema in the target database; it does **not**
copy SQLite data. A real switch also requires a data transfer and verification of
queries and migrations against PostgreSQL. PostgreSQL execution has not been tested
in this scaffold.

## Firecrawl

The backend uses the official `firecrawl-py` SDK for single-page Markdown ingestion.
Set `DOCKET_FIRECRAWL_API_KEY` in local `backend/.env`. The key is optional for API
startup, but required by our scraping helper, and is masked in settings output.

```bash
uv sync --locked
# Live smoke check: one scrape request, consumes Firecrawl API credits.
uv run python -m app.services.firecrawl https://www.fremont.gov/
```

The command prints only the page title, source status and Markdown length. In
Python, `app.services.firecrawl.scrape_page(url)` returns a Firecrawl `Document`
with Markdown and source metadata. It has a 60-second HTTP timeout and no automatic
retries. Empty content and source HTTP errors fail the check. This is a synchronous
helper for a future ingestion worker, not a public scraping endpoint. Scheduling,
PDF parsing, structured extraction, and saving documents to SQLite are not wired yet.

Unit tests mock Firecrawl and do not consume credits. CI never needs a real key.
See the [Python SDK documentation](https://docs.firecrawl.dev/sdks/python).

### Firecrawl MCP in Codex (developer tooling)

```bash
codex mcp add firecrawl --url https://mcp.firecrawl.dev/v2/mcp-oauth
codex mcp login firecrawl
```

Complete the browser OAuth flow if prompted. Some Codex versions start it during
`mcp add`; a second login is unnecessary once connected. Reload Codex to discover
new tools if needed. This is local developer configuration, separate from the
backend's API-key authentication; it is not installed for teammates by cloning
DOCKET. See [Firecrawl OAuth setup](https://docs.firecrawl.dev/mcp-server/oauth).
