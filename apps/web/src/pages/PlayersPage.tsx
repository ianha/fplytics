import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { PlayerCard, TeamSummary } from "@fpl/contracts";
import { getPlayers, getTeams, resolveAssetUrl } from "@/api/client";
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
import { Search, Users, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

type SortDir = "asc" | "desc";

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
  key: string;
  label: string;
  title?: string;
  align?: "right" | "left";
  sortable?: boolean;
  format?: (v: any, player: PlayerCard) => React.ReactNode;
  group?: string;
  compute?: (player: PlayerCard) => number;
};

const COLUMNS: ColDef[] = [
  { key: "nowCost",           label: "Price",  align: "right", sortable: true, format: (v) => formatCost(v) },
  { key: "totalPoints",       label: "Pts",    title: "Total Points",   align: "right", sortable: true, format: (v) => <span className="text-accent font-bold">{v}</span> },
  { key: "pointsPerGame",     label: "PPG",    title: "Points Per Game", align: "right", sortable: true, format: (v) => Number(v).toFixed(1) },
  { key: "form",              label: "Form",   align: "right", sortable: true, format: (v) => Number(v).toFixed(1) },
  { key: "selectedByPercent", label: "Sel%",   title: "Selected By %",  align: "right", sortable: true, format: (v) => formatPercent(Number(v)) },
  { key: "minutes",           label: "Min",    title: "Minutes Played", align: "right", sortable: true, format: (v) => v.toLocaleString() },
  { key: "starts",            label: "Starts", align: "right", sortable: true },
  { key: "cleanSheets",       label: "CS",     title: "Clean Sheets",   align: "right", sortable: true },
  { key: "bonus",             label: "Bonus",  align: "right", sortable: true },
  { key: "defensiveContribution", label: "DC", title: "Defensive Contribution", align: "right", sortable: true },
  // Goals group
  { key: "goalsScored",              label: "G",   title: "Goals",                    align: "right", sortable: true, group: "Goals" },
  { key: "expectedGoals",            label: "xG",  title: "Expected Goals",           align: "right", sortable: true, format: (v) => Number(v).toFixed(2), group: "Goals" },
  { key: "expectedGoalPerformance",  label: "xGP", title: "Expected Goal Performance",align: "right", sortable: true, format: (v) => Number(v).toFixed(2), group: "Goals" },
  // Assists group
  { key: "assists",                   label: "A",   title: "Assists",                    align: "right", sortable: true, group: "Assists" },
  { key: "expectedAssists",           label: "xA",  title: "Expected Assists",           align: "right", sortable: true, format: (v) => Number(v).toFixed(2), group: "Assists" },
  { key: "expectedAssistPerformance", label: "xAP", title: "Expected Assist Performance",align: "right", sortable: true, format: (v) => Number(v).toFixed(2), group: "Assists" },
  // GI group
  { key: "gi",                                  label: "GI",   title: "Goal Involvements (G+A)",            align: "right", sortable: true, compute: (p) => p.goalsScored + p.assists, group: "GI" },
  { key: "expectedGoalInvolvements",            label: "xGI",  title: "Expected Goal Involvements",         align: "right", sortable: true, format: (v) => <span className="text-primary">{Number(v).toFixed(2)}</span>, group: "GI" },
  { key: "expectedGoalInvolvementPerformance",  label: "xGIP", title: "Expected Goal Involvement Performance", align: "right", sortable: true, format: (v) => Number(v).toFixed(2), group: "GI" },
];

// Track which keys are the first column in their group (for left-border separator)
const GROUP_STARTS = new Set<string>(
  COLUMNS.reduce<string[]>((acc, col, i) => {
    if (col.group && (i === 0 || COLUMNS[i - 1].group !== col.group)) acc.push(col.key);
    return acc;
  }, []),
);

