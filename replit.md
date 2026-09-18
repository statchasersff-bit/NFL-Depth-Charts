# StatChasers NFL Depth Charts

A standalone NFL Team Depth Charts web tool. The Express backend fetches ESPN data server-side, normalizes it, caches it in PostgreSQL, and exposes a public API. The React frontend at `/nfl-depth-charts` shows all 32 teams at once as per-team sections (circular team logo, bold blue team name, "View details" link, and a compact position-column grid underneath). Fantasy / Offense / Defense / Special Teams tabs switch the visible columns; a search bar and team filter sit above the list. Player rows are light-green with blue player text; columns are independently sized (shorter columns leave clean white space). Each section's columns scroll horizontally on narrow screens. "View details" opens a dialog with the team's full depth chart. This page is for the public StatChasers website — no Dynasty Command branding/auth/routes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run refresh` — pull all 32 teams (ESPN + Footballguys + FantasyPros) and write to the cache (standalone; writes the DB directly, no HTTP/admin-secret needed). This is the command the daily Scheduled Deployment runs.
- Required env: `DATABASE_URL` — Postgres connection string

## Daily refresh (Scheduled Deployment)

A **Replit Scheduled Deployment** keeps the cache current. Because the web app is autoscale (scales to zero), the refresh runs as a separate scheduled job that writes the shared DB directly — it does NOT depend on the web app being awake.

Configure in Replit → Deployments → Scheduled:
- **Schedule (cron):** `0 8 * * *`  (08:00 UTC daily)
- **Build command:** `pnpm install`
- **Run command:** `pnpm --filter @workspace/scripts run refresh`
- **Secrets:** `DATABASE_URL` (same Postgres as the app). `ADMIN_SECRET` is not needed — the script writes the DB directly rather than calling the admin endpoint.

The script (`scripts/src/refreshDepthCharts.ts`) runs the same three-source pipeline as the admin endpoint — ESPN fetch, Footballguys merge for the Offense/Defense/Special-Teams columns, FantasyPros merge for the `FAN_*` columns, ESPN headshots reapplied by name — and inserts a new snapshot per team; movement indicators on the page come from diffing the new snapshot against the prior one.

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
- Server-side ESPN fetch + PostgreSQL cache — no client-side ESPN calls; cache serves all reads. The frontend loads `GET /api/nfl/depth-charts` once (all 32 teams) and switches tabs/columns client-side — never one call per team.
- Normalizer emits a matrix-friendly `positions` map (canonical keys: QB, RB, WR, TE, LT, LG, C, RG, RT, EDGE, DL, LB, CB, S, K, P, LS, KR, PR, DEF) alongside the legacy `groups`. EDGE/DL/LB bucketing is scheme-aware (3-4 vs 4-3 detected from ESPN formation names); `DEF` is the team nickname. See Gotchas.
- `team.logo` is derived from ESPN's logo CDN (`https://a.espncdn.com/i/teamlogos/nfl/500/{abbr-lowercase}.png`) because the depthcharts endpoint omits team logos. The frontend falls back to the abbreviation in the circle if the image is missing.
- `GET /api/nfl/depth-charts` computes per-player `movement` (↑ up / ↓ down / NEW) by diffing the latest snapshot against the previous one per team (window query).
- Admin refresh endpoint (`POST /api/admin/nfl/depth-charts/refresh`) protected by `x-admin-secret` header (`ADMIN_SECRET` env var).
- CORS allows `statchasers.com` and Replit preview domains.
- Embed script served at `/embed/depth-charts.js` (top-level, in `app.ts`) — iframe embed for WordPress/Divi that loads `/nfl-depth-charts`. Legacy `/api/nfl/embed/depth-charts.js` is also still served.

## Product

- Browse NFL depth charts for all 32 teams organized by Offense / Defense / Special Teams tabs.
- Search players by name across the selected team's roster.
- Data sourced from ESPN, refreshed via admin endpoint, cached in PostgreSQL.
- Embeddable widget via a single `<script>` tag for external sites.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **ESPN API shape**: the depth chart endpoint returns `data.depthchart` as an object with numeric string keys (formations), NOT `data.items`. Each formation has `positions` (Record<slotKey, positionSlot>). See `.agents/memory/espn-depth-chart-api.md` for full details.
- **ESPN team slugs ≠ abbreviations**: ESPN's depth-chart URL/API slug for Washington is `wsh`, not `was` (the wrong slug returns `{error:true}` with zero formations, so the team silently caches empty). `NFL_TEAMS[].espnSlug` holds the ESPN slug; `abbr` (still `WAS`) is used for display, the DB key, and the logo CDN. If a team caches with empty positions, check its `espnSlug` against `https://www.espn.com/nfl/team/depth/_/name/<slug>` first.
- **Backend changes need a server restart**: the api-server `dev` script is `build && start` (no watch). After editing server code you must restart the process — a running instance keeps serving the old build, which looks like "the API dropped a field" (e.g. empty cells when `positions` is missing from the response).
- **3-4 vs 4-3 matters**: ESPN labels defensive slots the same (LDE/RDE, WLB/SLB) across schemes but they mean opposite things — in a 3-4 the DEs are interior (DL) and the OLBs are edge rushers; in a 4-3 the DEs are edge and the OLBs are off-ball (LB). `espnFetcher.ts` reads the scheme from the formation name (`Base 3-4 D` / `Base 4-3 D`) to bucket EDGE/DL/LB correctly. Don't hardcode LDE→EDGE.
- After changing `espnFetcher.ts`, restart the API server workflow and re-POST to `/api/admin/nfl/depth-charts/refresh` with `x-admin-secret` header to repopulate the cache.
- `pnpm --filter @workspace/db run push` for schema migrations (dev only).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
