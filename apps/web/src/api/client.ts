import type {
  CaptainRecommendation,
  FdrRow,
  GwCalendarRow,
  LiveGwUpdate,
  OverviewResponse,
  PlayerCard,
  PlayerDetail,
  PlayerXpts,
  FixtureCard,
  TeamSummary,
  GameweekSummary,
  MyTeamPageResponse,
  MyTeamGameweekPicksResponse,
  TransferDecisionHorizon,
  TransferDecisionResponse,
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
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

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

export function getGwCalendar() {
  return request<GwCalendarRow[]>("/fixtures/calendar");
}

export function getPlayerXpts(gw?: number) {
  const q = gw ? `?gw=${gw}` : "";
  return request<PlayerXpts[]>(`/players/xpts${q}`);
}

export function getCaptainRecommendation(accountId: number, gw: number) {
  return request<CaptainRecommendation[]>(`/my-team/captain-pick?accountId=${accountId}&gw=${gw}`);
}

export function getTransferDecision(
  accountId: number,
  params?: {
    gw?: number;
    horizon?: TransferDecisionHorizon;
    includeHits?: boolean;
    maxHit?: 0 | 4 | 8;
  },
) {
  const search = new URLSearchParams();
  if (params?.gw !== undefined) search.set("gw", String(params.gw));
  if (params?.horizon !== undefined) search.set("horizon", String(params.horizon));
  if (params?.includeHits !== undefined) search.set("includeHits", String(params.includeHits));
  if (params?.maxHit !== undefined) search.set("maxHit", String(params.maxHit));
  const query = search.toString();

  return request<TransferDecisionResponse>(
    `/my-team/${accountId}/transfer-decision${query ? `?${query}` : ""}`,
  ).then((response) => ({
    ...response,
    replayState: response.replayState ?? "full",
    replayNotes: response.replayNotes ?? [],
    recommendedOptionId:
      response.recommendedOptionId ??
      response.options?.[0]?.id ??
      null,
    options: response.options ?? [],
  }));
}

export function getLiveGwSnapshot(gw: number) {
  return request<LiveGwUpdate>(`/live/gw/${gw}`);
}

export function subscribeLiveGw(
  gw: number,
  onUpdate: (u: LiveGwUpdate) => void,
): () => void {
  const es = new EventSource(`/api/live/gw/${gw}/stream`);
  es.onmessage = (e) => {
    try {
      onUpdate(JSON.parse(e.data) as LiveGwUpdate);
    } catch {
      /* ignore parse errors */
    }
  };
  // Suppress unhandled error events — EventSource auto-reconnects on failure
  // so ECONNREFUSED during API startup is recoverable without any action here.
  es.onerror = () => { /* reconnect handled automatically by the browser */ };
  return () => es.close();
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
