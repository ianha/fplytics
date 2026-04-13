import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { QueryService } from "../src/services/queryService.js";
import { MlModelRegistryService } from "../src/services/mlModelRegistryService.js";
import { now, seedPublicData } from "./myTeamFixtures.js";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-query-service-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function seedHistoricalReplayScenario(db: ReturnType<typeof createDatabase>) {
  seedPublicData(db);

  db.prepare(
    `INSERT INTO teams (id, code, name, short_name, strength, updated_at) VALUES
      (3, 43, 'Chelsea', 'CHE', 4, ?),
      (4, 6, 'Spurs', 'TOT', 4, ?)`,
  ).run(now(), now());

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

  insertPlayer.run(110, 10110, "Martinelli", "Gabriel", "Martinelli", 1, 3, 50, 96, 4.3, 8.2, 4.1, 4, 5, 3, 2300, 10, 320, 410, 420, 390, 122, 5.2, 4.3, 9.5, 0, 0, 0, 12, 0.10, 26, 10, 44, 12, "10110.jpg", 3, "a", now());
  insertPlayer.run(112, 10112, "Palmer", "Cole", "Palmer", 3, 3, 55, 188, 8.6, 31.4, 6.8, 16, 11, 5, 2750, 23, 600, 940, 980, 910, 284, 17.8, 9.7, 27.5, 0, 0, 0, 14, 0.14, 31, 14, 60, 16, "10112.jpg", 43, "a", now());
  insertPlayer.run(113, 10113, "Son", "Son", "Heung-Min", 4, 3, 59, 170, 7.1, 24.2, 6.0, 13, 8, 2, 2680, 19, 510, 780, 830, 810, 240, 14.8, 7.6, 22.4, 0, 0, 0, 15, 0.10, 30, 8, 42, 10, "10113.jpg", 6, "a", now());

  db.prepare(
    `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
     VALUES (7, 'Gameweek 7', ?, 55, 104, 0, 1, ?),
            (8, 'Gameweek 8', ?, 55, 104, 1, 0, ?),
            (9, 'Gameweek 9', ?, 55, 104, 0, 0, ?)`,
  ).run(
    "2026-03-22T10:00:00.000Z", now(),
    "2026-03-29T10:00:00.000Z", now(),
    "2026-04-05T10:00:00.000Z", now(),
  );

  const insertFixture = db.prepare(
    `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertFixture.run(701, 9701, 7, "2026-03-23T15:00:00.000Z", 1, 2, 2, 1, 1, 1, now());
  insertFixture.run(702, 9702, 7, "2026-03-24T15:00:00.000Z", 3, 4, 3, 2, 1, 1, now());
  insertFixture.run(801, 9801, 8, "2026-03-30T15:00:00.000Z", 3, 2, null, null, 0, 0, now());
  insertFixture.run(802, 9802, 8, "2026-03-31T15:00:00.000Z", 4, 2, null, null, 0, 0, now());
  insertFixture.run(901, 9901, 9, "2026-04-06T15:00:00.000Z", 2, 1, null, null, 0, 0, now());
  insertFixture.run(902, 9902, 9, "2026-04-07T15:00:00.000Z", 4, 3, null, null, 0, 0, now());

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

  for (const round of [2, 3, 4, 5, 6]) {
    insertHistory.run(
      110, round, 4, 85, 0, 0, 0, 1, 18, 14,
      18, 16, 4, 0.10, 0.08, 0.18, 0, 0, 0, 1.1, 1, 4, 2, 3,
      0, 0, 0, 0, 0, 0, 1, 1, 2, 1, 50, 1, `2026-03-${10 + round}T15:00:00.000Z`, now(),
    );
    insertHistory.run(
      112, round, 3, 82, 0, 0, 0, 0, 12, 8,
      11, 9, 3, 0.05, 0.04, 0.09, 0, 0, 0, 1.2, 1, 3, 1, 2,
      0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 65, 1, `2026-03-${10 + round}T15:00:00.000Z`, now(),
    );
    insertHistory.run(
      113, round, 7, 90, 1, 0, 0, 2, 24, 16,
      22, 20, 5, 0.42, 0.20, 0.62, 0, 0, 0, 0.9, 1, 3, 1, 2,
      0, 0, 0, 0, 0, 0, 1, 1, 2, 4, 59, 1, `2026-03-${10 + round}T15:00:00.000Z`, now(),
    );
  }

  insertHistory.run(
    112, 7, 16, 90, 2, 1, 0, 3, 32, 30,
    35, 34, 9, 1.45, 0.55, 2.0, 0, 0, 0, 0.7, 1, 2, 1, 2,
    0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 55, 1, "2026-03-23T15:00:00.000Z", now(),
  );

  db.prepare(
    `INSERT INTO my_team_accounts (
      id, email, encrypted_credentials, manager_id, entry_id, player_first_name, player_last_name, team_name,
      auth_status, last_authenticated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, "ian@fpl.local", "encrypted", 77, 321, "Ian", "Harper", "Midnight Press FC", "authenticated", now(), now());

  db.prepare(
    `INSERT INTO my_team_gameweeks (
      account_id, gameweek_id, points, total_points, overall_rank, rank, bank, value, event_transfers,
      event_transfers_cost, points_on_bench, active_chip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
             (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    1, 7, 58, 548, 154820, 154820, 10, 1007, 1, 0, 3, null,
    1, 8, 64, 612, 121482, 121482, 14, 1012, 0, 0, 6, null,
  );

  const insertPick = db.prepare(
    `INSERT INTO my_team_picks (
      account_id, gameweek_id, player_id, position, multiplier, is_captain, is_vice_captain, selling_price, purchase_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertPick.run(1, 7, 110, 5, 1, 0, 0, 50, 48);
  insertPick.run(1, 8, 110, 5, 1, 0, 0, 50, 48);
}

function seedHistoricalSellValueFallbackScenario(db: ReturnType<typeof createDatabase>) {
  seedPublicData(db);

  db.prepare(
    `INSERT INTO teams (id, code, name, short_name, strength, updated_at) VALUES
      (3, 43, 'Chelsea', 'CHE', 4, ?),
      (4, 6, 'Spurs', 'TOT', 4, ?)`,
  ).run(now(), now());

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

  insertPlayer.run(210, 10210, "Martinelli", "Gabriel", "Martinelli", 1, 3, 75, 96, 4.3, 8.2, 4.1, 4, 5, 3, 2300, 10, 320, 410, 420, 390, 122, 5.2, 4.3, 9.5, 0, 0, 0, 12, 0.10, 26, 10, 44, 12, "10210.jpg", 3, "a", now());
  insertPlayer.run(212, 10212, "Palmer", "Cole", "Palmer", 3, 3, 55, 188, 8.1, 31.4, 6.8, 16, 11, 5, 2750, 23, 600, 940, 980, 910, 284, 14.0, 8.0, 22.0, 0, 0, 0, 14, 0.14, 31, 14, 60, 16, "10212.jpg", 43, "a", now());
  insertPlayer.run(213, 10213, "Son", "Son", "Heung-Min", 4, 3, 59, 170, 8.9, 24.2, 6.0, 13, 8, 2, 2680, 19, 510, 780, 830, 810, 240, 18.5, 9.2, 27.7, 0, 0, 0, 15, 0.10, 30, 8, 42, 10, "10213.jpg", 6, "a", now());

  db.prepare(
    `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
     VALUES (7, 'Gameweek 7', ?, 55, 104, 0, 1, ?),
            (8, 'Gameweek 8', ?, 55, 104, 1, 0, ?),
            (9, 'Gameweek 9', ?, 55, 104, 0, 0, ?)`,
  ).run(
    "2026-03-22T10:00:00.000Z", now(),
    "2026-03-29T10:00:00.000Z", now(),
    "2026-04-05T10:00:00.000Z", now(),
  );

  const insertFixture = db.prepare(
    `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertFixture.run(701, 9701, 7, "2026-03-23T15:00:00.000Z", 3, 2, 2, 1, 1, 1, now());
  insertFixture.run(702, 9702, 7, "2026-03-24T15:00:00.000Z", 4, 2, 3, 2, 1, 1, now());
  insertFixture.run(801, 9801, 8, "2026-03-30T15:00:00.000Z", 3, 2, null, null, 0, 0, now());
  insertFixture.run(802, 9802, 8, "2026-03-31T15:00:00.000Z", 4, 2, null, null, 0, 0, now());
  insertFixture.run(901, 9901, 9, "2026-04-06T15:00:00.000Z", 2, 1, null, null, 0, 0, now());
  insertFixture.run(902, 9902, 9, "2026-04-07T15:00:00.000Z", 4, 3, null, null, 0, 0, now());

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

  for (const round of [2, 3, 4, 5, 6]) {
    insertHistory.run(
      210, round, 2, 72, 0, 0, 0, 0, 10, 8,
      10, 9, 2, 0.04, 0.03, 0.07, 0, 0, 0, 1.3, 1, 3, 1, 2,
      0, 0, 0, 0, 0, 0, 1, 1, 2, 1, 50, 1, `2026-03-${10 + round}T15:00:00.000Z`, now(),
    );
    insertHistory.run(
      212, round, 10, 90, 1, 1, 0, 2, 30, 24,
      30, 28, 8, 0.58, 0.31, 0.89, 0, 0, 0, 0.7, 1, 3, 1, 2,
      0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 55, 1, `2026-03-${10 + round}T15:00:00.000Z`, now(),
    );
    insertHistory.run(
      213, round, 9, 90, 1, 1, 0, 2, 28, 22,
      30, 28, 7, 0.62, 0.28, 0.90, 0, 0, 0, 0.7, 1, 3, 1, 2,
      0, 0, 0, 0, 0, 0, 1, 1, 2, 4, 59, 1, `2026-03-${10 + round}T15:00:00.000Z`, now(),
    );
  }

  db.prepare(
    `INSERT INTO my_team_accounts (
      id, email, encrypted_credentials, manager_id, entry_id, player_first_name, player_last_name, team_name,
      auth_status, last_authenticated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, "ian@fpl.local", "encrypted", 77, 321, "Ian", "Harper", "Midnight Press FC", "authenticated", now(), now());

  db.prepare(
    `INSERT INTO my_team_gameweeks (
      account_id, gameweek_id, points, total_points, overall_rank, rank, bank, value, event_transfers,
      event_transfers_cost, points_on_bench, active_chip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
             (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    1, 7, 58, 548, 154820, 154820, 5, 1007, 1, 0, 3, null,
    1, 8, 64, 612, 121482, 121482, 5, 1012, 0, 0, 6, null,
  );

  const insertPick = db.prepare(
    `INSERT INTO my_team_picks (
      account_id, gameweek_id, player_id, position, multiplier, is_captain, is_vice_captain, selling_price, purchase_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertPick.run(1, 7, 210, 5, 1, 0, 0, null, null);
  insertPick.run(1, 8, 210, 5, 1, 0, 0, null, null);
}

function seedHistoricalLowMinuteOutlierScenario(db: ReturnType<typeof createDatabase>) {
  seedPublicData(db);

  db.prepare(
    `INSERT INTO teams (id, code, name, short_name, strength, updated_at) VALUES
      (4, 31, 'Bournemouth', 'BOU', 3, ?),
      (5, 11, 'Brentford', 'BRE', 3, ?),
      (9, 39, 'Everton', 'EVE', 3, ?),
      (16, 90, 'Burnley', 'BUR', 3, ?)`,
  ).run(now(), now(), now(), now());

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

  insertPlayer.run(136, 10136, "Thiago", "Thiago", "Rodrigues", 5, 4, 73, 130, 4.5, 2.3, 4.1, 11, 2, 0, 2652, 19, 300, 120, 340, 690, 115, 17.54, 1.66, 19.20, 0, 0, 0, 40.94, 0, 30, 9, 61, 10, "10136.jpg", 11, "a", now());
  insertPlayer.run(311, 10311, "Beto", "Beto", "Betuncal", 9, 4, 50, 82, 7.2, 4.2, 3.8, 6, 0, 0, 1196, 9, 210, 60, 220, 580, 96, 7.16, 0.21, 7.37, 0, 0, 0, 18.32, 0, 12, 5, 33, 7, "10311.jpg", 39, "a", now());

  db.prepare(
    `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
     VALUES (29, 'Gameweek 29', ?, 55, 104, 0, 1, ?),
            (30, 'Gameweek 30', ?, 55, 104, 1, 0, ?)`,
  ).run(
    "2026-03-01T10:00:00.000Z", now(),
    "2026-03-08T10:00:00.000Z", now(),
  );

  const insertFixture = db.prepare(
    `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertFixture.run(2901, 12901, 29, "2026-03-03T19:30:00.000Z", 4, 5, 0, 0, 1, 1, now());
  insertFixture.run(2902, 12902, 29, "2026-03-03T19:30:00.000Z", 9, 16, 2, 0, 1, 1, now());
  insertFixture.run(3001, 13001, 30, "2026-03-10T19:30:00.000Z", 5, 4, null, null, 0, 0, now());
  insertFixture.run(3002, 13002, 30, "2026-03-10T19:30:00.000Z", 16, 9, null, null, 0, 0, now());

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

  const thiagoRounds = [
    { round: 24, xg: 0.00, xa: 0.00, xgc: 2.40, bonus: 0, yc: 0, gc: 0, minutes: 90 },
    { round: 25, xg: 0.79, xa: 0.04, xgc: 2.24, bonus: 0, yc: 1, gc: 2, minutes: 90 },
    { round: 26, xg: 0.77, xa: 0.22, xgc: 0.60, bonus: 0, yc: 0, gc: 1, minutes: 90 },
    { round: 27, xg: 0.31, xa: 0.43, xgc: 1.09, bonus: 0, yc: 0, gc: 2, minutes: 90 },
    { round: 28, xg: 0.58, xa: 0.03, xgc: 0.97, bonus: 1, yc: 1, gc: 3, minutes: 90 },
  ];
  for (const item of thiagoRounds) {
    insertHistory.run(
      136, item.round, 4, item.minutes, 0, 0, 0, item.bonus, 18, 10,
      22, 30, 6, item.xg, item.xa, item.xg + item.xa, 0, 0, 0, item.xgc, 1, 3, 1, 2,
      0, item.yc, 0, 0, 0, 0, item.gc, 1, 4, 5, 71, 0, `2026-02-${item.round.toString().padStart(2, "0")}T15:00:00.000Z`, now(),
    );
  }

  const betoRounds = [
    { round: 24, minutes: 1, starts: 0, xg: 0.59, xa: 0.00, bonus: 2, gc: 0, yc: 0 },
    { round: 25, minutes: 21, starts: 0, xg: 0.00, xa: 0.00, bonus: 0, gc: 0, yc: 0 },
    { round: 26, minutes: 28, starts: 0, xg: 0.10, xa: 0.01, bonus: 0, gc: 1, yc: 1 },
    { round: 27, minutes: 11, starts: 0, xg: 0.00, xa: 0.00, bonus: 0, gc: 0, yc: 0 },
    { round: 28, minutes: 73, starts: 1, xg: 1.02, xa: 0.01, bonus: 3, gc: 1, yc: 0 },
  ];
  for (const item of betoRounds) {
    insertHistory.run(
      311, item.round, 5, item.minutes, 0, 0, 0, item.bonus, 15, 8,
      20, 40, 5, item.xg, item.xa, item.xg + item.xa, 0, 0, 0, 1.05, 0, 2, 0, 1,
      0, item.yc, 0, 0, 0, 0, item.gc, item.starts, 16, 9, 50, 1, `2026-02-${item.round.toString().padStart(2, "0")}T15:00:00.000Z`, now(),
    );
  }

  db.prepare(
    `INSERT INTO my_team_accounts (
      id, email, encrypted_credentials, manager_id, entry_id, player_first_name, player_last_name, team_name,
      auth_status, last_authenticated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, "ian@fpl.local", "encrypted", 77, 321, "Ian", "Harper", "Midnight Press FC", "authenticated", now(), now());

  db.prepare(
    `INSERT INTO my_team_gameweeks (
      account_id, gameweek_id, points, total_points, overall_rank, rank, bank, value, event_transfers,
      event_transfers_cost, points_on_bench, active_chip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
             (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    1, 29, 62, 1680, 101000, 101000, 71, 1035, 0, 0, 7, null,
    1, 30, 62, 1742, 98000, 98000, 71, 1038, 0, 0, 5, null,
  );

  db.prepare(
    `INSERT INTO my_team_picks (
      account_id, gameweek_id, player_id, position, multiplier, is_captain, is_vice_captain, selling_price, purchase_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, 29, 136, 10, 1, 0, 0, 71, 73);
}

function seedTransferDecisionHeuristicScenario(
  db: ReturnType<typeof createDatabase>,
  mode: "upside_bias" | "roll_bias",
) {
  seedPublicData(db);

  db.prepare(
    `INSERT INTO positions (id, name, short_name, updated_at) VALUES
      (1, 'Goalkeeper', 'GKP', ?),
      (2, 'Defender', 'DEF', ?)`,
  ).run(now(), now());

  db.prepare(
    `INSERT INTO teams (id, code, name, short_name, strength, updated_at)
     VALUES (3, 43, 'Chelsea', 'CHE', 4, ?)`,
  ).run(now());

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

  insertPlayer.run(20, 10020, "Flekken", "Mark", "Flekken", 2, 1, 45, 80, 4.2, 8.1, 3.1, 0, 0, 5, 2700, 12, 420, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 42, 0.18, 30, 0, 0, 0, "10020.jpg", 14, "a", now());
  insertPlayer.run(21, 10021, "Raya", "David", "Raya", 1, 1, 50, 110, 4.9, 15.2, 4.0, 0, 0, 9, 2880, 18, 520, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 0.28, 32, 0, 0, 0, "10021.jpg", 3, "a", now());
  insertPlayer.run(30, 10030, "Rogers", "Morgan", "Rogers", 2, 3, 55, 92, 4.6, 11.2, 3.9, 3, 4, 3, 2400, 10, 360, 420, 410, 400, 123, 4.5, 4.2, 8.7, 0, 0, 0, 20, 0.10, 27, 12, 50, 14, "10030.jpg", 14, "a", now());
  insertPlayer.run(31, 10031, "Palmer", "Cole", "Palmer", 3, 3, 70, 210, 8.8, 35.4, 7.1, 18, 13, 6, 2850, 26, 610, 980, 1020, 930, 295, 17.2, 9.8, 27.0, 0, 0, 0, 14, 0.18, 32, 18, 65, 18, "10031.jpg", 43, "a", now());
  insertPlayer.run(40, 10040, "Harwood", "Bench", "Harwood", 2, 2, 40, 55, 3.5, 2.4, 2.9, 1, 0, 4, 1800, 6, 220, 120, 220, 80, 42, 1.0, 0.8, 1.8, 0, 0, 0, 26, 0.18, 20, 20, 55, 42, "10040.jpg", 14, "a", now());
  insertPlayer.run(41, 10041, "Gabriel", "Gabriel", "Magalhaes", 1, 2, 50, 145, 5.7, 22.4, 5.0, 5, 2, 12, 2900, 19, 520, 260, 420, 310, 148, 4.8, 1.9, 6.7, 0, 0, 0, 18, 0.42, 32, 45, 88, 71, "10041.jpg", 3, "a", now());

  db.prepare(
    `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
     VALUES (7, 'Gameweek 7', ?, 55, 104, 1, 0, ?)`,
  ).run("2026-03-22T10:00:00.000Z", now());
  db.prepare(
    `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
     VALUES (8, 'Gameweek 8', ?, 55, 104, 0, 0, ?)`,
  ).run("2026-03-29T10:00:00.000Z", now());
  db.prepare(
    `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
     VALUES (9, 'Gameweek 9', ?, 55, 104, 0, 0, ?)`,
  ).run("2026-04-05T10:00:00.000Z", now());

  const insertFixture = db.prepare(
    `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertFixture.run(701, 9701, 7, "2026-03-23T15:00:00.000Z", 1, 2, null, null, 0, 0, now());
  insertFixture.run(702, 9702, 7, "2026-03-24T15:00:00.000Z", 3, 2, null, null, 0, 0, now());
  insertFixture.run(703, 9703, 8, "2026-03-30T15:00:00.000Z", 2, 1, null, null, 0, 0, now());
  insertFixture.run(704, 9704, 8, "2026-03-31T15:00:00.000Z", 3, 1, null, null, 0, 0, now());
  insertFixture.run(705, 9705, 9, "2026-04-06T15:00:00.000Z", 3, 2, null, null, 0, 0, now());
  insertFixture.run(706, 9706, 9, "2026-04-07T15:00:00.000Z", 1, 2, null, null, 0, 0, now());

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

  const playerHistory: Record<number, [number, number, number, number, number, number, number, number, number]> = mode === "upside_bias"
    ? {
      20: [4, 90, 0.00, 0.00, 1.8, 4.2, 1, 0, 2],
      21: [5, 90, 0.00, 0.00, 1.0, 4.8, 2, 0, 1],
      30: [4, 85, 0.10, 0.08, 1.4, 0.0, 1, 0, 1],
      31: [9, 90, 0.62, 0.28, 0.8, 0.0, 2, 0, 1],
      40: [3, 88, 0.05, 0.03, 1.2, 0.0, 1, 0, 1],
      41: [6, 90, 0.14, 0.05, 0.9, 0.0, 2, 0, 1],
    }
    : {
      20: [4, 90, 0.00, 0.00, 1.6, 4.0, 1, 0, 2],
      21: [4, 90, 0.00, 0.00, 1.4, 4.3, 1, 0, 2],
      30: [4, 85, 0.10, 0.08, 1.3, 0.0, 1, 0, 1],
      31: [5, 88, 0.14, 0.10, 1.2, 0.0, 1, 0, 1],
      40: [3, 88, 0.05, 0.03, 1.2, 0.0, 1, 0, 1],
      41: [4, 90, 0.06, 0.04, 1.1, 0.0, 1, 0, 1],
    };

  for (const round of [2, 3, 4, 5, 6]) {
    for (const [playerIdText, [points, minutes, xg, xa, xgc, saves, bonus, redCards, goalsConceded]] of Object.entries(playerHistory)) {
      const playerId = Number(playerIdText);
      const teamId = playerId === 31 ? 3 : playerId === 21 || playerId === 41 ? 1 : 2;
      insertHistory.run(
        playerId, round, points, minutes, xg > 0.3 ? 1 : 0, xa > 0.2 ? 1 : 0, xgc < 1 ? 1 : 0, bonus, 18 + bonus, 20,
        24, 18, 5, xg, xa, xg + xa, 0, 0, 0, xgc, 2, 5, 3, 4,
        saves, 0.1, redCards, 0, 0, 0, goalsConceded, 1, 1, teamId, 100, 1, `2026-03-${10 + round}T15:00:00.000Z`, now(),
      );
    }
  }

  db.prepare(
    `INSERT INTO my_team_accounts (
      id, email, encrypted_credentials, manager_id, entry_id, player_first_name, player_last_name, team_name,
      auth_status, last_authenticated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, "ian@fpl.local", "encrypted", 77, 321, "Ian", "Harper", "Midnight Press FC", "authenticated", now(), now());
  db.prepare(
    `INSERT INTO my_team_gameweeks (
      account_id, gameweek_id, points, total_points, overall_rank, rank, bank, value, event_transfers,
      event_transfers_cost, points_on_bench, active_chip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, 7, 64, 612, 121482, 121482, 15, 1012, 1, 0, 6, null);

  const insertPick = db.prepare(
    `INSERT INTO my_team_picks (
      account_id, gameweek_id, player_id, position, multiplier, is_captain, is_vice_captain, selling_price, purchase_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertPick.run(1, 7, 20, 1, 1, 0, 0, 45, 45);
  insertPick.run(1, 7, 30, 2, 1, 0, 0, 55, 55);
  insertPick.run(1, 7, 40, 12, 0, 0, 0, 40, 40);
}

function seedGoalkeeperCashGenerationScenario(db: ReturnType<typeof createDatabase>) {
  seedPublicData(db);

  db.prepare(
    `INSERT INTO positions (id, name, short_name, updated_at)
     VALUES (1, 'Goalkeeper', 'GKP', ?)`,
  ).run(now());

  db.prepare(
    `INSERT INTO teams (id, code, name, short_name, strength, updated_at)
     VALUES (3, 43, 'Chelsea', 'CHE', 4, ?)`,
  ).run(now());

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

  insertPlayer.run(21, 10021, "Raya", "David", "Raya", 1, 1, 50, 110, 4.9, 15.2, 4.0, 0, 0, 9, 2880, 18, 520, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 0.28, 32, 0, 0, 0, "10021.jpg", 3, "a", now());
  insertPlayer.run(341, 10341, "Darlow", "Karl", "Darlow", 2, 1, 39, 55, 4.6, 1.1, 3.4, 0, 0, 6, 1620, 6, 220, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 24, 0.24, 18, 0, 0, 0, "10341.jpg", 14, "a", now());

  db.prepare(
    `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
     VALUES (7, 'Gameweek 7', ?, 55, 104, 1, 0, ?),
            (8, 'Gameweek 8', ?, 55, 104, 0, 0, ?),
            (9, 'Gameweek 9', ?, 55, 104, 0, 0, ?)`,
  ).run(
    "2026-03-22T10:00:00.000Z", now(),
    "2026-03-29T10:00:00.000Z", now(),
    "2026-04-05T10:00:00.000Z", now(),
  );

  const insertFixture = db.prepare(
    `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertFixture.run(701, 9701, 7, "2026-03-23T15:00:00.000Z", 1, 2, null, null, 0, 0, now());
  insertFixture.run(702, 9702, 7, "2026-03-24T15:00:00.000Z", 2, 3, null, null, 0, 0, now());
  insertFixture.run(703, 9703, 8, "2026-03-30T15:00:00.000Z", 2, 1, null, null, 0, 0, now());
  insertFixture.run(704, 9704, 8, "2026-03-31T15:00:00.000Z", 2, 3, null, null, 0, 0, now());
  insertFixture.run(705, 9705, 9, "2026-04-06T15:00:00.000Z", 3, 2, null, null, 0, 0, now());
  insertFixture.run(706, 9706, 9, "2026-04-07T15:00:00.000Z", 1, 3, null, null, 0, 0, now());

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

  for (const round of [2, 3, 4, 5, 6]) {
    insertHistory.run(
      21, round, 5, 90, 0, 0, 1, 1, 22, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2, 0, 0, 0, 0,
      3.6, 0, 0, 0, 0, 0, 1, 1, 2, 1, 50, 1, `2026-03-${10 + round}T15:00:00.000Z`, now(),
    );
    insertHistory.run(
      341, round, 5, 90, 0, 0, 1, 0, 18, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1.25, 0, 0, 0, 0,
      3.2, 0, 0, 0, 0, 0, 1, 1, 2, 2, 39, 1, `2026-03-${10 + round}T15:00:00.000Z`, now(),
    );
  }

  db.prepare(
    `INSERT INTO my_team_accounts (
      id, email, encrypted_credentials, manager_id, entry_id, player_first_name, player_last_name, team_name,
      auth_status, last_authenticated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, "ian@fpl.local", "encrypted", 77, 321, "Ian", "Harper", "Midnight Press FC", "authenticated", now(), now());

  db.prepare(
    `INSERT INTO my_team_gameweeks (
      account_id, gameweek_id, points, total_points, overall_rank, rank, bank, value, event_transfers,
      event_transfers_cost, points_on_bench, active_chip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, 7, 64, 612, 121482, 121482, 0, 1012, 1, 0, 6, null);

  db.prepare(
    `INSERT INTO my_team_picks (
      account_id, gameweek_id, player_id, position, multiplier, is_captain, is_vice_captain, selling_price, purchase_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, 7, 21, 1, 1, 0, 0, 50, 50);
}

describe("QueryService", () => {
  it("normalizes fixture and history booleans while preserving nested player cards", () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPublicData(db);

    db.prepare(
      `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
       VALUES (7, 'Gameweek 7', ?, 55, 104, 1, 0, ?)`,
    ).run("2026-03-22T10:00:00.000Z", now());

    db.prepare(
      `INSERT INTO fixtures (
        id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(501, 9001, 7, "2026-03-23T15:00:00.000Z", 1, 2, 2, 1, 1, 1, now());

    db.prepare(
      `INSERT INTO player_history (
        player_id, round, total_points, minutes, goals_scored, assists, clean_sheets, bonus, bps, creativity,
        influence, threat, ict_index, expected_goals, expected_assists, expected_goal_involvements,
        expected_goal_performance, expected_assist_performance, expected_goal_involvement_performance,
        expected_goals_conceded, tackles, recoveries, clearances_blocks_interceptions, defensive_contribution,
        saves, yellow_cards, red_cards, own_goals, penalties_saved, penalties_missed, goals_conceded, starts,
        opponent_team, team_id, value, was_home, kickoff_time, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      10, 7, 11, 90, 1, 1, 0, 3, 28, 15.5,
      24.2, 12.1, 5.3, 0.8, 0.4, 1.2,
      0.2, 0.6, 0.8, 1.1, 2, 7, 3, 5,
      0, 1, 0, 0, 0, 0, 1, 1,
      2, 1, 105, 1, "2026-03-23T15:00:00.000Z", now(),
    );

    db.prepare(
      `INSERT INTO player_future_fixtures (
        player_id, fixture_id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(10, 601, 9002, 8, "2026-03-30T15:00:00.000Z", 2, 1, null, null, 0, 0, now());

    db.prepare(
      `INSERT INTO my_team_accounts (
        id, email, encrypted_credentials, manager_id, entry_id, player_first_name, player_last_name, team_name,
        auth_status, last_authenticated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(1, "ian@fpl.local", "encrypted", 77, 321, "Ian", "Harper", "Midnight Press FC", "authenticated", now(), now());

    db.prepare(
      `INSERT INTO my_team_gameweeks (
        account_id, gameweek_id, points, total_points, overall_rank, rank, bank, value, event_transfers,
        event_transfers_cost, points_on_bench, active_chip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(1, 7, 64, 612, 121482, 121482, 14, 1012, 1, 4, 6, null);

    db.prepare(
      `INSERT INTO my_team_picks (
        account_id, gameweek_id, player_id, position, multiplier, is_captain, is_vice_captain, selling_price, purchase_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(1, 7, 11, 1, 2, 1, 0, 110, 108);

    db.prepare(
      `INSERT INTO my_team_transfers (
        account_id, transfer_id, gameweek_id, transferred_at, player_in_id, player_out_id, player_in_cost, player_out_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(1, "tx-1", 7, "2026-03-21T18:00:00.000Z", 11, 10, 110, 105);

    db.prepare(
      `INSERT INTO my_team_seasons (account_id, season_name, total_points, overall_rank, rank)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(1, "2025/26", 2310, 150002, 150002);

    const queryService = new QueryService(db);

    expect(queryService.getGameweeks()[0]).toMatchObject({ isCurrent: true, isFinished: false });
    expect(queryService.getFixtures(7)[0]).toMatchObject({ finished: true, started: true });

    const detail = queryService.getPlayerById(10);
    expect(detail?.history[0]?.wasHome).toBe(true);
    expect(detail?.upcomingFixtures[0]).toMatchObject({ finished: false, started: false });

    const myTeam = queryService.getMyTeam(1);
    expect(myTeam?.picks[0]).toMatchObject({
      isCaptain: true,
      isViceCaptain: false,
      player: { webName: "Salah" },
    });
    expect(myTeam?.transfers[0]?.playerOut.webName).toBe("Saka");

    const historicalPicks = queryService.getMyTeamPicksForGameweek(1, 7);
    expect(historicalPicks.picks[0]).toMatchObject({
      gwPoints: 0,
      player: { webName: "Salah" },
    });
  });

  it("getGwCalendar returns BGW rows and DGW rows correctly", () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPublicData(db); // seeds Arsenal (id=1, "ARS") and Liverpool (id=2, "LIV")

    // Add a third team so we can give Arsenal a GW30 fixture that does not involve Liverpool
    db.prepare(
      `INSERT INTO teams (id, code, name, short_name, strength, updated_at) VALUES (3, 43, 'Man City', 'MCI', 5, ?)`,
    ).run(now());

    // GW29 is current
    db.prepare(
      `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
       VALUES (29, 'Gameweek 29', ?, 55, 104, 1, 0, ?)`,
    ).run("2026-03-22T10:00:00.000Z", now());

    // Arsenal DGW29: two fixtures in the same GW (home vs Liverpool, away at Liverpool)
    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(901, 9901, 29, "2026-03-29T15:00:00.000Z", 1, 2, null, null, 0, 0, now());

    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(902, 9902, 29, "2026-03-31T20:00:00.000Z", 2, 1, null, null, 0, 0, now());

    // GW30: Arsenal plays Man City — Liverpool has no fixture (BGW)
    db.prepare(
      `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
       VALUES (30, 'Gameweek 30', ?, 55, 104, 0, 0, ?)`,
    ).run("2026-04-05T10:00:00.000Z", now());

    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(903, 9903, 30, "2026-04-12T15:00:00.000Z", 1, 3, null, null, 0, 0, now()); // Arsenal (H) vs Man City (A)

    const queryService = new QueryService(db);
    const calendar = queryService.getGwCalendar();

    const arsenal = calendar.find((r) => r.teamShortName === "ARS");
    const liverpool = calendar.find((r) => r.teamShortName === "LIV");

    expect(arsenal).toBeDefined();
    expect(liverpool).toBeDefined();

    // Arsenal GW29: DGW — 2 fixtures
    expect(arsenal!.gameweeks[29]).toHaveLength(2);

    // Arsenal GW29: one home fixture (vs LIV) and one away fixture (at LIV)
    const arsenalGw29 = arsenal!.gameweeks[29];
    expect(arsenalGw29.some((f) => f.isHome && f.opponentShort === "LIV")).toBe(true);
    expect(arsenalGw29.some((f) => !f.isHome && f.opponentShort === "LIV")).toBe(true);

    // Arsenal GW30: normal single fixture vs Man City
    expect(arsenal!.gameweeks[30]).toHaveLength(1);
    expect(arsenal!.gameweeks[30][0]).toMatchObject({ opponentShort: "MCI", isHome: true });

    // Liverpool GW30: BGW — no fixture seeded involving Liverpool
    expect(liverpool!.gameweeks[30]).toHaveLength(0);
  });

  it("builds a roll-vs-best-1FT transfer decision comparison", () => {
    const db = createDatabase(path.join(tempDir, "decision.sqlite"));
    seedPublicData(db);

    db.prepare(
      `INSERT INTO teams (id, code, name, short_name, strength, updated_at)
       VALUES (3, 43, 'Chelsea', 'CHE', 4, ?)`,
    ).run(now());

    db.prepare(
      `INSERT INTO players (
        id, code, web_name, first_name, second_name, team_id, position_id, now_cost, total_points,
        form, selected_by_percent, points_per_game, goals_scored, assists, clean_sheets, minutes,
        bonus, bps, creativity, influence, threat, ict_index, expected_goals, expected_assists,
        expected_goal_involvements, expected_goal_performance, expected_assist_performance,
        expected_goal_involvement_performance, expected_goals_conceded, clean_sheets_per_90, starts,
        tackles, recoveries, defensive_contribution, photo, team_code, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      12, 10012, "Palmer", "Cole", "Palmer", 3, 3, 103, 190,
      8.4, 28.1, 6.4, 15, 11, 7, 2760,
      27, 580, 910.5, 1012.4, 845.1, 287.4, 18.2, 10.5,
      28.7, 1.3, 0.9, 2.2, 18.4, 0.18, 31,
      20, 88, 40, "10012.jpg", 43, "a", now(),
    );

    db.prepare(
      `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
       VALUES (7, 'Gameweek 7', ?, 55, 104, 1, 0, ?)`,
    ).run("2026-03-22T10:00:00.000Z", now());
    db.prepare(
      `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
       VALUES (8, 'Gameweek 8', ?, 55, 104, 0, 0, ?)`,
    ).run("2026-03-29T10:00:00.000Z", now());
    db.prepare(
      `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
       VALUES (9, 'Gameweek 9', ?, 55, 104, 0, 0, ?)`,
    ).run("2026-04-05T10:00:00.000Z", now());

    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(701, 9701, 7, "2026-03-23T15:00:00.000Z", 1, 2, null, null, 0, 0, now());
    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(702, 9702, 7, "2026-03-24T15:00:00.000Z", 3, 2, null, null, 0, 0, now());
    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(703, 9703, 8, "2026-03-30T15:00:00.000Z", 2, 1, null, null, 0, 0, now());
    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(704, 9704, 8, "2026-03-31T15:00:00.000Z", 2, 3, null, null, 0, 0, now());
    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(705, 9705, 9, "2026-04-06T15:00:00.000Z", 1, 2, null, null, 0, 0, now());
    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(706, 9706, 9, "2026-04-07T15:00:00.000Z", 3, 1, null, null, 0, 0, now());

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

    for (const round of [2, 3, 4, 5, 6]) {
      insertHistory.run(
        10, round, 5, 88, 0, 0, 0, 1, 18, 10,
        18, 12, 4, 0.18, 0.12, 0.3, 0.1, 0.1, 0.2, 1.5, 1, 5, 2, 3,
        0, 0, 0, 0, 0, 0, 1, 1, 2, 1, 105, 1, `2026-03-${10 + round}T15:00:00.000Z`, now(),
      );
      insertHistory.run(
        12, round, 9, 90, 1, 1, 0, 2, 26, 18,
        24, 20, 6, 0.62, 0.28, 0.9, 0.4, 0.2, 0.6, 0.8, 1, 4, 1, 2,
        0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 103, 1, `2026-03-${10 + round}T15:00:00.000Z`, now(),
      );
    }

    db.prepare(
      `INSERT INTO my_team_accounts (
        id, email, encrypted_credentials, manager_id, entry_id, player_first_name, player_last_name, team_name,
        auth_status, last_authenticated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(1, "ian@fpl.local", "encrypted", 77, 321, "Ian", "Harper", "Midnight Press FC", "authenticated", now(), now());
    db.prepare(
      `INSERT INTO my_team_gameweeks (
        account_id, gameweek_id, points, total_points, overall_rank, rank, bank, value, event_transfers,
        event_transfers_cost, points_on_bench, active_chip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(1, 7, 64, 612, 121482, 121482, 14, 1012, 1, 0, 6, null);
    db.prepare(
      `INSERT INTO my_team_picks (
        account_id, gameweek_id, player_id, position, multiplier, is_captain, is_vice_captain, selling_price, purchase_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(1, 7, 10, 1, 1, 0, 0, 105, 100);

    const queryService = new QueryService(db);
    const decision = queryService.getTransferDecision(1, { horizon: 3 });

    expect(decision).not.toBeNull();
    expect(decision?.recommendedOptionId).toContain("best-1ft");
    expect(decision?.options).toHaveLength(2);
    expect(decision?.options[1]).toMatchObject({
      label: "best_1ft",
      transfers: [
        {
          outPlayerId: 10,
          inPlayerId: 12,
        },
      ],
    });
    expect(decision?.options[1]?.projectedGain).toBeGreaterThan(0);
    expect(decision?.options[1]?.remainingBank).toBe(16);
  });

  it("prefers an attacking starter move over marginal goalkeeper or bench upgrades", () => {
    const db = createDatabase(path.join(tempDir, "upside-bias.sqlite"));
    seedTransferDecisionHeuristicScenario(db, "upside_bias");

    const queryService = new QueryService(db);
    const decision = queryService.getTransferDecision(1, { horizon: 3 });
    const bestOption = decision?.options.find((option) => option.label === "best_1ft");

    expect(decision?.recommendedOptionId).toContain("best-1ft-30-31");
    expect(bestOption?.transfers[0]).toMatchObject({
      outPlayerId: 30,
      inPlayerId: 31,
    });
    expect(bestOption?.reasons.join(" ")).toContain("goal involvement upside");
  });

  it("recommends rolling when only low-impact gains are available", () => {
    const db = createDatabase(path.join(tempDir, "roll-bias.sqlite"));
    seedTransferDecisionHeuristicScenario(db, "roll_bias");

    const queryService = new QueryService(db);
    const decision = queryService.getTransferDecision(1, { horizon: 3 });

    expect(decision?.recommendedOptionId).toBe("roll");
    expect(decision?.options).toHaveLength(1);
  });

  it("hides low-upside goalkeeper cash-generation fallback moves when roll is best", () => {
    const db = createDatabase(path.join(tempDir, "gk-cash-generation.sqlite"));
    seedGoalkeeperCashGenerationScenario(db);

    const queryService = new QueryService(db);
    const decision = queryService.getTransferDecision(1, { horizon: 3 });
    const bestOption = decision?.options.find((option) => option.label === "best_1ft");

    expect(decision?.recommendedOptionId).toBe("roll");
    expect(bestOption).toBeUndefined();
    expect(decision?.options).toHaveLength(1);
  });

  it("uses active event-model weights to change projected gains without changing the response shape", () => {
    const db = createDatabase(path.join(tempDir, "event-model-weights.sqlite"));
    seedTransferDecisionHeuristicScenario(db, "upside_bias");

    const queryService = new QueryService(db);
    const baselineDecision = queryService.getTransferDecision(1, { horizon: 3 });
    const baselineBestOption = baselineDecision?.options.find((option) => option.label === "best_1ft");

    const registryService = new MlModelRegistryService(db);
    const registry = registryService.ensureRegistry({
      modelName: "transfer_event_points_v2",
      targetMetric: "expected_raw_points",
      description: "Live transfer event model",
    });
    registryService.createVersion({
      registryId: registry.id,
      versionTag: "test-v1",
      coefficients: {
        goal_weight: 1.4,
        assist_weight: 1.25,
        clean_sheet_weight: 0.7,
        save_weight: 0.8,
      },
      activate: true,
    });

    const weightedDecision = new QueryService(db).getTransferDecision(1, { horizon: 3 });
    const weightedBestOption = weightedDecision?.options.find((option) => option.label === "best_1ft");

    expect(weightedBestOption?.id).toBe(baselineBestOption?.id);
    expect(weightedBestOption?.projectedGain).not.toBe(baselineBestOption?.projectedGain);
    expect(weightedBestOption?.reasons[0]).toMatch(/\+.*xPts over 3 GWs/i);
    expect(weightedDecision?.recommendedOptionId).toContain("best-1ft");
  });

  it("keeps low-upside goalkeeper cash-generation moves suppressed even with an active event model", () => {
    const db = createDatabase(path.join(tempDir, "gk-cash-generation-weighted.sqlite"));
    seedGoalkeeperCashGenerationScenario(db);

    const registryService = new MlModelRegistryService(db);
    const registry = registryService.ensureRegistry({
      modelName: "transfer_event_points_v2",
      targetMetric: "expected_raw_points",
      description: "Live transfer event model",
    });
    registryService.createVersion({
      registryId: registry.id,
      versionTag: "defensive-bias",
      coefficients: {
        clean_sheet_weight: 1.8,
        save_weight: 1.6,
        goal_weight: 0.8,
        assist_weight: 0.8,
      },
      activate: true,
    });

    const queryService = new QueryService(db);
    const decision = queryService.getTransferDecision(1, { horizon: 3 });
    const bestOption = decision?.options.find((option) => option.label === "best_1ft");

    expect(decision?.recommendedOptionId).toBe("roll");
    expect(bestOption).toBeUndefined();
    expect(decision?.options).toHaveLength(1);
  });

  it("replays historical recommendations with historical prices instead of current now_cost", () => {
    const db = createDatabase(path.join(tempDir, "historical-replay.sqlite"));
    seedHistoricalReplayScenario(db);

    const queryService = new QueryService(db);
    const decision = queryService.getTransferDecision(1, { gw: 7, horizon: 1 });
    const bestOption = decision?.options.find((option) => option.label === "best_1ft");

    expect(decision).not.toBeNull();
    expect(decision?.replayState).toBe("degraded");
    expect(decision?.replayNotes.join(" ")).toMatch(/historical/i);
    expect(bestOption?.transfers[0]).toMatchObject({
      outPlayerId: 110,
      inPlayerId: 113,
    });
    expect(bestOption?.transfers[0]?.inPlayerId).not.toBe(112);
  });

  it("uses historical sell value when owned pick selling_price is missing", () => {
    const db = createDatabase(path.join(tempDir, "historical-sell-value.sqlite"));
    seedHistoricalSellValueFallbackScenario(db);

    const queryService = new QueryService(db);
    const decision = queryService.getTransferDecision(1, { gw: 7, horizon: 1 });
    const bestOption = decision?.options.find((option) => option.label === "best_1ft");

    expect(decision).not.toBeNull();
    expect(bestOption?.transfers[0]).toMatchObject({
      outPlayerId: 210,
      inPlayerId: 212,
    });
    expect(bestOption?.transfers[0]?.inPlayerId).not.toBe(213);
  });

  it("does not let one-minute historical cameo outliers explode replay xPts", () => {
    const db = createDatabase(path.join(tempDir, "historical-low-minute-outlier.sqlite"));
    seedHistoricalLowMinuteOutlierScenario(db);

    const queryService = new QueryService(db);
    const decision = queryService.getTransferDecision(1, { gw: 29, horizon: 1 });
    const bestOption = decision?.options.find((option) => option.label === "best_1ft");

    expect(decision).not.toBeNull();
    expect(bestOption?.projectedGain ?? 0).toBeLessThan(8);
    expect(bestOption?.nextGwGain ?? 0).toBeLessThan(8);
    expect(decision?.recommendedOptionId).toBe("roll");
  });

  it("keeps current-gameweek xPts grounded when recent history includes a one-minute cameo outlier", () => {
    const db = createDatabase(path.join(tempDir, "historical-low-minute-current-xpts.sqlite"));
    seedHistoricalLowMinuteOutlierScenario(db);

    const queryService = new QueryService(db);
    const xpts = queryService.getPlayerXpts(30);
    const beto = xpts.find((row) => row.playerId === 311);

    expect(beto).toBeDefined();
    expect(beto?.xpts ?? 0).toBeLessThan(8);
  });
});
