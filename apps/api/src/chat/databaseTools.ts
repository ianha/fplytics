import type { AppDatabase } from "../db/database.js";
import { annotateSchema, type SchemaTable } from "./schemaContext.js";

export const READ_ONLY_QUERY_ERROR_MESSAGE = "Only SELECT or WITH queries are permitted.";

export function isSafeReadOnlyQuery(sql: string): boolean {
  const first = sql.trim().toUpperCase().split(/\s+/)[0];
  return first === "SELECT" || first === "WITH";
}

export function buildDatabaseSchema(db: AppDatabase) {
  const tables = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string; sql: string }[];

  const schema = tables.map((table) => ({
    table: table.name,
    createSql: table.sql,
    columns: (db.prepare(`PRAGMA table_info(${table.name})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>).map((column) => ({
      name: column.name,
      type: column.type,
      notNull: column.notnull === 1,
      defaultValue: column.dflt_value,
      primaryKey: column.pk > 0,
    })),
  })) satisfies SchemaTable[];

  return annotateSchema(schema);
}

export function executeReadOnlyQuery(db: AppDatabase, sql: string) {
  if (!isSafeReadOnlyQuery(sql)) {
    throw new Error(READ_ONLY_QUERY_ERROR_MESSAGE);
  }

  return db.prepare(sql).all();
}
