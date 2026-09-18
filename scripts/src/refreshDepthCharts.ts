import { db, nflDepthChartSnapshotsTable } from "@workspace/db";
import {
  refreshAllTeams,
  NFL_TEAMS,
  collectHeadshotsByName,
  applyHeadshotsByName,
} from "../../artifacts/api-server/src/lib/espnFetcher";
import {
  mergeFantasyProsPositions,
  seedFantasyColumns,
} from "../../artifacts/api-server/src/lib/fantasyProsFetcher";
import {
  fetchAllFootballguysCharts,
  mergeFootballguysPositions,
} from "../../artifacts/api-server/src/lib/footballguysFetcher";

async function main() {
  console.log("[refresh] Starting NFL depth chart refresh...");

  // Footballguys publishes all 32 teams on one page — fetch it once up front
  // and merge per team below. On failure the map is null and ESPN's ordering
  // is kept for the non-fantasy columns.
  const footballguysByTeam = await fetchAllFootballguysCharts();
  if (footballguysByTeam) {
    console.log(`[refresh] Footballguys charts fetched for ${footballguysByTeam.size} teams`);
  } else {
    console.warn("[refresh] Footballguys fetch failed; falling back to ESPN for non-fantasy tabs");
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

    console.log(`[refresh] Saved depth chart for ${abbr} (${sources.join(" + ")})`);
  });

  console.log(`[refresh] Done. ${result.teamsRefreshed} refreshed, ${result.teamsFailed} failed.`);
  if (result.failedTeams.length > 0) {
    console.log(`[refresh] Failed teams: ${result.failedTeams.join(", ")}`);
  }

  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error("[refresh] Fatal error:", err);
  process.exit(1);
});
