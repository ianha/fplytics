import { Router, type Request, type Response } from "express";
import type { AppDatabase } from "../db/database.js";
import type { ChatRequest } from "./chatTypes.js";
import { listProviderInfos, getProviderById } from "./providerConfig.js";
import * as oauthManager from "./oauthManager.js";
import { streamAnthropic } from "./providers/anthropic.js";
import { streamOpenAI } from "./providers/openai.js";
import { streamGemini } from "./providers/gemini.js";

export function createChatRouter(db: AppDatabase): Router {
  const router = Router();

  // ── GET /api/chat/providers ───────────────────────────────────────────────
  // Returns the list of configured providers (no secrets) for the frontend.
  router.get("/providers", (_req: Request, res: Response) => {
    res.json(listProviderInfos());
  });

  // ── POST /api/chat/stream ─────────────────────────────────────────────────
  // SSE endpoint that runs the agentic loop and streams ChatEvents.
  router.post("/stream", async (req: Request, res: Response) => {
    const { messages, providerId } = req.body as ChatRequest;

    if (!messages || !providerId) {
      res.status(400).json({ error: "messages and providerId are required" });
      return;
    }

    const config = getProviderById(providerId);
    if (!config) {
      res.status(404).json({ error: `Provider "${providerId}" not found` });
      return;
    }

    // Check OAuth providers are connected
    if ("auth" in config && config.auth === "oauth" && !oauthManager.hasTokens(config.id)) {
      res.status(401).json({ error: `Provider "${providerId}" requires OAuth sign-in first` });
      return;
    }

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const emit = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      if (config.provider === "anthropic") {
        await streamAnthropic(db, config as any, messages, emit);
      } else if (config.provider === "openai") {
        await streamOpenAI(db, config as any, messages, emit);
      } else if (config.provider === "google") {
        await streamGemini(db, config, messages, emit);
      } else {
        emit({ type: "error", message: `Unsupported provider: ${(config as any).provider}` });
      }
    } catch (err) {
      emit({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    res.end();
  });

  // ── GET /api/chat/auth/google/start?providerId=... ────────────────────────
  // Returns the Google OAuth consent URL. Frontend opens it in a new tab.
  router.get("/auth/google/start", (req: Request, res: Response) => {
    const { providerId } = req.query;
    if (!providerId || typeof providerId !== "string") {
      res.status(400).json({ error: "providerId query parameter is required" });
      return;
    }

    const config = getProviderById(providerId);
    if (!config || !("auth" in config) || config.auth !== "oauth") {
      res.status(400).json({ error: `Provider "${providerId}" is not an OAuth provider` });
      return;
    }

    const url = oauthManager.getAuthUrl(config, providerId);
    res.json({ url });
  });

  // ── GET /api/chat/auth/google/callback?code=...&state=providerId ──────────
  // Google redirects here after the user signs in. Exchanges code for tokens
  // and redirects the browser back to the web app.
  router.get("/auth/google/callback", async (req: Request, res: Response) => {
    const { code, state: providerId, error } = req.query;

    if (error) {
      res.status(400).send(`OAuth error: ${error}`);
      return;
    }

    if (!code || typeof code !== "string" || !providerId || typeof providerId !== "string") {
      res.status(400).send("Missing code or state parameter");
      return;
    }

    const config = getProviderById(providerId);
    if (!config || !("auth" in config) || config.auth !== "oauth") {
      res.status(400).send(`Provider "${providerId}" is not an OAuth provider`);
      return;
    }

    try {
      await oauthManager.handleCallbackWithConfig(config, code, providerId);
      // Redirect back to the web app with success signal
      res.redirect("http://localhost:5173/chat?oauth_connected=true");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).send(`OAuth callback failed: ${msg}`);
    }
  });

  return router;
}
