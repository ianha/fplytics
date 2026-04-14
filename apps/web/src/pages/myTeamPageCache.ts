import type { LiveGwUpdate, MyTeamGameweekPicksResponse, MyTeamPageResponse, PlayerDetail } from "@fpl/contracts";

export type MyTeamCache = {
  state: { status: "ready"; payload: MyTeamPageResponse };
  selectedAccountId: number | null;
  email: string;
  entryIdInput: string;
  viewGameweek: number | null;
  historicalData: MyTeamGameweekPicksResponse | null;
};

const myTeamCache = new Map<string, MyTeamCache>();
const myTeamHistoricalCache = new Map<string, MyTeamGameweekPicksResponse>();
const playerDetailCache = new Map<number, PlayerDetail>();
const liveGwCache = new Map<number, LiveGwUpdate>();
let myTeamSavedParams = "";

export function resetMyTeamPageCache() {
  myTeamCache.clear();
  myTeamHistoricalCache.clear();
  playerDetailCache.clear();
  liveGwCache.clear();
  myTeamSavedParams = "";
}

export function getSavedMyTeamParam(key: string) {
  if (!myTeamSavedParams) return "";
  return new URLSearchParams(myTeamSavedParams).get(key) ?? "";
}

export function setSavedMyTeamParams(value: string) {
  myTeamSavedParams = value;
}

export function getMyTeamCacheKey(accountId: number | null | undefined) {
  return accountId === null || accountId === undefined ? "default" : String(accountId);
}

export function getHistoricalCacheKey(accountId: number, gameweek: number) {
  return `${accountId}|${gameweek}`;
}

export function getMyTeamCacheEntry(accountId: number | null | undefined) {
  return myTeamCache.get(getMyTeamCacheKey(accountId));
}

export function setMyTeamCacheEntry(accountId: number | null | undefined, value: MyTeamCache) {
  myTeamCache.set(getMyTeamCacheKey(accountId), value);
}

export function getHistoricalMyTeamCache(accountId: number, gameweek: number) {
  return myTeamHistoricalCache.get(getHistoricalCacheKey(accountId, gameweek)) ?? null;
}

export function setHistoricalMyTeamCache(accountId: number, gameweek: number, value: MyTeamGameweekPicksResponse) {
  myTeamHistoricalCache.set(getHistoricalCacheKey(accountId, gameweek), value);
}

export function getCachedPlayerDetail(playerId: number) {
  return playerDetailCache.get(playerId) ?? null;
}

export function setCachedPlayerDetail(playerId: number, detail: PlayerDetail) {
  playerDetailCache.set(playerId, detail);
}

export function getCachedLiveGw(gw: number) {
  return liveGwCache.get(gw) ?? null;
}

export function setCachedLiveGw(gw: number, update: LiveGwUpdate) {
  liveGwCache.set(gw, update);
}
