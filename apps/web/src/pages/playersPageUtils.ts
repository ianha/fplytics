import type { GameweekSummary, PlayerCard } from "@fpl/contracts";

export type SortDir = "asc" | "desc";
export type PlayerComputedColumnKey = "gi";
export type PlayerColumnKey =
  | "nowCost"
  | "totalPoints"
  | "pointsPerGame"
  | "form"
  | "selectedByPercent"
  | "minutes"
  | "starts"
  | "cleanSheets"
  | "bonus"
  | "defensiveContribution"
  | "goalsScored"
  | "expectedGoals"
  | "expectedGoalPerformance"
  | "assists"
  | "expectedAssists"
  | "expectedAssistPerformance"
  | PlayerComputedColumnKey
  | "expectedGoalInvolvements"
  | "expectedGoalInvolvementPerformance"
  | "xPts";

type PlayersSearchParamState = {
  search: string;
  position: string;
  team: string;
  statusFilter: string;
  minPrice: string;
  maxPrice: string;
  minMinutes: string;
  fromGW: string;
  toGW: string;
  sortCol: string;
  sortDir: SortDir;
};

export function getPlayersParamsKey(
  search: string,
  position: string,
  team: string,
  fromGW: string,
  toGW: string,
): string {
  return [search || "", position, team, fromGW, toGW].join("|");
}

export function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasActiveAdvancedFilters(filters: {
  team: string;
  statusFilter: string;
  minPrice: string;
  maxPrice: string;
  minMinutes: string;
}): boolean {
  return countActiveAdvancedFilters(filters) > 0;
}

export function countActiveAdvancedFilters(filters: {
  team: string;
  statusFilter: string;
  minPrice: string;
  maxPrice: string;
  minMinutes: string;
}): number {
  return [
    filters.team !== "all",
    filters.statusFilter !== "all",
    !!filters.minPrice,
    !!filters.maxPrice,
    !!filters.minMinutes,
  ].filter(Boolean).length;
}

export function getDefaultGameweekRange(gameweeks: GameweekSummary[]): {
  fromGW: string;
  toGW: string;
} {
  const current =
    gameweeks.find((gameweek) => gameweek.isCurrent) ??
    gameweeks.filter((gameweek) => gameweek.isFinished).at(-1) ??
    gameweeks[0];

  return {
    fromGW: gameweeks[0] ? String(gameweeks[0].id) : "",
    toGW: current ? String(current.id) : "",
  };
}

export function buildPlayersSearchParams(state: PlayersSearchParamState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search) params.set("q", state.search);
  if (state.position !== "all") params.set("position", state.position);
  if (state.team !== "all") params.set("team", state.team);
  if (state.statusFilter !== "all") params.set("status", state.statusFilter);
  if (state.minPrice) params.set("minPrice", state.minPrice);
  if (state.maxPrice) params.set("maxPrice", state.maxPrice);
  if (state.minMinutes) params.set("minMin", state.minMinutes);
  if (state.fromGW) params.set("fromGW", state.fromGW);
  if (state.toGW) params.set("toGW", state.toGW);
  if (state.sortCol !== "totalPoints") params.set("col", state.sortCol);
  if (state.sortDir !== "desc") params.set("dir", state.sortDir);
  return params;
}

export function getPlayerColumnValue(
  player: PlayerCard,
  key: PlayerColumnKey,
): number | string {
  if (key === "gi") {
    return player.goalsScored + player.assists;
  }

  if (key === "xPts") {
    // xPts comes from external API, not PlayerCard — returns 0 as fallback for sort
    return 0;
  }

  return player[key];
}

export function filterAndSortPlayers(
  players: PlayerCard[],
  filters: {
    statusFilter: string;
    minPrice: string;
    maxPrice: string;
    minMinutes: string;
  },
  sort: {
    key: PlayerColumnKey | string;
    dir: SortDir;
  },
): PlayerCard[] {
  const minPrice = parseOptionalNumber(filters.minPrice);
  const maxPrice = parseOptionalNumber(filters.maxPrice);
  const minMinutes = parseOptionalNumber(filters.minMinutes);

  let nextPlayers = players;
  if (filters.statusFilter !== "all") {
    nextPlayers = nextPlayers.filter((player) => player.status === filters.statusFilter);
  }
  if (minPrice !== null) {
    nextPlayers = nextPlayers.filter((player) => player.nowCost >= minPrice * 10);
  }
  if (maxPrice !== null) {
    nextPlayers = nextPlayers.filter((player) => player.nowCost <= maxPrice * 10);
  }
  if (minMinutes !== null) {
    nextPlayers = nextPlayers.filter((player) => player.minutes >= minMinutes);
  }

  return [...nextPlayers].sort((left, right) => {
    const leftValue =
      sort.key in left
        ? left[sort.key as keyof PlayerCard]
        : getPlayerColumnValue(left, sort.key as PlayerColumnKey);
    const rightValue =
      sort.key in right
        ? right[sort.key as keyof PlayerCard]
        : getPlayerColumnValue(right, sort.key as PlayerColumnKey);

    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    const diff =
      Number.isNaN(leftNumber) || Number.isNaN(rightNumber)
        ? String(leftValue).localeCompare(String(rightValue))
        : leftNumber - rightNumber;

    return sort.dir === "desc" ? -diff : diff;
  });
}
