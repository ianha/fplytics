import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { H2HQueryService } from "../src/services/h2hQueryService.js";
import { QueryService } from "../src/services/queryService.js";
import { seedH2HComparisonData } from "./h2hFixtures.js";

const tempDirs: string[] = [];

function makeDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-h2h-query-"));
  tempDirs.push(dir);
  return path.join(dir, "test.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeService(db: ReturnType<typeof createDatabase>) {
  const queryService = new QueryService(db);
  return new H2HQueryService(db, queryService.getPlayerXpts.bind(queryService));
}

describe("H2HQueryService", () => {
  it("returns overlap, differential players, and rank history for a synced rival", () => {
    const db = createDatabase(makeDbPath());
    seedH2HComparisonData(db);

    const service = makeService(db);
    const response = service.getH2HComparison(1, 99, 501);

    expect(response.syncRequired).toBe(false);
    expect(response.rivalEntry).toMatchObject({
      entryId: 501,
      playerName: "Brad",
      teamName: "Brad FC",
    });
    expect(response.squadOverlap).toMatchObject({
      gameweek: 2,
      overlapPct: 93.3,
    });
    expect(response.squadOverlap?.sharedPlayers).toHaveLength(14);
    expect(response.squadOverlap?.userOnlyPlayers.map((player) => player.webName)).toEqual(["Isak"]);
    expect(response.squadOverlap?.rivalOnlyPlayers.map((player) => player.webName)).toEqual(["Palmer"]);
    expect(response.gmRankHistory).toEqual([
      { gameweek: 1, userOverallRank: 120000, rivalOverallRank: 130000 },
      { gameweek: 2, userOverallRank: 90000, rivalOverallRank: 98000 },
    ]);
  });

  it("returns attribution metrics for captaincy, transfer impact, and bench usage", () => {
    const db = createDatabase(makeDbPath());
    seedH2HComparisonData(db);

    const service = makeService(db);
    const response = service.getH2HComparison(1, 99, 501);

    expect(response.attribution).toEqual({
      totalPointDelta: 6,
      captaincy: {
        userPoints: 17,
        rivalPoints: 14,
        delta: 3,
        shareOfGap: 50,
      },
      transfers: {
        userHitCost: 0,
        rivalHitCost: 4,
        userNetImpact: 10,
        rivalNetImpact: 0,
        delta: 10,
      },
      bench: {
        userPointsOnBench: 11,
        rivalPointsOnBench: 9,
        delta: -2,
      },
    });
  });

  it("returns positional audit rows with spend efficiency and stable edge labels", () => {
    const db = createDatabase(makeDbPath());
    seedH2HComparisonData(db);

    const service = makeService(db);
    const response = service.getH2HComparison(1, 99, 501);

    expect(response.positionalAudit).toEqual({
      rows: [
        {
          positionName: "Goalkeeper",
          userPoints: 34,
          rivalPoints: 31,
          pointDelta: 3,
          userSpend: 19.7,
          rivalSpend: 19.7,
          userValuePerMillion: 1.73,
          rivalValuePerMillion: 1.57,
          valueDelta: 0.16,
          trend: "lead",
        },
        {
          positionName: "Defender",
          userPoints: 20,
          rivalPoints: 20,
          pointDelta: 0,
          userSpend: 13,
          rivalSpend: 13,
          userValuePerMillion: 1.54,
          rivalValuePerMillion: 1.54,
          valueDelta: 0,
          trend: "level",
        },
        {
          positionName: "Midfielder",
          userPoints: 41,
          rivalPoints: 55,
          pointDelta: -14,
          userSpend: 24.6,
          rivalSpend: 35.1,
          userValuePerMillion: 1.67,
          rivalValuePerMillion: 1.57,
          valueDelta: 0.1,
          trend: "trail",
        },
        {
          positionName: "Forward",
          userPoints: 37,
          rivalPoints: 20,
          pointDelta: 17,
          userSpend: 26.7,
          rivalSpend: 18.2,
          userValuePerMillion: 1.39,
          rivalValuePerMillion: 1.1,
          valueDelta: 0.29,
          trend: "lead",
        },
      ],
    });
  });

  it("returns a luck-vs-skill view plus stale sync metadata for the current comparison", () => {
    const db = createDatabase(makeDbPath());
    seedH2HComparisonData(db);

    const service = makeService(db);
    const response = service.getH2HComparison(1, 99, 501);

    expect(response.syncStatus).toMatchObject({
      currentGameweek: 3,
      lastSyncedGw: 2,
      stale: true,
    });
    expect(response.luckVsSkill).toMatchObject({
      basedOnGameweek: 3,
      actualDelta: 6,
      dataQuality: "full",
      missingPlayerProjections: 0,
    });
    expect(response.luckVsSkill?.userExpectedPoints ?? 0).toBeGreaterThan(0);
    expect(response.luckVsSkill?.rivalExpectedPoints ?? 0).toBeGreaterThan(0);
  });

  it("returns syncRequired when rival comparison data has not been synced yet", () => {
    const db = createDatabase(makeDbPath());
    seedH2HComparisonData(db);
    db.prepare("DELETE FROM rival_picks WHERE entry_id = ?").run(501);
    db.prepare("DELETE FROM rival_gameweeks WHERE entry_id = ?").run(501);

    const service = makeService(db);
    const response = service.getH2HComparison(1, 99, 501);

    expect(response).toEqual({
      syncRequired: true,
      rivalEntry: {
        entryId: 501,
        playerName: "Brad",
        teamName: "Brad FC",
        rank: 1,
        totalPoints: 130,
      },
      squadOverlap: null,
      gmRankHistory: [],
      attribution: null,
      positionalAudit: null,
      luckVsSkill: null,
      syncStatus: {
        currentGameweek: 3,
        lastSyncedGw: 2,
        stale: true,
        fetchedAt: expect.any(String),
      },
    });
  });
});
