import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { PlayerCard, PlayerXpts, TeamSummary } from "@fpl/contracts";
import { getPlayers, getTeams, getGameweeks, getPlayerXpts, resolveAssetUrl } from "@/api/client";
import type { GameweekSummary } from "@fpl/contracts";
import { formatCost, formatPercent } from "@/lib/format";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Search, Users, ChevronUp, ChevronDown, ChevronsUpDown, RefreshCw, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildPlayersSearchParams,
  countActiveAdvancedFilters,
  filterAndSortPlayers,
  getDefaultGameweekRange,
  getPlayerColumnValue,
  getPlayersParamsKey,
  hasActiveAdvancedFilters,
  type PlayerColumnKey,
  type SortDir,
} from "./playersPageUtils";

type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

const PLAYERS_PAGE_SIZE = 35;

const _playersDataCache = new Map<string, PlayerCard[]>();
let _savedParams = ""; // always up-to-date filter/sort URL string, even before first fetch completes
let _teamsCache: TeamSummary[] | null = null;
let _gameweeksCache: GameweekSummary[] | null = null;
let _xptsCache: PlayerXpts[] | null = null;
let _xptsMap = new Map<number, number | null>(); // playerId → xpts
let _latestFetchId = 0; // increments on every fetchPlayers call; stale responses are discarded

function getSavedParam(key: string, fallback = ""): string {
  if (!_savedParams) return fallback;
  return new URLSearchParams(_savedParams).get(key) ?? fallback;
}

const POSITIONS: Record<number, { label: string; short: string; color: string }> = {
  1: { label: "Goalkeeper", short: "GKP", color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25" },
  2: { label: "Defender", short: "DEF", color: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
  3: { label: "Midfielder", short: "MID", color: "bg-green-500/15 text-green-400 border-green-500/25" },
  4: { label: "Forward", short: "FWD", color: "bg-primary/15 text-primary border-primary/25" },
};

const STATUS_CONFIG: Record<string, { label: string; dot: string }> = {
  a: { label: "Available", dot: "bg-green-400" },
  d: { label: "Doubtful", dot: "bg-amber-400" },
  i: { label: "Injured", dot: "bg-red-500" },
  s: { label: "Suspended", dot: "bg-red-500" },
  n: { label: "N/A", dot: "bg-gray-500" },
  u: { label: "Unavailable", dot: "bg-gray-500" },
};

type ColDef = {
  key: PlayerColumnKey;
  label: string;
  title?: string;
  align?: "right" | "left";
  sortable?: boolean;
  format?: (value: number | string, player: PlayerCard) => React.ReactNode;
  group?: string;
  compute?: (player: PlayerCard) => number;
  /** Values can be negative; format renders green (≥0) or red (<0) */
  signed?: boolean;
};

const COLUMNS: ColDef[] = [
  { key: "nowCost",           label: "Price",  align: "right", sortable: true, format: (v) => formatCost(Number(v)) },
  { key: "totalPoints",       label: "Pts",    title: "Total Points",   align: "right", sortable: true, format: (v) => <span className="font-bold">{v}</span> },
  { key: "pointsPerGame",     label: "PPG",    title: "Points Per Game", align: "right", sortable: true, format: (v) => Number(v).toFixed(1) },
  { key: "form",              label: "Form",   align: "right", sortable: true, format: (v) => Number(v).toFixed(1) },
  { key: "selectedByPercent", label: "Sel%",   title: "Selected By %",  align: "right", sortable: true, format: (v) => formatPercent(Number(v)) },
  { key: "minutes",           label: "Min",    title: "Minutes Played", align: "right", sortable: true, format: (v) => Number(v).toLocaleString() },
  { key: "starts",            label: "Starts", align: "right", sortable: true },
  { key: "cleanSheets",       label: "CS",     title: "Clean Sheets",   align: "right", sortable: true },
  { key: "bonus",             label: "Bonus",  align: "right", sortable: true },
  { key: "defensiveContribution", label: "DC", title: "Defensive Contribution", align: "right", sortable: true },
  {
    key: "xPts",
    label: "xPts",
    title: "Expected Points (next GW)",
    align: "right",
    sortable: true,
    format: (_v: number | string, player: PlayerCard) => {
      const v = _xptsMap.get(player.id);
      if (v == null) return <span className="text-white/25">—</span>;
      return <span className="font-semibold text-accent">{v.toFixed(1)}</span>;
    },
  },
  // Goals group
  { key: "goalsScored",              label: "G",   title: "Goals",                    align: "right", sortable: true, group: "Goals" },
  { key: "expectedGoals",            label: "xG",  title: "Expected Goals",           align: "right", sortable: true, format: (v) => Number(v).toFixed(2), group: "Goals" },
  { key: "expectedGoalPerformance",  label: "xGP", title: "Expected Goal Performance",align: "right", sortable: true, signed: true, format: (v) => { const n = Number(v); return <span style={{ color: n < 0 ? "hsl(0,72%,51%)" : "hsl(160,100%,50%)" }}>{n.toFixed(2)}</span>; }, group: "Goals" },
  // Assists group
  { key: "assists",                   label: "A",   title: "Assists",                    align: "right", sortable: true, group: "Assists" },
  { key: "expectedAssists",           label: "xA",  title: "Expected Assists",           align: "right", sortable: true, format: (v) => Number(v).toFixed(2), group: "Assists" },
  { key: "expectedAssistPerformance", label: "xAP", title: "Expected Assist Performance",align: "right", sortable: true, signed: true, format: (v) => { const n = Number(v); return <span style={{ color: n < 0 ? "hsl(0,72%,51%)" : "hsl(160,100%,50%)" }}>{n.toFixed(2)}</span>; }, group: "Assists" },
  // GI group
  { key: "gi",                                  label: "GI",   title: "Goal Involvements (G+A)",            align: "right", sortable: true, compute: (p) => p.goalsScored + p.assists, group: "GI" },
  { key: "expectedGoalInvolvements",            label: "xGI",  title: "Expected Goal Involvements",         align: "right", sortable: true, format: (v) => Number(v).toFixed(2), group: "GI" },
  { key: "expectedGoalInvolvementPerformance",  label: "xGIP", title: "Expected Goal Involvement Performance", align: "right", sortable: true, signed: true, format: (v) => { const n = Number(v); return <span style={{ color: n < 0 ? "hsl(0,72%,51%)" : "hsl(160,100%,50%)" }}>{n.toFixed(2)}</span>; }, group: "GI" },
];

// Track which keys are the first column in their group (for left-border separator)
const GROUP_STARTS = new Set<string>(
  COLUMNS.reduce<string[]>((acc, col, i) => {
    if (col.group && (i === 0 || COLUMNS[i - 1].group !== col.group)) acc.push(col.key);
    return acc;
  }, []),
);

const POSITION_CHIPS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "1",   label: "GKP" },
  { value: "2",   label: "DEF" },
  { value: "3",   label: "MID" },
  { value: "4",   label: "FWD" },
];

