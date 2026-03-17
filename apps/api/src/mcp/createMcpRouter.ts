import { Router, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { AppDatabase } from "../db/database.js";
import { annotateSchema, type SchemaTable } from "../chat/schemaContext.js";

/** Only SELECT and WITH (CTEs) are permitted — checked before hitting the DB. */
function isSafeQuery(sql: string): boolean {
  const first = sql.trim().toUpperCase().split(/\s+/)[0];
  return first === "SELECT" || first === "WITH";
}

/** Creates a fresh McpServer + transport pair for each stateless request. */
function buildMcpServer(db: AppDatabase) {
  const server = new McpServer({ name: "fpl-database", version: "1.0.0" });

  // ── Tool: query ──────────────────────────────────────────────────────────
  server.tool(
    "query",
    "Execute a read-only SQL SELECT (or WITH…SELECT) query against the FPL SQLite database. Returns all result rows as a JSON array.",
    { sql: z.string().describe("A read-only SQL query. Must start with SELECT or WITH.") },
    async ({ sql }) => {
      if (!isSafeQuery(sql)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Only SELECT or WITH queries are permitted." }) }],
        };
      }
      try {
        const rows = db.prepare(sql).all();
        return { content: [{ type: "text" as const, text: JSON.stringify(rows) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
        };
      }
    },
  );

  // ── Resource: schema://fpl-database ──────────────────────────────────────
  server.resource(
    "fpl-database-schema",
    "schema://fpl-database",
    { description: "Full column definitions for all tables in the FPL SQLite database. Read this before writing queries.", mimeType: "application/json" },
    async () => {
      const tables = db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
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

      return {
        contents: [{ uri: "schema://fpl-database", mimeType: "application/json", text: JSON.stringify(annotateSchema(schema), null, 2) }],
      };
    },
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  return { server, transport };
}

export function createMcpRouter(db: AppDatabase): Router {
  const router = Router();

  // POST /mcp — all JSON-RPC requests (initialize, tools/call, resources/read, …)
  router.post("/", async (req: Request, res: Response) => {
    const { server, transport } = buildMcpServer(db);
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
      }
    }
  });

  // GET /mcp — stateless; no SSE streams supported
  router.get("/", (_req: Request, res: Response) => {
    res
      .status(405)
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "This MCP server is stateless; GET SSE streams are not supported." }, id: null });
  });

  // DELETE /mcp — no sessions to terminate
  router.delete("/", (_req: Request, res: Response) => {
    res
      .status(405)
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "This MCP server is stateless; no sessions exist." }, id: null });
  });

  return router;
}
