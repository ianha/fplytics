import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { QueryService } from "../src/services/queryService.js";
import { MyTeamSyncService } from "../src/my-team/myTeamSyncService.js";
import { createApp } from "../src/app.js";
import { now, seedPublicData } from "./myTeamFixtures.js";

vi.hoisted(() => {
  process.env.FPL_AUTH_SECRET = "test-fpl-secret";
});

const sessionFixtures = vi.hoisted(() => ({
  me: {
    player: {
      id: 77,
      entry: 321,
      entry_name: "Midnight Press FC",
    },
  },
  entry: {
    player_first_name: "Ian",
    player_last_name: "Harper",
    player_region_name: "Canada",
    name: "Midnight Press FC",
  },
  history: {
    current: [
      {
        event: 7,
        points: 64,
        total_points: 612,
        overall_rank: 121482,
        rank: 121482,
        bank: 14,
        value: 1012,
        event_transfers: 1,
        event_transfers_cost: 4,
        points_on_bench: 6,
      },
    ],
    past: [
      {
        season_name: "2025/26",
        total_points: 2310,
        rank: 150002,
      },
    ],
  },
  transfers: [
    {
      event: 7,
      time: "2026-03-18T18:00:00.000Z",
      element_in: 11,
      element_out: 10,
      element_in_cost: 110,
      element_out_cost: 105,
    },
  ],
  picks: {
    active_chip: null,
    entry_history: {
      bank: 14,
      value: 1012,
      event_transfers: 1,
      event_transfers_cost: 4,
      points_on_bench: 6,
      points: 64,
      total_points: 612,
      overall_rank: 121482,
      rank: 121482,
    },
    picks: [
      {
        element: 11,
        position: 1,
        multiplier: 1,
        is_captain: true,
        is_vice_captain: false,
        selling_price: 110,
        purchase_price: 108,
      },
      {
        element: 10,
        position: 12,
        multiplier: 0,
        is_captain: false,
        is_vice_captain: true,
        selling_price: 105,
        purchase_price: 103,
      },
    ],
  },
}));

const loginMock = vi.fn(async () => undefined);

