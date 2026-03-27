import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import {
  acknowledgePendingMlEvaluation,
  parseAckPendingMlEvaluationArgs,
} from "../src/cli/ackPendingMlEvaluation.js";
import { MlModelRegistryService } from "../src/services/mlModelRegistryService.js";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-ack-pending-ml-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("ackPendingMlEvaluationCli", () => {
  it("parses a targeted gameweek acknowledgement", () => {
    expect(parseAckPendingMlEvaluationArgs(["--gameweek", "29"])).toEqual({
      gameweek: 29,
      all: false,
    });
  });

  it("parses a full-queue acknowledgement", () => {
    expect(parseAckPendingMlEvaluationArgs(["--all"])).toEqual({
      gameweek: undefined,
      all: true,
    });
  });

  it("requires either one gameweek or --all", () => {
    expect(() => parseAckPendingMlEvaluationArgs([])).toThrow(
      "Pass `--gameweek <id>` to acknowledge one item or `--all` to clear the full queue.",
    );
    expect(() => parseAckPendingMlEvaluationArgs(["--all", "--gameweek", "29"])).toThrow(
      "Use either `--gameweek` or `--all`, not both.",
    );
  });

  it("acknowledges one processed queue item without dropping the rest", () => {
    const db = createDatabase(path.join(tempDir, "ack-one.sqlite"));
    const service = new MlModelRegistryService(db);

    service.setPendingMlEvaluation(29);
    service.setPendingMlEvaluation(30);

    const result = acknowledgePendingMlEvaluation(db, { gameweek: 29 });

    expect(result).toEqual({
      requestedGameweek: 29,
      clearedGameweeks: [29],
      remainingGameweeks: [30],
    });
  });

  it("can clear the full queue after a successful batch training run", () => {
    const db = createDatabase(path.join(tempDir, "ack-all.sqlite"));
    const service = new MlModelRegistryService(db);

    service.setPendingMlEvaluation(29);
    service.setPendingMlEvaluation(30);

    const result = acknowledgePendingMlEvaluation(db, { all: true });

    expect(result).toEqual({
      requestedGameweek: null,
      clearedGameweeks: [29, 30],
      remainingGameweeks: [],
    });
    expect(service.getPendingMlEvaluation()).toBeNull();
  });
});
