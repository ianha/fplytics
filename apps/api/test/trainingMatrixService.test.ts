import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { TrainingMatrixService } from "../src/services/trainingMatrixService.js";
import { now, seedPublicData } from "./myTeamFixtures.js";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-training-matrix-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function seedTrainingMatrixScenario(db: ReturnType<typeof createDatabase>) {
  seedPublicData(db);

  db.prepare(
    `INSERT INTO teams (id, code, name, short_name, strength, updated_at) VALUES
      (3, 43, 'Chelsea', 'CHE', 4, ?),
      (4, 6, 'Spurs', 'TOT', 3, ?)`,
  ).run(now(), now());

  const insertHistory = db.prepare(
    `INSERT INTO player_history (
      player_id, round, total_points, minutes, goals_scored, assists, clean_sheets, bonus, bps, creativity,
      influence, threat, ict_index, expected_goals, expected_assists, expected_goal_involvements,
      expected_goal_performance, expected_assist_performance, expected_goal_involvement_performance,
      expected_goals_conceded, tackles, recoveries, clearances_blocks_interceptions, defensive_contribution,
      saves, yellow_cards, red_cards, own_goals, penalties_saved, penalties_missed, goals_conceded, starts,
      opponent_team, team_id, value, was_home, kickoff_time, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  insertHistory.run(
    10, 5, 6, 80, 0, 1, 0, 1, 20, 11,
    15, 12, 4, 0.20, 0.10, 0.30, 0, 0, 0, 1.00, 1, 3, 1, 2,
    0, 0, 0, 0, 0, 0, 1, 1, 2, 1, 104, 1, "2026-03-10T15:00:00.000Z", now(),
  );
  insertHistory.run(
    10, 6, 8, 90, 1, 0, 1, 2, 30, 14,
    18, 17, 5, 0.60, 0.20, 0.80, 0, 0, 0, 0.80, 1, 4, 1, 2,
    0, 0, 0, 0, 0, 0, 0, 1, 3, 1, 105, 0, "2026-03-17T15:00:00.000Z", now(),
  );

  insertHistory.run(
    10, 7, 10, 90, 1, 1, 0, 3, 35, 20,
    22, 23, 7, 0.90, 0.35, 1.25, 0, 0, 0, 0.70, 1, 3, 1, 2,
    0, 0, 0, 0, 0, 0, 1, 1, 2, 1, 106, 1, "2026-03-24T15:00:00.000Z", now(),
  );
  insertHistory.run(
    10, 7, 4, 75, 0, 0, 0, 0, 12, 8,
    10, 9, 2, 0.15, 0.05, 0.20, 0, 0, 0, 1.20, 1, 3, 1, 2,
    0, 0, 0, 0, 0, 0, 2, 1, 4, 1, 106, 0, "2026-03-27T15:00:00.000Z", now(),
  );

  insertHistory.run(
    10, 8, 13, 90, 2, 0, 0, 3, 38, 22,
    25, 26, 8, 1.10, 0.15, 1.25, 0, 0, 0, 0.60, 1, 4, 2, 3,
    0, 0, 0, 0, 0, 0, 1, 1, 3, 1, 107, 1, "2026-04-03T15:00:00.000Z", now(),
  );

  insertHistory.run(
    11, 7, 12, 90, 2, 0, 0, 3, 40, 22,
    28, 30, 8, 1.20, 0.10, 1.30, 0, 0, 0, 0.50, 0, 2, 1, 2,
    0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 110, 1, "2026-03-24T18:00:00.000Z", now(),
  );
}

describe("TrainingMatrixService", () => {
  it("returns only strictly historical data for the target gameweek", () => {
    const db = createDatabase(path.join(tempDir, "lookback.sqlite"));
    seedTrainingMatrixScenario(db);

    const service = new TrainingMatrixService(db);
    const rows = service.getTrainingMatrix({
      targetGameweek: 7,
      lookbackWindow: 2,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      playerId: 10,
      targetGameweek: 7,
      actualPoints: 10,
      matchesInLookback: 2,
    });
    expect(rows[0]?.rollingMinutes).toBeCloseTo(85);
    expect(rows[0]?.rollingXg).toBeCloseTo(0.4);
    expect(rows[0]?.rollingXa).toBeCloseTo(0.15);
    expect(rows[0]?.rollingBps).toBeCloseTo(25);
  });

  it("keeps separate target rows for double-gameweek fixtures", () => {
    const db = createDatabase(path.join(tempDir, "double-gameweek.sqlite"));
    seedTrainingMatrixScenario(db);

    const service = new TrainingMatrixService(db);
    const rows = service.getTrainingMatrix({
      targetGameweek: 7,
      lookbackWindow: 2,
    });

    expect(rows.map((row) => row.opponentTeamId)).toEqual([2, 4]);
    expect(rows.map((row) => row.kickoffTime)).toEqual([
      "2026-03-24T15:00:00.000Z",
      "2026-03-27T15:00:00.000Z",
    ]);
    expect(rows[0]?.rollingMinutes).toBe(rows[1]?.rollingMinutes);
    expect(rows[0]?.matchesInLookback).toBe(rows[1]?.matchesInLookback);
  });

  it("excludes target rows when there is no historical lookback sample", () => {
    const db = createDatabase(path.join(tempDir, "no-history.sqlite"));
    seedTrainingMatrixScenario(db);

    const service = new TrainingMatrixService(db);
    const rows = service.getTrainingMatrix({
      targetGameweek: 7,
      lookbackWindow: 1,
    });

    expect(rows.map((row) => row.playerId)).toEqual([10, 10]);
    expect(rows.every((row) => row.matchesInLookback > 0)).toBe(true);
  });
});
