import { Router, type Request } from "express";
import { QueryService } from "../services/queryService.js";
import type { AppDatabase } from "../db/database.js";
import { MyTeamSyncService } from "../my-team/myTeamSyncService.js";
import { liveGwService } from "../services/liveGwService.js";
import type { LiveGwUpdate } from "@fpl/contracts";
import { RecapCardService } from "../services/recapCardService.js";
import { env } from "../config/env.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function firstHeaderValue(value: string | undefined) {
  return value?.split(",")[0]?.trim();
}

function parseForwardedHeader(value: string | undefined) {
  if (!value) return {};

  const firstEntry = value.split(",")[0]?.trim();
  if (!firstEntry) return {};

  const parts = firstEntry.split(";").map((part) => part.trim());
  const parsed: { proto?: string; host?: string } = {};

  for (const part of parts) {
    const [rawKey, rawValue] = part.split("=", 2);
    if (!rawKey || !rawValue) continue;

    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim().replace(/^"|"$/g, "");

    if (key === "proto") parsed.proto = value;
    if (key === "host") parsed.host = value;
  }

  return parsed;
}

function hostLooksLocal(host: string | undefined) {
  if (!host) return true;
  const normalized = host.toLowerCase();

  return (
    normalized.includes("localhost") ||
    normalized.startsWith("127.0.0.1") ||
    normalized.startsWith("[::1]") ||
    normalized.startsWith("0.0.0.0") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".local")
  );
}

function getRequestOrigin(req: Request) {
  const forwarded = parseForwardedHeader(req.get("forwarded"));
  const proto =
    forwarded.proto ||
    firstHeaderValue(req.get("x-forwarded-proto")) ||
    firstHeaderValue(req.get("x-original-proto")) ||
    req.protocol;
  const host =
    forwarded.host ||
    firstHeaderValue(req.get("x-forwarded-host")) ||
    firstHeaderValue(req.get("x-original-host")) ||
    req.get("host");

  if (hostLooksLocal(host) && env.publicUrl) {
    return env.publicUrl;
  }

  return `${proto}://${host}`;
}

