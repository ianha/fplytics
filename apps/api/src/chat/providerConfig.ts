import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { hasTokens } from "./oauthManager.js";
import type { ProviderInfo, ProviderType } from "./chatTypes.js";

const DATA_DIR = path.dirname(env.dbPath);
const PROVIDERS_FILE = path.join(DATA_DIR, "llm-providers.json");

// ── Config shapes ────────────────────────────────────────────────────────────

export type ApiKeyProviderConfig = {
  id: string;
  name: string;
  provider: ProviderType;
  model: string;
  apiKey: string;
  /** Optional base URL override. Use this for OpenAI-compatible APIs such as OpenRouter. */
  baseURL?: string;
};

export type OAuthProviderConfig = {
  id: string;
  name: string;
  provider: "google";
  model: string;
  auth: "oauth";
  clientId: string;
  clientSecret: string;
};

export type ProviderConfig = ApiKeyProviderConfig | OAuthProviderConfig;

// ── Loading ───────────────────────────────────────────────────────────────────

let cachedProviders: ProviderConfig[] | null = null;

export function loadProviders(): ProviderConfig[] {
  if (cachedProviders) return cachedProviders;

  if (!fs.existsSync(PROVIDERS_FILE)) {
    console.warn(
      `[chat] No provider config found at ${PROVIDERS_FILE}. ` +
        "Create this file to enable the AI chat feature. See apps/api/CHAT.md for details.",
    );
    cachedProviders = [];
    return cachedProviders;
  }

  try {
    cachedProviders = JSON.parse(fs.readFileSync(PROVIDERS_FILE, "utf8")) as ProviderConfig[];
    return cachedProviders;
  } catch (err) {
    console.error(`[chat] Failed to parse ${PROVIDERS_FILE}:`, err);
    cachedProviders = [];
    return cachedProviders;
  }
}

/** Returns provider configs without secret keys — safe to send to the frontend. */
export function listProviderInfos(): ProviderInfo[] {
  return loadProviders().map((c) => ({
    id: c.id,
    name: c.name,
    provider: c.provider,
    model: c.model,
    authType: "auth" in c ? ("oauth" as const) : ("apiKey" as const),
    oauthConnected: "auth" in c ? hasTokens(c.id) : false,
  }));
}

/** Returns the full config (including secrets) for a specific provider ID. */
export function getProviderById(id: string): ProviderConfig | undefined {
  return loadProviders().find((c) => c.id === id);
}

/** Clears the in-memory cache so providers are re-read from disk on next call. */
export function reloadProviders(): void {
  cachedProviders = null;
}
