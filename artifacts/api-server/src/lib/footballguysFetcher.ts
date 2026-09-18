import { logger } from "./logger";
import type {
  NormalizedDepthChart,
  NormalizedPlayer,
  NormalizedPositions,
} from "./espnFetcher";

/**
 * Footballguys publishes every team's depth chart on a single page
 * (`?type=all`). We parse all 32 teams in one fetch and fold the result into the
 * ESPN-sourced snapshot so the Offense / Defense / Special-Teams tabs reflect
 * Footballguys' ordering. The Fantasy tab is still owned by FantasyPros, which
 * is merged afterwards (see depthCharts route).
 */
export const FOOTBALLGUYS_ALL_URL =
  "https://www.footballguys.com/depth-charts?type=all";

type Scheme = "3-4" | "4-3";

// Footballguys uses fixed L/R/slot abbreviations. Offense and special-teams
// slots map to a canonical column regardless of front; FB and H have no column.
const FIXED_CANONICAL: Record<string, string> = {
  // Offense
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  LT: "LT",
  LG: "LG",
  C: "C",
  RG: "RG",
  RT: "RT",
  // Special teams (PK is the place-kicker)
  PK: "K",
  P: "P",
  LS: "LS",
  KR: "KR",
  PR: "PR",
};

// Defensive slots fold into EDGE / DL / LB / CB / S. The line abbreviations are
// scheme-dependent, mirroring espnFetcher's bucketing: ends are edge rushers in
// a 4-3 but interior linemen in a 3-4, and outside backers flip the other way.
function canonicalDefense(slot: string, scheme: Scheme): string | null {
  switch (slot) {
    case "LDT":
    case "RDT":
    case "NT":
      return "DL";
    case "LDE":
    case "RDE":
      return scheme === "3-4" ? "DL" : "EDGE";
    case "WLB":
    case "SLB":
      return scheme === "3-4" ? "EDGE" : "LB";
    case "MLB":
    case "LILB":
    case "RILB":
      return "LB";
    case "LCB":
    case "RCB":
    case "SCB":
      return "CB";
    case "FS":
    case "SS":
      return "S";
    default:
      return null;
  }
}

// Order in which raw slots are folded into a multi-slot canonical column. Listing
// the slots left-to-right keeps each column's interleave deterministic (all
// starters first, then the second-stringers) regardless of HTML order.
const DEFENSE_SLOT_ORDER = [
  "LDE", "RDE", "LDT", "RDT", "NT",
  "WLB", "SLB", "MLB", "LILB", "RILB",
  "LCB", "RCB", "SCB", "FS", "SS",
];
const OFFENSE_SLOT_ORDER = ["QB", "RB", "WR", "TE", "LT", "LG", "C", "RG", "RT"];
const SPECIAL_SLOT_ORDER = ["PK", "P", "LS", "KR", "PR"];

// Known injury/roster designations Footballguys appends to a player name as a
// trailing parenthetical, e.g. "James Conner (Q)".
const STATUS_CODES = new Set([
  "Q", "D", "O", "IR", "SUS", "PUP", "NFI", "CEL", "EX", "DNR",
]);

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Split a raw display name like "James Conner (Q)" into name + status. */
function splitStatus(raw: string): { name: string; status: string | null } {
  const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m && STATUS_CODES.has(m[2].toUpperCase())) {
    return { name: m[1].trim(), status: m[2].toUpperCase() };
  }
  return { name: raw, status: null };
}

interface RawSlotPlayer {
  name: string;
  playerId: string | null;
  status: string | null;
}

/**
 * Merge one or more per-slot ranked lists into a single ranked column. Starters
 * are surfaced first by interleaving across slots (all first-string, then all
 * second-string, …); duplicates are removed by player id / name.
 */
function interleaveDedupe(
  slotLists: RawSlotPlayer[][],
  position: string,
): NormalizedPlayer[] {
  const out: NormalizedPlayer[] = [];
  const seen = new Set<string>();
  const maxLen = slotLists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const list of slotLists) {
      const p = list[i];
      if (!p) continue;
      const key = p.playerId ?? p.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        rank: out.length + 1,
        name: p.name,
        playerId: p.playerId,
        position,
        jersey: null,
        status: p.status,
        headshot: null,
      });
    }
  }
  return out;
}

/**
 * Parse the ranked players out of one `<li class="depth-chart-pos ...">` body.
 * Skill players are anchors linking to a profile (`/player/Name/ID`); offensive
 * linemen, punters, and long snappers are plain `<span>`s with no id. Both carry
 * `class="player …"`, so we match either element and pull the id when present.
 */
