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
  { abbr: "WAS", name: "Washington Commanders", espnSlug: "was" },
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

export interface NormalizedPlayer {
  rank: number;
  name: string;
  position: string;
  jersey: string | null;
  status: string | null;
  headshot: string | null;
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

export interface NormalizedDepthChart {
  team: { abbr: string; name: string; logo: string | null };
  season: number;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  groups: NormalizedGroups;
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
  const logo = (teamInfo.logos as Array<{ href: string }>)?.[0]?.href ?? null;

  // ESPN returns depthchart as an object with numeric keys, each a "formation"
  // Each formation has a name and positions map (key = slot like "qb", "lt", etc.)
  const depthchartObj = (data.depthchart as Record<string, EspnFormation>) ?? {};
  const formations = Object.values(depthchartObj);

  // Collect all position groups, keyed by position abbreviation
  // (merge slots across formations that share the same parent position)
  const groupMap = new Map<string, NormalizedPositionGroup>();

  // Track which "category" each position slot belongs to (offense/defense/special)
  const slotCategory = new Map<string, "offense" | "defense" | "specialTeams">();

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
          position: slotAbbr,
          jersey: athlete.jersey ?? null,
          status: injury ?? null,
          headshot: athlete.headshot?.href ?? null,
        };
      });

      groupMap.set(slotAbbr, { position: slotAbbr, label: posLabel, players });
      slotCategory.set(slotAbbr, category);
    }
  }

  const allGroups = Array.from(groupMap.values());
  const offense = allGroups.filter(g => slotCategory.get(g.position) === "offense");
  const defense = allGroups.filter(g => slotCategory.get(g.position) === "defense");
  const specialTeams = allGroups.filter(g => slotCategory.get(g.position) === "specialTeams");

  return {
    team: { abbr: teamAbbr, name: teamName, logo },
    season,
    source: "ESPN",
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    groups: { offense, defense, specialTeams },
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
