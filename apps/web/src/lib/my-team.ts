import type { GameweekSummary, LivePlayerPoints, PlayerCard } from "@fpl/contracts";

export type PlannerChip = "none" | "wildcard" | "free-hit" | "bench-boost" | "triple-captain";

export type SquadEntry = {
  slotId: string;
  player: PlayerCard;
  role: "starter" | "bench";
  benchOrder: number | null;
  isCaptain: boolean;
  isViceCaptain: boolean;
};

export type TransferRecord = {
  id: string;
  gameweek: number;
  madeAt: string;
  playerOut: PlayerCard;
  playerIn: PlayerCard;
  cost: number;
  bankAfter: number;
};

export type SeasonSummary = {
  season: string;
  overallPoints: number;
  overallRank: number;
  bestRank: number;
  gameweeksPlayed: number;
};

export type HistoryRow = {
  gameweek: number;
  points: number;
  rank: number;
  overallPoints: number;
  teamValue: number;
  bank: number;
};

export type MockManager = {
  id: string;
  name: string;
  email: string;
  teamName: string;
  currentGameweek: number;
  overallRank: number;
  overallPoints: number;
  bank: number;
  freeTransfers: number;
  squad: SquadEntry[];
  transfers: TransferRecord[];
  seasons: SeasonSummary[];
  history: HistoryRow[];
};

export type PlannerEvaluation = {
  transferCount: number;
  freeTransfers: number;
  hitCost: number;
  remainingBank: number;
  warnings: string[];
  isValid: boolean;
};

const REQUIRED_COUNTS: Record<number, number> = {
  1: 2,
  2: 5,
  3: 5,
  4: 3,
};

const STARTER_COUNTS: Record<number, number> = {
  1: 1,
  2: 3,
  3: 4,
  4: 3,
};

function clampFreeTransfers(value: number) {
  return Math.max(1, Math.min(5, value));
}

function byMerit(left: PlayerCard, right: PlayerCard) {
  return (
    right.totalPoints - left.totalPoints ||
    right.form - left.form ||
    right.expectedGoalInvolvements - left.expectedGoalInvolvements
  );
}

function takePlayersForPosition(
  players: PlayerCard[],
  count: number,
  offset: number,
  clubCounts: Map<number, number>,
) {
  const pool = [...players].sort(byMerit);
  const rotated = pool.slice(offset).concat(pool.slice(0, offset));
  const selected: PlayerCard[] = [];

  for (const player of rotated) {
    const currentClubCount = clubCounts.get(player.teamId) ?? 0;
    if (currentClubCount >= 3) continue;
    selected.push(player);
    clubCounts.set(player.teamId, currentClubCount + 1);
    if (selected.length === count) return selected;
  }

  for (const player of rotated) {
    if (selected.some((candidate) => candidate.id === player.id)) continue;
    selected.push(player);
    if (selected.length === count) return selected;
  }

  return selected;
}

function buildSquad(players: PlayerCard[], offset: number) {
  const clubCounts = new Map<number, number>();
  const byPosition = new Map<number, PlayerCard[]>();

  for (const player of players) {
    const current = byPosition.get(player.positionId) ?? [];
    current.push(player);
    byPosition.set(player.positionId, current);
  }

  const picked: PlayerCard[] = [];
  for (const [positionId, requiredCount] of Object.entries(REQUIRED_COUNTS)) {
    picked.push(
      ...takePlayersForPosition(
        byPosition.get(Number(positionId)) ?? [],
        requiredCount,
        offset,
        clubCounts,
      ),
    );
  }

  const squad: SquadEntry[] = [];
  const startersUsed: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const benchUsed: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  const ordered = [...picked].sort((left, right) => {
    if (left.positionId !== right.positionId) return left.positionId - right.positionId;
    return byMerit(left, right);
  });

  for (const player of ordered) {
    const starterLimit = STARTER_COUNTS[player.positionId] ?? 0;
    const asStarter = startersUsed[player.positionId] < starterLimit;
    if (asStarter) {
      startersUsed[player.positionId] += 1;
    } else {
      benchUsed[player.positionId] += 1;
    }

    squad.push({
      slotId: `${asStarter ? "starter" : "bench"}-${player.positionId}-${asStarter ? startersUsed[player.positionId] : benchUsed[player.positionId]}`,
      player,
      role: asStarter ? "starter" : "bench",
      benchOrder: asStarter ? null : player.positionId === 1 ? 4 : benchUsed[player.positionId],
      isCaptain: false,
      isViceCaptain: false,
    });
  }

  const captain = squad
    .filter((entry) => entry.role === "starter")
    .sort((left, right) => byMerit(left.player, right.player))[0];
  const viceCaptain = squad
    .filter((entry) => entry.role === "starter" && entry.player.id !== captain?.player.id)
    .sort((left, right) => byMerit(left.player, right.player))[0];

  if (captain) captain.isCaptain = true;
  if (viceCaptain) viceCaptain.isViceCaptain = true;

  return squad.sort((left, right) => {
    if (left.role !== right.role) return left.role === "starter" ? -1 : 1;
    if (left.role === "bench" && right.role === "bench") {
      return (left.benchOrder ?? 99) - (right.benchOrder ?? 99);
    }
    if (left.player.positionId !== right.player.positionId) {
      return left.player.positionId - right.player.positionId;
    }
    return byMerit(left.player, right.player);
  });
}

