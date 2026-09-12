# DOCKET frontend

React + TypeScript + Vite. Use Node.js 24 LTS (`.nvmrc`).

```bash
nvm install
nvm use
npm ci
cp .env.example .env
npm run dev
```

If you don't use nvm, install Node.js 24 with your preferred runtime manager.
The development URL is http://localhost:5173. The port is fixed to match the API's
local CORS configuration. A busy port produces an error rather than silently changing it.

## Commands

- `npm run dev`: development server with hot reload.
- `npm run typecheck`: strict TypeScript checks.
- `npm run lint`: ESLint, including React Hooks rules.
- `npm run build`: TypeScript checks and production output in `dist/`.
- `npm run preview`: local preview of a completed build; not a production server.

## Handoff

Start in `src/App.tsx`; global styles are in `src/index.css`. The starter intentionally
has no backend calls. You can build UI without Python, a database, or AWS credentials.
Add feature components and clearly labeled mock fixtures as needed. Product routes,
UI libraries, and state management can be chosen as screens take shape.

The `.env.example` reserves `VITE_API_BASE_URL=http://localhost:8000/api/v1` for later
integration. Access it via `import.meta.env.VITE_API_BASE_URL` when adding an API
client. Restart Vite after changing environment variables. `VITE_*` values are
public browser configuration and must never contain credentials.

Coordinate schemas with the backend developer using `/openapi.json`. Planned
areas are neighborhoods, places, meetings, legislation, analysis, and community
votes. These are product areas, not existing API endpoints.
