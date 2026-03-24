import type {
  CaptainRecommendation,
  FdrRow,
  OverviewResponse,
  PlayerCard,
  PlayerDetail,
  PlayerXpts,
  FixtureCard,
  TeamSummary,
  GameweekSummary,
  MyTeamPageResponse,
  MyTeamGameweekPicksResponse,
} from "@fpl/contracts";
import type { ChatMessage, ProviderInfo } from "@/pages/chatPageUtils";

function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}/api`;
  }

  return "http://localhost:4000/api";
}

const API_BASE_URL = resolveApiBaseUrl();
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function requestWithBody<T>(path: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) message = payload.message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function getOverview() {
  return request<OverviewResponse>("/overview");
}

export function getGameweeks() {
  return request<GameweekSummary[]>("/gameweeks");
}

export function getPlayers(params?: {
  search?: string;
  position?: string;
  sort?: string;
  team?: string;
  fromGW?: number;
  toGW?: number;
}) {
  const p = new URLSearchParams();
  if (params?.search) p.set("search", params.search);
  if (params?.position) p.set("position", params.position);
  if (params?.sort) p.set("sort", params.sort);
  if (params?.team) p.set("team", params.team);
  if (params?.fromGW !== undefined) p.set("fromGW", String(params.fromGW));
  if (params?.toGW !== undefined) p.set("toGW", String(params.toGW));
  const q = p.toString();
  return request<PlayerCard[]>(`/players${q ? `?${q}` : ""}`);
}

export function getPlayer(playerId: number) {
  return request<PlayerDetail>(`/players/${playerId}`);
}

export function getTeams() {
  return request<TeamSummary[]>("/teams");
}

export function getFixtures(params?: { event?: number; team?: number }) {
  const p = new URLSearchParams();
  if (params?.event) p.set("event", String(params.event));
  if (params?.team) p.set("team", String(params.team));
  const q = p.toString();
  return request<FixtureCard[]>(`/fixtures${q ? `?${q}` : ""}`);
}

export function resolveAssetUrl(imagePath: string | null) {
  return imagePath ? `${API_ORIGIN}${imagePath}` : null;
}

export function getMyTeam(accountId?: number) {
  const q = accountId ? `?accountId=${accountId}` : "";
  return request<MyTeamPageResponse>(`/my-team${q}`);
}

export function linkMyTeamAccount(email: string, password: string, entryId?: number) {
  return requestWithBody<MyTeamPageResponse>("/my-team/auth", "POST", {
    email,
    password,
    ...(entryId ? { entryId } : {}),
  });
}

export function syncMyTeam(params?: { accountId?: number; gameweek?: number; force?: boolean }) {
  return requestWithBody<MyTeamPageResponse>("/my-team/sync", "POST", params ?? {});
}

export function getMyTeamGameweekPicks(accountId: number, gameweek: number) {
  return request<MyTeamGameweekPicksResponse>(`/my-team/picks?accountId=${accountId}&gameweek=${gameweek}`);
}

export function getFdrData() {
  return request<FdrRow[]>("/fixtures/fdr");
}

export function getPlayerXpts(gw?: number) {
  const q = gw ? `?gw=${gw}` : "";
  return request<PlayerXpts[]>(`/players/xpts${q}`);
}

export function getCaptainRecommendation(accountId: number, gw: number) {
  return request<CaptainRecommendation[]>(`/my-team/captain-pick?accountId=${accountId}&gw=${gw}`);
}

export function getChatProviders() {
  return request<ProviderInfo[]>("/chat/providers");
}

export async function getChatGoogleAuthUrl(providerId: string) {
  const encodedProviderId = encodeURIComponent(providerId);
  const response = await request<{ url: string }>(`/chat/auth/google/start?providerId=${encodedProviderId}`);
  return response.url;
}

export async function streamChat(
  providerId: string,
  messages: ChatMessage[],
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await fetch(`${API_BASE_URL}/chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ providerId, messages }),
  });

  if (!response.ok || !response.body) {
    const message = await response.text().catch(() => `Request failed: ${response.status}`);
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.body.getReader();
}
