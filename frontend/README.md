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

## Hosting

The app is server-rendered: route handlers, httpOnly session cookies and live
address lookups need a Node runtime, so it is not a static export. Amplify Hosting
builds it on every push to `main`. Set `SESSION_SECRET` (32+ characters), `APP_URL`,
`DEMO`, `DSQL_ENDPOINT`, `DSQL_USER`, `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`
in the Amplify console; `amplify.yml` passes them to the server runtime. The server
reaches Aurora DSQL with the Amplify SSR compute role (no stored AWS keys).

AWS resources (us-west-2) are created by `scripts/aws-provision.sh`, which writes their
IDs to `.env.local`. Apply the schema with `node scripts/dsql-migrate.mjs` and load
neighborhoods and sample groups with `node scripts/dsql-seed.ts` (both need
`DSQL_ENDPOINT` and an AWS login).

## Public side

| Route | What it does |
| --- | --- |
| `/` | Address input and the weekly reading stat |
| `/find?address=` | Match, nearby-only, no-group and cross-street states |
| `/groups` | Directory, most recently active first |
| `/g/[slug]` | Public, indexable group page |
| `/g/[slug]/join` | Join form; shows the group's items right after submit |
| `/start` | Placeholder until the Clerk exists |

API: `GET /api/find?address=`, `GET /api/groups`, `GET /api/groups/[slug]`,
`POST /api/groups/[slug]/join`, `GET /api/stats`, `POST /api/auth/start`,
`POST /api/auth/verify`, `POST /api/auth/resend`, `POST /api/auth/signout`,
`GET /api/auth/me`. Group and role always come from the URL or the session,
never from a request body.

Sign-in is passwordless through Amazon Cognito (Essentials): joining a group creates
the account and emails a 6-digit code; `/signin` emails a code to existing members.
Nobody has to confirm the code before reading a group's items.

## Data

- `src/data/fremont-districts.json`: official City of Fremont "Neighborhoods" GIS
  layer (General Plan 2030 neighborhood areas), simplified to ≤60 vertices.
- `src/data/fixtures.ts`: **sample** groups, agenda items, outcomes and reading runs.
  The landing stat is computed from these records and labelled "Sample data".
- `src/lib/data.ts` is the only module pages and routes read from; replace its
  functions with database queries when the backend is ready.
- Members and memberships are saved in Aurora DSQL (`db/migrations/0001_core.sql`,
  `src/lib/members.ts`) once a sign-in code is confirmed. Groups and agenda items
  shown on pages still come from the sample fixtures.
- Issues, AI analyses, polls, votes and reviews live in DSQL (`src/lib/issues.ts`).
  `scripts/dsql-seed.ts` loads sample issues and sample neighbors' votes and reviews,
  all marked `is_sample` and labelled "Sample" in the issue dialog.
- `src/data/fremont-neighborhoods.json`: all 32 areas of the City of Fremont
  Neighborhoods layer, seeded into the `neighborhoods` table.
- Geocoding uses the free US Census geocoder. Sign-in codes are sent through Amazon
  SES; while the SES account is in the sandbox, codes only reach verified addresses.

## GitHub Pages preview

Run `npm run build:pages` to export the original Next.js frontend to `out-pages/`.
The build copies `src/` into ignored `.pages-build/` and applies server-only route
adapters there; shared components, fonts, illustrations, styles and fixtures are
used directly. Do not create a separate HTML/CSS landing page. Changes made by
the frontend team are included automatically on the next Pages build.

The default base path is `/DOCKET`; set `PAGES_BASE_PATH` to override it. CI builds
this preview on pull requests and publishes it after successful main checks.
Pages has no API or session server: join submissions show an unavailable message
instead of claiming an email was sent, sign-in shows a short notice, group pages
render without member state, and issue dialogs can't load votes. Address lookup
runs in the browser and uses the existing unavailable view if the Census service
rejects the request. The regular `npm run build` remains the server build for Amplify.

`scripts/build-pages.mjs` patches exact lines in app files (for example the
`export const dynamic` lines on the group and join pages). If you change those
lines, update the matching adapter or the Pages build fails with "Pages adapter
needs updating".
