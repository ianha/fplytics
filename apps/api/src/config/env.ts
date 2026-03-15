import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultDbPath = fileURLToPath(
  new URL("../../data/fpl.sqlite", import.meta.url),
);
const defaultAssetsDir = fileURLToPath(
  new URL("../../data/assets", import.meta.url),
);
const workspaceDbPath = path.resolve(process.cwd(), "apps/api/data/fpl.sqlite");
const workspaceAssetsDir = path.resolve(process.cwd(), "apps/api/data/assets");

export const env = {
  port: Number(process.env.PORT ?? 4000),
  baseUrl: process.env.FPL_BASE_URL ?? "https://fantasy.premierleague.com/api",
  dbPath: process.env.DB_PATH ?? (process.cwd().endsWith("/apps/api") ? path.resolve(defaultDbPath) : workspaceDbPath),
  assetsDir:
    process.env.ASSETS_DIR ??
    (process.cwd().endsWith("/apps/api")
      ? path.resolve(defaultAssetsDir)
      : workspaceAssetsDir),
  fplMinRequestIntervalMs: Number(process.env.FPL_MIN_REQUEST_INTERVAL_MS ?? 3000),
};
