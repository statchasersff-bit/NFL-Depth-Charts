import { logger } from "./logger";

const NFL_TEAMS = [
  { abbr: "ARI", name: "Arizona Cardinals", espnSlug: "ari" },
  { abbr: "ATL", name: "Atlanta Falcons", espnSlug: "atl" },
  { abbr: "BAL", name: "Baltimore Ravens", espnSlug: "bal" },
  { abbr: "BUF", name: "Buffalo Bills", espnSlug: "buf" },
  { abbr: "CAR", name: "Carolina Panthers", espnSlug: "car" },
  { abbr: "CHI", name: "Chicago Bears", espnSlug: "chi" },
  { abbr: "CIN", name: "Cincinnati Bengals", espnSlug: "cin" },
  { abbr: "CLE", name: "Cleveland Browns", espnSlug: "cle" },
  { abbr: "DAL", name: "Dallas Cowboys", espnSlug: "dal" },
  { abbr: "DEN", name: "Denver Broncos", espnSlug: "den" },
  { abbr: "DET", name: "Detroit Lions", espnSlug: "det" },
  { abbr: "GB",  name: "Green Bay Packers", espnSlug: "gb" },
  { abbr: "HOU", name: "Houston Texans", espnSlug: "hou" },
  { abbr: "IND", name: "Indianapolis Colts", espnSlug: "ind" },
  { abbr: "JAX", name: "Jacksonville Jaguars", espnSlug: "jax" },
  { abbr: "KC",  name: "Kansas City Chiefs", espnSlug: "kc" },
  { abbr: "LV",  name: "Las Vegas Raiders", espnSlug: "lv" },
  { abbr: "LAC", name: "Los Angeles Chargers", espnSlug: "lac" },
  { abbr: "LAR", name: "Los Angeles Rams", espnSlug: "lar" },
  { abbr: "MIA", name: "Miami Dolphins", espnSlug: "mia" },
  { abbr: "MIN", name: "Minnesota Vikings", espnSlug: "min" },
  { abbr: "NE",  name: "New England Patriots", espnSlug: "ne" },
  { abbr: "NO",  name: "New Orleans Saints", espnSlug: "no" },
  { abbr: "NYG", name: "New York Giants", espnSlug: "nyg" },
  { abbr: "NYJ", name: "New York Jets", espnSlug: "nyj" },
  { abbr: "PHI", name: "Philadelphia Eagles", espnSlug: "phi" },
  { abbr: "PIT", name: "Pittsburgh Steelers", espnSlug: "pit" },
  { abbr: "SF",  name: "San Francisco 49ers", espnSlug: "sf" },
  { abbr: "SEA", name: "Seattle Seahawks", espnSlug: "sea" },
  { abbr: "TB",  name: "Tampa Bay Buccaneers", espnSlug: "tb" },
  { abbr: "TEN", name: "Tennessee Titans", espnSlug: "ten" },
  { abbr: "WAS", name: "Washington Commanders", espnSlug: "wsh" },
];

export { NFL_TEAMS };

const POSITION_LABELS: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
  LT: "Left Tackle",
  LG: "Left Guard",
  C: "Center",
  RG: "Right Guard",
  RT: "Right Tackle",
  OL: "Offensive Line",
  FB: "Fullback",
  DE: "Defensive End",
  DT: "Defensive Tackle",
  NT: "Nose Tackle",
  LOLB: "Left Outside Linebacker",
  LILB: "Left Inside Linebacker",
  MLB: "Middle Linebacker",
  RILB: "Right Inside Linebacker",
  ROLB: "Right Outside Linebacker",
  LB: "Linebacker",
  CB: "Cornerback",
  SS: "Strong Safety",
  FS: "Free Safety",
  S: "Safety",
  K: "Kicker",
  P: "Punter",
  LS: "Long Snapper",
  KR: "Kick Returner",
  PR: "Punt Returner",
  H: "Holder",
};