function buildTransferHistory(squad: SquadEntry[], currentGameweek: number, bank: number) {
  const starters = squad.filter((entry) => entry.role === "starter");
  const bench = squad.filter((entry) => entry.role === "bench");

  if (starters.length < 3 || bench.length < 2) return [];

  return [
    {
      id: "tr-1",
      gameweek: Math.max(1, currentGameweek - 1),
      madeAt: new Date(2026, 7, 18, 18, 35).toISOString(),
      playerOut: bench[1].player,
      playerIn: starters[3].player,
      cost: 0,
      bankAfter: bank + bench[1].player.nowCost - starters[3].player.nowCost,
    },
    {
      id: "tr-2",
      gameweek: Math.max(1, currentGameweek - 3),
      madeAt: new Date(2026, 7, 4, 19, 10).toISOString(),
      playerOut: starters[0].player,
      playerIn: bench[0].player,
      cost: 4,
      bankAfter: bank + starters[0].player.nowCost - bench[0].player.nowCost - 4,
    },
  ];
}

function buildSeasonSummaries(points: number, rank: number) {
  return [
    {
      season: "2026/27",
      overallPoints: points,
      overallRank: rank,
      bestRank: Math.floor(rank * 0.74),
      gameweeksPlayed: 8,
    },
    {
      season: "2025/26",
      overallPoints: points - 156,
      overallRank: rank + 148_232,
      bestRank: Math.floor(rank * 0.93),
      gameweeksPlayed: 38,
    },
    {
      season: "2024/25",
      overallPoints: points - 214,
      overallRank: rank + 318_114,
      bestRank: Math.floor(rank * 1.04),
      gameweeksPlayed: 38,
    },
  ];
}

function buildHistory(currentGameweek: number, overallPoints: number, rank: number, teamValue: number, bank: number) {
  return Array.from({ length: 5 }, (_, index) => {
    const gw = Math.max(1, currentGameweek - index);
    return {
      gameweek: gw,
      points: 54 + ((gw * 7) % 21),
      rank: rank + index * 18_250,
      overallPoints: overallPoints - index * 11,
      teamValue: teamValue - index,
      bank: Math.max(0, bank - index * 2),
    };
  }).reverse();
}

export function createMockManagers(players: PlayerCard[], gameweeks: GameweekSummary[]): MockManager[] {
  const currentGameweek =
    gameweeks.find((gameweek) => gameweek.isCurrent)?.id ??
    gameweeks.find((gameweek) => !gameweek.isFinished)?.id ??
    gameweeks.at(-1)?.id ??
    1;

  const managerSeeds = [
    {
      id: "mgr-1",
      name: "Ian Harper",
      email: "ian@fpl.local",
      teamName: "Midnight Press FC",
      overallRank: 121_482,
      overallPoints: 612,
      bank: 16,
      freeTransfers: 2,
      offset: 0,
    },
    {
      id: "mgr-2",
      name: "Harper Labs",
      email: "labs@fpl.local",
      teamName: "Teal Arrow XI",
      overallRank: 398_104,
      overallPoints: 574,
      bank: 9,
      freeTransfers: 1,
      offset: 2,
    },
  ];

  return managerSeeds.map((seed) => {
    const squad = buildSquad(players, seed.offset);
    const teamValue = squad.reduce((sum, entry) => sum + entry.player.nowCost, 0);
    return {
      id: seed.id,
      name: seed.name,
      email: seed.email,
      teamName: seed.teamName,
      currentGameweek,
      overallRank: seed.overallRank,
      overallPoints: seed.overallPoints,
      bank: seed.bank,
      freeTransfers: seed.freeTransfers,
      squad,
      transfers: buildTransferHistory(squad, currentGameweek, seed.bank),
      seasons: buildSeasonSummaries(seed.overallPoints, seed.overallRank),
      history: buildHistory(currentGameweek, seed.overallPoints, seed.overallRank, teamValue, seed.bank),
    };
  });
}

