import {
  useState,
  useMemo,
  useRef,
  useEffect,
  type ReactNode,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useGetAllDepthCharts } from "@workspace/api-client-react";
import type {
  DepthChartSnapshot,
  DepthChartPlayer,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Search, SearchX, AlertCircle, ArrowUp, ArrowDown, Download, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tab + column configuration
// ---------------------------------------------------------------------------

type TabKey = "fantasy" | "offense" | "defense" | "special";

interface ColumnDef {
  key: string; // canonical positions[] key returned by the API
  label: string; // column header label
  short?: string; // compact header shown when the column is at its min width
}

const TABS: Record<TabKey, { label: string; columns: ColumnDef[] }> = {
  fantasy: {
    // FantasyPros ECR order lives in dedicated FAN_* columns so the Offense /
    // Special-Teams tabs can show Footballguys' team depth order for QB/RB/WR/TE/K.
    label: "Fantasy",
    columns: [
      { key: "FAN_QB", label: "Quarterbacks", short: "QB" },
      { key: "FAN_RB", label: "Running Backs", short: "RB" },
      { key: "FAN_WR", label: "Wide Receivers", short: "WR" },
      { key: "FAN_TE", label: "Tight Ends", short: "TE" },
      { key: "FAN_K", label: "Kickers", short: "K" },
    ],
  },
  offense: {
    label: "Offense",
    columns: [
      { key: "QB", label: "QB" },
      { key: "RB", label: "RB" },
      { key: "WR", label: "WR" },
      { key: "TE", label: "TE" },
      { key: "LT", label: "LT" },
      { key: "LG", label: "LG" },
      { key: "C", label: "C" },
      { key: "RG", label: "RG" },
      { key: "RT", label: "RT" },
    ],
  },
  defense: {
    label: "Defense",
    columns: [
      { key: "EDGE", label: "EDGE" },
      { key: "DL", label: "DL" },
      { key: "LB", label: "LB" },
      { key: "CB", label: "CB" },
      { key: "S", label: "S" },
    ],
  },
  special: {
    label: "Special Teams",
    columns: [
      { key: "K", label: "K" },
      { key: "P", label: "P" },
      { key: "LS", label: "LS" },
      { key: "KR", label: "KR" },
      { key: "PR", label: "PR" },
    ],
  },
};

const TAB_ORDER: TabKey[] = ["fantasy", "offense", "defense", "special"];

// Colored position codes shown in the "All positions" dropdown. Keyed by the
// base position code derived from a column (col.short ?? col.key), so FAN_QB and
// QB both map to "QB". Positions without an entry render in a neutral gray.
const POSITION_COLOR: Record<string, string> = {
  QB: "#dc2626", // red
  RB: "#16a34a", // green
  WR: "#2563eb", // blue
  TE: "#ca8a04", // yellow
  K: "#9333ea", // purple
};

function positionCode(col: ColumnDef): string {
  return col.short ?? col.key;
}

function PositionBadge({ code }: { code: string }) {
  return (
    <span
      className="inline-flex items-center justify-center min-w-[1.75rem] text-[0.7rem] font-bold leading-none"
      style={{ color: POSITION_COLOR[code] ?? "#64748b" }}
    >
      {code}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPlayers(team: DepthChartSnapshot, key: string): DepthChartPlayer[] {
  const positions = (team.positions ?? {}) as Record<string, DepthChartPlayer[]>;
  return positions[key] ?? [];
}

// Tab-aware search match: a team is a hit when its name/abbr contains the query,
// OR one of its players *in the currently displayed columns* does. Scoping to
// `columns` (rather than every raw position key) means a Fantasy-tab search only
// surfaces teams whose match is actually visible on that tab.
function teamMatchesSearch(
  team: DepthChartSnapshot,
  query: string,
  columns: ColumnDef[]
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (
    team.team.name.toLowerCase().includes(q) ||
    team.team.abbr.toLowerCase().includes(q)
  ) {
    return true;
  }
  for (const col of columns) {
    if (getPlayers(team, col.key).some((p) => p.name.toLowerCase().includes(q)))
      return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  const [positionFilter, setPositionFilter] = useState<string>("ALL");
  const [activeTab, setActiveTab] = useState<TabKey>("fantasy");

  // Search autocomplete: open state + keyboard-highlighted row.
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const suggestListRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, isError } = useGetAllDepthCharts();

  const teams = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => a.team.name.localeCompare(b.team.name));
  }, [data]);

  // Only the ESPN source carries headshots (Fantasy's FAN_* columns come from
  // FantasyPros with headshot: null). Build a name -> headshot map across *every*
  // position so Fantasy-tab suggestions can borrow a player's ESPN headshot.
  const headshotByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) {
      const positions = (t.positions ?? {}) as Record<string, DepthChartPlayer[]>;
      for (const players of Object.values(positions)) {
        for (const p of players) {
          if (p.headshot && p.name) {
            const k = p.name.toLowerCase();
            if (!map.has(k)) map.set(k, p.headshot);
          }
        }
      }
    }
    return map;
  }, [teams]);

  // Alphabetical team + player list for the active tab. Players are de-duplicated
  // by name and drawn only from the tab's visible columns. Each row carries its
  // imagery: teams a logo; players a headshot plus their team's abbr + logo.
  const suggestions = useMemo(() => {
    const cols = TABS[activeTab].columns;
    const items: {
      type: "team" | "player";
      label: string;
      sub?: string;
      pos?: string;
      logo?: string | null;
      headshot?: string | null;
      teamLogo?: string | null;
    }[] = [];
    for (const t of teams)
      items.push({ type: "team", label: t.team.name, sub: t.team.abbr, logo: t.team.logo });
    const seen = new Set<string>();
    for (const t of teams) {
      for (const col of cols) {
        for (const p of getPlayers(t, col.key)) {
          if (!p.name) continue;
          const k = p.name.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          items.push({
            type: "player",
            label: p.name,
            sub: t.team.abbr,
            pos: positionCode(col),
            headshot: p.headshot ?? headshotByName.get(k) ?? null,
            teamLogo: t.team.logo,
          });
        }
      }
    }
    items.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    return items;
  }, [teams, activeTab, headshotByName]);

  // The dropdown's current rows: query-filtered, capped so a full roster can't
  // render thousands of nodes.
  const shownSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? suggestions.filter((s) => s.label.toLowerCase().includes(q))
      : suggestions;
    return list.slice(0, 60);
  }, [suggestions, searchQuery]);

  // Keep the keyboard-highlighted row scrolled into view.
  useEffect(() => {
    if (activeSuggestion < 0) return;
    const el = suggestListRef.current?.children[activeSuggestion] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeSuggestion]);

  function selectSuggestion(label: string) {
    setSearchQuery(label);
    setSearchOpen(false);
    setActiveSuggestion(-1);
  }

  function handleSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    const open = searchOpen && shownSuggestions.length > 0;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setSearchOpen(true);
        return;
      }
      setActiveSuggestion((i) => Math.min(i + 1, shownSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      if (!open) return;
      e.preventDefault();
      setActiveSuggestion((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && activeSuggestion >= 0 && shownSuggestions[activeSuggestion]) {
        e.preventDefault();
        selectSuggestion(shownSuggestions[activeSuggestion].label);
      }
    } else if (e.key === "Escape") {
      setSearchOpen(false);
    }
  }

  const visibleTeams = useMemo(() => {
    const searchColumns = TABS[activeTab].columns;
    return teams.filter((t) => {
      if (teamFilter !== "ALL" && t.team.abbr !== teamFilter) return false;
      return teamMatchesSearch(t, searchQuery, searchColumns);
    });
  }, [teams, teamFilter, searchQuery, activeTab]);

  const tabColumns = TABS[activeTab].columns;
  const columns =
    positionFilter === "ALL"
      ? tabColumns
      : tabColumns.filter((c) => c.key === positionFilter);

  // Result-state context shown as chips beneath the toolbar.
  const visiblePlayerCount = useMemo(
    () =>
      visibleTeams.reduce(
        (sum, team) =>
          sum +
          columns.reduce((s, col) => s + getPlayers(team, col.key).length, 0),
        0
      ),
    [visibleTeams, columns]
  );
  const activePositionLabel =
    positionFilter === "ALL"
      ? null
      : tabColumns.find((c) => c.key === positionFilter)?.label ?? positionFilter;
  const activeTeamLabel =
    teamFilter === "ALL"
      ? null
      : teams.find((t) => t.team.abbr === teamFilter)?.team.abbr ?? teamFilter;

  // Per-position "auto-fit" width: wide enough for that position's longest
  // (abbreviated) name across every team, so a given position is the SAME width
  // in all teams. Used only as the tight end of the clamp below — on wide
  // screens all columns share the uniform max, and each only narrows to its own
  // width as the viewport runs out of room.
  const positionFitRem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const col of tabColumns) {
      let maxChars = (col.short ?? col.label).length;
      for (const team of teams) {
        for (const p of getPlayers(team, col.key)) {
          const len = abbreviateName(p.name).length;
          if (len > maxChars) maxChars = len;
        }
      }
      // ~0.4rem/char at the tight 0.7rem font, plus gutters; clamped to a sane
      // range so no column is absurdly narrow or wider than the uniform max.
      const rem = maxChars * 0.4 + 1;
      map[col.key] = Math.min(7, Math.max(4, Math.round(rem * 100) / 100));
    }
    return map;
  }, [teams, tabColumns]);

  // Each column: uniform 7rem min on wide screens (grows via 1fr), tightening
  // toward this position's own fit as the viewport shrinks. Same vw term for all
  // columns so they narrow together; the per-column min is what differentiates.
  // Each track's min is scaled by --sc-fit (set per team card): normally 1, but
  // dropped to 0.8 when that card's columns overflow and would otherwise force
  // horizontal scrolling — shrinking columns (and their padding) up to 20% to
  // pack more onto the screen. See useFitToWidth / the .sc-col* padding rules.
  const columnTemplate = columns
    .map(
      (col) =>
        `minmax(calc(clamp(${positionFitRem[col.key] ?? 4}rem, calc(0.7rem + 11.2vw), 7rem) * var(--sc-fit, 1)), 1fr)`
    )
    .join(" ");

  // Each team card is roughly (columns × column-width) + gaps + padding wide.
  // Feeding that into an auto-fill grid lets the browser pack as many teams
  // per row as fit — so filtering down to fewer columns shows more teams/row.
  // Capped at 100% so a wide card (many columns) never overflows the page.
  const COLUMN_WIDTH_REM = 11; // matches the per-column minmax() min below
  const teamCardMinWidth = `min(100%, ${(
    columns.length * COLUMN_WIDTH_REM +
    (columns.length - 1) * 0.5 +
    2.3 // team-surface horizontal padding (~1.15rem each side)
  ).toFixed(2)}rem)`;

  // Switching tabs may invalidate the selected position, so reset it. The search
  // term is scoped to the tab's columns, so clear it too — a carried-over query
  // could otherwise leave the new tab looking empty.
  function handleTabChange(key: TabKey) {
    setActiveTab(key);
    setPositionFilter("ALL");
    setSearchQuery("");
    setSearchOpen(false);
    setActiveSuggestion(-1);
  }


  // Export exactly what's on screen — the visible teams (team filter + search)
  // crossed with the active tab's displayed columns (position filter) — as a
  // wide-format .xlsx: one row per Team + Position, with each position's players
  // (in depth order) spread across "Player 1", "Player 2", … columns.
  async function handleDownloadExcel() {
    const records = visibleTeams
      .flatMap((team) =>
        columns.map((col) => ({
          team,
          position: col.label,
          players: getPlayers(team, col.key),
        }))
      )
      .filter((r) => r.players.length > 0);
    if (records.length === 0) return;

    // Enough "Player N" columns for the deepest position in the export.
    const maxPlayers = records.reduce((m, r) => Math.max(m, r.players.length), 0);
    const playerHeaders = Array.from(
      { length: maxPlayers },
      (_, i) => `Player ${i + 1}`
    );
    const header = ["Team", "Abbr", "Position", ...playerHeaders];

    const rows = records.map((r) => {
      const row: Record<string, string> = {
        Team: r.team.team.name,
        Abbr: r.team.team.abbr,
        Position: r.position,
      };
      playerHeaders.forEach((key, i) => {
        const p = r.players[i];
        // Keep the injury status visible inline, e.g. "Player Name (Q)".
        row[key] = p ? `${p.name}${p.status ? ` (${p.status})` : ""}` : "";
      });
      return row;
    });

    // Loaded on demand so the ~400 kB sheet library stays out of the initial bundle.
    const XLSX = await import("xlsx");
    const worksheet = XLSX.utils.json_to_sheet(rows, { header });
    worksheet["!cols"] = [
      { wch: 24 }, // Team
      { wch: 6 }, // Abbr
      { wch: 16 }, // Position
      ...playerHeaders.map(() => ({ wch: 22 })), // Player N
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, TABS[activeTab].label);
    const stamp = format(new Date(), "yyyy-MM-dd");
    XLSX.writeFile(workbook, `statchasers-depth-charts-${activeTab}-${stamp}.xlsx`);
  }

  return (
    <div className="depth-app-root min-h-screen bg-white text-[var(--sc-ink)] flex flex-col">
      <main className="flex-1 w-full px-[5px] py-8">
        <div className="space-y-6">
          {/* Top header row — the view switch lives in a header band above the
              toolbar, with the quiet results count on the right. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3 border-b border-[var(--sc-border)]">
            <Tabs
              value={activeTab}
              onValueChange={(v) => handleTabChange(v as TabKey)}
            >
              <TabsList className="inline-flex flex-wrap h-11 p-1 gap-1 bg-[var(--sc-bg)] border border-[var(--sc-border)] rounded-lg">
                {TAB_ORDER.map((key) => (
                  <TabsTrigger
                    key={key}
                    value={key}
                    className="depth-app-tab rounded-md px-5 text-sm font-semibold text-[var(--sc-muted)] transition-colors hover:text-[var(--sc-ink)] data-[state=active]:bg-[linear-gradient(180deg,#f7c63d,#efb91b)] data-[state=active]:text-[var(--sc-navy)] data-[state=active]:font-bold data-[state=active]:shadow-[0_2px_6px_rgba(210,160,20,0.18)]"
                  >
                    {TABS[key].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {/* Hidden on mobile — the count is shown above the first team card
                there instead (see the body below). */}
            {!isLoading && !isError && (
              <span className="ml-auto hidden sm:block text-xs text-[var(--sc-muted)]">
                Showing {visiblePlayerCount} players
                {activePositionLabel && ` · ${activePositionLabel}`}
                {activeTeamLabel && ` · ${activeTeamLabel}`}
              </span>
            )}
          </div>

          {/* Controls — search + filters + export. */}
          <div className="space-y-2">
            {/* Row 1 — search (grows) with the secondary Export beside it. */}
            <div className="flex gap-3 items-center">
              <div className="flex-1 min-w-0 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <Input
                  type="text"
                  placeholder="Search team or player..."
                  className="w-full pl-10 h-[33px] text-[0.85rem]"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchOpen(true);
                    setActiveSuggestion(-1);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={handleSearchKeyDown}
                  onBlur={() => {
                    // Delay so a click inside the list resolves before we close.
                    blurTimer.current = setTimeout(() => setSearchOpen(false), 120);
                  }}
                  disabled={isLoading}
                  role="combobox"
                  aria-expanded={searchOpen && shownSuggestions.length > 0}
                  aria-autocomplete="list"
                  autoComplete="off"
                />
                {searchOpen && shownSuggestions.length > 0 && (
                  <div
                    ref={suggestListRef}
                    role="listbox"
                    className="absolute left-0 right-0 top-full mt-1 z-30 max-h-64 overflow-y-auto rounded-lg border border-[var(--sc-border)] bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
                  >
                    {shownSuggestions.map((s, i) => (
                      <div
                        key={`${s.type}-${s.label}`}
                        role="option"
                        aria-selected={i === activeSuggestion}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 cursor-pointer",
                          i === activeSuggestion && "bg-[var(--sc-row-hover)]"
                        )}
                        // mousedown (before the input's blur) so the click registers.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (blurTimer.current) clearTimeout(blurTimer.current);
                          selectSuggestion(s.label);
                        }}
                        onMouseEnter={() => setActiveSuggestion(i)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {s.type === "team" ? (
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                              {s.logo ? (
                                <img
                                  src={s.logo}
                                  alt=""
                                  className="h-6 w-6 object-contain"
                                  loading="lazy"
                                />
                              ) : (
                                <span className="text-[0.6rem] font-bold text-[var(--sc-navy)]">
                                  {s.sub}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="relative h-7 w-7 shrink-0">
                              {s.headshot ? (
                                <img
                                  src={s.headshot}
                                  alt=""
                                  className="h-7 w-7 rounded-full bg-[var(--sc-bg)] object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--sc-bg)] text-[0.6rem] font-bold text-[var(--sc-navy)]">
                                  {s.sub}
                                </span>
                              )}
                              {s.teamLogo && (
                                <img
                                  src={s.teamLogo}
                                  alt=""
                                  className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 object-contain"
                                  loading="lazy"
                                />
                              )}
                            </span>
                          )}
                          <span className="flex min-w-0 items-baseline gap-1.5">
                            <span className="truncate text-[0.85rem] font-medium text-[var(--sc-ink)]">
                              {s.label}
                            </span>
                            {s.type === "player" && s.pos && (
                              <span
                                className="shrink-0 text-[0.65rem] font-bold uppercase tracking-wider"
                                style={{ color: POSITION_COLOR[s.pos] ?? "#64748b" }}
                              >
                                {s.pos}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 text-[0.65rem] font-bold uppercase tracking-wider text-[var(--sc-faint)] tabular-nums">
                          {s.type === "team" ? "Team" : s.sub ?? "Player"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Export is secondary — softened so it doesn't compete with the
                  view switch. Gold only appears on hover. */}
              <Button
                type="button"
                onClick={handleDownloadExcel}
                disabled={isLoading || visibleTeams.length === 0}
                className="shrink-0 h-[33px] px-4 gap-2 text-[0.85rem] font-semibold bg-white text-[var(--sc-navy)] border border-[var(--sc-border)] hover:bg-[var(--sc-gold-soft)] hover:border-[var(--sc-gold)]"
              >
                <Download className="w-4 h-4" />
                Export
              </Button>
            </div>

            {/* Row 2 — the two filters share a row. */}
            <div className="flex gap-3">
              <div className="flex-1 min-w-0">
                <Select
                  value={positionFilter}
                  onValueChange={setPositionFilter}
                  disabled={isLoading}
                >
                  <SelectTrigger className="w-full h-[33px] text-[0.85rem] font-medium">
                    <SelectValue placeholder="All positions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All positions</SelectItem>
                    {tabColumns.map((col) => (
                      <SelectItem key={col.key} value={col.key}>
                        <span className="inline-flex items-center gap-2">
                          {col.label}
                          <PositionBadge code={positionCode(col)} />
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-0">
                <Select
                  value={teamFilter}
                  onValueChange={setTeamFilter}
                  disabled={isLoading}
                >
                  <SelectTrigger className="w-full h-[33px] text-[0.85rem] font-medium">
                    <SelectValue placeholder="All teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All teams</SelectItem>
                    {teams.map((t) => (
                      <SelectItem key={t.team.abbr} value={t.team.abbr}>
                        <span className="inline-flex items-center gap-2">
                          {t.team.logo ? (
                            <img
                              src={t.team.logo}
                              alt=""
                              className="w-5 h-5 object-contain shrink-0"
                              loading="lazy"
                            />
                          ) : (
                            <span className="inline-flex items-center justify-center w-5 h-5 shrink-0 rounded text-[0.6rem] font-bold text-[var(--sc-navy)]">
                              {t.team.abbr}
                            </span>
                          )}
                          {t.team.name} ({t.team.abbr})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Fantasy note — a soft informational aside, not a warning. */}
            {activeTab === "fantasy" && (
              <div
                className="flex items-center gap-2 w-fit max-w-full rounded-lg px-3 py-2 text-[13px] leading-snug"
                style={{
                  background: "rgba(245, 185, 66, 0.08)",
                  border: "1px solid rgba(245, 185, 66, 0.24)",
                  color: "#475569",
                }}
              >
                <Info
                  className="w-4 h-4 shrink-0"
                  style={{ color: "rgba(201, 151, 0, 0.9)" }}
                />
                <span>
                  Fantasy view prioritizes fantasy value and may differ from
                  official team depth charts.
                </span>
              </div>
            )}
          </div>

          {/* Body */}
          {isLoading ? (
            <TeamSectionsSkeleton
              columns={columns.length}
              cardMinWidth={teamCardMinWidth}
            />
          ) : isError ? (
            <EmptyState
              icon={<AlertCircle className="w-12 h-12 text-slate-300 mb-4" />}
              title="Data Unavailable"
              subtitle="There was a problem loading depth chart data. Please try again later."
            />
          ) : visibleTeams.length === 0 ? (
            <EmptyState
              icon={<SearchX className="w-12 h-12 text-slate-300 mb-4" />}
              title="No teams found"
              subtitle="Try adjusting your search or team filter."
            />
          ) : (
            <div>
              {/* Mobile-only results count, directly above the first team card
                  (the header copy is hidden below the sm breakpoint). */}
              <div className="sm:hidden mb-2 text-xs text-[var(--sc-muted)]">
                Showing {visiblePlayerCount} players
                {activePositionLabel && ` · ${activePositionLabel}`}
                {activeTeamLabel && ` · ${activeTeamLabel}`}
              </div>
              <div
                className="grid gap-4 items-start"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${teamCardMinWidth}, 1fr))`,
                }}
              >
                {visibleTeams.map((team) => (
                  <TeamSection
                    key={team.team.abbr}
                    team={team}
                    columns={columns}
                    columnTemplate={columnTemplate}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team section
// ---------------------------------------------------------------------------

// Watches the horizontally-scrollable column strip and returns a scale factor
// for --sc-fit: 1 while everything fits, 0.8 once the columns overflow and would
// otherwise need horizontal scrolling (shrinking column widths + padding ~20%).
// Hysteresis on the restore side keeps the shrink — which itself reduces
// scrollWidth — from oscillating the state.
function useFitToWidth(columnCount: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const inner = el.firstElementChild;
    const measure = () => {
      const overflow = el.scrollWidth - el.clientWidth;
      setFit((prev) =>
        prev === 1
          ? overflow > 0
            ? 0.8
            : 1
          : // Already shrunk: only restore once there's clear slack.
            overflow > -24
            ? 0.8
            : 1
      );
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (inner) ro.observe(inner);
    measure();
    return () => ro.disconnect();
  }, [columnCount]);
  return [ref, fit] as const;
}

function TeamSection({
  team,
  columns,
  columnTemplate,
}: {
  team: DepthChartSnapshot;
  columns: ColumnDef[];
  columnTemplate: string;
}) {
  const [scrollRef, fit] = useFitToWidth(columns.length);
  // Small summary strip under the team name, e.g. "3 QB · 6 RB · 4 WR · 2 TE · 1 K".
  const positionSummary = columns
    .map((col) => ({ label: col.short ?? col.label, n: getPlayers(team, col.key).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${x.label}`)
    .join(" · ");

  return (
    <section className="depth-app-team-card min-w-0">
      {/* Team identity — logo + strong team name with a quiet roster summary. */}
      <header className="flex items-center gap-3 mb-3.5 min-w-0">
        <TeamLogo team={team.team} />
        <div className="min-w-0">
          <h2 className="font-display font-extrabold text-[var(--sc-navy)] text-[19px] md:text-[20px] leading-[1.15] tracking-[-0.01em] truncate">
            {team.team.name}
          </h2>
          {positionSummary && (
            <div className="mt-1 text-[11px] font-medium text-[var(--sc-muted)] tabular-nums truncate">
              {positionSummary}
            </div>
          )}
        </div>
      </header>

      {/* Position groups sit directly on the team surface — a grid on wide
          screens, horizontally scrollable on small. No nested boxes. */}
      <div
        ref={scrollRef}
        style={{ "--sc-fit": fit } as CSSProperties}
        className="depth-app-scroll overflow-x-auto -mx-1 px-1 pb-1"
      >
        <div
          className="grid gap-x-2 gap-y-0"
          style={{ gridTemplateColumns: columnTemplate }}
        >
          {columns.map((col) => (
            <PositionColumn
              key={col.key}
              label={col.label}
              short={col.short ?? col.label}
              players={getPlayers(team, col.key)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function TeamLogo({
  team,
}: {
  team: DepthChartSnapshot["team"];
}) {
  return (
    <div className="w-[52px] h-[52px] shrink-0 rounded-2xl bg-[var(--sc-bg)] border border-[var(--sc-card-border)] flex items-center justify-center overflow-hidden">
      {team.logo ? (
        <img
          src={team.logo}
          alt={`${team.name} logo`}
          className="w-10 h-10 object-contain"
          loading="lazy"
        />
      ) : (
        <span className="text-sm font-bold text-[var(--sc-navy)]">{team.abbr}</span>
      )}
    </div>
  );
}

function PositionColumn({
  label,
  short,
  players,
}: {
  label: string;
  short: string;
  players: DepthChartPlayer[];
}) {
  return (
    <div className="min-w-0" style={{ containerType: "inline-size" }}>
      {/* Editorial position header: quiet uppercase eyebrow + count badge. */}
      <div className="depth-app-colhead flex items-center gap-1.5 min-w-0 py-0.5">
        <span className="depth-app-colhead-text min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--sc-navy)]">
          {/* Full header by default; swaps to the compact form (e.g. "QB") once
              the column is squeezed to its narrowest (scrolling) width. */}
          <span className="depth-app-colhead-full">{label}</span>
          <span className="depth-app-colhead-abbr">{short}</span>
        </span>
        {players.length > 0 && (
          <span className="shrink-0 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-[var(--sc-bg)] text-[10px] font-bold leading-none text-[var(--sc-muted)] tabular-nums">
            {players.length}
          </span>
        )}
      </div>
      <div className="depth-app-colrule" />
      <div className="depth-app-colbody space-y-px">
        {players.length === 0 ? (
          <div className="px-2 py-px text-xs text-[var(--sc-faint)]">—</div>
        ) : (
          players.map((p) => <PlayerRow key={`${p.rank}-${p.name}`} player={p} />)
        )}
      </div>
    </div>
  );
}

// "Josh Sweat" -> "J. Sweat". Keeps everything after the first name intact so
// suffixes/compound surnames survive (e.g. "Amon-Ra St. Brown" -> "A. St. Brown").
function abbreviateName(name: string): string {
  const firstSpace = name.indexOf(" ");
  if (firstSpace <= 0) return name;
  return `${name[0]}. ${name.slice(firstSpace + 1)}`;
}

// Trailing generational suffixes dropped from the profile slug so
// "Michael Pittman Jr." -> "michael-pittman".
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

// StatChasers player profile URL, e.g. "Josh Allen" ->
// "https://statchasers.com/nfl/players/josh-allen/". Drops any trailing
// suffix, strips punctuation, and collapses non-alphanumeric runs to a
// single hyphen.
function playerProfileUrl(name: string): string {
  const words = name.trim().split(/\s+/);
  if (
    words.length > 1 &&
    NAME_SUFFIXES.has(words[words.length - 1].replace(/[^a-z]/gi, "").toLowerCase())
  ) {
    words.pop();
  }
  const slug = words
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `https://statchasers.com/nfl/players/${slug}/`;
}

function PlayerRow({ player }: { player: DepthChartPlayer }) {
  // Zero-padded depth rank ("01", "02") for a calm, aligned tabular column.
  const rank = String(player.rank).padStart(2, "0");
  return (
    <div className="depth-app-player-row group flex items-start gap-1.5 pr-1.5 py-[3px] rounded-md border-l-2 border-transparent transition-colors duration-150 hover:bg-[var(--sc-row-hover)] hover:border-[var(--sc-gold)]">
      <MovementIcon movement={player.movement} />
      <span className="depth-app-rank shrink-0 text-left tabular-nums leading-[0.919rem] text-[var(--sc-faint)]">
        {rank}
      </span>
      {/* Name links to the player's StatChasers profile in a new tab. Full name
          by default; the container query swaps to the abbreviated form once the
          column is squeezed to its narrowest (scrolling) width. */}
      <a
        href={playerProfileUrl(player.name)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 min-w-0 hover:underline"
      >
        <span className="depth-app-name depth-app-name-full break-words font-medium leading-[0.919rem] text-[var(--sc-ink)] transition-colors group-hover:text-[var(--sc-navy)]">
          {player.name}
        </span>
        <span className="depth-app-name depth-app-name-abbr break-words font-medium leading-[0.919rem] text-[var(--sc-ink)] transition-colors group-hover:text-[var(--sc-navy)]">
          {abbreviateName(player.name)}
        </span>
      </a>
      <PlayerBadges player={player} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function MovementIcon({ movement }: { movement?: DepthChartPlayer["movement"] }) {
  if (movement === "up") {
    return (
      <ArrowUp
        className="depth-app-move w-3 h-3 shrink-0 mt-0.5 text-emerald-600"
        aria-label="Moved up"
      />
    );
  }
  if (movement === "down") {
    return (
      <ArrowDown
        className="depth-app-move w-3 h-3 shrink-0 mt-0.5 text-red-500"
        aria-label="Moved down"
      />
    );
  }
  return null;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  Q: { label: "Q", className: "bg-amber-100 text-amber-700" },
  D: { label: "D", className: "bg-amber-100 text-amber-700" },
  O: { label: "O", className: "bg-red-100 text-red-600" },
  IR: { label: "IR", className: "bg-red-100 text-red-600" },
  PUP: { label: "PUP", className: "bg-red-100 text-red-600" },
  SUSP: { label: "SUS", className: "bg-red-100 text-red-600" },
};

function PlayerBadges({ player }: { player: DepthChartPlayer }) {
  const badges: { label: string; className: string }[] = [];

  if (player.status) {
    const known = STATUS_BADGE[player.status.toUpperCase()];
    badges.push(
      known ?? { label: player.status, className: "bg-red-100 text-red-600" }
    );
  }

  if (badges.length === 0) return null;

  return (
    <span className="flex items-center gap-1 shrink-0">
      {badges.map((b) => (
        <span
          key={b.label}
          className={cn(
            "inline-flex items-center rounded px-1 py-0 text-[9px] leading-4 font-bold uppercase tracking-wider",
            b.className
          )}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="bg-[var(--sc-card)] rounded-xl border border-[var(--sc-border)] border-t-4 border-t-[var(--sc-gold)] shadow-md p-16 text-center flex flex-col items-center justify-center">
      {icon}
      <h3 className="text-xl font-bold text-[var(--sc-ink)]">{title}</h3>
      <p className="text-[var(--sc-muted)] mt-2">{subtitle}</p>
    </div>
  );
}

function TeamSectionsSkeleton({
  columns,
  cardMinWidth,
}: {
  columns: number;
  cardMinWidth: string;
}) {
  return (
    <div
      className="grid gap-4 items-start"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}, 1fr))`,
      }}
    >
      {Array.from({ length: 6 }).map((_, s) => (
        <div key={s} className="depth-app-team-card min-w-0">
          <div className="flex items-center gap-3 mb-3.5">
            <Skeleton className="w-[52px] h-[52px] rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
          <div
            className="grid gap-x-2"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(11rem, 1fr))`,
            }}
          >
            {Array.from({ length: columns }).map((_, c) => (
              <div key={c}>
                <Skeleton className="h-3.5 w-16 mb-1.5" />
                <div className="depth-app-colrule mb-1.5" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
