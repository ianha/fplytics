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
    seedPublicData(db);

    // GW 29 is current
    db.prepare(
      `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
       VALUES (29, 'Gameweek 29', ?, 55, 104, 1, 0, ?)`,
    ).run("2026-03-22T10:00:00.000Z", now());

    // Arsenal (teamId=1) has a normal GW29 fixture (home vs Liverpool)
    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(901, 9901, 29, "2026-03-29T15:00:00.000Z", 1, 2, null, null, 0, 0, now());

    // Arsenal also has a second GW29 fixture (DGW) — away at Liverpool (artificial DGW for test)
    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(902, 9902, 29, "2026-03-31T20:00:00.000Z", 2, 1, null, null, 0, 0, now());

    // GW30 has only Arsenal (Liverpool is BGW in GW30)
    db.prepare(
      `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
       VALUES (30, 'Gameweek 30', ?, 55, 104, 0, 0, ?)`,
    ).run("2026-04-05T10:00:00.000Z", now());

    db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(903, 9903, 30, "2026-04-12T15:00:00.000Z", 1, 2, null, null, 0, 0, now());

    const queryService = new QueryService(db);
    const calendar = queryService.getGwCalendar();

    const arsenal = calendar.find((r) => r.teamShortName === "ARS");
    const liverpool = calendar.find((r) => r.teamShortName === "LIV");

    expect(arsenal).toBeDefined();
    expect(liverpool).toBeDefined();

    // Arsenal GW29: DGW (2 fixtures)
    expect(arsenal!.gameweeks[29]).toHaveLength(2);

    // Liverpool GW30: BGW (0 fixtures — no fixture seeded for LIV in GW30)
    expect(liverpool!.gameweeks[30]).toHaveLength(0);

    // Arsenal GW29 home fixture has isHome:true and opponentShort:"LIV"
    const arsenalGw29 = arsenal!.gameweeks[29];
    expect(arsenalGw29.some((f) => f.isHome && f.opponentShort === "LIV")).toBe(true);
    // Arsenal GW29 away fixture has isHome:false
    expect(arsenalGw29.some((f) => !f.isHome && f.opponentShort === "LIV")).toBe(true);
  });
});