vi.mock("../src/my-team/fplSessionClient.js", () => ({
  FplSessionClient: vi.fn().mockImplementation(() => ({
    login: loginMock,
    getMe: async () => sessionFixtures.me,
    getEntry: async () => sessionFixtures.entry,
    getEntryHistory: async () => sessionFixtures.history,
    getTransfers: async () => sessionFixtures.transfers,
    getEventPicks: async () => sessionFixtures.picks,
    getEntryIdFromMyTeamPage: async () => null,
    getEntryResolutionDiagnostics: () => "none",
  })),
}));

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-my-team-"));
  loginMock.mockClear();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function seedTransferDecisionData(db: ReturnType<typeof createDatabase>) {
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

  const insertFixture = db.prepare(
    `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertFixture.run(701, 9701, 7, "2026-03-23T15:00:00.000Z", 1, 2, null, null, 0, 0, now());
  insertFixture.run(702, 9702, 7, "2026-03-24T15:00:00.000Z", 3, 2, null, null, 0, 0, now());
  insertFixture.run(703, 9703, 8, "2026-03-30T15:00:00.000Z", 2, 1, null, null, 0, 0, now());
  insertFixture.run(704, 9704, 8, "2026-03-31T15:00:00.000Z", 2, 3, null, null, 0, 0, now());
  insertFixture.run(705, 9705, 9, "2026-04-06T15:00:00.000Z", 1, 2, null, null, 0, 0, now());
  insertFixture.run(706, 9706, 9, "2026-04-07T15:00:00.000Z", 3, 1, null, null, 0, 0, now());

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
}

describe("My Team sync", () => {
  it("stores linked credentials, syncs account data, and exposes a queryable page payload", async () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPublicData(db);

    const service = new MyTeamSyncService(db);
    const accountId = service.linkAccount("ian@fpl.local", "super-secret");
    const result = await service.syncAccount(accountId, true);
    const payload = new QueryService(db).getMyTeam(accountId);

    expect(result).toMatchObject({
      accountId,
      entryId: 321,
      syncedGameweeks: 1,
      currentGameweek: 7,
    });
    expect(loginMock).toHaveBeenCalledWith("ian@fpl.local", "super-secret");
    expect(payload).not.toBeNull();
    expect(payload?.managerName).toBe("Ian Harper");
    expect(payload?.teamName).toBe("Midnight Press FC");
    expect(payload?.currentGameweek).toBe(7);
    expect(payload?.picks).toHaveLength(2);
    expect(payload?.picks[0]?.player.webName).toBe("Salah");
    expect(payload?.transfers[0]?.playerOut.webName).toBe("Saka");
    expect(payload?.seasons[0]?.season).toBe("2025/26");
  });

  it("serves the linked-account flow through the API routes", async () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPublicData(db);

    const app = createApp(db);
    const response = await request(app)
      .post("/api/my-team/auth")
      .send({ email: "ian@fpl.local", password: "super-secret" })
      .expect(201);

    expect(response.body.teamName).toBe("Midnight Press FC");
    expect(response.body.accounts).toHaveLength(1);
    expect(response.body.accounts[0].authStatus).toBe("authenticated");

    const myTeam = await request(app).get("/api/my-team").expect(200);
    expect(myTeam.body.managerName).toBe("Ian Harper");
    expect(myTeam.body.picks[0].player.webName).toBe("Salah");
  });

  it("marks the account as relogin-required when stored credentials stop working", async () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPublicData(db);

    const service = new MyTeamSyncService(db);
    const accountId = service.linkAccount("ian@fpl.local", "super-secret");
    await service.syncAccount(accountId, true);

    loginMock.mockRejectedValueOnce(
      new Error("FPL login failed. Check your email/password and try again."),
    );

    await expect(service.syncAccount(accountId, true)).rejects.toThrow("FPL login failed");

    const accounts = service.getAccounts() as Array<{ id: number; authStatus: string; authError: string | null }>;
    const account = accounts.find((candidate) => candidate.id === accountId);
    const payload = new QueryService(db).getMyTeam(accountId);

    expect(account?.authStatus).toBe("relogin_required");
    expect(account?.authError).toContain("FPL login failed");
    expect(payload?.picks[0]?.player.webName).toBe("Salah");
  });

  it("fails with a clear message when FPL returns no manager entry for a newly linked account", async () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPublicData(db);

    const service = new MyTeamSyncService(db);
    const accountId = service.linkAccount("ian@fpl.local", "super-secret");

    const originalPlayer = sessionFixtures.me.player;
    sessionFixtures.me.player = null;

    await expect(service.syncAccount(accountId, true)).rejects.toThrow("no FPL team entry ID");

    const accounts = service.getAccounts() as Array<{ id: number; authStatus: string; authError: string | null }>;
    const account = accounts.find((candidate) => candidate.id === accountId);
    expect(account?.authStatus).toBe("relogin_required");
    expect(account?.authError).toContain("no FPL team entry ID");

    sessionFixtures.me.player = originalPlayer;
  });

  it("falls back to the authenticated My Team page when /api/me omits the entry id", async () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPublicData(db);

    const service = new MyTeamSyncService(db);
    const accountId = service.linkAccount("ian@fpl.local", "super-secret");

    const originalPlayer = sessionFixtures.me.player;
    sessionFixtures.me.player = null;

    const originalImplementation = vi.mocked(await import("../src/my-team/fplSessionClient.js")).FplSessionClient;
    originalImplementation.mockImplementationOnce(() => ({
      login: loginMock,
      getMe: async () => sessionFixtures.me,
      getEntry: async () => sessionFixtures.entry,
      getEntryHistory: async () => sessionFixtures.history,
      getTransfers: async () => sessionFixtures.transfers,
      getEventPicks: async () => sessionFixtures.picks,
      getEntryIdFromMyTeamPage: async () => 321,
      getEntryResolutionDiagnostics: () => "none",
    }) as any);

    const result = await service.syncAccount(accountId, true);
    expect(result.entryId).toBe(321);

    sessionFixtures.me.player = originalPlayer;
  });

  it("uses a manually provided entry id during account linking when automatic discovery fails", async () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPublicData(db);

    const originalPlayer = sessionFixtures.me.player;
    sessionFixtures.me.player = null;

    const app = createApp(db);
    const response = await request(app)
      .post("/api/my-team/auth")
      .send({ email: "ian@fpl.local", password: "super-secret", entryId: 321 })
      .expect(201);

    expect(response.body.accounts[0].entryId).toBe(321);
    expect(response.body.teamName).toBe("Midnight Press FC");

    sessionFixtures.me.player = originalPlayer;
  });

  it("serves transfer decision recommendations through the API", async () => {
    const db = createDatabase(path.join(tempDir, "transfer-decision.sqlite"));
    seedTransferDecisionData(db);

    const app = createApp(db);
    const response = await request(app)
      .get("/api/my-team/1/transfer-decision?horizon=3")
      .expect(200);

    expect(response.body.recommendedOptionId).toContain("best-1ft");
    expect(response.body.options).toHaveLength(2);
    expect(response.body.options[1].transfers[0]).toMatchObject({
      outPlayerId: 10,
      inPlayerId: 12,
    });
  });

  it("normalizes null rank values from FPL history instead of failing the sync", async () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPublicData(db);

    const service = new MyTeamSyncService(db);
    const accountId = service.linkAccount("ian@fpl.local", "super-secret");

    const originalCurrentRank = sessionFixtures.history.current[0].rank;
    const originalCurrentOverallRank = sessionFixtures.history.current[0].overall_rank;
    const originalPastRank = sessionFixtures.history.past[0].rank;
    const originalEntryHistoryRank = sessionFixtures.picks.entry_history.rank;
    const originalEntryHistoryOverallRank = sessionFixtures.picks.entry_history.overall_rank;

    sessionFixtures.history.current[0].rank = null;
    sessionFixtures.history.current[0].overall_rank = null;
    sessionFixtures.history.past[0].rank = null;
    sessionFixtures.picks.entry_history.rank = null;
    sessionFixtures.picks.entry_history.overall_rank = null;

    const result = await service.syncAccount(accountId, true);
    const payload = new QueryService(db).getMyTeam(accountId);

    expect(result.syncedGameweeks).toBe(1);
    expect(payload?.history[0]?.rank).toBe(0);
    expect(payload?.history[0]?.overallRank).toBe(0);
    expect(payload?.seasons[0]?.rank).toBe(0);
    expect(payload?.seasons[0]?.overallRank).toBe(0);

    sessionFixtures.history.current[0].rank = originalCurrentRank;
    sessionFixtures.history.current[0].overall_rank = originalCurrentOverallRank;
    sessionFixtures.history.past[0].rank = originalPastRank;
    sessionFixtures.picks.entry_history.rank = originalEntryHistoryRank;
    sessionFixtures.picks.entry_history.overall_rank = originalEntryHistoryOverallRank;
  });
});
