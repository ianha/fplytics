import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { seedPublicData } from "./myTeamFixtures.js";
import { buildDatabaseSchema, executeReadOnlyQuery, isSafeReadOnlyQuery } from "../src/chat/databaseTools.js";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-db-tools-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("databaseTools", () => {
  it("allows only SELECT and WITH queries", () => {
    expect(isSafeReadOnlyQuery("SELECT 1")).toBe(true);
    expect(isSafeReadOnlyQuery("WITH sample AS (SELECT 1) SELECT * FROM sample")).toBe(true);
    expect(isSafeReadOnlyQuery("DELETE FROM players")).toBe(false);
  });

  it("builds the annotated schema and executes read-only queries", () => {
    const db = createDatabase(path.join(tempDir, "database-tools.sqlite"));
    seedPublicData(db);

    const schema = buildDatabaseSchema(db);
    const players = executeReadOnlyQuery(db, "SELECT id, web_name FROM players ORDER BY id LIMIT 1") as Array<{
      id: number;
      web_name: string;
    }>;

    expect(schema.some((table) => table.table === "players")).toBe(true);
    expect(players[0]).toMatchObject({ id: 10, web_name: "Saka" });
  });
});
