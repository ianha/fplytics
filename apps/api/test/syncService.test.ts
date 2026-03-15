import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { SyncService } from "../src/services/syncService.js";
import {
  bootstrapFixture,
  createElementSummaryFixture,
  fixturesFixture,
} from "./fixtures.js";

const tempDirs: string[] = [];
const assetSyncStub = {
  syncBootstrapAssets: vi.fn(async () => ({
    playersDownloaded: 0,
    teamsDownloaded: 0,
    playerPlaceholdersGenerated: 0,
    teamPlaceholdersGenerated: 0,
    playersSkipped: 0,
    teamsSkipped: 0,
  })),
};

function makeDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-api-test-"));
  tempDirs.push(dir);
  return path.join(dir, "test.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SyncService", () => {
  it("noops on a second full sync when the upstream snapshot has not changed", () => {
    const db = createDatabase(makeDbPath());
    const getElementSummary = vi.fn(async (playerId: number) =>
      createElementSummaryFixture(playerId),
    );
    const service = new SyncService(db, {
      getBootstrap: async () => bootstrapFixture,
      getFixtures: async () => fixturesFixture,
      getElementSummary,
    } as any, undefined, assetSyncStub as any);

    return service.syncAll().then(async () => {
      await service.syncAll();

      const players = db.prepare("SELECT COUNT(*) AS count FROM players").get() as {
        count: number;
      };
      const history = db
        .prepare("SELECT COUNT(*) AS count FROM player_history")
        .get() as { count: number };
      const advancedStats = db
        .prepare(
          `SELECT expected_goals AS expectedGoals, expected_assists AS expectedAssists,
                  expected_goal_performance AS expectedGoalPerformance,
                  expected_assist_performance AS expectedAssistPerformance,
                  expected_goal_involvement_performance AS expectedGoalInvolvementPerformance,
                  tackles
           FROM players WHERE id = 10`,
        )
        .get() as {
          expectedGoals: number;
          expectedAssists: number;
          expectedGoalPerformance: number;
          expectedAssistPerformance: number;
          expectedGoalInvolvementPerformance: number;
          tackles: number;
        };

      expect(players.count).toBe(3);
      expect(history.count).toBe(6);
      expect(advancedStats.expectedGoals).toBe(14.6);
      expect(advancedStats.expectedAssists).toBe(11.2);
      expect(advancedStats.expectedGoalPerformance).toBeCloseTo(1.4);
      expect(advancedStats.expectedAssistPerformance).toBeCloseTo(0.8);
      expect(advancedStats.expectedGoalInvolvementPerformance).toBeCloseTo(2.2);
      expect(advancedStats.tackles).toBe(54);
      expect(getElementSummary).toHaveBeenCalledTimes(3);
    });
  });

  it("emits progress logs during a full sync", async () => {
    const db = createDatabase(makeDbPath());
    const info = vi.fn();
    const error = vi.fn();
    const service = new SyncService(
      db,
      {
        getBootstrap: async () => bootstrapFixture,
        getFixtures: async () => fixturesFixture,
        getElementSummary: async (playerId: number) =>
          createElementSummaryFixture(playerId),
      } as any,
      { info, error },
      assetSyncStub as any,
    );

    await service.syncAll();

    expect(info).toHaveBeenCalledWith(expect.stringContaining("Starting full sync"));
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Bootstrap synced: 1 gameweeks, 3 teams, 3 players."),
    );
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("3 player summaries need refresh for the full dataset."),
    );
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Full sync finished successfully. Refreshed 3 player summaries."),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("syncs only players involved in a single gameweek", async () => {
    const db = createDatabase(makeDbPath());
    const getElementSummary = vi.fn(async (playerId: number) =>
      createElementSummaryFixture(playerId),
    );
    const service = new SyncService(db, {
      getBootstrap: async () => bootstrapFixture,
      getFixtures: async () => fixturesFixture,
      getElementSummary,
    } as any, undefined, assetSyncStub as any);

    await service.syncGameweek(1);

    const gameweekPlayers = service.getPlayerIdsForGameweek(1);
    const historyCount = db
      .prepare("SELECT COUNT(*) AS count FROM player_history")
      .get() as { count: number };
    const salahHistory = db
      .prepare("SELECT COUNT(*) AS count FROM player_history WHERE player_id = 11")
      .get() as { count: number };
    const sakaHistory = db
      .prepare(
        `SELECT expected_goals AS expectedGoals, expected_assists AS expectedAssists,
                expected_goal_involvements AS expectedGoalInvolvements,
                expected_goal_performance AS expectedGoalPerformance,
                expected_assist_performance AS expectedAssistPerformance,
                expected_goal_involvement_performance AS expectedGoalInvolvementPerformance,
                tackles
         FROM player_history
         WHERE player_id = 10
         ORDER BY kickoff_time
         LIMIT 1`,
      )
      .get() as {
        expectedGoals: number;
        expectedAssists: number;
        expectedGoalInvolvements: number;
        expectedGoalPerformance: number;
        expectedAssistPerformance: number;
        expectedGoalInvolvementPerformance: number;
        tackles: number;
      };

    expect(gameweekPlayers).toEqual([10, 12]);
    expect(historyCount.count).toBe(4);
    expect(salahHistory.count).toBe(0);
    expect(sakaHistory.expectedGoals).toBe(0.64);
    expect(sakaHistory.expectedAssists).toBe(0.31);
    expect(sakaHistory.expectedGoalInvolvements).toBe(0.95);
    expect(sakaHistory.expectedGoalPerformance).toBeCloseTo(0.36);
    expect(sakaHistory.expectedAssistPerformance).toBeCloseTo(0.69);
    expect(sakaHistory.expectedGoalInvolvementPerformance).toBeCloseTo(1.05);
    expect(sakaHistory.tackles).toBe(4);

    await service.syncGameweek(1);

    expect(getElementSummary).toHaveBeenCalledTimes(2);
  });

  it("resumes a gameweek sync from the point of failure on rerun", async () => {
    const db = createDatabase(makeDbPath());
    const getElementSummary = vi
      .fn<(playerId: number) => Promise<ReturnType<typeof createElementSummaryFixture>>>()
      .mockImplementationOnce(async (playerId: number) =>
        createElementSummaryFixture(playerId),
      )
      .mockImplementationOnce(async () => {
        throw new Error("Temporary upstream failure");
      })
      .mockImplementation(async (playerId: number) =>
        createElementSummaryFixture(playerId),
      );

    const service = new SyncService(db, {
      getBootstrap: async () => bootstrapFixture,
      getFixtures: async () => fixturesFixture,
      getElementSummary,
    } as any, undefined, assetSyncStub as any);

    await expect(service.syncGameweek(1)).rejects.toThrow("Temporary upstream failure");
    await service.syncGameweek(1);

    expect(getElementSummary).toHaveBeenCalledTimes(3);
    expect(getElementSummary.mock.calls.map(([playerId]) => playerId)).toEqual([
      10,
      12,
      12,
    ]);
  });

  it("forces a gameweek refresh when explicitly requested", async () => {
    const db = createDatabase(makeDbPath());
    const getElementSummary = vi.fn(async (playerId: number) =>
      createElementSummaryFixture(playerId),
    );
    const service = new SyncService(db, {
      getBootstrap: async () => bootstrapFixture,
      getFixtures: async () => fixturesFixture,
      getElementSummary,
    } as any, undefined, assetSyncStub as any);

    await service.syncGameweek(1);
    await service.syncGameweek(1, true);

    expect(getElementSummary).toHaveBeenCalledTimes(4);
  });
});