// Parent abbreviations ESPN uses per group
const OFFENSE_PARENTS = new Set(["OFF","OT","OG"]);
// Individual slot position abbreviations that are offense
const OFFENSE_SLOT_ABBRS = new Set(["QB","RB","FB","WR","TE","LT","LG","C","RG","RT","OL"]);
const DEFENSE_PARENTS = new Set(["DE","DT","LB","CB","S","DB","DEF"]);
const DEFENSE_SLOT_ABBRS = new Set(["DE","DT","NT","LB","MLB","OLB","ILB","CB","SS","FS","S","DB","NB","LDE","RDE","LDT","RDT","WLB","SLB","LOLB","ROLB","LILB","RILB","LCB","RCB"]);
const SPECIAL_PARENTS = new Set(["ST","K","P"]);
const SPECIAL_SLOT_ABBRS = new Set(["K","PK","P","LS","KR","PR","H"]);

export type PlayerMovement = "up" | "down" | "new" | null;

export interface NormalizedPlayer {
  rank: number;
  name: string;
  playerId: string | null;
  position: string;
  jersey: string | null;
  status: string | null;
  headshot: string | null;
  /** Rank change vs the previous snapshot — computed at the API layer, not stored. */
  movement?: PlayerMovement;
}

export interface NormalizedPositionGroup {
  position: string;
  label: string;
  players: NormalizedPlayer[];
}

export interface NormalizedGroups {
  offense: NormalizedPositionGroup[];
  defense: NormalizedPositionGroup[];
  specialTeams: NormalizedPositionGroup[];
}

/**
 * Matrix-friendly view: a flat map of canonical column key -> ranked players.
 * Keys cover every column used across the Fantasy / Offense / Defense / Special
 * Teams tabs so the frontend can render `positions[col]` for any cell.
 */
export type NormalizedPositions = Record<string, NormalizedPlayer[]>;

// ESPN player headshot CDN. The numeric athlete id from the depthcharts endpoint
// maps directly to a full-size headshot; non-numeric ids (e.g. Footballguys'
// "BrisJa00") aren't ESPN athletes and have no headshot here.
export function espnHeadshotUrl(id: string | null | undefined): string | null {
  if (!id || !/^\d+$/.test(id)) return null;
  return `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`;
}

// Normalize a player name for cross-source matching: lowercase, drop periods and
// generational suffixes, collapse whitespace. "T.J. Sanders" / "Michael Pittman
// Jr." both reduce to a stable key.
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
export function normalizePlayerNameKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  while (words.length > 1 && NAME_SUFFIXES.has(words[words.length - 1]!)) {
    words.pop();
  }
  return words.join(" ");
}

// Index a chart's headshots by normalized name (ESPN populates these before the
// Footballguys / FantasyPros merges overwrite players by name).
export function collectHeadshotsByName(
  positions: NormalizedPositions
): Map<string, string> {
  const map = new Map<string, string>();
  for (const players of Object.values(positions)) {
    for (const p of players) {
      if (p.headshot && p.name) {
        const key = normalizePlayerNameKey(p.name);
        if (!map.has(key)) map.set(key, p.headshot);
      }
    }
  }
  return map;
}

// Backfill headshots onto every player (in place) by normalized-name lookup, so
// merged-in Footballguys / FantasyPros rows recover the ESPN headshot. Only fills
// gaps — never clobbers a headshot the row already carries.
export function applyHeadshotsByName(
  positions: NormalizedPositions,
  byName: Map<string, string>
): void {
  for (const players of Object.values(positions)) {
    for (const p of players) {
      if (!p.headshot && p.name) {
        const url = byName.get(normalizePlayerNameKey(p.name));
        if (url) p.headshot = url;
      }
    }
  }
}

export interface NormalizedDepthChart {
  team: { abbr: string; name: string; logo: string | null };
  season: number;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  groups: NormalizedGroups;
  positions: NormalizedPositions;
}

type Scheme = "3-4" | "4-3";

