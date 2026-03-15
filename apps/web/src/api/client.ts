import type { OverviewResponse, PlayerCard, PlayerDetail } from "@fpl/contracts";

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

export function getPlayers(search = "") {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return request<PlayerCard[]>(`/players${query}`);
}

export function getPlayer(playerId: number) {
  return request<PlayerDetail>(`/players/${playerId}`);
}

export function resolveAssetUrl(imagePath: string | null) {
  return imagePath ? `${API_ORIGIN}${imagePath}` : null;
}
