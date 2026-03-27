import { pathToFileURL } from "node:url";
import type { AppDatabase } from "../db/database.js";
import { createDatabase } from "../db/database.js";
import { MlModelRegistryService } from "../services/mlModelRegistryService.js";

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

export function parseSeedPendingMlEvaluationArgs(argv: string[]) {
  return {
    gameweek: parseGameweekArg(argv),
  };
}

export function seedPendingMlEvaluationFromFinishedGameweeks(
  db: AppDatabase,
  input?: { gameweek?: number },
) {
  const mlModelRegistryService = new MlModelRegistryService(db);
  const currentPending = mlModelRegistryService.getPendingMlEvaluation()?.gameweekIds ?? [];
  const rows = input?.gameweek === undefined
    ? db
      .prepare(
        `SELECT id
         FROM gameweeks
         WHERE is_finished = 1
         ORDER BY id`,
      )
      .all() as Array<{ id: number }>
    : db
      .prepare(
        `SELECT id
         FROM gameweeks
         WHERE id = ?
           AND is_finished = 1`,
      )
      .all(input.gameweek) as Array<{ id: number }>;

  for (const row of rows) {
    mlModelRegistryService.setPendingMlEvaluation(row.id);
  }

  const pending = mlModelRegistryService.getPendingMlEvaluation();
  const queuedGameweeks = pending?.gameweekIds ?? [];
  const addedGameweeks = queuedGameweeks.filter((gameweekId) => !currentPending.includes(gameweekId));

  return {
    requestedGameweek: input?.gameweek ?? null,
    addedGameweeks,
    queuedGameweeks,
  };
}

export async function runSeedPendingMlEvaluationCli(argv = process.argv.slice(2)) {
  const db = createDatabase();
  const { gameweek } = parseSeedPendingMlEvaluationArgs(argv);
  const result = seedPendingMlEvaluationFromFinishedGameweeks(db, { gameweek });

  if (gameweek !== undefined && result.addedGameweeks.length === 0) {
    console.log(
      `No finished gameweek ${gameweek} was available to seed. Pending ML evaluation queue: ${result.queuedGameweeks.join(", ") || "empty"}.`,
    );
    return result;
  }

  console.log(
    `Seeded pending ML evaluation for gameweeks: ${result.addedGameweeks.join(", ") || "none"}. Current queue: ${result.queuedGameweeks.join(", ") || "empty"}.`,
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSeedPendingMlEvaluationCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
