# DOCKET web

Next.js 15 (App Router) + TypeScript + Tailwind. Deployed with AWS Amplify Hosting
using `amplify.yml` at the repository root (app root `frontend`).

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
