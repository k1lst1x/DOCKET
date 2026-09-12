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

**Current state:** the web app's public side is built: address lookup (US Census
geocoder), group directory, public group pages with boundary maps, and a join flow with
magic-link sign-in. Group boundaries are the City of Fremont's official neighborhood
areas; groups, agenda items, votes and reading stats are **sample data** until the
reading agent writes real records. Voting, the member feed, the Clerk, and the
autonomous agent are not implemented yet. The FastAPI app still serves only its health
endpoint, with SQLite sessions and Alembic migrations configured.

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
frontend/                Next.js web application
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

## GitHub Actions

[CI workflow](.github/workflows/ci.yml) runs automatically after every push and
when a pull request is opened, updated, or reopened. A local commit alone does
not reach GitHub; push it to start the checks. You can also run CI manually from
**Actions → CI → Run workflow** once this workflow is on the default branch.

Two jobs run in parallel:

- **Backend checks:** Ruff, Python unit tests, SQLite migration upgrade/check/
  downgrade/upgrade, API/CORS smoke checks, and Strands SDK import.
- **Frontend checks:** clean dependency installation, ESLint, TypeScript checks,
  and the production Next.js build. Frontend behavior tests have not been added yet.

Each job has a 10-minute timeout. New updates cancel obsolete runs for the same
event and branch. CI uses a temporary SQLite database; Firecrawl calls are mocked
in tests, so no API keys or AWS credentials are required.

Results appear under **Actions → CI** and in a pull request's **Checks** tab.
A failed check marks the run red. Requiring successful checks before merging is
a separate repository branch-protection setting; this workflow does not enable it.

Deployment is not part of this workflow. The web app needs a server (route
handlers, cookies, request-time lookups), so it is not a static export: AWS Amplify
Hosting builds and deploys it from [`amplify.yml`](amplify.yml) on every push to `main`.

## Working together

Work independently inside `frontend/` and `backend/`. Commit lockfile changes
alongside dependency changes. Use `.env.example` for shared configuration and
keep secrets in ignored local `.env` files.

Agree on resource schemas before integrating product features. The API prefix
is `/api/v1`; the web app's reserved server-only `API_BASE_URL` points there. Only the health
endpoint exists today. See [architecture and integration notes](docs/architecture.md).