function getColValue(player: PlayerCard, col: ColDef): number | string {
  if (col.compute) return col.compute(player);
  return (player as any)[col.key] ?? 0;
}

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
        "px-3 text-[10px] uppercase tracking-wider font-medium whitespace-nowrap select-none",
        col.align === "right" ? "text-right" : "text-left",
        col.sortable !== false ? "cursor-pointer hover:text-white transition-colors" : "",
        sortCol === col.key ? "text-white" : "text-muted-foreground",
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

  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [position, setPosition] = useState(searchParams.get("position") ?? "all");
  const [team, setTeam] = useState(searchParams.get("team") ?? "all");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "all");
  const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") ?? "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") ?? "");
  const [minMinutes, setMinMinutes] = useState(searchParams.get("minMin") ?? "");
  const [sortCol, setSortCol] = useState<string>(searchParams.get("col") ?? "totalPoints");
  const [sortDir, setSortDir] = useState<SortDir>((searchParams.get("dir") as SortDir) ?? "desc");

  const [state, setState] = useState<AsyncState<PlayerCard[]>>({ status: "loading" });
  const [teams, setTeams] = useState<TeamSummary[]>([]);

  useEffect(() => {
    getTeams().then(setTeams).catch(() => {});
  }, []);

  const fetchPlayers = useCallback((q: string, pos: string, tm: string) => {
    setState({ status: "loading" });
    getPlayers({
      search: q || undefined,
      position: pos !== "all" ? pos : undefined,
      team: tm !== "all" ? tm : undefined,
    })
      .then((data) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: "error", message: e.message }));
  }, []);

  useEffect(() => {
    fetchPlayers(search, position, team);
  }, [search, position, team, fetchPlayers]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (position !== "all") p.set("position", position);
    if (team !== "all") p.set("team", team);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (minPrice) p.set("minPrice", minPrice);
    if (maxPrice) p.set("maxPrice", maxPrice);
    if (minMinutes) p.set("minMin", minMinutes);
    if (sortCol !== "totalPoints") p.set("col", sortCol);
    if (sortDir !== "desc") p.set("dir", sortDir);
    setSearchParams(p, { replace: true });
  }, [search, position, team, statusFilter, minPrice, maxPrice, minMinutes, sortCol, sortDir, setSearchParams]);

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
    let list = state.data;

    if (statusFilter !== "all") list = list.filter((p) => p.status === statusFilter);
    if (minPrice) { const min = parseFloat(minPrice) * 10; list = list.filter((p) => p.nowCost >= min); }
    if (maxPrice) { const max = parseFloat(maxPrice) * 10; list = list.filter((p) => p.nowCost <= max); }
    if (minMinutes) { const min = parseInt(minMinutes, 10); list = list.filter((p) => p.minutes >= min); }

    const colDef = COLUMNS.find((c) => c.key === sortCol);
    list = [...list].sort((a, b) => {
      const aVal = colDef ? getColValue(a, colDef) : (a as any)[sortCol] ?? 0;
      const bVal = colDef ? getColValue(b, colDef) : (b as any)[sortCol] ?? 0;
      const aNum = Number(aVal);
      const bNum = Number(bVal);
      const diff = isNaN(aNum) || isNaN(bNum)
        ? String(aVal).localeCompare(String(bVal))
        : aNum - bNum;
      return sortDir === "desc" ? -diff : diff;
    });

    return list;
  }, [state, statusFilter, minPrice, maxPrice, minMinutes, sortCol, sortDir]);

  return (
    <div className="flex flex-col gap-5 p-6 lg:p-8 min-h-0">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          Players
        </h1>
        <p className="text-sm text-muted-foreground">Browse and filter all FPL players</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input placeholder="Search players…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={position} onValueChange={setPosition}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Position" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Positions</SelectItem>
            <SelectItem value="1">Goalkeeper</SelectItem>
            <SelectItem value="2">Defender</SelectItem>
            <SelectItem value="3">Midfielder</SelectItem>
            <SelectItem value="4">Forward</SelectItem>
          </SelectContent>
        </Select>
        <Select value={team} onValueChange={setTeam}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Team" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Teams</SelectItem>
            {teams.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="a">Available</SelectItem>
            <SelectItem value="d">Doubtful</SelectItem>
            <SelectItem value="i">Injured</SelectItem>
            <SelectItem value="s">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Input type="number" placeholder="Min £" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className="w-20 h-9 text-sm" step="0.1" min="0" />
          <span className="text-muted-foreground text-xs">–</span>
          <Input type="number" placeholder="Max £" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="w-20 h-9 text-sm" step="0.1" min="0" />
        </div>
        <Input type="number" placeholder="Min mins" value={minMinutes} onChange={(e) => setMinMinutes(e.target.value)} className="w-24 h-9 text-sm" min="0" />
      </div>

      {state.status === "ready" && (
        <p className="text-xs text-muted-foreground -mt-1">
          {players.length} player{players.length !== 1 ? "s" : ""}
          {search && ` matching "${search}"`}
        </p>
      )}

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
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/8 bg-secondary/40">
                <th className="sticky left-0 z-10 bg-secondary/60 backdrop-blur-sm px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-medium min-w-52">
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
                players.map((player, idx) => {
                  const img = resolveAssetUrl(player.imagePath);
                  const pos = POSITIONS[player.positionId];
                  return (
                    <tr
                      key={player.id}
                      onClick={() => navigate(`/players/${player.id}`)}
                      className={cn(
                        "group cursor-pointer border-b border-white/4 transition-colors hover:bg-white/4",
                        idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.025]",
                      )}
                    >
                      <td className="sticky left-0 z-10 px-4 py-2 bg-[hsl(267,70%,5%)] group-hover:bg-[hsl(267,70%,9%)] transition-colors">
                        <div className="flex items-center gap-2.5">
                          {img ? (
                            <img src={img} alt={player.webName} className="h-8 w-8 rounded-md object-cover border border-white/10 bg-secondary shrink-0" />
                          ) : (
                            <div className="h-8 w-8 rounded-md bg-secondary flex items-center justify-center shrink-0">
                              <Users className="h-3 w-3 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-white text-xs truncate max-w-28">{player.webName}</span>
                              {pos && (
                                <span className={cn("shrink-0 inline-flex items-center rounded-full border px-1 py-0 text-[9px] font-bold uppercase", pos.color)}>
                                  {pos.short}
                                </span>
                              )}
                              <StatusDot status={player.status} />
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate max-w-28">{player.teamShortName}</p>
                          </div>
                        </div>
                      </td>

                      {COLUMNS.map((col) => {
                        const raw = col.compute ? col.compute(player) : (player as any)[col.key];
                        const content = col.format ? col.format(raw, player) : String(raw ?? "—");
                        return (
                          <td
                            key={col.key}
                            className={cn(
                              "px-3 py-2 text-xs tabular-nums whitespace-nowrap",
                              col.align === "right" ? "text-right" : "text-left",
                              sortCol === col.key ? "bg-primary/5" : "",
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
    </div>
  );
}
