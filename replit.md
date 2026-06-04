# StatChasers NFL Depth Charts

A standalone NFL Team Depth Charts web tool. The Express backend fetches ESPN data server-side, normalizes it, caches it in PostgreSQL, and exposes a public API. The React frontend at `/` lets users browse any of the 32 NFL teams by offense, defense, and special teams tabs with a player search.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/stat-chasers/src/pages/home.tsx` — main frontend page (team selector, tabs, search, player cards)
- `artifacts/api-server/src/routes/depthCharts.ts` — all API routes
- `artifacts/api-server/src/lib/espnFetcher.ts` — ESPN fetcher + normalizer (see Gotchas)
- `lib/db/src/schema/depthCharts.ts` — DB schema (`nfl_depth_chart_snapshots` table)
- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/api-client-react/src/generated/` — generated React Query hooks and Zod schemas

## Architecture decisions

- Contract-first: OpenAPI spec drives codegen for both client hooks and server Zod schemas.
- Server-side ESPN fetch + PostgreSQL cache — no client-side ESPN calls; cache serves all reads.
- Admin refresh endpoint (`POST /api/admin/nfl/depth-charts/refresh`) protected by `x-admin-secret` header (`ADMIN_SECRET` env var).
- CORS allows `statchasers.com` and Replit preview domains.
- Embed script served at `/api/nfl/embed/depth-charts.js` (iframe embed for WordPress/Divi).

## Product

- Browse NFL depth charts for all 32 teams organized by Offense / Defense / Special Teams tabs.
- Search players by name across the selected team's roster.
- Data sourced from ESPN, refreshed via admin endpoint, cached in PostgreSQL.
- Embeddable widget via a single `<script>` tag for external sites.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **ESPN API shape**: the depth chart endpoint returns `data.depthchart` as an object with numeric string keys (formations), NOT `data.items`. Each formation has `positions` (Record<slotKey, positionSlot>). See `.agents/memory/espn-depth-chart-api.md` for full details.
- After changing `espnFetcher.ts`, restart the API server workflow and re-POST to `/api/admin/nfl/depth-charts/refresh` with `x-admin-secret` header to repopulate the cache.
- `pnpm --filter @workspace/db run push` for schema migrations (dev only).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
