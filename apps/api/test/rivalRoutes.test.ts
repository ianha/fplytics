import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/database.js";
import { seedH2HComparisonData } from "./h2hFixtures.js";
import { now, seedPublicData } from "./myTeamFixtures.js";

let tempDir = "";

function seedPhaseOneData(db: ReturnType<typeof createDatabase>) {
  seedPublicData(db);

  db.prepare(
    `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
     VALUES
     (1, 'Gameweek 1', ?, 50, 100, 0, 1, ?),
     (2, 'Gameweek 2', ?, 51, 101, 1, 0, ?)`,
  ).run("2026-08-15T10:00:00.000Z", now(), "2026-08-22T10:00:00.000Z", now());

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
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-rival-routes-"));
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = String(input);

    if (url.endsWith("/leagues-classic/99/standings/?page=1")) {
      return new Response(JSON.stringify({
        league: { id: 99, name: "Writers ML" },
        standings: {
          has_next: true,
          results: [
            { entry: 501, player_name: "Brad", entry_name: "Brad FC", rank: 1, total: 130 },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.endsWith("/leagues-classic/99/standings/?page=2")) {
      return new Response(JSON.stringify({
        league: { id: 99, name: "Writers ML" },
        standings: {
          has_next: false,
          results: [
            { entry: 502, player_name: "Sean", entry_name: "Sean FC", rank: 2, total: 125 },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.endsWith("/entry/501/history/")) {
      return new Response(JSON.stringify({
        current: [
          {
            event: 1,
            points: 62,
            total_points: 62,
            overall_rank: 15000,
            rank: 15000,
            event_transfers: 1,
            event_transfers_cost: 4,
            points_on_bench: 5,
          },
          {
            event: 2,
            points: 71,
            total_points: 133,
            overall_rank: 9000,
            rank: 9000,
            event_transfers: 0,
            event_transfers_cost: 0,
            points_on_bench: 3,
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.endsWith("/entry/501/event/1/picks/")) {
      return new Response(JSON.stringify({
        active_chip: null,
        picks: [
          { element: 10, position: 1, multiplier: 2, is_captain: true, is_vice_captain: false },
          { element: 11, position: 12, multiplier: 0, is_captain: false, is_vice_captain: true },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.endsWith("/entry/501/event/2/picks/")) {
      return new Response(JSON.stringify({
        active_chip: null,
        picks: [
          { element: 11, position: 1, multiplier: 2, is_captain: true, is_vice_captain: false },
          { element: 10, position: 12, multiplier: 0, is_captain: false, is_vice_captain: true },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({ message: `Unhandled URL ${url}` }), { status: 404 });
  }) as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Rival league routes", () => {
  it("returns paginated classic standings through the API", async () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPhaseOneData(db);
    const app = createApp(db);

    const response = await request(app)
      .get("/api/leagues/99/standings?type=classic")
      .expect(200);

    expect(response.body).toEqual([
      { entryId: 501, playerName: "Brad", teamName: "Brad FC", rank: 1, totalPoints: 130 },
      { entryId: 502, playerName: "Sean", teamName: "Sean FC", rank: 2, totalPoints: 125 },
    ]);
  });

  it("syncs one rival through the API and persists rival rows", async () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedPhaseOneData(db);
    const app = createApp(db);

    const response = await request(app)
      .post("/api/leagues/99/sync")
      .send({ accountId: 1, rivalEntryId: 501, type: "classic" })
      .expect(200);

    const rivalEntries = db
      .prepare("SELECT COUNT(*) AS count FROM rival_entries")
      .get() as { count: number };
    const rivalGameweeks = db
      .prepare("SELECT COUNT(*) AS count FROM rival_gameweeks")
      .get() as { count: number };
    const rivalPicks = db
      .prepare("SELECT COUNT(*) AS count FROM rival_picks")
      .get() as { count: number };

    expect(response.body).toMatchObject({
      entryId: 501,
      syncedGameweeks: 2,
      lastSyncedGw: 2,
    });
    expect(rivalEntries.count).toBe(2);
    expect(rivalGameweeks.count).toBe(2);
    expect(rivalPicks.count).toBe(4);
  });

  it("returns the first h2h comparison payload for a synced rival", async () => {
    const db = createDatabase(path.join(tempDir, "test.sqlite"));
    seedH2HComparisonData(db);
    const app = createApp(db);

    const response = await request(app)
      .get("/api/leagues/99/h2h/501?accountId=1")
      .expect(200);

    expect(response.body.syncRequired).toBe(false);
    expect(response.body.rivalEntry).toMatchObject({
      entryId: 501,
      playerName: "Brad",
      teamName: "Brad FC",
    });
    expect(response.body.squadOverlap).toMatchObject({
      gameweek: 2,
      overlapPct: 93.3,
    });
    expect(response.body.syncStatus).toMatchObject({
      currentGameweek: 3,
      lastSyncedGw: 2,
      stale: true,
    });
    expect(response.body.luckVsSkill).toMatchObject({
      basedOnGameweek: 3,
      dataQuality: "full",
    });
    expect(response.body.gmRankHistory).toEqual([
      { gameweek: 1, userOverallRank: 120000, rivalOverallRank: 130000 },
      { gameweek: 2, userOverallRank: 90000, rivalOverallRank: 98000 },
    ]);
  });
});
