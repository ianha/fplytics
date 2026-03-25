import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { QueryService } from "../src/services/queryService.js";
import { now, seedPublicData } from "./myTeamFixtures.js";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-query-service-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

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
});
