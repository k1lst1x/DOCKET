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

**Current state:** the web app, DSQL-backed memberships/votes/reviews, live civic
data panel, and the Strands reading agent are implemented. The agent ingests public
records, stores evidence in Aurora DSQL/S3/S3 Vectors, and produces cited outputs.
Some civic records and activity remain labelled **sample data** until production
ingestion is enabled.

## Stack

| Component | Choice |
| --- | --- |
| Agent backend | Python **3.11**, FastAPI **0.141.1**, Strands, AgentCore, Uvicorn |
| Frontend | Next.js **15.5** (App Router), React **19.3.0**, TypeScript **5.9**, Tailwind **3.4** |
| Hosting | AWS Amplify Hosting (`amplify.yml`, app root `frontend`) |
| JavaScript runtime | Node.js **24 LTS**, npm |
| Database | Aurora DSQL with IAM authentication; S3 and S3 Vectors for source data |
| Python tooling | uv |
| Agent SDK | Strands Agents **1.55.1** |
| License | [MIT](LICENSE) |

FastAPI and React do not have Django-style LTS release lines. We use stable
releases with committed lockfiles (`backend/uv.lock`, `frontend/package-lock.json`).
Node.js 24 is the LTS runtime. Upgrade dependencies deliberately and run checks.
See the official [FastAPI version policy](https://fastapi.tiangolo.com/deployment/versions/),
[React versions](https://react.dev/versions), and
[Node.js releases](https://nodejs.org/en/about/previous-releases).

## Repository

```text
backend/                 Python agent backend and AgentCore deployment
  api/                   Local FastAPI fallback for chat and operator endpoints
  core/                  Ingestion, retrieval, citations and generation graph
  agentcore/             AgentCore runtime configuration and IAM policies
  migrations/            Aurora DSQL schema migrations
  tests/                 Agent/API regression tests
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

Open http://localhost:3000. The web UI can be developed independently; chat needs a
local agent or deployed AgentCore runtime.
See [frontend instructions](frontend/README.md).

## Start the backend

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) first.
`uv sync` can install Python 3.11 if it is not available locally.

```bash
cd backend
uv sync --locked
cp .env.example .env
uv run uvicorn api.main:app --reload --port 8000
```

- Health: http://localhost:8000/health
- Interactive API docs: http://localhost:8000/docs
- OpenAPI schema: http://localhost:8000/openapi.json

See [AgentCore deployment instructions](backend/docs/agentcore-hosting.md). Local API
calls need AWS credentials and the DSQL/S3 environment values from `backend/.env`.

## Checks

```bash
# From backend/
uv run python -m unittest discover -s tests
uv run python -m compileall -q api core agentcore_chat.py agentcore_pipeline.py

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

- **Docket agent checks:** Python regression tests, syntax compilation, FastAPI and
  Strands import checks.
- **Frontend checks:** clean dependency installation, ESLint, TypeScript checks,
  behavior tests, production build and Pages export.

Each job has a 10-minute timeout. New updates cancel obsolete runs for the same
event and branch. Agent tests mock expensive graph and ingestion calls, so no API
keys or AWS credentials are required.

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

The frontend calls Aurora DSQL through server routes and invokes the AgentCore chat
runtime server-side. See [architecture and integration notes](docs/architecture.md).

## Hackathon submission materials

- [Architecture diagram](docs/architecture.svg)
- [Devpost submission draft](docs/submission.md)
- [Judge guide](docs/judge-guide.md)
- [Third-party and pre-existing work disclosure](docs/third-party-and-preexisting-work.md)
