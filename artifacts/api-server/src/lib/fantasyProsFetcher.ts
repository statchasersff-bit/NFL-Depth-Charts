import { logger } from "./logger";
import type {
  NormalizedDepthChart,
  NormalizedPlayer,
  NormalizedPositions,
} from "./espnFetcher";

/**
 * FantasyPros publishes only the five fantasy-relevant positions, ordered by
 * Expert Consensus Ranking. The Fantasy tab reads these from dedicated `FAN_*`
 * columns, kept separate from the canonical QB/RB/WR/TE/K columns so the Offense
 * and Special-Teams tabs can show Footballguys' team depth order for the same
 * positions while the Fantasy tab shows FantasyPros' ECR order.
 */
export const FANTASY_PROS_POSITIONS = ["QB", "RB", "WR", "TE", "K"] as const;

/**
 * Canonical column key -> the Fantasy-tab column key that holds its
 * FantasyPros-ordered copy (e.g. "QB" -> "FAN_QB").
 */
export function fantasyColumnKey(position: string): string {
  return `FAN_${position}`;
}

/**
 * Seed the Fantasy-tab columns from whatever currently fills the canonical
 * columns (Footballguys, else ESPN). This guarantees the Fantasy tab still
 * renders if FantasyPros is unavailable; a successful FantasyPros merge then
 * overrides these with ECR order. Mutates `chart.positions` in place.
 */
export function seedFantasyColumns(chart: NormalizedDepthChart): void {
  for (const position of FANTASY_PROS_POSITIONS) {
    const canonical = chart.positions[position];
    if (canonical && canonical.length > 0) {
      chart.positions[fantasyColumnKey(position)] = canonical.map((p) => ({ ...p }));
    }
  }
}

// The second <th> of each position table identifies the position group.
const HEADER_TO_POSITION: Record<string, string> = {
  Quarterbacks: "QB",
  "Running Backs": "RB",
  "Wide Receivers": "WR",
  "Tight Ends": "TE",
  Kickers: "K",
};

/**
 * FantasyPros team page slugs are the lowercased team name with non-alphanumeric
 * runs collapsed to single hyphens (e.g. "San Francisco 49ers" ->
 * "san-francisco-49ers", "Washington Commanders" -> "washington-commanders").
 */
function teamSlug(teamName: string): string {
  return teamName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
}

async function fetchHtmlWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StatChasers/1.0)",
        Accept: "text/html",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse the five position tables out of a FantasyPros depth-chart page. Each
 * table's body rows are `<tr class="mpb-player-{id}">`, and the player id and
 * display name come from the `fp-player-link`. Depth order is the row order.
 */
export function parseFantasyProsHtml(html: string): NormalizedPositions {
  const positions: NormalizedPositions = {};

  const tables = html.match(/<table[^>]*class="[^"]*position-table[^"]*"[\s\S]*?<\/table>/g) ?? [];
  for (const table of tables) {
    const headerMatch = table.match(
      /<th[^>]*>(Quarterbacks|Running Backs|Wide Receivers|Tight Ends|Kickers)<\/th>/
    );
    if (!headerMatch) continue;
    const position = HEADER_TO_POSITION[headerMatch[1]];

    const rows = table.match(/<tr class="mpb-player-\d+">[\s\S]*?<\/tr>/g) ?? [];
    const players: NormalizedPlayer[] = [];
    for (const row of rows) {
      const idMatch = row.match(/mpb-player-(\d+)/);
      const nameMatch =
        row.match(/fp-player-name="([^"]*)"/) ??
        row.match(/class="player-name[^"]*"[^>]*>([^<]+)</);
      if (!nameMatch) continue;

      players.push({
        rank: players.length + 1,
        name: decodeEntities(nameMatch[1]),
        playerId: idMatch ? idMatch[1] : null,
        position,
        jersey: null,
        status: null,
        headshot: null,
      });
    }

    if (players.length > 0) positions[position] = players;
  }

  return positions;
}

/**
 * Fetch a team's QB/RB/WR/TE/K depth order from FantasyPros. Returns null on any
 * network/parse failure so the caller can fall back to the ESPN ordering.
 */
export async function fetchFantasyProsPositions(
  teamAbbr: string,
  teamName: string
): Promise<{ positions: NormalizedPositions; sourceUrl: string } | null> {
  const slug = teamSlug(teamName);
  const sourceUrl = `https://www.fantasypros.com/nfl/depth-chart/${slug}.php`;

  let html: string;
  try {
    const res = await fetchHtmlWithTimeout(sourceUrl);
    if (!res.ok) {
      logger.warn({ team: teamAbbr, status: res.status, url: sourceUrl }, "FantasyPros non-OK response");
      return null;
    }
    html = await res.text();
  } catch (err) {
    logger.error({ team: teamAbbr, err }, "FantasyPros fetch failed");
    return null;
  }

  const positions = parseFantasyProsHtml(html);
  if (Object.keys(positions).length === 0) {
    logger.warn({ team: teamAbbr, url: sourceUrl }, "FantasyPros parse produced no positions");
    return null;
  }
  return { positions, sourceUrl };
}

/**
 * Fill the dedicated Fantasy-tab columns (`FAN_*`) with FantasyPros' ECR-ordered
 * depth, leaving the canonical QB/RB/WR/TE/K columns (Footballguys/ESPN) intact
 * for the Offense and Special-Teams tabs. Mutates `chart.positions` in place and
 * returns the FantasyPros source URL when the merge succeeded, otherwise null.
 */
export async function mergeFantasyProsPositions(
  chart: NormalizedDepthChart,
  teamAbbr: string,
  teamName: string
): Promise<string | null> {
  const result = await fetchFantasyProsPositions(teamAbbr, teamName);
  if (!result) return null;

  for (const position of FANTASY_PROS_POSITIONS) {
    const players = result.positions[position];
    if (players && players.length > 0) {
      chart.positions[fantasyColumnKey(position)] = players;
    }
  }
  return result.sourceUrl;
}