function parseSlotPlayers(inner: string): RawSlotPlayer[] {
  const players: RawSlotPlayer[] = [];
  const tagRe =
    /<(?:a|span)\b([^>]*?)\bclass="player[^"]*"([^>]*)>([^<]*)</g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(inner))) {
    const name = decodeEntities(m[3]);
    if (!name) continue;
    const idMatch = `${m[1]} ${m[2]}`.match(/\/player\/[^/]*\/([A-Za-z0-9]+)/);
    const { name: cleanName, status } = splitStatus(name);
    players.push({ name: cleanName, playerId: idMatch ? idMatch[1] : null, status });
  }
  return players;
}

/** Detect the defensive front from which scheme-specific slots are present. */
function detectScheme(slots: Set<string>): Scheme {
  // 3-4 fronts list a nose tackle and inside backers; 4-3 fronts list two
  // defensive tackles and a middle linebacker.
  if (slots.has("NT") || slots.has("LILB") || slots.has("RILB")) return "3-4";
  return "4-3";
}

/**
 * Parse the all-teams Footballguys page into a map of team abbreviation ->
 * canonical positions matrix. Teams whose block can't be parsed are skipped.
 */
export function parseFootballguysHtml(
  html: string,
): Map<string, NormalizedPositions> {
  const byTeam = new Map<string, NormalizedPositions>();

  const teamRe =
    /<div class="depth-chart col[^"]*" id="depth_chart_([A-Z]{2,3})">([\s\S]*?)(?=<div class="depth-chart col|<\/div><\/div><\/div>)/g;
  let team: RegExpExecArray | null;
  while ((team = teamRe.exec(html))) {
    const abbr = team[1];
    const block = team[2];

    // Collect raw slot lists keyed by the uppercased slot abbreviation.
    const rawSlots = new Map<string, RawSlotPlayer[]>();
    const liRe =
      /<li class="depth-chart-pos depth-chart-cat-(?:off|def|st) depth-chart-pos-([a-z0-9]+)[^"]*">([\s\S]*?)<\/li>/g;
    let li: RegExpExecArray | null;
    while ((li = liRe.exec(block))) {
      const slot = li[1].toUpperCase();
      const players = parseSlotPlayers(li[2]);
      if (players.length > 0) rawSlots.set(slot, players);
    }
    if (rawSlots.size === 0) continue;

    const scheme = detectScheme(new Set(rawSlots.keys()));

    // Fold raw slots into canonical column buckets, preserving slot order so
    // multi-slot columns interleave starters first.
    const buckets = new Map<string, RawSlotPlayer[][]>();
    const pushBucket = (canon: string, list: RawSlotPlayer[]) => {
      if (!buckets.has(canon)) buckets.set(canon, []);
      buckets.get(canon)!.push(list);
    };

    for (const slot of [...OFFENSE_SLOT_ORDER, ...SPECIAL_SLOT_ORDER]) {
      const list = rawSlots.get(slot);
      if (list && FIXED_CANONICAL[slot]) pushBucket(FIXED_CANONICAL[slot], list);
    }
    for (const slot of DEFENSE_SLOT_ORDER) {
      const list = rawSlots.get(slot);
      if (!list) continue;
      const canon = canonicalDefense(slot, scheme);
      if (canon) pushBucket(canon, list);
    }

    const positions: NormalizedPositions = {};
    for (const [canon, slotLists] of buckets) {
      positions[canon] = interleaveDedupe(slotLists, canon);
    }
    byTeam.set(abbr, positions);
  }

  return byTeam;
}

async function fetchHtmlWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
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
 * Fetch and parse the all-teams Footballguys depth chart page. Returns a map of
 * team abbreviation -> positions, or null on any network/parse failure so the
 * caller can fall back to the ESPN ordering.
 */
export async function fetchAllFootballguysCharts(): Promise<Map<string, NormalizedPositions> | null> {
  let html: string;
  try {
    const res = await fetchHtmlWithTimeout(FOOTBALLGUYS_ALL_URL);
    if (!res.ok) {
      logger.warn(
        { status: res.status, url: FOOTBALLGUYS_ALL_URL },
        "Footballguys non-OK response",
      );
      return null;
    }
    html = await res.text();
  } catch (err) {
    logger.error({ err }, "Footballguys fetch failed");
    return null;
  }

  const byTeam = parseFootballguysHtml(html);
  if (byTeam.size === 0) {
    logger.warn({ url: FOOTBALLGUYS_ALL_URL }, "Footballguys parse produced no teams");
    return null;
  }
  return byTeam;
}

/**
 * Overwrite a chart's non-fantasy columns with Footballguys' depth order.
 * Mutates `chart.positions` in place and returns true when the merge applied.
 * The Fantasy columns (QB/RB/WR/TE/K) are intentionally still written here but
 * are re-overridden by the FantasyPros merge that runs afterwards.
 */
export function mergeFootballguysPositions(
  chart: NormalizedDepthChart,
  positions: NormalizedPositions | undefined,
): boolean {
  if (!positions || Object.keys(positions).length === 0) return false;
  for (const [key, players] of Object.entries(positions)) {
    if (players.length > 0) chart.positions[key] = players;
  }
  return true;
}
