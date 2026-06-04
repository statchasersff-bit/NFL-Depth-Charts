import { db, nflDepthChartSnapshotsTable } from "@workspace/db";
import { refreshAllTeams, NFL_TEAMS, type NormalizedDepthChart } from "../../artifacts/api-server/src/lib/espnFetcher";

async function main() {
  console.log("[refresh] Starting NFL depth chart refresh...");

  const result = await refreshAllTeams(async (abbr, name, _slug, chart) => {
    const teamInfo = NFL_TEAMS.find(t => t.abbr === abbr);
    const sourceUrl = `https://www.espn.com/nfl/team/depth/_/name/${teamInfo?.espnSlug ?? abbr.toLowerCase()}`;

    await db
      .insert(nflDepthChartSnapshotsTable)
      .values({
        season: chart.season,
        teamAbbr: abbr,
        teamName: name,
        source: "ESPN",
        sourceUrl,
        normalized: chart as unknown as Record<string, unknown>,
        raw: null,
        fetchedAt: new Date(),
      });

    console.log(`[refresh] Saved depth chart for ${abbr}`);
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
