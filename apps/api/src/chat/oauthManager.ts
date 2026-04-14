import fs from "node:fs";
import path from "node:path";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env.js";

const DATA_DIR = path.dirname(env.dbPath);
const TOKENS_FILE = path.join(DATA_DIR, "llm-tokens.json");

const SCOPES = ["https://www.googleapis.com/auth/generative-language.retriever"];

function resolvePublicApiUrl() {
  return env.publicUrl || `http://localhost:${env.port}`;
}

export function getGoogleRedirectUri() {
  return `${resolvePublicApiUrl()}/api/chat/auth/google/callback`;
}

// ── Token file I/O ──────────────────────────────────────────────────────────

type TokenStore = Record<string, { refresh_token?: string; access_token?: string }>;

function readTokens(): TokenStore {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")) as TokenStore;
  } catch {
    return {};
  }
}

function writeTokens(store: TokenStore): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(store, null, 2), "utf8");
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface OAuthProviderConfig {
  id: string;
  clientId: string;
  clientSecret: string;
}

/** Build the Google consent-screen URL to redirect (or open in tab) for `providerId`. */
export function getAuthUrl(config: OAuthProviderConfig, providerId: string): string {
  const client = new OAuth2Client(config.clientId, config.clientSecret, getGoogleRedirectUri());
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state: providerId,
  });
}

/** Exchange the auth code from Google's callback for tokens and persist them. */
export async function handleCallback(code: string, providerId: string): Promise<void> {
  // We need the client credentials for the provider; store them in the token file
  // by providerId so we can reconstruct the client later.
  // However, we only have code + providerId here.  The caller must have loaded the
  // correct config; this function is only responsible for exchanging + saving tokens.
  // Because we store clientId/clientSecret per-provider in llm-providers.json (not here),
  // we expect the router to pass a fully initialised OAuth2Client.
  throw new Error(
    "handleCallback should be called via handleCallbackWithConfig — use the router wrapper.",
  );
}

/** Exchange code with a fully-initialised client and persist tokens. */
export async function handleCallbackWithConfig(
  config: OAuthProviderConfig,
  code: string,
  providerId: string,
): Promise<void> {
  const client = new OAuth2Client(config.clientId, config.clientSecret, getGoogleRedirectUri());
  const { tokens } = await client.getToken(code);
  const store = readTokens();
  store[providerId] = {
    refresh_token: tokens.refresh_token ?? store[providerId]?.refresh_token,
    access_token: tokens.access_token ?? undefined,
  };
  writeTokens(store);
}

/**
 * Get a valid access token for the given provider, refreshing automatically
 * if necessary.  Returns the access token string.
 */
export async function getAccessToken(
  config: OAuthProviderConfig,
  providerId: string,
): Promise<string> {
  const store = readTokens();
  const saved = store[providerId];
  if (!saved?.refresh_token) {
    throw new Error(`No OAuth tokens found for provider "${providerId}". Sign in first.`);
  }

  const redirectUri = getGoogleRedirectUri();
  const client = new OAuth2Client(config.clientId, config.clientSecret, redirectUri);
  client.setCredentials({
    refresh_token: saved.refresh_token,
    access_token: saved.access_token,
  });

  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain access token from Google.");

  // Persist updated access token
  store[providerId] = { ...saved, access_token: token };
  writeTokens(store);

  return token;
}

/** Returns true if a refresh token is stored for this provider. */
export function hasTokens(providerId: string): boolean {
  const store = readTokens();
  return Boolean(store[providerId]?.refresh_token);
}
