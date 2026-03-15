import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { QueryService } from "../src/services/queryService.js";
import { SyncService } from "../src/services/syncService.js";
import {
  bootstrapFixture,
  createElementSummaryFixture,
  fixturesFixture,
} from "./fixtures.js";

let tempDir = "";

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-api-app-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("API routes", () => {
  it("returns queryable overview data for the API layer", async () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    const assetSyncStub = {
      syncBootstrapAssets: async () => ({
        playersDownloaded: 0,
        teamsDownloaded: 0,
        playerPlaceholdersGenerated: 0,
        teamPlaceholdersGenerated: 0,
        playersSkipped: 0,
        teamsSkipped: 0,
      }),
    };
    const syncService = new SyncService(db, {
      getBootstrap: async () => bootstrapFixture,
      getFixtures: async () => fixturesFixture,
      getElementSummary: async (playerId: number) =>
        createElementSummaryFixture(playerId),
    } as any, undefined, assetSyncStub as any);
    await syncService.syncAll();

    const queryService = new QueryService(db);
    const response = queryService.getOverview();
    const playerDetail = queryService.getPlayerById(10);

    expect(response.topPlayers[0].webName).toBe("Salah");
    expect(response.fixtures[0].teamHShortName).toBe("ARS");
    expect(playerDetail?.player.expectedGoals).toBe(14.6);
    expect(playerDetail?.player.expectedGoalInvolvements).toBe(25.8);
    expect(playerDetail?.player.expectedGoalPerformance).toBeCloseTo(1.4);
    expect(playerDetail?.player.expectedAssistPerformance).toBeCloseTo(0.8);
    expect(playerDetail?.player.expectedGoalInvolvementPerformance).toBeCloseTo(2.2);
    expect(playerDetail?.history.some((history) => history.tackles === 2)).toBe(true);
  });
});
