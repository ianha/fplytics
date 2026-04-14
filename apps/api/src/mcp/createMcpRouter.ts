import { Router, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { AppDatabase } from "../db/database.js";
import { TrainingMatrixService } from "../services/trainingMatrixService.js";
import { ManagerRoiService } from "../services/managerRoiService.js";
import { MlModelRegistryService } from "../services/mlModelRegistryService.js";
import {
  buildDatabaseSchema,
  executeReadOnlyQuery,
  READ_ONLY_QUERY_ERROR_MESSAGE,
} from "../chat/databaseTools.js";

/** Creates a fresh McpServer + transport pair for each stateless request. */
function buildMcpServer(db: AppDatabase) {
  const server = new McpServer({ name: "fpl-database", version: "1.0.0" });
  const trainingMatrixService = new TrainingMatrixService(db);
  const managerRoiService = new ManagerRoiService(db);
  const mlModelRegistryService = new MlModelRegistryService(db);

  // ── Tool: query ──────────────────────────────────────────────────────────
  server.tool(
    "query",
    "Execute a read-only SQL SELECT (or WITH…SELECT) query against the FPL SQLite database. Returns all result rows as a JSON array.",
    { sql: z.string().describe("A read-only SQL query. Must start with SELECT or WITH.") },
    async ({ sql }) => {
      try {
        const rows = executeReadOnlyQuery(db, sql);
        return { content: [{ type: "text" as const, text: JSON.stringify(rows) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) || READ_ONLY_QUERY_ERROR_MESSAGE }) }],
        };
      }
    },
  );

  server.tool(
    "get_training_matrix",
    "Returns a supervised learning dataset mapping historical rolling player performance to actual target-match points, with strict no-lookahead enforcement.",
    {
      target_gameweek: z.number().int().positive().describe("Target gameweek to build supervised rows for."),
      lookback_window: z.number().int().positive().default(5).describe("Number of prior gameweeks to average for feature inputs."),
    },
    async ({ target_gameweek, lookback_window }) => {
      try {
        const rows = trainingMatrixService.getTrainingMatrix({
          targetGameweek: target_gameweek,
          lookbackWindow: lookback_window,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(rows) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
        };
      }
    },
  );

  server.tool(
    "evaluate_manager_roi",
    "Returns a Bayesian-smoothed manager transfer profile, including transfer outcomes, hit ROI, and recommended risk posture.",
    {
      account_id: z.number().int().positive().describe("The my_team_accounts.id to profile."),
      from_gameweek: z.number().int().positive().optional().describe("Optional lower gameweek bound."),
      to_gameweek: z.number().int().positive().optional().describe("Optional upper gameweek bound."),
      future_window: z.number().int().positive().default(3).describe("Number of future gameweeks used to measure transfer outcomes."),
      sample_threshold: z.number().int().positive().default(15).describe("Minimum transfer sample size before using fully personalized outputs."),
    },
    async ({ account_id, from_gameweek, to_gameweek, future_window, sample_threshold }) => {
      try {
        const profile = managerRoiService.evaluateManagerRoi({
          accountId: account_id,
          fromGameweek: from_gameweek,
          toGameweek: to_gameweek,
          futureWindow: future_window,
          sampleThreshold: sample_threshold,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(profile) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
        };
      }
    },
  );

  server.tool(
    "update_projection_weights",
    "Validates and stores a new ML coefficient payload in the explicit model registry/version store.",
    {
      model_name: z.string().min(1).describe("Logical model name, for example transfer_event_points_v2."),
      target_metric: z.string().min(1).default("expected_raw_points").describe("Target metric produced by this model."),
      description: z.string().optional().describe("Optional human-readable model description."),
      version_tag: z.string().optional().describe("Optional semantic version or training run label."),
      coefficients: z.record(z.unknown()).describe("JSON coefficient payload to persist."),
      metadata: z.record(z.unknown()).optional().describe("Optional metadata for auditability."),
      gameweek_scope: z.string().optional().describe("Optional gameweek scope or label for this version."),
      activate: z.boolean().default(true).describe("Whether to mark this new version active immediately."),
    },
    async ({ model_name, target_metric, description, version_tag, coefficients, metadata, gameweek_scope, activate }) => {
      try {
        const registry = mlModelRegistryService.ensureRegistry({
          modelName: model_name,
          targetMetric: target_metric,
          description,
        });
        const version = mlModelRegistryService.createVersion({
          registryId: registry.id,
          versionTag: version_tag,
          coefficients,
          metadata,
          gameweekScope: gameweek_scope,
          activate,
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              registry,
              version,
            }),
          }],
        };
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
      return {
        contents: [{ uri: "schema://fpl-database", mimeType: "application/json", text: JSON.stringify(buildDatabaseSchema(db), null, 2) }],
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
