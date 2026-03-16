import { Router } from "express";
import { QueryService } from "../services/queryService.js";
import type { AppDatabase } from "../db/database.js";

export function createApiRouter(db: AppDatabase) {
  const router = Router();
  const queryService = new QueryService(db);

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

  return router;
}