function SortIcon({ colKey, sortCol, sortDir }: { colKey: string; sortCol: string; sortDir: SortDir }) {
  if (colKey !== sortCol) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  return sortDir === "desc"
    ? <ChevronDown className="h-3 w-3 text-primary" />
    : <ChevronUp className="h-3 w-3 text-primary" />;
}

function StatusDot({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["n"];
  return (
    <span title={cfg.label} className={cn("inline-block h-2 w-2 rounded-full shrink-0", cfg.dot)} />
  );
}

function shouldAutofocusInput(): boolean {
  if (typeof window === "undefined") return false;
  return !window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
}

function ColHeader({
  col, sortCol, sortDir, onSort,
  className,
}: {
  col: ColDef;
  sortCol: string;
  sortDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
}) {
  return (
    <th
      onClick={() => col.sortable !== false && onSort(col.key)}
      title={col.title ?? col.label}
      className={cn(
        "px-3 text-[10px] uppercase tracking-wider whitespace-nowrap select-none",
        col.align === "right" ? "text-right" : "text-left",
        col.sortable !== false ? "cursor-pointer hover:text-white transition-colors" : "",
        sortCol === col.key ? "font-bold text-white" : "font-medium text-muted-foreground",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1 justify-end w-full">
        {col.label}
        {col.sortable !== false && (
          <SortIcon colKey={col.key} sortCol={sortCol} sortDir={sortDir} />
        )}
      </span>
    </th>
  );
}

export function PlayersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(() => searchParams.get("q") ?? getSavedParam("q"));
  const [position, setPosition] = useState(() => searchParams.get("position") ?? getSavedParam("position", "all"));
  const [team, setTeam] = useState(() => searchParams.get("team") ?? getSavedParam("team", "all"));
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get("status") ?? getSavedParam("status", "all"));
  const [minPrice, setMinPrice] = useState(() => searchParams.get("minPrice") ?? getSavedParam("minPrice"));
  const [maxPrice, setMaxPrice] = useState(() => searchParams.get("maxPrice") ?? getSavedParam("maxPrice"));
  const [minMinutes, setMinMinutes] = useState(() => searchParams.get("minMin") ?? getSavedParam("minMin"));
  const [sortCol, setSortCol] = useState<string>(() => searchParams.get("col") ?? getSavedParam("col", "totalPoints"));
  const [sortDir, setSortDir] = useState<SortDir>(() => (searchParams.get("dir") ?? getSavedParam("dir", "desc")) as SortDir);
  const [fromGW, setFromGW] = useState<string>(() => searchParams.get("fromGW") ?? getSavedParam("fromGW"));
  const [toGW, setToGW] = useState<string>(() => searchParams.get("toGW") ?? getSavedParam("toGW"));

  // Auto-expand on return if any advanced filter was previously active
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(() => {
    return hasActiveAdvancedFilters({
      team: getSavedParam("team", "all"),
      statusFilter: getSavedParam("status", "all"),
      minPrice: getSavedParam("minPrice"),
      maxPrice: getSavedParam("maxPrice"),
      minMinutes: getSavedParam("minMin"),
    });
  });

  const currentParamsKey = getPlayersParamsKey(search, position, team, fromGW, toGW);

  const [state, setState] = useState<AsyncState<PlayerCard[]>>(() => {
    const cached = _playersDataCache.get(currentParamsKey);
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  const [teams, setTeams] = useState<TeamSummary[]>(() => _teamsCache ?? []);
  const [gameweeks, setGameweeks] = useState<GameweekSummary[]>(() => _gameweeksCache ?? []);
  const [xptsLoaded, setXptsLoaded] = useState(() => _xptsCache !== null);

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [tableScrolled, setTableScrolled] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PLAYERS_PAGE_SIZE);
  const handleTableScroll = useCallback(() => {
    setTableScrolled((tableContainerRef.current?.scrollLeft ?? 0) > 12);
  }, []);

  useEffect(() => {
    // xPts — fetch once, populate module-level map, trigger re-render
    if (!_xptsCache) {
      getPlayerXpts()
        .then((data) => {
          _xptsCache = data;
          _xptsMap = new Map(data.map((x) => [x.playerId, x.xpts]));
          setXptsLoaded(true);
        })
        .catch(() => {});
    }
    // Teams — skip if already cached
    if (_teamsCache) {
      setTeams(_teamsCache);
    } else {
      getTeams().then((t) => { _teamsCache = t; setTeams(t); }).catch(() => {});
    }
    // Gameweeks — skip if already cached; only default fromGW/toGW on first load
    if (_gameweeksCache) {
      setGameweeks(_gameweeksCache);
    } else {
      getGameweeks()
        .then((gws) => {
          _gameweeksCache = gws;
          setGameweeks(gws);
          const defaults = getDefaultGameweekRange(gws);
          if (!fromGW && defaults.fromGW) setFromGW(defaults.fromGW);
          if (!toGW && defaults.toGW) setToGW(defaults.toGW);
        })
        .catch(() => {});
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPlayers = useCallback((q: string, pos: string, tm: string, fgw: string, tgw: string, skipCache = false) => {
    const paramsKey = getPlayersParamsKey(q, pos, tm, fgw, tgw);
    const cached = !skipCache ? _playersDataCache.get(paramsKey) : undefined;
    if (cached) {
      setState({ status: "ready", data: cached });
      return;
    }

    setState({ status: "loading" });
    const fetchId = ++_latestFetchId; // claim "latest" — any older in-flight fetch will be discarded
    getPlayers({
      search: q || undefined,
      position: pos !== "all" ? pos : undefined,
      team: tm !== "all" ? tm : undefined,
      fromGW: fgw ? Number(fgw) : undefined,
      toGW: tgw ? Number(tgw) : undefined,
    })
      .then((data) => {
        if (fetchId !== _latestFetchId) return; // stale — a newer fetch already won, discard
        _playersDataCache.set(paramsKey, data);
        setState({ status: "ready", data });
      })
      .catch((e) => {
        if (fetchId !== _latestFetchId) return;
        setState({ status: "error", message: e.message });
      });
  }, []);

  useEffect(() => {
    fetchPlayers(search, position, team, fromGW, toGW);
  }, [search, position, team, fromGW, toGW, fetchPlayers]);

  const handleRefresh = useCallback(() => {
    fetchPlayers(search, position, team, fromGW, toGW, true);
  }, [search, position, team, fromGW, toGW, fetchPlayers]);

  const handleResetFilters = useCallback(() => {
    setSearch("");
    setPosition("all");
    setTeam("all");
    setStatusFilter("all");
    setMinPrice("");
    setMaxPrice("");
      setMinMinutes("");
      setSortCol("totalPoints");
      setSortDir("desc");
    const defaults = getDefaultGameweekRange(gameweeks);
    setToGW(defaults.toGW);
    setFromGW(defaults.fromGW);
    setShowAdvancedFilters(false);
  }, [gameweeks]);

  // Count of active advanced filters (shown as badge on mobile toggle button)
  const activeFilterCount = useMemo(
    () =>
      countActiveAdvancedFilters({
        team,
        statusFilter,
        minPrice,
        maxPrice,
        minMinutes,
      }),
    [team, statusFilter, minPrice, maxPrice, minMinutes],
  );

  useEffect(() => {
    const params = buildPlayersSearchParams({
      search,
      position,
      team,
      statusFilter,
      minPrice,
      maxPrice,
      minMinutes,
      fromGW,
      toGW,
      sortCol,
      sortDir,
    });
    _savedParams = params.toString();
    setSearchParams(params, { replace: true });
  }, [search, position, team, statusFilter, minPrice, maxPrice, minMinutes, fromGW, toGW, sortCol, sortDir, setSearchParams]);

  function handleSort(col: string) {
    if (col === sortCol) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  const players = useMemo(() => {
    if (state.status !== "ready") return [];
    const sorted = filterAndSortPlayers(
      state.data,
      { statusFilter, minPrice, maxPrice, minMinutes },
      { key: sortCol === "xPts" ? "totalPoints" : sortCol, dir: sortDir },
    );
    if (sortCol === "xPts") {
      sorted.sort((a, b) => {
        const av = _xptsMap.get(a.id) ?? -1;
        const bv = _xptsMap.get(b.id) ?? -1;
        return sortDir === "desc" ? bv - av : av - bv;
      });
    }
    return sorted;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, statusFilter, minPrice, maxPrice, minMinutes, sortCol, sortDir, xptsLoaded]);

  const teamImageMap = useMemo(
    () => new Map(teams.map((t) => [t.id, resolveAssetUrl(t.imagePath)])),
    [teams],
  );
  const visiblePlayers = useMemo(
    () => players.slice(0, visibleCount),
    [players, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(PLAYERS_PAGE_SIZE);
  }, [search, position, team, statusFilter, minPrice, maxPrice, minMinutes, fromGW, toGW, sortCol, sortDir, state.status]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || state.status !== "ready" || visibleCount >= players.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisibleCount((count) => Math.min(count + PLAYERS_PAGE_SIZE, players.length));
      },
      { rootMargin: "240px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [visibleCount, players.length, state.status]);

  useEffect(() => {
    if (!shouldAutofocusInput()) return;
    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="flex flex-col gap-5 p-6 lg:p-8 min-h-0">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          Players
        </h1>
        <p className="text-sm text-muted-foreground">Browse and filter all FPL players</p>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2.5 space-y-1.5">

        {/* Row 1: Search + mobile filter toggle */}
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              ref={searchInputRef}
              placeholder="Search players…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn("h-7 pl-8 text-xs", search && "pr-8")}
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(""); searchInputRef.current?.focus(); }}
                aria-label="Clear player search"
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Mobile-only toggle — reveals advanced filters */}
          <button
            type="button"
            onClick={() => setShowAdvancedFilters((v) => !v)}
            className={cn(
              "sm:hidden shrink-0 flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all",
              showAdvancedFilters || activeFilterCount > 0
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-white/8 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white",
            )}
          >
            <SlidersHorizontal className="h-3 w-3" />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Row 2: Position chips — always visible */}
        <div className="flex flex-wrap items-center gap-1">
          {POSITION_CHIPS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setPosition(value)}
              className={cn(
                "h-7 px-2.5 rounded-lg border text-xs font-medium transition-all",
                position === value
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-white/8 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Row 3: Advanced filters — collapsible on mobile, always shown on sm+ */}
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-in-out",
            showAdvancedFilters ? "grid-rows-[1fr]" : "grid-rows-[0fr] sm:grid-rows-[1fr]",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-wrap gap-1.5 pt-0.5">

              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger className="h-7 w-32 px-2.5 text-xs">
                  <SelectValue placeholder="Team" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Teams</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-7 w-28 px-2.5 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="a">Available</SelectItem>
                  <SelectItem value="d">Doubtful</SelectItem>
                  <SelectItem value="i">Injured</SelectItem>
                  <SelectItem value="s">Suspended</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1">
                <Input type="number" placeholder="Min £" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className="h-7 w-16 px-2.5 text-xs" step="0.1" min="0" />
                <span className="text-[10px] text-muted-foreground">–</span>
                <Input type="number" placeholder="Max £" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="h-7 w-16 px-2.5 text-xs" step="0.1" min="0" />
              </div>

              <Input type="number" placeholder="Min mins" value={minMinutes} onChange={(e) => setMinMinutes(e.target.value)} className="h-7 w-20 text-xs" min="0" />

              {/* GW range — shown once gameweeks have loaded */}
              {gameweeks.length > 0 && (
                <div className="flex items-center gap-1">
                  <Select value={fromGW} onValueChange={setFromGW}>
                    <SelectTrigger className="h-7 w-20 px-2.5 text-xs">
                      <SelectValue placeholder="From GW" />
                    </SelectTrigger>
                    <SelectContent>
                      {gameweeks.map((gw) => (
                        <SelectItem key={gw.id} value={String(gw.id)}>GW{gw.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <Select value={toGW} onValueChange={setToGW}>
                    <SelectTrigger className="h-7 w-20 px-2.5 text-xs">
                      <SelectValue placeholder="To GW" />
                    </SelectTrigger>
                    <SelectContent>
                      {gameweeks.map((gw) => (
                        <SelectItem key={gw.id} value={String(gw.id)}>GW{gw.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

            </div>
          </div>
        </div>

      </div>

      {/* ── Action row: count (left) + Reset / Refresh (right) ──────── */}
      <div className="flex items-center justify-between -mt-1">
        {state.status === "ready" ? (
          <p className="text-xs text-muted-foreground">
            {visiblePlayers.length} of {players.length} player{players.length !== 1 ? "s" : ""}
            {search && ` matching "${search}"`}
          </p>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetFilters}
            disabled={state.status === "loading"}
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={state.status === "loading"}
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("h-3 w-3", state.status === "loading" && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {state.status === "loading" && (
        <div className="flex justify-center py-16">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {state.status === "error" && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
          <p className="text-sm text-destructive">{state.message}</p>
        </div>
      )}

      {state.status === "ready" && (
        <div ref={tableContainerRef} onScroll={handleTableScroll} className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/8 bg-secondary/40">
                <th
                  className="sticky left-0 z-10 bg-secondary/60 backdrop-blur-sm text-left text-[10px] uppercase tracking-wider text-muted-foreground font-medium overflow-hidden"
                  style={{
                    minWidth: tableScrolled ? '120px' : '208px',
                    width: tableScrolled ? '120px' : '208px',
                    padding: tableScrolled ? '10px 12px' : '10px 16px',
                    transition: 'min-width 320ms cubic-bezier(0.4,0,0.2,1), width 320ms cubic-bezier(0.4,0,0.2,1), padding 280ms ease',
                  }}
                >
                  Player
                </th>
                {COLUMNS.map((col) => (
                  <ColHeader
                    key={col.key}
                    col={col}
                    sortCol={sortCol}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={cn("py-2.5", GROUP_STARTS.has(col.key) && "border-l border-white/8")}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {players.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="py-16 text-center text-muted-foreground text-sm">
                    <Users className="mx-auto h-8 w-8 mb-2 opacity-40" />
                    No players found
                  </td>
                </tr>
              ) : (
                visiblePlayers.map((player, idx) => {
                  const img = resolveAssetUrl(player.imagePath);
                  const pos = POSITIONS[player.positionId];
                  const teamImg = teamImageMap.get(player.teamId);
                  return (
                    <tr
                      key={player.id}
                      onClick={() => navigate(`/players/${player.id}`)}
                      className={cn(
                        "group cursor-pointer border-b border-white/4 transition-colors hover:bg-white/4",
                        idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.025]",
                      )}
                    >
                      <td
                        className="sticky left-0 z-10 overflow-hidden bg-[hsl(267,70%,5%)] group-hover:bg-[hsl(267,70%,9%)]"
                        style={{
                          minWidth: tableScrolled ? '120px' : '208px',
                          width: tableScrolled ? '120px' : '208px',
                          padding: tableScrolled ? '8px 12px' : '8px 16px',
                          transition: 'min-width 320ms cubic-bezier(0.4,0,0.2,1), width 320ms cubic-bezier(0.4,0,0.2,1), padding 280ms ease, background-color 150ms cubic-bezier(0.4,0,0.2,1)',
                        }}
                      >
                        <div className="flex items-center gap-2.5">
                          {img ? (
                            <img src={img} alt={player.webName} className="h-8 w-8 rounded-md object-cover border border-white/10 bg-secondary shrink-0" />
                          ) : (
                            <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center shrink-0">
                              <Users className="h-3 w-3 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0 overflow-hidden">
                            <div className="flex items-center gap-1.5">
                              {/* Name — shrinks to ~2/3 on scroll */}
                              <span
                                className="font-semibold text-white text-xs truncate"
                                style={{
                                  maxWidth: tableScrolled ? '72px' : '112px',
                                  transition: 'max-width 320ms cubic-bezier(0.4,0,0.2,1)',
                                }}
                              >
                                {player.webName}
                              </span>
                              {/* Position badge — collapses */}
                              <span style={{
                                display: 'inline-flex',
                                overflow: 'hidden',
                                flexShrink: 0,
                                width: tableScrolled ? '0px' : '34px',
                                opacity: tableScrolled ? 0 : 1,
                                transition: 'width 320ms cubic-bezier(0.4,0,0.2,1), opacity 240ms ease',
                              }}>
                                {pos && (
                                  <span className={cn("inline-flex items-center rounded-full border px-1 py-0 text-[9px] font-bold uppercase whitespace-nowrap", pos.color)}>
                                    {pos.short}
                                  </span>
                                )}
                              </span>
                              {/* Status dot — collapses */}
                              <span style={{
                                display: 'inline-flex',
                                overflow: 'hidden',
                                flexShrink: 0,
                                width: tableScrolled ? '0px' : '10px',
                                opacity: tableScrolled ? 0 : 1,
                                transition: 'width 320ms cubic-bezier(0.4,0,0.2,1), opacity 240ms ease',
                              }}>
                                <StatusDot status={player.status} />
                              </span>
                            </div>
                            {/* Team row — collapses */}
                            <div
                              className="flex items-center gap-1 overflow-hidden"
                              style={{
                                maxHeight: tableScrolled ? '0px' : '20px',
                                opacity: tableScrolled ? 0 : 1,
                                transition: 'max-height 320ms cubic-bezier(0.4,0,0.2,1), opacity 240ms ease',
                              }}
                            >
                              {teamImg && <img src={teamImg} alt={player.teamShortName} className="h-3.5 w-3.5 object-contain shrink-0" />}
                              <p className="text-[10px] text-muted-foreground truncate">{player.teamShortName}</p>
                            </div>
                          </div>
                        </div>
                      </td>

                      {COLUMNS.map((col) => {
                        const raw = getPlayerColumnValue(player, col.key);
                        const content = col.format ? col.format(raw, player) : String(raw ?? "—");
                        return (
                          <td
                            key={col.key}
                            style={sortCol === col.key ? { color: "hsl(160,100%,50%)" } : undefined}
                            className={cn(
                              "px-3 py-2 text-xs tabular-nums whitespace-nowrap",
                              col.align === "right" ? "text-right" : "text-left",
                              sortCol === col.key ? "bg-[hsl(342,100%,46%,0.05)]" : "",
                              GROUP_STARTS.has(col.key) && "border-l border-white/8",
                            )}
                          >
                            {content}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {state.status === "ready" && players.length > visiblePlayers.length && (
        <div ref={loadMoreRef} className="flex justify-center py-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/60 border-t-transparent" />
        </div>
      )}
    </div>
  );
}
