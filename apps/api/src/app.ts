import cors from "cors";
import express from "express";
import { createApiRouter } from "./routes/createApiRouter.js";
import { createMcpRouter } from "./mcp/createMcpRouter.js";
import { createChatRouter } from "./chat/chatRouter.js";
import type { AppDatabase } from "./db/database.js";
import { env } from "./config/env.js";

export function createApp(db: AppDatabase) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/assets", express.static(env.assetsDir));
  app.use("/api", createApiRouter(db));
  app.use("/api/chat", createChatRouter(db));
  app.use("/mcp", createMcpRouter(db));
  return app;
}
