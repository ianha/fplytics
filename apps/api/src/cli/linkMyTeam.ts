import { pathToFileURL } from "node:url";
import { createDatabase } from "../db/database.js";
import { MyTeamSyncService } from "../my-team/myTeamSyncService.js";

function parseStringArg(argv: string[], names: string[], label: string) {
  const argIndex = argv.findIndex((arg) => names.includes(arg));
  if (argIndex >= 0) {
    const value = argv[argIndex + 1]?.trim();
    if (!value) {
      throw new Error(`\`${label}\` must be followed by a value.`);
    }
    return value;
  }

  const prefixedArg = argv.find((arg) => names.some((name) => arg.startsWith(`${name}=`)));
  if (!prefixedArg) return undefined;

  const value = prefixedArg.split("=")[1]?.trim();
  if (!value) {
    throw new Error(`\`${label}\` must be a non-empty value.`);
  }
  return value;
}

function parsePositiveIntegerArg(argv: string[], names: string[], label: string) {
  const argIndex = argv.findIndex((arg) => names.includes(arg));
  if (argIndex >= 0) {
    const value = argv[argIndex + 1];
    if (!value || Number.isNaN(Number(value)) || Number(value) <= 0) {
      throw new Error(`\`${label}\` must be followed by a positive integer.`);
    }
    return Number(value);
  }

  const prefixedArg = argv.find((arg) => names.some((name) => arg.startsWith(`${name}=`)));
  if (!prefixedArg) return undefined;

  const value = prefixedArg.split("=")[1];
  if (!value || Number.isNaN(Number(value)) || Number(value) <= 0) {
    throw new Error(`\`${label}\` must be a positive integer.`);
  }
  return Number(value);
}

export function parseLinkMyTeamArgs(argv: string[]) {
  const email = parseStringArg(argv, ["--email", "-e"], "--email");
  const password = parseStringArg(argv, ["--password", "-p"], "--password");
  const entryId = parsePositiveIntegerArg(argv, ["--entry", "--entry-id"], "--entry");

  if (!email || !password) {
    throw new Error("Both `--email` and `--password` are required.");
  }

  return { email, password, entryId };
}

async function run() {
  const { email, password, entryId } = parseLinkMyTeamArgs(process.argv.slice(2));
  void email;
  void password;
  void entryId;
  void createDatabase;
  void MyTeamSyncService;

  throw new Error(
    "Password-based linking has been removed. Link your FPL account from the web app OAuth flow instead.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
