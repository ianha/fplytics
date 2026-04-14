import type { AppDatabase } from "../db/database.js";
import {
  buildDatabaseSchema,
  executeReadOnlyQuery,
  READ_ONLY_QUERY_ERROR_MESSAGE,
} from "./databaseTools.js";

export const FPL_TOOL_DEFINITIONS = [
  {
    name: "query",
    description:
      "Execute a read-only SQL SELECT (or WITH…SELECT) against the FPL SQLite database. Returns a JSON array of result rows.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "A read-only SQL query. Must start with SELECT or WITH.",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "get_schema",
    description:
      "Return the full schema of the FPL database — all tables, column names, and types. Call this before writing queries when you are unsure about table or column names.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
] as const;

export type FplToolName = "query" | "get_schema";

export function executeTool(
  db: AppDatabase,
  name: FplToolName,
  input: Record<string, unknown>,
): string {
  if (name === "get_schema") {
    try {
      return JSON.stringify(buildDatabaseSchema(db), null, 2);
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (name === "query") {
    const sql = String(input.sql ?? "");
    try {
      return JSON.stringify(executeReadOnlyQuery(db, sql));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: message || READ_ONLY_QUERY_ERROR_MESSAGE });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}
