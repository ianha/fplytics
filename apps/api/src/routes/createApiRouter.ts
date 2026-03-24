import { Router } from "express";
import { QueryService } from "../services/queryService.js";
import type { AppDatabase } from "../db/database.js";
import { MyTeamSyncService } from "../my-team/myTeamSyncService.js";

export function createApiRouter(db: AppDatabase) {
  const router = Router();
  const queryService = new QueryService(db);
  const myTeamSyncService = new MyTeamSyncService(db);

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

  router.get("/players/xpts", (req, res) => {
    const gw = req.query.gw ? Number(req.query.gw) : undefined;
    res.json(queryService.getPlayerXpts(gw));
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

  return router;
}
