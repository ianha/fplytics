import { createDatabase } from "../src/db/database.js";
import { now, seedPublicData } from "./myTeamFixtures.js";

export function seedH2HComparisonData(db: ReturnType<typeof createDatabase>) {
  seedPublicData(db);

  db.prepare(
    `INSERT INTO positions (id, name, short_name, updated_at)
     VALUES (1, 'Goalkeeper', 'GKP', ?), (2, 'Defender', 'DEF', ?)`,
  ).run(now(), now());

  db.prepare(
    `INSERT INTO teams (id, code, name, short_name, strength, updated_at)
     VALUES (3, 8, 'Chelsea', 'CHE', 4, ?),
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

  insertPlayer.run(
    12, 10012, "Martinelli", "Gabriel", "Martinelli", 1, 3, 70, 140,
    5.9, 14, 5.1, 9, 6, 7, 2400,
    16, 430, 55, 65, 70, 63, 8.4, 5.1,
    13.5, 0.6, 0.9, 1.5, 21, 0.25, 27,
    14, 44, 18, "10012.jpg", 3, "a", now(),
  );
  insertPlayer.run(
    20, 10020, "Raya", "David", "Raya", 1, 1, 55, 150,
    5.2, 15, 4.8, 0, 0, 12, 2700,
    12, 420, 10, 20, 5, 11, 0.1, 0.02,
    0.12, -0.1, -0.02, -0.12, 25, 0.4, 30,
    0, 10, 18, "10020.jpg", 3, "a", now(),
  );
  insertPlayer.run(
    21, 10021, "Gabriel", "Gabriel", "Magalhaes", 1, 2, 60, 155,
    5.5, 20, 5.0, 4, 1, 13, 2800,
    14, 450, 20, 25, 30, 25, 2.0, 0.4,
    2.4, 2.0, 0.6, 2.6, 22, 0.42, 31,
    30, 70, 55, "10021.jpg", 3, "a", now(),
  );
  insertPlayer.run(
    22, 10022, "Isak", "Alexander", "Isak", 3, 4, 85, 170,
    6.4, 18, 5.6, 14, 4, 5, 2500,
    18, 510, 22, 30, 40, 31, 10.2, 2.1,
    12.3, 3.8, 1.9, 5.7, 18, 0.18, 28,
    8, 28, 20, "10022.jpg", 8, "a", now(),
  );
  insertPlayer.run(
    23, 10023, "Palmer", "Cole", "Palmer", 3, 3, 105, 220,
    7.3, 25, 6.1, 16, 9, 7, 2900,
    24, 610, 90, 110, 120, 106, 15.0, 9.5,
    24.5, 1.0, -0.5, 0.5, 20, 0.22, 33,
    15, 60, 22, "10023.jpg", 8, "a", now(),
  );
  for (let id = 24; id <= 32; id += 1) {
    insertPlayer.run(
      id,
      10000 + id,
      `Player ${id}`,
      "Player",
      String(id),
      id % 2 === 0 ? 1 : 3,
      (id % 4) + 1,
      45 + id,
      100 + id,
      5.1,
      10,
      4.8,
      3,
      2,
      5,
      2000 + id,
      10,
      300,
      20,
      20,
      20,
      20,
      3,
      2,
      5,
      0.5,
      0.4,
      0.9,
      20,
      0.2,
      20,
      10,
      20,
      15,
      `${10000 + id}.jpg`,
      id % 2 === 0 ? 3 : 8,
      "a",
      now(),
    );
  }

  insertPlayer.run(
    33, 10033, "Udogie", "Destiny", "Udogie", 3, 2, 48, 98,
    4.8, 7, 3.9, 2, 3, 8, 2100,
    10, 280, 24, 30, 28, 27, 1.5, 2.6,
    4.1, 0.5, 0.8, 1.3, 23, 0.32, 24,
    28, 64, 44, "10033.jpg", 8, "a", now(),
  );
  insertPlayer.run(
    34, 10034, "Gordon", "Anthony", "Gordon", 3, 3, 75, 165,
    6.1, 16, 5.4, 11, 8, 5, 2550,
    16, 410, 58, 75, 66, 64, 9.8, 6.7,
    16.5, 1.2, 0.9, 2.1, 18, 0.19, 29,
    12, 34, 19, "10034.jpg", 8, "a", now(),
  );

  db.prepare(
    `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
     VALUES
     (1, 'Gameweek 1', ?, 50, 100, 0, 1, ?),
     (2, 'Gameweek 2', ?, 51, 101, 0, 1, ?),
     (3, 'Gameweek 3', ?, 52, 102, 1, 0, ?)`,
  ).run(
    "2026-08-15T10:00:00.000Z", now(),
    "2026-08-22T10:00:00.000Z", now(),
    "2026-08-29T10:00:00.000Z", now(),
  );

  db.prepare(
    `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
     VALUES
     (301, 1301, 3, '2026-08-29T15:00:00.000Z', 1, 4, NULL, NULL, 0, 0, ?),
     (302, 1302, 3, '2026-08-30T15:00:00.000Z', 2, 3, NULL, NULL, 0, 0, ?)`,
  ).run(now(), now());

  db.prepare(
    `INSERT INTO my_team_accounts (
      id, email, encrypted_credentials, manager_id, entry_id, player_first_name, player_last_name,
      team_name, auth_status, last_authenticated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    1,
    "ian@fpl.local",
    "encrypted",
    77,
    321,
    "Ian",
    "Harper",
    "Midnight Press FC",
    "authenticated",
    now(),
    now(),
  );

  db.prepare(
    `INSERT INTO my_team_gameweeks (
      account_id, gameweek_id, points, total_points, overall_rank, rank, bank, value, event_transfers,
      event_transfers_cost, points_on_bench, active_chip
    ) VALUES
      (1, 1, 60, 60, 120000, 120000, 10, 1000, 1, 0, 4, NULL),
      (1, 2, 72, 132, 90000, 90000, 12, 1005, 0, 0, 7, NULL)`,
  ).run();

  const insertMyPick = db.prepare(
    `INSERT INTO my_team_picks (
      account_id, gameweek_id, player_id, position, multiplier, is_captain, is_vice_captain, selling_price, purchase_price, gw_points
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const gw1MyPicks = [
    [20, 1, 1, 0, 0, 6],
    [21, 2, 1, 0, 1, 7],
    [10, 3, 1, 0, 0, 10],
    [11, 4, 1, 0, 0, 5],
    [12, 5, 1, 0, 0, 4],
    [22, 6, 2, 1, 0, 8],
    [24, 7, 1, 0, 0, 3],
    [25, 8, 1, 0, 0, 2],
    [26, 9, 1, 0, 0, 6],
    [27, 10, 1, 0, 0, 4],
    [28, 11, 1, 0, 0, 5],
    [29, 12, 0, 0, 0, 2],
    [30, 13, 0, 0, 0, 1],
    [31, 14, 0, 0, 0, 1],
    [32, 15, 0, 0, 0, 0],
  ] as const;
  const gw2MyPicks = [
    [20, 1, 1, 0, 0, 4],
    [21, 2, 1, 0, 1, 8],
    [10, 3, 1, 0, 0, 9],
    [11, 4, 1, 0, 0, 6],
    [12, 5, 1, 0, 0, 5],
    [22, 6, 2, 1, 0, 9],
    [24, 7, 1, 0, 0, 4],
    [25, 8, 1, 0, 0, 3],
    [26, 9, 1, 0, 0, 7],
    [27, 10, 1, 0, 0, 5],
    [28, 11, 1, 0, 0, 12],
    [29, 12, 0, 0, 0, 3],
    [30, 13, 0, 0, 0, 2],
    [31, 14, 0, 0, 0, 1],
    [32, 15, 0, 0, 0, 1],
  ] as const;

  for (const [playerId, position, multiplier, isCaptain, isViceCaptain, gwPoints] of gw1MyPicks) {
    insertMyPick.run(1, 1, playerId, position, multiplier, isCaptain, isViceCaptain, 100, 100, gwPoints);
  }
  for (const [playerId, position, multiplier, isCaptain, isViceCaptain, gwPoints] of gw2MyPicks) {
    insertMyPick.run(1, 2, playerId, position, multiplier, isCaptain, isViceCaptain, 100, 100, gwPoints);
  }

  db.prepare(
    `INSERT INTO rival_entries (
      entry_id, player_name, team_name, overall_rank, total_points, last_synced_gw, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(501, "Brad", "Brad FC", 1, 130, 2, now());

  db.prepare(
    `INSERT INTO rival_leagues (league_id, league_type, league_name, account_id, synced_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(99, "classic", "Writers ML", 1, now());

  db.prepare(
    `INSERT INTO rival_gameweeks (
      entry_id, gameweek_id, points, total_points, overall_rank, rank, event_transfers, event_transfers_cost, points_on_bench, active_chip
    ) VALUES
      (501, 1, 54, 54, 130000, 130000, 1, 4, 3, NULL),
      (501, 2, 68, 126, 98000, 98000, 0, 0, 6, NULL)`,
  ).run();

  const insertRivalPick = db.prepare(
    `INSERT INTO rival_picks (
      entry_id, gameweek_id, player_id, position, multiplier, is_captain, is_vice_captain, gw_points
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const gw1RivalPicks = [
    [20, 1, 1, 0, 0, 3],
    [21, 2, 1, 0, 1, 7],
    [10, 3, 1, 0, 0, 10],
    [11, 4, 1, 0, 0, 5],
    [12, 5, 1, 0, 0, 4],
    [23, 6, 2, 1, 0, 6],
    [24, 7, 1, 0, 0, 3],
    [25, 8, 1, 0, 0, 2],
    [26, 9, 1, 0, 0, 6],
    [27, 10, 1, 0, 0, 4],
    [28, 11, 1, 0, 0, 4],
    [29, 12, 0, 0, 0, 1],
    [30, 13, 0, 0, 0, 1],
    [31, 14, 0, 0, 0, 1],
    [32, 15, 0, 0, 0, 0],
  ] as const;
  const gw2RivalPicks = [
    [20, 1, 1, 0, 0, 2],
    [21, 2, 1, 0, 1, 8],
    [10, 3, 1, 0, 0, 9],
    [11, 4, 1, 0, 0, 6],
    [12, 5, 1, 0, 0, 5],
    [23, 6, 2, 1, 0, 8],
    [24, 7, 1, 0, 0, 4],
    [25, 8, 1, 0, 0, 3],
    [26, 9, 1, 0, 0, 7],
    [27, 10, 1, 0, 0, 5],
    [28, 11, 1, 0, 0, 15],
    [29, 12, 0, 0, 0, 2],
    [30, 13, 0, 0, 0, 2],
    [31, 14, 0, 0, 0, 1],
    [32, 15, 0, 0, 0, 1],
  ] as const;

  for (const [playerId, position, multiplier, isCaptain, isViceCaptain, gwPoints] of gw1RivalPicks) {
    insertRivalPick.run(501, 1, playerId, position, multiplier, isCaptain, isViceCaptain, gwPoints);
  }
  for (const [playerId, position, multiplier, isCaptain, isViceCaptain, gwPoints] of gw2RivalPicks) {
    insertRivalPick.run(501, 2, playerId, position, multiplier, isCaptain, isViceCaptain, gwPoints);
  }

  const historyProfiles = new Map<number, { xg: number; xa: number; xgc: number; minutes: number; teamId: number }>([
    [20, { xg: 0.02, xa: 0.01, xgc: 0.65, minutes: 90, teamId: 1 }],
    [21, { xg: 0.10, xa: 0.03, xgc: 0.60, minutes: 90, teamId: 1 }],
    [22, { xg: 0.48, xa: 0.12, xgc: 1.05, minutes: 86, teamId: 3 }],
    [23, { xg: 0.42, xa: 0.30, xgc: 1.00, minutes: 88, teamId: 3 }],
    [24, { xg: 0.08, xa: 0.04, xgc: 0.88, minutes: 82, teamId: 1 }],
    [25, { xg: 0.10, xa: 0.05, xgc: 0.95, minutes: 84, teamId: 3 }],
    [26, { xg: 0.14, xa: 0.06, xgc: 0.98, minutes: 85, teamId: 1 }],
    [27, { xg: 0.18, xa: 0.08, xgc: 1.00, minutes: 83, teamId: 3 }],
    [28, { xg: 0.12, xa: 0.04, xgc: 0.92, minutes: 80, teamId: 1 }],
    [10, { xg: 0.54, xa: 0.22, xgc: 0.90, minutes: 89, teamId: 1 }],
    [11, { xg: 0.70, xa: 0.25, xgc: 0.85, minutes: 90, teamId: 2 }],
    [12, { xg: 0.32, xa: 0.19, xgc: 0.88, minutes: 84, teamId: 1 }],
  ]);

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

  for (const [playerId, profile] of historyProfiles) {
    for (const round of [1, 2]) {
      insertHistory.run(
        playerId,
        round,
        6,
        profile.minutes,
        0,
        0,
        profile.teamId === 1 ? 1 : 0,
        1,
        20,
        12,
        18,
        20,
        5,
        profile.xg,
        profile.xa,
        profile.xg + profile.xa,
        0,
        0,
        0,
        profile.xgc,
        1,
        3,
        1,
        2,
        playerId === 20 ? 3 : 0,
        0,
        0,
        0,
        0,
        0,
        profile.teamId === 1 ? 1 : 0,
        1,
        profile.teamId === 2 ? 3 : 2,
        profile.teamId,
        100,
        round % 2 === 0 ? 1 : 0,
        `2026-08-${14 + round}T15:00:00.000Z`,
        now(),
      );
    }
  }
}