// Offense + special-teams slot abbreviations map to a canonical column
// regardless of defensive scheme.
const CANONICAL_FIXED: Record<string, string> = {
  // Offense
  QB: "QB",
  RB: "RB", HB: "RB", TB: "RB",
  WR: "WR", LWR: "WR", RWR: "WR", SWR: "WR", SLWR: "WR",
  TE: "TE",
  LT: "LT", LG: "LG", C: "C", RG: "RG", RT: "RT",
  // Special teams
  K: "K", PK: "K", P: "P", LS: "LS", KR: "KR", PR: "PR",
};

// Defensive line interior — always DL.
const DL_SLOTS = new Set(["DT", "LDT", "RDT", "NT", "NG", "DL"]);
// Pure edge rushers — always EDGE.
const EDGE_SLOTS = new Set(["LOLB", "ROLB", "RUSH", "EDGE"]);
// Defensive ends — interior 5-techs (DL) in a 3-4, edge rushers in a 4-3.
const END_SLOTS = new Set(["DE", "LDE", "RDE"]);
// Outside linebackers — edge rushers in a 3-4, off-ball (LB) in a 4-3.
const OLB_SLOTS = new Set(["WLB", "SLB", "OLB"]);
// Inside / off-ball linebackers — always LB.
const ILB_SLOTS = new Set(["MLB", "ILB", "LILB", "RILB", "MIKE", "WILL", "SAM", "LB"]);
const CB_SLOTS = new Set(["CB", "LCB", "RCB", "NB", "NCB", "DB"]);
const S_SLOTS = new Set(["S", "SS", "FS", "SAF"]);

function canonicalKey(slot: string, parent: string, scheme: Scheme): string | null {
  if (CANONICAL_FIXED[slot]) return CANONICAL_FIXED[slot];
  if (DL_SLOTS.has(slot)) return "DL";
  if (EDGE_SLOTS.has(slot)) return "EDGE";
  if (END_SLOTS.has(slot)) return scheme === "3-4" ? "DL" : "EDGE";
  if (OLB_SLOTS.has(slot)) return scheme === "3-4" ? "EDGE" : "LB";
  if (ILB_SLOTS.has(slot)) return "LB";
  if (CB_SLOTS.has(slot)) return "CB";
  if (S_SLOTS.has(slot)) return "S";
  // Parent-category fallback for unrecognized slot abbreviations.
  switch (parent) {
    case "DE":
      return scheme === "3-4" ? "DL" : "EDGE";
    case "DT":
      return "DL";
    case "LB":
      return "LB";
    case "CB":
    case "DB":
      return "CB";
    case "S":
      return "S";
    default:
      return null;
  }
}

// Detect the base defensive front from ESPN formation names ("Base 3-4 D",
// "Base 4-3 D"). Defaults to 4-3 when no front is named.
function detectScheme(formationNames: string[]): Scheme {
  for (const name of formationNames) {
    if (name.includes("3-4")) return "3-4";
    if (name.includes("4-3")) return "4-3";
  }
  return "4-3";
}

/**
 * Merge one or more per-slot ranked lists into a single ranked list for a
 * canonical column. Starters are surfaced first by interleaving across slots
 * (all rank-1s, then all rank-2s, …); duplicates are removed by player id/name.
 */
function interleaveDedupe(slotLists: NormalizedPlayer[][]): NormalizedPlayer[] {
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
      out.push({ ...p, rank: out.length + 1 });
    }
  }
  return out;
}

function teamNickname(teamName: string): string {
  const parts = teamName.trim().split(/\s+/);
  return parts[parts.length - 1] || teamName;
}

interface EspnAthlete {
  id: string;
  displayName: string;
  shortName?: string;
  jersey?: string;
  injuries?: Array<{ type?: { abbreviation?: string } }>;
  headshot?: { href: string };
}

interface EspnPositionSlot {
  position: {
    abbreviation: string;
    displayName: string;
    parent?: { abbreviation: string; displayName: string };
  };
  athletes: EspnAthlete[];
}

