import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, nflDepthChartSnapshotsTable } from "@workspace/db";
import {
  GetTeamDepthChartParams,
  GetAllDepthChartsResponse,
  GetTeamDepthChartResponse,
  RefreshDepthChartsResponse,
  GetRefreshStatusResponse,
} from "@workspace/api-zod";
import {
  refreshAllTeams,
  NFL_TEAMS,
  collectHeadshotsByName,
  applyHeadshotsByName,
  type NormalizedDepthChart,
  type NormalizedPositions,
  type PlayerMovement,
} from "../lib/espnFetcher";
import {
  mergeFantasyProsPositions,
  seedFantasyColumns,
} from "../lib/fantasyProsFetcher";
import {
  fetchAllFootballguysCharts,
  mergeFootballguysPositions,
} from "../lib/footballguysFetcher";

const router: IRouter = Router();

function toApiSnapshot(row: typeof nflDepthChartSnapshotsTable.$inferSelect) {
  const normalized = row.normalized as NormalizedDepthChart;
  return {
    id: row.id,
    team: normalized.team,
    season: row.season,
    source: row.source,
    sourceUrl: row.sourceUrl,
    fetchedAt: row.fetchedAt.toISOString(),
    groups: normalized.groups,
    positions: normalized.positions ?? {},
  };
}

/**
 * Annotate each player in `current` with how their rank changed vs the
 * `previous` snapshot's positions, comparing within the same column key.
 * Mutates `current` in place.
 */
function applyMovement(
  current: NormalizedPositions,
  previous: NormalizedPositions | undefined,
): void {
  if (!previous) return;

  for (const [posKey, players] of Object.entries(current)) {
    if (posKey === "DEF") continue; // team-defense unit never "moves"
    const prevPlayers = previous[posKey] ?? [];
    const prevRankByKey = new Map<string, number>();
    for (const p of prevPlayers) {
      prevRankByKey.set((p.playerId ?? p.name.toLowerCase()), p.rank);
    }

    for (const player of players) {
      const key = player.playerId ?? player.name.toLowerCase();
      const prevRank = prevRankByKey.get(key);
      let movement: PlayerMovement = null;
      if (prevRank === undefined) {
        movement = prevPlayers.length > 0 ? "new" : null;
      } else if (player.rank < prevRank) {
        movement = "up";
      } else if (player.rank > prevRank) {
        movement = "down";
      }
      player.movement = movement;
    }
  }
}