export function createApiRouter(db: AppDatabase) {
  const router = Router();
  const queryService = new QueryService(db);
  const myTeamSyncService = new MyTeamSyncService(db);
  const recapCardService = new RecapCardService(db);

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/overview", (_req, res) => {
    res.json(queryService.getOverview());
  });

  router.get("/gameweeks", (_req, res) => {
    res.json(queryService.getGameweeks());
  });

  router.get("/teams", (_req, res) => {
    res.json(queryService.getTeams());
  });

  router.get("/fixtures", (req, res) => {
    const event = req.query.event ? Number(req.query.event) : undefined;
    const team = req.query.team ? Number(req.query.team) : undefined;
    res.json(queryService.getFixtures(event, team));
  });

  router.get("/players", (req, res) => {
    res.json(
      queryService.getPlayers({
        search: req.query.search?.toString(),
        team: req.query.team ? Number(req.query.team) : undefined,
        position: req.query.position ? Number(req.query.position) : undefined,
        sort: req.query.sort?.toString(),
        fromGW: req.query.fromGW ? Number(req.query.fromGW) : undefined,
        toGW: req.query.toGW ? Number(req.query.toGW) : undefined,
      }),
    );
  });

  // Specific sub-routes must come BEFORE /:id wildcard
  router.get("/players/xpts", (req, res) => {
    const gw = req.query.gw ? Number(req.query.gw) : undefined;
    res.json(queryService.getPlayerXpts(gw));
  });

  router.get("/players/:id", (req, res) => {
    const player = queryService.getPlayerById(Number(req.params.id));
    if (!player) {
      res.status(404).json({ message: "Player not found" });
      return;
    }
    res.json(player);
  });

  router.get("/my-team/accounts", (_req, res) => {
    res.json(queryService.getMyTeamAccounts());
  });

  router.get("/my-team/picks", (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    const gameweek = req.query.gameweek ? Number(req.query.gameweek) : undefined;
    if (!accountId || !gameweek) {
      res.status(400).json({ message: "accountId and gameweek are required" });
      return;
    }
    res.json(queryService.getMyTeamPicksForGameweek(accountId, gameweek));
  });

  router.get("/my-team", (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    res.json(queryService.getMyTeam(accountId));
  });

  router.post("/my-team/auth", async (req, res) => {
    try {
      const { email, password, entryId } = req.body as {
        email?: string;
        password?: string;
        entryId?: number | string;
      };
      if (!email || !password) {
        res.status(400).json({ message: "email and password are required" });
        return;
      }

      const parsedEntryId =
        entryId === undefined || entryId === null || entryId === ""
          ? undefined
          : Number(entryId);
      if (parsedEntryId !== undefined && (!Number.isInteger(parsedEntryId) || parsedEntryId <= 0)) {
        res.status(400).json({ message: "entryId must be a positive integer when provided" });
        return;
      }

      const accountId = myTeamSyncService.linkAccount(email, password, parsedEntryId);
      await myTeamSyncService.syncAccount(accountId, true);
      res.status(201).json(queryService.getMyTeam(accountId));
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/fixtures/fdr", (_req, res) => {
    res.json(queryService.getFdrData());
  });

  router.get("/fixtures/calendar", (_req, res) => {
    res.json(queryService.getGwCalendar());
  });

  router.get("/my-team/captain-pick", (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    const gw = req.query.gw ? Number(req.query.gw) : undefined;
    if (!accountId || !gw) {
      res.status(400).json({ message: "accountId and gw are required" });
      return;
    }
    res.json(queryService.getCaptainRecommendations(accountId, gw));
  });

  router.post("/my-team/sync", async (req, res) => {
    try {
      const { accountId, gameweek, force } = req.body as {
        accountId?: number;
        gameweek?: number;
        force?: boolean;
      };
      if (accountId) {
        await myTeamSyncService.syncAccount(accountId, Boolean(force), gameweek);
        res.json(queryService.getMyTeam(accountId));
        return;
      }

      await myTeamSyncService.syncAll(Boolean(force), gameweek);
      res.json(queryService.getMyTeam());
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /api/my-team/:accountId/recap/:gw/preview — HTML page with OG/Twitter card meta tags
  // so X/WhatsApp/Telegram scrapers render the recap image inline when the link is shared.
  // Real browsers are immediately redirected to the PNG via <meta http-equiv="refresh">.
  router.get("/my-team/:accountId/recap/:gw/preview", async (req, res) => {
    const accountId = Number(req.params.accountId);
    const gw = Number(req.params.gw);
    if (!accountId || !gw) {
      res.status(400).send("Bad request");
      return;
    }
    const data = recapCardService.getRecapData(accountId, gw);
    if (!data) {
      res.status(404).send("Not found");
      return;
    }

    try {
      const asset = await recapCardService.ensureCardAsset(data);
      const origin = getRequestOrigin(req);
      const previewUrl = `${origin}/api/my-team/${accountId}/recap/${gw}/preview`;
      const imageUrl = `${origin}${asset.relativePath}`;
      const title = escapeHtml(`${data.managerName} — GW${gw} Recap`);
      const description = escapeHtml(`${data.points} pts · Rank #${data.overallRank.toLocaleString()} · ${data.teamName}`);
      const imageAlt = escapeHtml(`${data.teamName} gameweek ${gw} recap card`);
      const safeImageUrl = escapeHtml(imageUrl);
      const safePreviewUrl = escapeHtml(previewUrl);
      const safeRelativeImageUrl = escapeHtml(asset.relativePath);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${description}">
  <meta property="og:url" content="${safePreviewUrl}">
  <meta property="og:site_name" content="FPLytics">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${safeImageUrl}">
  <meta property="og:image:url" content="${safeImageUrl}">
  <meta property="og:image:secure_url" content="${safeImageUrl}">
  <meta property="og:image:width" content="480">
  <meta property="og:image:height" content="320">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:alt" content="${imageAlt}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${safeImageUrl}">
  <meta name="twitter:image:alt" content="${imageAlt}">
  <link rel="canonical" href="${safePreviewUrl}">
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${description}</p>
    <img src="${safeRelativeImageUrl}" alt="${imageAlt}" width="480" height="320">
    <p><a href="${safeRelativeImageUrl}">Open recap image</a></p>
  </main>
</body>
</html>`);
    } catch (err) {
      res.status(500).send(err instanceof Error ? err.message : "Failed to render recap card");
    }
  });

  router.get("/my-team/:accountId/recap/:gw", async (req, res) => {
    const accountId = Number(req.params.accountId);
    const gw = Number(req.params.gw);
    if (!accountId || !gw) {
      res.status(400).json({ message: "accountId and gw are required" });
      return;
    }
    const data = recapCardService.getRecapData(accountId, gw);
    if (!data) {
      res.status(404).json({ message: "No recap data found for this account and gameweek" });
      return;
    }
    try {
      const asset = await recapCardService.ensureCardAsset(data);
      res.setHeader("Content-Type", "image/png");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="fplytics-gw${gw}-recap.png"`,
      );
      res.sendFile(asset.absolutePath);
    } catch (err) {
      res.status(500).json({
        message: err instanceof Error ? err.message : "Failed to render recap card",
      });
    }
  });

  // GET /api/live/gw/:gw/stream — SSE, pushes LiveGwUpdate on each poll
  router.get("/live/gw/:gw/stream", (req, res) => {
    const gameweek = Number(req.params.gw);
    if (!gameweek || gameweek < 1) {
      res.status(400).json({ message: "gameweek must be a positive integer" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const emit = (update: LiveGwUpdate) =>
      res.write(`data: ${JSON.stringify(update)}\n\n`);
    const cached = liveGwService.getCached(gameweek);
    if (cached) emit(cached);
    liveGwService.startPolling(gameweek);
    const unsub = liveGwService.subscribe(gameweek, emit);
    req.on("close", unsub);
  });

  // GET /api/live/gw/:gw — REST snapshot
  router.get("/live/gw/:gw", async (req, res) => {
    const gameweek = Number(req.params.gw);
    if (!gameweek || gameweek < 1) {
      res.status(400).json({ message: "gameweek must be a positive integer" });
      return;
    }
    const cached = liveGwService.getCached(gameweek);
    if (cached) { res.json(cached); return; }
    try {
      await liveGwService.fetchAndCache(gameweek);
      res.json(liveGwService.getCached(gameweek));
    } catch (err) {
      res.status(502).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