interface EspnFormation {
  id: string;
  name: string;
  positions: Record<string, EspnPositionSlot>;
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StatChasers/1.0)",
        Accept: "application/json",
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTeamDepthChart(
  teamAbbr: string,
  teamName: string,
  espnSlug: string
): Promise<NormalizedDepthChart | null> {
  const sourceUrl = `https://www.espn.com/nfl/team/depth/_/name/${espnSlug}`;
  const apiUrl = `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnSlug}/depthcharts`;

  let rawData: unknown = null;

  try {
    const res = await fetchWithTimeout(apiUrl);
    if (!res.ok) {
      logger.warn({ team: teamAbbr, status: res.status, url: apiUrl }, "ESPN API non-OK response");
      return null;
    }
    rawData = await res.json();
  } catch (err) {
    logger.error({ team: teamAbbr, err }, "ESPN API fetch failed");
    return null;
  }

  try {
    const normalized = normalizeEspnData(rawData, teamAbbr, teamName, sourceUrl);
    return normalized;
  } catch (err) {
    logger.error({ team: teamAbbr, err }, "ESPN data normalization failed");
    return null;
  }
}

function normalizeEspnData(
  raw: unknown,
  teamAbbr: string,
  teamName: string,
  sourceUrl: string
): NormalizedDepthChart {
  const data = raw as Record<string, unknown>;
  const season = (data.season as Record<string, unknown>)?.year as number ?? new Date().getFullYear();

  const teamInfo = (data.team as Record<string, unknown>) ?? {};
  // The depthcharts endpoint omits team logos, so fall back to ESPN's stable
  // logo CDN keyed by the lowercased team abbreviation.
  const logo =
    (teamInfo.logos as Array<{ href: string }>)?.[0]?.href ??
    `https://a.espncdn.com/i/teamlogos/nfl/500/${teamAbbr.toLowerCase()}.png`;

  // ESPN returns depthchart as an object with numeric keys, each a "formation"
  // Each formation has a name and positions map (key = slot like "qb", "lt", etc.)
  const depthchartObj = (data.depthchart as Record<string, EspnFormation>) ?? {};
  const formations = Object.values(depthchartObj);

  // Collect all position groups, keyed by position abbreviation
  // (merge slots across formations that share the same parent position)
  const groupMap = new Map<string, NormalizedPositionGroup>();

  // Track which "category" each position slot belongs to (offense/defense/special)
  const slotCategory = new Map<string, "offense" | "defense" | "specialTeams">();
  // Track the ESPN parent abbreviation per slot (used for canonical bucketing)
  const slotParent = new Map<string, string>();

  for (const formation of formations) {
    const slots = Object.values(formation.positions ?? {});
    for (const slot of slots) {
      // The slot's own abbreviation (e.g. "WR", "QB", "LDE") is what we display
      const slotAbbr = (slot.position.abbreviation ?? "").toUpperCase();
      const parentAbbr = (slot.position.parent?.abbreviation ?? "").toUpperCase();

      if (!slotAbbr) continue;

      const athletes = slot.athletes ?? [];
      if (athletes.length === 0) continue;

      // Determine category from parent abbreviation or slot abbreviation
      let category: "offense" | "defense" | "specialTeams";
      if (OFFENSE_PARENTS.has(parentAbbr) || OFFENSE_SLOT_ABBRS.has(slotAbbr)) {
        category = "offense";
      } else if (SPECIAL_PARENTS.has(parentAbbr) || SPECIAL_SLOT_ABBRS.has(slotAbbr)) {
        category = "specialTeams";
      } else if (DEFENSE_PARENTS.has(parentAbbr) || DEFENSE_SLOT_ABBRS.has(slotAbbr)) {
        category = "defense";
      } else {
        // Unknown — skip
        continue;
      }

      // Group by slot abbreviation; keep entry with most players
      const existing = groupMap.get(slotAbbr);
      if (existing && existing.players.length >= athletes.length) continue;

      const posLabel = POSITION_LABELS[slotAbbr] ?? slot.position.displayName ?? slotAbbr;

      const players: NormalizedPlayer[] = athletes.map((athlete, idx) => {
        const injury = athlete.injuries?.[0]?.type?.abbreviation ?? null;
        return {
          rank: idx + 1,
          name: athlete.displayName ?? athlete.shortName ?? "Unknown",
          playerId: athlete.id ?? null,
          position: slotAbbr,
          jersey: athlete.jersey ?? null,
          status: injury ?? null,
          // The depthcharts endpoint omits headshots, so derive the stable ESPN
          // CDN URL from the numeric athlete id.
          headshot: athlete.headshot?.href ?? espnHeadshotUrl(athlete.id),
        };
      });

      groupMap.set(slotAbbr, { position: slotAbbr, label: posLabel, players });
      slotCategory.set(slotAbbr, category);
      slotParent.set(slotAbbr, parentAbbr);
    }
  }

  const allGroups = Array.from(groupMap.values());
  const offense = allGroups.filter(g => slotCategory.get(g.position) === "offense");
  const defense = allGroups.filter(g => slotCategory.get(g.position) === "defense");
  const specialTeams = allGroups.filter(g => slotCategory.get(g.position) === "specialTeams");

  // Build the matrix-friendly `positions` map by folding ESPN slots into
  // canonical column keys (e.g. LCB+RCB+NB -> CB). Edge/DL/LB bucketing is
  // scheme-aware because the same slot means different things in 3-4 vs 4-3.
  const scheme = detectScheme(formations.map((f) => f.name ?? ""));
  const buckets = new Map<string, NormalizedPlayer[][]>();
  for (const group of allGroups) {
    const canon = canonicalKey(group.position, slotParent.get(group.position) ?? "", scheme);
    if (!canon) continue;
    if (!buckets.has(canon)) buckets.set(canon, []);
    buckets.get(canon)!.push(group.players);
  }

  const positions: NormalizedPositions = {};
  for (const [canon, slotLists] of buckets) {
    positions[canon] = interleaveDedupe(slotLists);
  }

  // Fantasy "DEF" column is the team defense unit, displayed as the nickname.
  positions.DEF = [
    {
      rank: 1,
      name: teamNickname(teamName),
      playerId: null,
      position: "DEF",
      jersey: null,
      status: null,
      headshot: null,
    },
  ];

  return {
    team: { abbr: teamAbbr, name: teamName, logo },
    season,
    source: "ESPN",
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    groups: { offense, defense, specialTeams },
    positions,
  };
}

