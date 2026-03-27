import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import {
  parseSeedPendingMlEvaluationArgs,
  seedPendingMlEvaluationFromFinishedGameweeks,
} from "../src/cli/seedPendingMlEvaluation.js";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-seed-pending-ml-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("seedPendingMlEvaluationCli", () => {
  it("parses an optional targeted gameweek", () => {
    expect(parseSeedPendingMlEvaluationArgs(["--gameweek", "29"])).toEqual({
      gameweek: 29,
    });
  });

  it("seeds all finished gameweeks into the pending ML queue without duplication", () => {
    const db = createDatabase(path.join(tempDir, "seed-all.sqlite"));

    db.prepare(
      `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
       VALUES (28, 'GW28', '2026-03-01T10:00:00.000Z', 50, 100, 0, 1, '2026-03-01T12:00:00.000Z'),
              (29, 'GW29', '2026-03-08T10:00:00.000Z', 52, 101, 0, 1, '2026-03-08T12:00:00.000Z'),
              (30, 'GW30', '2026-03-15T10:00:00.000Z', 53, 102, 1, 0, '2026-03-15T12:00:00.000Z')`,
    ).run();

    const firstRun = seedPendingMlEvaluationFromFinishedGameweeks(db);
    const secondRun = seedPendingMlEvaluationFromFinishedGameweeks(db);

    expect(firstRun).toEqual({
      requestedGameweek: null,
      addedGameweeks: [28, 29],
      queuedGameweeks: [28, 29],
    });
    expect(secondRun).toEqual({
      requestedGameweek: null,
      addedGameweeks: [],
      queuedGameweeks: [28, 29],
    });
  });

  it("can seed one finished gameweek without adding unfinished ones", () => {
    const db = createDatabase(path.join(tempDir, "seed-one.sqlite"));

    db.prepare(
      `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
       VALUES (29, 'GW29', '2026-03-08T10:00:00.000Z', 52, 101, 0, 1, '2026-03-08T12:00:00.000Z'),
              (30, 'GW30', '2026-03-15T10:00:00.000Z', 53, 102, 1, 0, '2026-03-15T12:00:00.000Z')`,
    ).run();

    const finishedResult = seedPendingMlEvaluationFromFinishedGameweeks(db, { gameweek: 29 });
    const unfinishedResult = seedPendingMlEvaluationFromFinishedGameweeks(db, { gameweek: 30 });

    expect(finishedResult).toEqual({
      requestedGameweek: 29,
      addedGameweeks: [29],
      queuedGameweeks: [29],
    });
    expect(unfinishedResult).toEqual({
      requestedGameweek: 30,
      addedGameweeks: [],
      queuedGameweeks: [29],
    });
  });
});