export function getAvailableCandidates(
  allPlayers: PlayerCard[],
  squad: SquadEntry[],
  slot: SquadEntry | null,
) {
  if (!slot) return [];
  const squadPlayerIds = new Set(squad.map((entry) => entry.player.id));
  return allPlayers
    .filter(
      (player) =>
        player.positionId === slot.player.positionId && !squadPlayerIds.has(player.id),
    )
    .sort(byMerit)
    .slice(0, 24);
}

export function replaceSquadPlayer(
  squad: SquadEntry[],
  slotId: string,
  incoming: PlayerCard,
) {
  return squad.map((entry) =>
    entry.slotId === slotId
      ? {
          ...entry,
          player: incoming,
        }
      : entry,
  );
}

export function computeLivePoints(
  picks: Array<{ playerId: number; multiplier: number; isStarting: boolean }>,
  liveData: LivePlayerPoints[],
): { totalPoints: number; pointsOnBench: number; byPlayerId: Map<number, number> } {
  const liveMap = new Map(liveData.map((p) => [p.playerId, p.totalLivePoints]));
  const byPlayerId = new Map<number, number>();
  let totalPoints = 0;
  let pointsOnBench = 0;
  for (const pick of picks) {
    const pts = (liveMap.get(pick.playerId) ?? 0) * pick.multiplier;
    byPlayerId.set(pick.playerId, pts);
    if (pick.isStarting) totalPoints += pts;
    else pointsOnBench += pts;
  }
  return { totalPoints, pointsOnBench, byPlayerId };
}

export function evaluatePlanner(
  originalSquad: SquadEntry[],
  workingSquad: SquadEntry[],
  bank: number,
  baseFreeTransfers: number,
  currentGameweek: number,
  selectedGameweek: number,
  chip: PlannerChip,
): PlannerEvaluation {
  const originalBySlot = new Map(originalSquad.map((entry) => [entry.slotId, entry]));
  const changedEntries = workingSquad.filter((entry) => {
    const originalEntry = originalBySlot.get(entry.slotId);
    return originalEntry && originalEntry.player.id !== entry.player.id;
  });

  const transferCount = changedEntries.length;
  const outgoingCost = changedEntries.reduce((sum, entry) => {
    const originalEntry = originalBySlot.get(entry.slotId);
    return sum + (originalEntry?.player.nowCost ?? 0);
  }, 0);
  const incomingCost = changedEntries.reduce((sum, entry) => sum + entry.player.nowCost, 0);
  const remainingBank = bank + outgoingCost - incomingCost;
  const rolledFreeTransfers = clampFreeTransfers(
    baseFreeTransfers + Math.max(0, selectedGameweek - currentGameweek),
  );

  const freeTransfers =
    chip === "wildcard" || chip === "free-hit" ? Math.max(transferCount, rolledFreeTransfers) : rolledFreeTransfers;
  const hitCost =
    chip === "wildcard" || chip === "free-hit"
      ? 0
      : Math.max(0, transferCount - freeTransfers) * 4;

  const warnings: string[] = [];
  if (remainingBank < 0) {
    warnings.push("Budget exceeded. Sell value no longer covers the proposed moves.");
  }

  const positionCounts = workingSquad.reduce<Record<number, number>>((counts, entry) => {
    counts[entry.player.positionId] = (counts[entry.player.positionId] ?? 0) + 1;
    return counts;
  }, {});
  for (const [positionId, requiredCount] of Object.entries(REQUIRED_COUNTS)) {
    if ((positionCounts[Number(positionId)] ?? 0) !== requiredCount) {
      warnings.push("Squad composition must stay at 2 GKP, 5 DEF, 5 MID, and 3 FWD.");
      break;
    }
  }

  const clubCounts = workingSquad.reduce<Map<number, number>>((counts, entry) => {
    counts.set(entry.player.teamId, (counts.get(entry.player.teamId) ?? 0) + 1);
    return counts;
  }, new Map<number, number>());
  for (const [, count] of clubCounts) {
    if (count > 3) {
      warnings.push("You can only own three players from a single Premier League club.");
      break;
    }
  }

  if (chip === "free-hit") {
    warnings.push("Free Hit simulation resets after the selected gameweek on the real game.");
  }
  if (chip === "triple-captain") {
    warnings.push("Triple Captain is modeled locally only and does not affect real captaincy on FPL.");
  }

  return {
    transferCount,
    freeTransfers,
    hitCost,
    remainingBank,
    warnings,
    isValid: warnings.every((warning) => !warning.startsWith("Budget exceeded") && !warning.startsWith("Squad composition") && !warning.startsWith("You can only own")),
  };
}
