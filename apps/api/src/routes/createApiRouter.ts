import { Router, type Request } from "express";
import { QueryService } from "../services/queryService.js";
import type { AppDatabase } from "../db/database.js";
import { MyTeamSyncService } from "../my-team/myTeamSyncService.js";
import { liveGwService } from "../services/liveGwService.js";
import type { LiveGwUpdate } from "@fpl/contracts";
import { RecapCardService } from "../services/recapCardService.js";
import { env } from "../config/env.js";
import type { TransferDecisionHorizon } from "@fpl/contracts";
import { RivalSyncService, type RivalLeagueType } from "../services/rivalSyncService.js";
import { FplApiClient } from "../client/fplApiClient.js";

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
  const rivalSyncService = new RivalSyncService(db);
  const fplApiClient = new FplApiClient();

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

  router.get("/my-team/leagues", (req, res) => {
    const accountId = req.query.accountId ? Number(req.query.accountId) : 1;
    const leagues = db
      .prepare(
        `SELECT league_id AS leagueId, league_type AS leagueType, league_name AS leagueName, synced_at AS syncedAt
         FROM rival_leagues WHERE account_id = ? ORDER BY league_name`,
      )
      .all(accountId);
    res.json(leagues);
  });

  router.post("/my-team/leagues/discover", async (req, res) => {
    const accountId = (req.body as { accountId?: number }).accountId ?? 1;
    const account = db
      .prepare(`SELECT entry_id FROM my_team_accounts WHERE id = ?`)
      .get(accountId) as { entry_id: number | null } | undefined;

    if (!account?.entry_id) {
      res.status(404).json({ message: "Account not found or entry ID not set. Sync your team first." });
      return;
    }

    try {
      const data = await fplApiClient.getEntryInfo(account.entry_id);
      const now = new Date().toISOString();
      const upsert = db.prepare(
        `INSERT INTO rival_leagues (league_id, league_type, league_name, account_id, synced_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(league_id, league_type, account_id) DO UPDATE SET
           league_name = excluded.league_name,
           synced_at = excluded.synced_at`,
      );
      db.transaction(() => {
        for (const league of data.leagues.classic) {
          upsert.run(league.id, "classic", league.name, accountId, now);
        }
        for (const league of data.leagues.h2h) {
          upsert.run(league.id, "h2h", league.name, accountId, now);
        }
      })();
      const leagues = db
        .prepare(
          `SELECT league_id AS leagueId, league_type AS leagueType, league_name AS leagueName, synced_at AS syncedAt
           FROM rival_leagues WHERE account_id = ? ORDER BY league_name`,
        )
        .all(accountId);
      res.json(leagues);
    } catch (error) {
      res.status(502).json({ message: error instanceof Error ? error.message : String(error) });
    }
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

  router.get("/my-team/:accountId/transfer-decision", (req, res) => {
    const accountId = Number(req.params.accountId);
    const gw = req.query.gw ? Number(req.query.gw) : undefined;
    const rawHorizon = req.query.horizon ? Number(req.query.horizon) : 3;
    const horizon = ([1, 3, 5].includes(rawHorizon)
      ? rawHorizon
      : null) as TransferDecisionHorizon | null;

    if (!accountId) {
      res.status(400).json({ message: "accountId must be a positive integer" });
      return;
    }

    if (gw !== undefined && (!Number.isInteger(gw) || gw <= 0)) {
      res.status(400).json({ message: "gw must be a positive integer when provided" });
      return;
    }

    if (!horizon) {
      res.status(400).json({ message: "horizon must be one of 1, 3, or 5" });
      return;
    }

    const response = queryService.getTransferDecision(accountId, { gw, horizon });
    if (!response) {
      res.status(404).json({ message: "Transfer decision data not available for that account/gameweek" });
      return;
    }

    res.json(response);
  });

  router.post("/my-team/auth", async (req, res) => {
    try {
      const { code, codeVerifier, entryId } = req.body as {
        code?: string;
        codeVerifier?: string;
        entryId?: number | string;
      };
      if (!code || !codeVerifier) {
        res.status(400).json({ message: "code and codeVerifier are required" });
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

      const { accountId } = await myTeamSyncService.linkAccountWithCode(code, codeVerifier, parsedEntryId);
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

  router.get("/leagues/:leagueId/standings", async (req, res) => {
    const leagueId = Number(req.params.leagueId);
    const leagueType = req.query.type === "h2h" ? "h2h" : req.query.type === "classic" ? "classic" : null;
    const accountId = req.query.accountId ? Number(req.query.accountId) : 1;

    if (!Number.isInteger(leagueId) || leagueId <= 0) {
      res.status(400).json({ message: "leagueId must be a positive integer" });
      return;
    }

    if (!leagueType) {
      res.status(400).json({ message: "type must be 'classic' or 'h2h'" });
      return;
    }

    try {
      const result = await rivalSyncService.syncLeagueStandings(
        leagueId,
        leagueType,
        accountId,
      );
      res.json(result.standings);
    } catch (error) {
      res.status(502).json({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/leagues/:leagueId/sync", async (req, res) => {
    const leagueId = Number(req.params.leagueId);
    const { accountId, rivalEntryId, type } = req.body as {
      accountId?: number;
      rivalEntryId?: number;
      type?: RivalLeagueType;
      syncSecret?: string;
    };

    if (!Number.isInteger(leagueId) || leagueId <= 0) {
      res.status(400).json({ message: "leagueId must be a positive integer" });
      return;
    }

    if (!Number.isInteger(accountId) || !accountId || accountId <= 0) {
      res.status(400).json({ message: "accountId must be a positive integer" });
      return;
    }

    if (!Number.isInteger(rivalEntryId) || !rivalEntryId || rivalEntryId <= 0) {
      res.status(400).json({ message: "rivalEntryId must be a positive integer" });
      return;
    }

    const leagueType = type === "h2h" ? "h2h" : "classic";

    try {
      const leagueKnown = db
        .prepare(
          `SELECT 1 FROM rival_leagues WHERE league_id = ? AND league_type = ? AND account_id = ? LIMIT 1`,
        )
        .get(leagueId, leagueType, accountId);

      if (!leagueKnown) {
        await rivalSyncService.syncLeagueStandings(leagueId, leagueType, accountId);
      }

      const result = await rivalSyncService.syncRivalOnDemand(
        leagueId,
        rivalEntryId,
        accountId,
      );
      res.json(result);
    } catch (error) {
      res.status(502).json({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/leagues/:leagueId/h2h/:rivalEntryId", (req, res) => {
    const leagueId = Number(req.params.leagueId);
    const rivalEntryId = Number(req.params.rivalEntryId);
    const accountId = req.query.accountId ? Number(req.query.accountId) : 1;

    if (!Number.isInteger(leagueId) || leagueId <= 0) {
      res.status(400).json({ message: "leagueId must be a positive integer" });
      return;
    }

    if (!Number.isInteger(rivalEntryId) || rivalEntryId <= 0) {
      res.status(400).json({ message: "rivalEntryId must be a positive integer" });
      return;
    }

    if (!Number.isInteger(accountId) || accountId <= 0) {
      res.status(400).json({ message: "accountId must be a positive integer" });
      return;
    }

    res.json(queryService.getH2HComparison(accountId, leagueId, rivalEntryId));
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
