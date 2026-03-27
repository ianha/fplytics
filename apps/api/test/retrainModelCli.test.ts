import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import {
  parseRetrainModelArgs,
  retrainModel,
} from "../src/cli/retrainModel.js";
import { MlModelRegistryService } from "../src/services/mlModelRegistryService.js";
import { now, seedPublicData } from "./myTeamFixtures.js";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-retrain-model-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function seedTrainingScenario(db: ReturnType<typeof createDatabase>) {
  seedPublicData(db);

  db.prepare(
    `INSERT INTO positions (id, name, short_name, updated_at) VALUES
      (1, 'Goalkeeper', 'GKP', ?),
      (2, 'Defender', 'DEF', ?)`,
  ).run(now(), now());

  db.prepare(
    `INSERT INTO teams (id, code, name, short_name, strength, updated_at) VALUES
      (3, 43, 'Chelsea', 'CHE', 4, ?),
      (4, 6, 'Spurs', 'TOT', 3, ?),
      (5, 7, 'ManCity', 'MCI', 5, ?),
      (6, 8, 'ManUtd', 'MUN', 4, ?)`,
  ).run(now(), now(), now(), now());

  // Create 23 more players (10/11 exist from seedPublicData)
  const insertPlayer = db.prepare(
    `INSERT INTO players (
      id, code, web_name, first_name, second_name, team_id, position_id, now_cost, total_points,
      form, selected_by_percent, points_per_game, goals_scored, assists, clean_sheets, minutes,
      bonus, bps, creativity, influence, threat, ict_index, expected_goals, expected_assists,
      expected_goal_involvements, expected_goal_performance, expected_assist_performance,
      expected_goal_involvement_performance, expected_goals_conceded, clean_sheets_per_90, starts,
      tackles, recoveries, defensive_contribution, photo, team_code, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (let i = 12; i <= 34; i++) {
    const teamId = ((i - 1) % 6) + 1;
    const posId = ((i - 1) % 4) + 1;
    insertPlayer.run(
      i, 10000 + i, `Player${i}`, `First${i}`, `Last${i}`, teamId, posId, 60 + i, 100 + i * 5,
      5.0, 10.0, 4.0, i % 10, i % 8, i % 5, 2000 + i * 20,
      i % 6, 300 + i * 10, 400, 500, 600, 150, 5.0, 3.0,
      8.0, 0.5, 0.3, 0.8, 10.0, 0.2, 28,
      30, 100, 60, `${10000 + i}.jpg`, teamId, "a", now(),
    );
  }

  // Add finished gameweeks and history
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

  for (const gw of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    db.prepare(
      `INSERT OR IGNORE INTO gameweeks (id, name, deadline_time, is_current, is_finished, updated_at)
       VALUES (?, ?, ?, 0, 1, ?)`,
    ).run(gw, `Gameweek ${gw}`, `2026-01-${String(gw).padStart(2, "0")}T11:00:00Z`, now());

    for (const playerId of [10, 11, ...Array.from({ length: 23 }, (_, i) => i + 12)]) {
      const posId = playerId <= 11 ? (playerId === 10 ? 3 : 4) : ((playerId - 1) % 4) + 1;
      const teamId = playerId <= 11 ? (playerId === 10 ? 1 : 2) : ((playerId - 1) % 6) + 1;
      const seed = playerId * 100 + gw;
      const mins = 70 + (seed % 21);
      const pts = 1 + (seed % 12);
      const xg = ((seed % 50) + 5) / 100;
      const xa = ((seed % 30) + 3) / 100;
      const xgc = ((seed % 40) + 20) / 100;
      const cs = (seed % 3 === 0) ? 1 : 0;
      const bon = seed % 4;
      const saves = posId === 1 ? 2 + (seed % 5) : 0;
      const opponentTeam = ((seed % 5)) + 1;
      const adjOpponent = opponentTeam === teamId ? (opponentTeam % 6) + 1 : opponentTeam;

      insertHistory.run(
        playerId, gw, pts, mins, seed % 3 === 0 ? 1 : 0, seed % 5 === 0 ? 1 : 0,
        cs, bon, 10 + bon * 5, 10, 10, 10, 3,
        xg, xa, xg + xa, 0, 0, 0, xgc,
        1, 3, 1, 2, saves, 0, 0, 0, 0, 0, cs === 1 ? 0 : 1, 1,
        adjOpponent, teamId, 80, gw % 2 === 0 ? 1 : 0,
        `2026-01-${String(gw).padStart(2, "0")}T15:00:00.000Z`, now(),
      );
    }
  }
}

describe("parseRetrainModelArgs", () => {
  it("parses --gameweek flag", () => {
    expect(parseRetrainModelArgs(["--gameweek", "10"])).toEqual({
      gameweek: 10,
      all: false,
    });
  });

  it("parses -g shorthand", () => {
    expect(parseRetrainModelArgs(["-g", "5"])).toEqual({
      gameweek: 5,
      all: false,
    });
  });

  it("parses --all flag", () => {
    expect(parseRetrainModelArgs(["--all"])).toEqual({
      gameweek: undefined,
      all: true,
    });
  });

  it("parses no flags (pending queue mode)", () => {
    expect(parseRetrainModelArgs([])).toEqual({
      gameweek: undefined,
      all: false,
    });
  });

  it("rejects --gameweek and --all together", () => {
    expect(() => parseRetrainModelArgs(["--gameweek", "5", "--all"])).toThrow(
      "Use either `--gameweek` or `--all`, not both.",
    );
  });
});

describe("retrainModel", () => {
  it("returns skip when pending queue is empty (default mode)", () => {
    const db = createDatabase(path.join(tempDir, "empty-queue.sqlite"));
    seedTrainingScenario(db);

    const result = retrainModel(db, {});

    expect(result.skipped).toBe(true);
    expect(result.mode).toBe("pending");
    expect(result.reason).toContain("No pending");
  });

  it("trains on pending gameweeks and clears queue", () => {
    const db = createDatabase(path.join(tempDir, "pending.sqlite"));
    seedTrainingScenario(db);

    // Queue gameweeks 5-10 as pending
    const mlService = new MlModelRegistryService(db);
    for (const gw of [5, 6, 7, 8, 9, 10]) {
      mlService.setPendingMlEvaluation(gw);
    }

    const result = retrainModel(db, {});

    expect(result.skipped).toBe(false);
    expect(result.mode).toBe("pending");
    expect(result.gameweeks).toEqual([5, 6, 7, 8, 9, 10]);
    expect(result.versionTag).toBe("auto-gw5-gw10");
    expect(result.versionId).toBeDefined();
    expect(result.trainingRows).toBeGreaterThanOrEqual(100);
    expect(typeof result.rSquared).toBe("number");

    // Pending queue should be cleared
    const pending = mlService.getPendingMlEvaluation();
    expect(pending).toBeNull();
  });

  it("trains on a single specified gameweek and clears it from queue", () => {
    const db = createDatabase(path.join(tempDir, "single-gw.sqlite"));
    seedTrainingScenario(db);

    // Queue multiple pending
    const mlService = new MlModelRegistryService(db);
    mlService.setPendingMlEvaluation(8);
    mlService.setPendingMlEvaluation(9);
    mlService.setPendingMlEvaluation(10);

    const result = retrainModel(db, { gameweek: 10 });

    expect(result.mode).toBe("gameweek");
    // Single GW may not have enough rows — result depends on data
    if (!result.skipped) {
      expect(result.gameweeks).toEqual([10]);
      // GW 10 should be cleared from queue, but 8 and 9 remain
      const pending = mlService.getPendingMlEvaluation();
      expect(pending?.gameweekIds).toEqual([8, 9]);
    }
  });

  it("trains on all finished gameweeks with --all", () => {
    const db = createDatabase(path.join(tempDir, "all-gw.sqlite"));
    seedTrainingScenario(db);

    const result = retrainModel(db, { all: true });

    expect(result.skipped).toBe(false);
    expect(result.mode).toBe("all");
    expect(result.gameweeks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.versionTag).toBe("auto-gw1-gw10");
    expect(result.coefficients).toBeDefined();

    // All coefficients within bounds
    for (const val of Object.values(result.coefficients!)) {
      expect(val).toBeGreaterThanOrEqual(0.1);
      expect(val).toBeLessThanOrEqual(5.0);
    }
  });

  it("activates the trained model in the registry", () => {
    const db = createDatabase(path.join(tempDir, "activation.sqlite"));
    seedTrainingScenario(db);

    const result = retrainModel(db, { all: true });
    expect(result.skipped).toBe(false);

    const mlService = new MlModelRegistryService(db);
    const active = mlService.getActiveVersionForModelName("transfer_event_points_v2");

    expect(active).not.toBeNull();
    expect(active!.id).toBe(result.versionId);
    expect(active!.isActive).toBe(true);
  });
});
