# DOCKET web

Next.js 15 (App Router) + TypeScript + Tailwind. Supports GitHub Pages static
exports and AWS Amplify Hosting via `amplify.yml` (app root `frontend`).

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The development URL is http://localhost:3000.

## Commands

- `npm run dev`: development server with hot reload.
- `npm run typecheck`: strict TypeScript checks.
- `npm run lint`: ESLint with the Next.js rules.
- `npm run build`: production build in `.next/`.
- `npm run start`: serve a completed build.

## Environment

See `.env.example`. All variables are server-only; nothing is exposed to the browser
unless it is prefixed `NEXT_PUBLIC_`, and no secret may ever use that prefix.

## GitHub Pages

In the GitHub repository, select **Settings → Pages → Build and deployment →
Source: GitHub Actions** once. Push to `main` (or run CI manually on `main`).
CI checks both the standard Next.js build and a static export. Deployment runs
only after both backend and frontend checks pass; pull requests never deploy.

Expected project URL: https://k1lst1x.github.io/DOCKET/ (available after a successful
Pages deployment). CI sets `GITHUB_PAGES=true` and `PAGES_BASE_PATH=/DOCKET`.
The export is written to `out/`; it is uploaded as a Pages artifact, not committed.
For a custom domain, update `PAGES_BASE_PATH` to match the hosting path.

Local export from `frontend/` on macOS/Linux:

```bash
GITHUB_PAGES=true PAGES_BASE_PATH=/DOCKET npm run build
```

The current homepage is a static starter. Pages cannot run FastAPI, server actions,
request-time server rendering, or server-side secrets. Future browser API requests
need a separately hosted backend. Normal `npm run build` / Amplify keeps the
server-capable Next.js build. No credentials are needed for the current export.
