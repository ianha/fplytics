import { pathToFileURL } from "node:url";
import type { AppDatabase } from "../db/database.js";
import { createDatabase } from "../db/database.js";
import { MlModelRegistryService } from "../services/mlModelRegistryService.js";
import { RidgeRegressionService } from "../services/ridgeRegressionService.js";

function parseGameweekArg(argv: string[]) {
  const gameweekIndex = argv.findIndex((arg) => arg === "--gameweek" || arg === "-g");
  if (gameweekIndex >= 0) {
    const value = argv[gameweekIndex + 1];
    const parsed = Number(value);
    if (!value || !Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("`--gameweek` must be followed by a positive integer.");
    }
    return parsed;
  }

  const prefixedArg = argv.find((arg) => arg.startsWith("--gameweek="));
  if (!prefixedArg) {
    return undefined;
  }

  const parsed = Number(prefixedArg.split("=")[1]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("`--gameweek` must be a positive integer.");
  }

  return parsed;
}

export function parseRetrainModelArgs(argv: string[]) {
  const gameweek = parseGameweekArg(argv);
  const all = argv.includes("--all");

  if (all && gameweek !== undefined) {
    throw new Error("Use either `--gameweek` or `--all`, not both.");
  }

  return { gameweek, all };
}

export type RetrainModelResult = {
  mode: "gameweek" | "all" | "pending";
  gameweeks: number[];
  skipped: boolean;
  reason?: string;
  versionId?: number;
  versionTag?: string;
  trainingRows?: number;
  rSquared?: number;
  coefficients?: Record<string, number>;
};

export function retrainModel(
  db: AppDatabase,
  input: { gameweek?: number; all?: boolean },
): RetrainModelResult {
  const mlModelRegistryService = new MlModelRegistryService(db);
  const ridgeRegressionService = new RidgeRegressionService(db);

  let gameweeks: number[];
  let mode: RetrainModelResult["mode"];

  if (input.gameweek !== undefined) {
    // Single gameweek mode
    mode = "gameweek";
    gameweeks = [input.gameweek];
  } else if (input.all) {
    // All finished gameweeks
    mode = "all";
    const rows = db
      .prepare(
        `SELECT id FROM gameweeks WHERE is_finished = 1 ORDER BY id`,
      )
      .all() as Array<{ id: number }>;
    gameweeks = rows.map((r) => r.id);
  } else {
    // Pending queue mode (default)
    mode = "pending";
    const pending = mlModelRegistryService.getPendingMlEvaluation();
    gameweeks = pending?.gameweekIds ?? [];
  }

  if (gameweeks.length === 0) {
    return {
      mode,
      gameweeks: [],
      skipped: true,
      reason: mode === "pending"
        ? "No pending ML evaluation gameweeks."
        : "No finished gameweeks found.",
    };
  }

  const result = ridgeRegressionService.trainAndStore({ gameweeks });

  if (result.skipped) {
    return {
      mode,
      gameweeks,
      skipped: true,
      reason: result.reason,
    };
  }

  // Clear trained gameweeks from pending queue
  for (const gw of gameweeks) {
    mlModelRegistryService.clearPendingMlEvaluation(gw);
  }

  return {
    mode,
    gameweeks,
    skipped: false,
    versionId: result.versionId,
    versionTag: result.versionTag,
    trainingRows: result.result?.metadata.trainingRows,
    rSquared: result.result?.metadata.rSquared,
    coefficients: result.result?.coefficients,
  };
}

export async function runRetrainModelCli(argv = process.argv.slice(2)) {
  const db = createDatabase();
  const { gameweek, all } = parseRetrainModelArgs(argv);
  const result = retrainModel(db, { gameweek, all });

  if (result.skipped) {
    console.log(result.reason);
    return result;
  }

  console.log(
    `Trained model version ${result.versionTag} (id: ${result.versionId}) on ${result.trainingRows} rows across gameweeks [${result.gameweeks.join(", ")}]. R²=${result.rSquared}`,
  );
  console.log("Coefficients:", JSON.stringify(result.coefficients, null, 2));

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRetrainModelCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
