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

export function parseAckPendingMlEvaluationArgs(argv: string[]) {
  const gameweek = parseGameweekArg(argv);
  const all = argv.includes("--all");

  if (all && gameweek !== undefined) {
    throw new Error("Use either `--gameweek` or `--all`, not both.");
  }

  if (!all && gameweek === undefined) {
    throw new Error("Pass `--gameweek <id>` to acknowledge one item or `--all` to clear the full queue.");
  }

  return { gameweek, all };
}

export function acknowledgePendingMlEvaluation(
  db: AppDatabase,
  input: { gameweek?: number; all?: boolean },
) {
  const mlModelRegistryService = new MlModelRegistryService(db);
  const before = mlModelRegistryService.getPendingMlEvaluation()?.gameweekIds ?? [];

  if (input.all) {
    mlModelRegistryService.clearPendingMlEvaluation();
  } else if (input.gameweek !== undefined) {
    mlModelRegistryService.clearPendingMlEvaluation(input.gameweek);
  }

  const after = mlModelRegistryService.getPendingMlEvaluation()?.gameweekIds ?? [];
  const clearedGameweeks = before.filter((gameweekId) => !after.includes(gameweekId));

  return {
    requestedGameweek: input.gameweek ?? null,
    clearedGameweeks,
    remainingGameweeks: after,
  };
}

export async function runAckPendingMlEvaluationCli(argv = process.argv.slice(2)) {
  const db = createDatabase();
  const { gameweek, all } = parseAckPendingMlEvaluationArgs(argv);
  const result = acknowledgePendingMlEvaluation(db, { gameweek, all });

  if (all) {
    console.log(
      `Cleared pending ML evaluation for gameweeks: ${result.clearedGameweeks.join(", ") || "none"}. Remaining queue: ${result.remainingGameweeks.join(", ") || "empty"}.`,
    );
    return result;
  }

  if (result.clearedGameweeks.length === 0) {
    console.log(
      `Gameweek ${gameweek} was not pending. Remaining ML evaluation queue: ${result.remainingGameweeks.join(", ") || "empty"}.`,
    );
    return result;
  }

  console.log(
    `Acknowledged pending ML evaluation for gameweek ${gameweek}. Remaining queue: ${result.remainingGameweeks.join(", ") || "empty"}.`,
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAckPendingMlEvaluationCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
