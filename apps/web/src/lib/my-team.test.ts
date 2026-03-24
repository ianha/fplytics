import { describe, expect, it } from "vitest";
import type { GameweekSummary, LivePlayerPoints } from "@fpl/contracts";
import { computeLivePoints, createMockManagers, evaluatePlanner, replaceSquadPlayer } from "./my-team";
import { makePlayer } from "../test/factories";

const players = [
  ...Array.from({ length: 4 }, (_, index) =>
    makePlayer(index + 1, 1, index + 1, 100 - index, { imagePath: null }),
  ),
  ...Array.from({ length: 8 }, (_, index) =>
    makePlayer(index + 10, 2, (index % 5) + 1, 120 - index, { imagePath: null }),
  ),
  ...Array.from({ length: 8 }, (_, index) =>
    makePlayer(index + 30, 3, (index % 5) + 1, 140 - index, { imagePath: null }),
  ),
  ...Array.from({ length: 5 }, (_, index) =>
    makePlayer(index + 50, 4, (index % 5) + 1, 160 - index, { imagePath: null }),
  ),
];

const gameweeks: GameweekSummary[] = [
  {
    id: 7,
    name: "Gameweek 7",
    deadlineTime: "2026-09-20T10:30:00Z",
    averageEntryScore: 58,
    highestScore: 113,
    isCurrent: true,
    isFinished: false,
  },
];

function makeLivePlayer(playerId: number, totalLivePoints: number): LivePlayerPoints {
  return {
    playerId,
    minutes: 90,
    goals: 0,
    assists: 0,
    cleanSheet: false,
    saves: 0,
    yellowCards: 0,
    redCards: 0,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    goalsConceded: 0,
    bonusProvisional: 0,
    totalLivePoints,
  };
}

describe("computeLivePoints", () => {
  it("sums starter points and excludes bench from totalPoints", () => {
    const picks = [
      { playerId: 1, multiplier: 1, isStarting: true },
      { playerId: 2, multiplier: 1, isStarting: true },
      { playerId: 3, multiplier: 1, isStarting: false }, // bench
    ];
    const live = [
      makeLivePlayer(1, 8),
      makeLivePlayer(2, 5),
      makeLivePlayer(3, 12),
    ];
    const result = computeLivePoints(picks, live);
    expect(result.totalPoints).toBe(13);       // 8 + 5, bench excluded
    expect(result.pointsOnBench).toBe(12);
    expect(result.byPlayerId.get(3)).toBe(12);  // bench player tracked
  });

  it("applies captain multiplier (2×) correctly", () => {
    const picks = [
      { playerId: 10, multiplier: 2, isStarting: true }, // captain
      { playerId: 11, multiplier: 1, isStarting: true },
    ];
    const live = [makeLivePlayer(10, 9), makeLivePlayer(11, 4)];
    const result = computeLivePoints(picks, live);
    expect(result.byPlayerId.get(10)).toBe(18); // 9 × 2
    expect(result.totalPoints).toBe(22);        // 18 + 4
  });

  it("gives 0 points to a player absent from live data (DNP)", () => {
    const picks = [{ playerId: 99, multiplier: 1, isStarting: true }];
    const result = computeLivePoints(picks, []);
    expect(result.totalPoints).toBe(0);
    expect(result.byPlayerId.get(99)).toBe(0);
  });

  it("returns zero totals when picks array is empty", () => {
    const live = [makeLivePlayer(1, 10)];
    const result = computeLivePoints([], live);
    expect(result.totalPoints).toBe(0);
    expect(result.pointsOnBench).toBe(0);
    expect(result.byPlayerId.size).toBe(0);
  });
});

describe("my-team planner utilities", () => {
  it("creates managers with a legal 15-player squad", () => {
    const [manager] = createMockManagers(players, gameweeks);

    expect(manager.squad).toHaveLength(15);
    expect(manager.squad.filter((entry) => entry.player.positionId === 1)).toHaveLength(2);
    expect(manager.squad.filter((entry) => entry.player.positionId === 2)).toHaveLength(5);
    expect(manager.squad.filter((entry) => entry.player.positionId === 3)).toHaveLength(5);
    expect(manager.squad.filter((entry) => entry.player.positionId === 4)).toHaveLength(3);
    expect(manager.squad.filter((entry) => entry.isCaptain)).toHaveLength(1);
    expect(manager.squad.filter((entry) => entry.isViceCaptain)).toHaveLength(1);
  });

  it("flags an over-budget transfer as invalid", () => {
    const [manager] = createMockManagers(players, gameweeks);
    const defender = manager.squad.find((entry) => entry.player.positionId === 2);
    const expensiveDefender = makePlayer(999, 2, 9, 500);
    expensiveDefender.nowCost = 250;

    const workingSquad = replaceSquadPlayer(manager.squad, defender!.slotId, expensiveDefender);
    const evaluation = evaluatePlanner(
      manager.squad,
      workingSquad,
      0,
      manager.freeTransfers,
      manager.currentGameweek,
      manager.currentGameweek,
      "none",
    );

    expect(evaluation.isValid).toBe(false);
    expect(evaluation.warnings.some((warning) => warning.includes("Budget exceeded"))).toBe(true);
  });

  it("treats wildcard planning as hit-free", () => {
    const [manager] = createMockManagers(players, gameweeks);
    const midfielders = manager.squad.filter((entry) => entry.player.positionId === 3).slice(0, 2);
    const candidateA = makePlayer(700, 3, 6, 180);
    const candidateB = makePlayer(701, 3, 7, 179);
    let workingSquad = replaceSquadPlayer(manager.squad, midfielders[0].slotId, candidateA);
    workingSquad = replaceSquadPlayer(workingSquad, midfielders[1].slotId, candidateB);

    const evaluation = evaluatePlanner(
      manager.squad,
      workingSquad,
      manager.bank,
      1,
      manager.currentGameweek,
      manager.currentGameweek,
      "wildcard",
    );

    expect(evaluation.transferCount).toBe(2);
    expect(evaluation.hitCost).toBe(0);
  });
});
