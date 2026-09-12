# DOCKET

The agent that reads city hall so a neighborhood doesn't have to.

DOCKET is a neighborhood civic platform being built for the **Agents for Humans
Hackathon**, targeting the **Good Neighbor Agents** track. The initial geographic
focus is Fremont.

## Product direction

Residents will choose their neighborhood, discover local places (such as
universities), explore past city meetings and adopted laws, read source-linked
summaries with pros and cons, and express their views through community votes.
Community votes represent residents' opinions; they are separate from official
legislative votes.

The planned Strands agent will monitor public city records in the background,
process new meetings and decisions, identify affected neighborhoods, and prepare
updates with evidence. This agent workflow is central to the hackathon build.

**Current state:** development scaffold only. The React starter and FastAPI health
endpoint run independently. Neighborhoods, places, voting, ingestion, AI analysis,
authentication, product data models, and the autonomous agent are not implemented yet.
SQLite connection/session infrastructure and Alembic migrations are configured.

## Stack

| Component | Choice |
| --- | --- |
| Backend | Python **3.12**, FastAPI **0.141.1**, Pydantic Settings, Uvicorn |
| Frontend | Next.js **15.5** (App Router), React **19.3.0**, TypeScript **5.9**, Tailwind **3.4** |
| Hosting | AWS Amplify Hosting (`amplify.yml`, app root `frontend`) |
| JavaScript runtime | Node.js **24 LTS**, npm |
| Database | SQLite initially; SQLAlchemy 2.0 + Alembic; PostgreSQL driver optional |
| Python tooling | uv, Ruff |
| Agent SDK | Strands Agents **1.55.1** (optional `agent` extra) |
| License | [MIT](LICENSE) |

FastAPI and React do not have Django-style LTS release lines. We use stable
releases with committed lockfiles (`backend/uv.lock`, `frontend/package-lock.json`).
Node.js 24 is the LTS runtime. Upgrade dependencies deliberately and run checks.
See the official [FastAPI version policy](https://fastapi.tiangolo.com/deployment/versions/),
[React versions](https://react.dev/versions), and
[Node.js releases](https://nodejs.org/en/about/previous-releases).

## Repository

```text
backend/                 Python API and future agent implementation
  app/api/               HTTP routes and API response schemas
  app/core/              Application configuration
  app/db/                SQLAlchemy base and request sessions
  migrations/            Alembic schema migrations
  app/agents/            Reserved for Strands workflows
frontend/                Standalone React application
  src/                   Frontend implementation
  package-lock.json      Reproducible npm dependencies
docs/                    Shared architecture and integration notes
.github/workflows/       Backend and frontend CI checks
```

## Start the frontend

Install Node.js 24 (with nvm, run `nvm install` and `nvm use` in `frontend/`).

```bash
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. **The backend is not required** to work on the UI.
See [frontend instructions](frontend/README.md).

## Start the backend

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) first.
`uv sync` can install Python 3.12 if it is not available locally.

```bash
cd backend
uv sync --locked
cp .env.example .env
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

- Health: http://localhost:8000/api/v1/health
- Interactive API docs: http://localhost:8000/docs
- OpenAPI schema: http://localhost:8000/openapi.json

See [backend instructions](backend/README.md). SQLite is a local `backend/docket.db` file; no separate database server or AWS
credentials are needed for the scaffold.

## Checks

```bash
# From backend/
uv run ruff check .
uv run ruff format --check .
uv run python -m unittest discover -s tests

# From frontend/
npm run lint
npm run build
```

CI runs these checks, an API/CORS smoke check, and a Strands SDK import check.

## Working together

Work independently inside `frontend/` and `backend/`. Commit lockfile changes
alongside dependency changes. Use `.env.example` for shared configuration and
keep secrets in ignored local `.env` files.

Agree on resource schemas before integrating product features. The API prefix
is `/api/v1`; the UI's reserved `VITE_API_BASE_URL` points there. Only the health
endpoint exists today. See [architecture and integration notes](docs/architecture.md).