export interface RefreshResult {
  success: boolean;
  teamsRefreshed: number;
  teamsFailed: number;
  failedTeams: string[];
  message: string;
}

export async function refreshAllTeams(
  saveTeam: (
    abbr: string,
    name: string,
    slug: string,
    chart: NormalizedDepthChart
  ) => Promise<void>
): Promise<RefreshResult> {
  const failedTeams: string[] = [];
  let teamsRefreshed = 0;

  // Process in batches of 3 to limit concurrency
  for (let i = 0; i < NFL_TEAMS.length; i += 3) {
    const batch = NFL_TEAMS.slice(i, i + 3);
    await Promise.all(
      batch.map(async ({ abbr, name, espnSlug }) => {
        try {
          const chart = await fetchTeamDepthChart(abbr, name, espnSlug);
          if (!chart) {
            failedTeams.push(abbr);
            logger.warn({ team: abbr }, "Failed to fetch depth chart");
            return;
          }
          await saveTeam(abbr, name, espnSlug, chart);
          teamsRefreshed++;
          logger.info({ team: abbr }, "Depth chart refreshed");
        } catch (err) {
          failedTeams.push(abbr);
          logger.error({ team: abbr, err }, "Error refreshing team depth chart");
        }
      })
    );
  }

  return {
    success: failedTeams.length < NFL_TEAMS.length,
    teamsRefreshed,
    teamsFailed: failedTeams.length,
    failedTeams,
    message: `Refreshed ${teamsRefreshed} teams. ${failedTeams.length} failed.`,
  };
}
