import type { AppDatabase } from "../db/database.js";
import { annotateSchema, type SchemaTable } from "./schemaContext.js";

/** Only SELECT and WITH (CTEs) are permitted. */
function isSafeQuery(sql: string): boolean {
  const first = sql.trim().toUpperCase().split(/\s+/)[0];
  return first === "SELECT" || first === "WITH";
}

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
      const tables = db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string; sql: string }[];

      const schema = tables.map((t) => ({
        table: t.name,
        createSql: t.sql,
        columns: (db.prepare(`PRAGMA table_info(${t.name})`).all() as any[]).map((c) => ({
          name: c.name,
          type: c.type,
          notNull: c.notnull === 1,
          defaultValue: c.dflt_value,
          primaryKey: c.pk > 0,
        })),
      })) satisfies SchemaTable[];

      return JSON.stringify(annotateSchema(schema), null, 2);
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (name === "query") {
    const sql = String(input.sql ?? "");
    if (!isSafeQuery(sql)) {
      return JSON.stringify({ error: "Only SELECT or WITH queries are permitted." });
    }
    try {
      return JSON.stringify(db.prepare(sql).all());
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}
