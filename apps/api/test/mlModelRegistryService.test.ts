import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { MlModelRegistryService } from "../src/services/mlModelRegistryService.js";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-ml-model-registry-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("MlModelRegistryService", () => {
  it("creates explicit model registry tables on database initialization", () => {
    const db = createDatabase(path.join(tempDir, "schema.sqlite"));

    const tables = db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('ml_model_registry', 'ml_model_versions')
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;

    expect(tables.map((table) => table.name)).toEqual([
      "ml_model_registry",
      "ml_model_versions",
    ]);
  });

  it("activates only one model version per registry at a time", () => {
    const db = createDatabase(path.join(tempDir, "versions.sqlite"));
    const service = new MlModelRegistryService(db);
    const registry = service.createRegistry({
      modelName: "transfer_event_points_v2",
      targetMetric: "expected_raw_points",
      description: "Learns event-based raw point coefficients",
    });

    const initialVersion = service.createVersion({
      registryId: registry.id,
      versionTag: "v1",
      coefficients: { rolling_xg: 1.2, rolling_xa: 0.8 },
      activate: true,
    });

    const replacementVersion = service.createVersion({
      registryId: registry.id,
      versionTag: "v2",
      coefficients: { rolling_xg: 1.4, rolling_xa: 0.9 },
      activate: true,
    });

    const activeVersion = service.getActiveVersion(registry.id);
    const storedInitialVersion = service.getVersionById(initialVersion.id);

    expect(activeVersion?.id).toBe(replacementVersion.id);
    expect(activeVersion?.isActive).toBe(true);
    expect(storedInitialVersion.isActive).toBe(false);
  });

  it("stores pending ML evaluation state in sync_state independently of model versions", () => {
    const db = createDatabase(path.join(tempDir, "pending-evaluation.sqlite"));
    const service = new MlModelRegistryService(db);

    const pending = service.setPendingMlEvaluation(29);
    const stored = service.getPendingMlEvaluation();

    expect(pending).toMatchObject({
      gameweekId: 29,
      status: "pending",
    });
    expect(stored).toMatchObject({
      gameweekId: 29,
      status: "pending",
    });
  });
});
