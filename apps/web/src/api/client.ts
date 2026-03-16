import type { OverviewResponse, PlayerCard, PlayerDetail, FixtureCard, TeamSummary } from "@fpl/contracts";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getOverview() {
  return request<OverviewResponse>("/overview");
}

export function getPlayers(params?: {
  search?: string;
  position?: string;
  sort?: string;
  team?: string;
}) {
  const p = new URLSearchParams();
  if (params?.search) p.set("search", params.search);
  if (params?.position) p.set("position", params.position);
  if (params?.sort) p.set("sort", params.sort);
  if (params?.team) p.set("team", params.team);
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