// GET /api/nfl/depth-charts — all teams
router.get("/nfl/depth-charts", async (req, res): Promise<void> => {
  try {
    // Get latest snapshot per team using a subquery
    const latestPerTeam = await db
      .selectDistinctOn([nflDepthChartSnapshotsTable.teamAbbr], {
        id: nflDepthChartSnapshotsTable.id,
        season: nflDepthChartSnapshotsTable.season,
        teamAbbr: nflDepthChartSnapshotsTable.teamAbbr,
        teamName: nflDepthChartSnapshotsTable.teamName,
        source: nflDepthChartSnapshotsTable.source,
        sourceUrl: nflDepthChartSnapshotsTable.sourceUrl,
        normalized: nflDepthChartSnapshotsTable.normalized,
        raw: nflDepthChartSnapshotsTable.raw,
        fetchedAt: nflDepthChartSnapshotsTable.fetchedAt,
      })
      .from(nflDepthChartSnapshotsTable)
      .orderBy(
        nflDepthChartSnapshotsTable.teamAbbr,
        desc(nflDepthChartSnapshotsTable.fetchedAt)
      );

    if (latestPerTeam.length === 0) {
      res.status(503).json({ error: "No depth chart data available yet. Trigger a refresh first." });
      return;
    }

    // Fetch the second-most-recent snapshot per team so we can compute rank
    // movement (↑ / ↓ / NEW) against the prior depth chart.
    const previousRows = await db.execute(
      sql`
        SELECT team_abbr, normalized
        FROM (
          SELECT
            team_abbr,
            normalized,
            row_number() OVER (PARTITION BY team_abbr ORDER BY fetched_at DESC) AS rn
          FROM ${nflDepthChartSnapshotsTable}
        ) ranked
        WHERE rn = 2
      `
    );
    const previousByTeam = new Map<string, NormalizedPositions>();
    for (const row of previousRows.rows as Array<{ team_abbr: string; normalized: NormalizedDepthChart }>) {
      if (row.normalized?.positions) {
        previousByTeam.set(row.team_abbr, row.normalized.positions);
      }
    }

    const snapshots = latestPerTeam
      .sort((a, b) => a.teamAbbr.localeCompare(b.teamAbbr))
      .map((row) => {
        const snapshot = toApiSnapshot(row);
        applyMovement(snapshot.positions, previousByTeam.get(row.teamAbbr));
        return snapshot;
      });

    res.json(GetAllDepthChartsResponse.parse(snapshots));
  } catch (err) {
    req.log.error({ err }, "Error fetching all depth charts");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/nfl/depth-charts/:team — single team
router.get("/nfl/depth-charts/:team", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.team) ? req.params.team[0] : req.params.team;
  const params = GetTeamDepthChartParams.safeParse({ team: raw?.toUpperCase() });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const teamAbbr = params.data.team;

  try {
    const [row] = await db
      .select()
      .from(nflDepthChartSnapshotsTable)
      .where(eq(nflDepthChartSnapshotsTable.teamAbbr, teamAbbr))
      .orderBy(desc(nflDepthChartSnapshotsTable.fetchedAt))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: `No depth chart data found for team: ${teamAbbr}` });
      return;
    }

    res.json(GetTeamDepthChartResponse.parse(toApiSnapshot(row)));
  } catch (err) {
    req.log.error({ err, team: teamAbbr }, "Error fetching team depth chart");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/nfl/depth-charts/refresh — protected refresh
router.post("/admin/nfl/depth-charts/refresh", async (req, res): Promise<void> => {
  const adminSecret = process.env.ADMIN_SECRET;
  const provided = req.headers["x-admin-secret"];

  if (!adminSecret || provided !== adminSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.log.info("Admin refresh triggered");

  try {
    // Footballguys publishes all 32 teams on one page — fetch it once up front
    // and merge per team below. On failure the map is null and ESPN's ordering
    // is kept for the non-fantasy columns.
    const footballguysByTeam = await fetchAllFootballguysCharts();
    if (footballguysByTeam) {
      req.log.info({ teams: footballguysByTeam.size }, "Footballguys charts fetched");
    } else {
      req.log.warn("Footballguys fetch failed; falling back to ESPN for non-fantasy tabs");
    }

    const result = await refreshAllTeams(async (abbr, name, _slug, chart) => {
      const teamInfo = NFL_TEAMS.find(t => t.abbr === abbr);
      const sourceUrl = `https://www.espn.com/nfl/team/depth/_/name/${teamInfo?.espnSlug ?? abbr.toLowerCase()}`;

      // ESPN is the only source with headshots (built from its numeric athlete
      // ids). Capture them by name now, before the merges below replace players
      // with Footballguys / FantasyPros rows that carry no headshot.
      const espnHeadshots = collectHeadshotsByName(chart.positions);

      // Override the Offense / Defense / Special-Teams columns (including the
      // canonical QB/RB/WR/TE/K) with Footballguys' team depth order; ESPN
      // remains the fallback if a team is missing.
      const fbgApplied = mergeFootballguysPositions(chart, footballguysByTeam?.get(abbr));

      // The Fantasy tab reads dedicated FAN_* columns. Seed them from the
      // canonical order first (so the tab still renders if FantasyPros fails),
      // then overlay FantasyPros' ECR order where available.
      seedFantasyColumns(chart);
      const fpUrl = await mergeFantasyProsPositions(chart, abbr, name);

      // Restore ESPN headshots onto the merged rows by matching player name.
      applyHeadshotsByName(chart.positions, espnHeadshots);

      const sources = ["ESPN"];
      if (fbgApplied) sources.push("Footballguys");
      if (fpUrl) sources.push("FantasyPros");

      await db
        .insert(nflDepthChartSnapshotsTable)
        .values({
          season: chart.season,
          teamAbbr: abbr,
          teamName: name,
          source: sources.join(" + "),
          sourceUrl,
          normalized: chart as unknown as Record<string, unknown>,
          raw: null,
          fetchedAt: new Date(),
        });
    });

    res.json(
      RefreshDepthChartsResponse.parse({
        success: result.success,
        teamsRefreshed: result.teamsRefreshed,
        teamsFailed: result.teamsFailed,
        message: result.message,
        failedTeams: result.failedTeams,
      })
    );
  } catch (err) {
    req.log.error({ err }, "Error during depth chart refresh");
    res.status(500).json({ error: "Refresh failed" });
  }
});

// GET /api/admin/nfl/depth-charts/status
router.get("/admin/nfl/depth-charts/status", async (req, res): Promise<void> => {
  const adminSecret = process.env.ADMIN_SECRET;
  const provided = req.headers["x-admin-secret"];

  if (!adminSecret || provided !== adminSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const latestPerTeam = await db
      .selectDistinctOn([nflDepthChartSnapshotsTable.teamAbbr], {
        teamAbbr: nflDepthChartSnapshotsTable.teamAbbr,
        fetchedAt: nflDepthChartSnapshotsTable.fetchedAt,
      })
      .from(nflDepthChartSnapshotsTable)
      .orderBy(
        nflDepthChartSnapshotsTable.teamAbbr,
        desc(nflDepthChartSnapshotsTable.fetchedAt)
      );

    const cachedAbbrs = new Set(latestPerTeam.map(r => r.teamAbbr));
    const allAbbrs = NFL_TEAMS.map(t => t.abbr);
    const failedTeams = allAbbrs.filter(a => !cachedAbbrs.has(a));
    const successfulTeams = allAbbrs.filter(a => cachedAbbrs.has(a));

    const lastRefreshAt =
      latestPerTeam.length > 0
        ? latestPerTeam.reduce((latest, row) =>
            row.fetchedAt > latest.fetchedAt ? row : latest
          ).fetchedAt.toISOString()
        : null;

    res.json(
      GetRefreshStatusResponse.parse({
        totalCached: latestPerTeam.length,
        lastRefreshAt,
        successfulTeams,
        failedTeams,
      })
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching status");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/nfl/embed/depth-charts.js — embeddable widget script
router.get("/nfl/embed/depth-charts.js", async (req, res): Promise<void> => {
  const origin = req.headers.origin ?? req.headers.host ?? "";
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(`
(function() {
  var container = document.getElementById('statchasers-depth-charts');
  if (!container) return;
  var iframe = document.createElement('iframe');
  var baseUrl = '${process.env.REPLIT_DOMAINS ? "https://" + process.env.REPLIT_DOMAINS.split(",")[0] : ""}';
  iframe.src = baseUrl + '/';
  iframe.style.width = '100%';
  iframe.style.height = '800px';
  iframe.style.border = 'none';
  iframe.style.borderRadius = '8px';
  iframe.setAttribute('loading', 'lazy');
  container.appendChild(iframe);
})();
`);
});

export default router;
