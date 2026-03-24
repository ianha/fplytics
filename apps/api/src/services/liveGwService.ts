import { env } from "../config/env.js";
import { fetchJson } from "../lib/http.js";
import type { LiveGwUpdate, LivePlayerPoints } from "@fpl/contracts";

type FplLiveElement = {
  id: number;
  stats: {
    minutes: number;
    goals_scored: number;
    assists: number;
    clean_sheets: number;
    saves: number;
    yellow_cards: number;
    red_cards: number;
    own_goals: number;
    penalties_saved: number;
    penalties_missed: number;
    goals_conceded: number;
    bonus: number;
    total_points: number;
  };
};

type FplLiveResponse = { elements: FplLiveElement[] };

const _cache = new Map<number, LiveGwUpdate>();
const _subscribers = new Map<number, Set<(u: LiveGwUpdate) => void>>();
const _polling = new Set<number>();

async function fetchAndCache(gameweek: number): Promise<void> {
  const data = await fetchJson<FplLiveResponse>(
    `${env.baseUrl}/event/${gameweek}/live/`,
  );

  const players: LivePlayerPoints[] = data.elements.map((el) => ({
    playerId: el.id,
    minutes: el.stats.minutes,
    goals: el.stats.goals_scored,
    assists: el.stats.assists,
    cleanSheet: el.stats.clean_sheets > 0,
    saves: el.stats.saves,
    yellowCards: el.stats.yellow_cards,
    redCards: el.stats.red_cards,
    ownGoals: el.stats.own_goals,
    penaltiesSaved: el.stats.penalties_saved,
    penaltiesMissed: el.stats.penalties_missed,
    goalsConceded: el.stats.goals_conceded,
    bonusProvisional: el.stats.bonus,
    totalLivePoints: el.stats.total_points,
  }));

  const isLive = players.some((p) => p.minutes > 0 && p.minutes < 90);

  const update: LiveGwUpdate = {
    gameweek,
    lastUpdated: new Date().toISOString(),
    isLive,
    players,
  };

  _cache.set(gameweek, update);
  _subscribers.get(gameweek)?.forEach((fn) => fn(update));
}

function subscribe(
  gameweek: number,
  fn: (u: LiveGwUpdate) => void,
): () => void {
  if (!_subscribers.has(gameweek)) _subscribers.set(gameweek, new Set());
  _subscribers.get(gameweek)!.add(fn);
  return () => _subscribers.get(gameweek)?.delete(fn);
}

function getCached(gameweek: number): LiveGwUpdate | null {
  return _cache.get(gameweek) ?? null;
}

function startPolling(gameweek: number, intervalMs = 60_000): void {
  if (_polling.has(gameweek)) return; // idempotent
  _polling.add(gameweek);
  fetchAndCache(gameweek).catch((e) =>
    console.error("[liveGw] initial fetch failed:", e),
  );
  setInterval(
    () => fetchAndCache(gameweek).catch((e) => console.error("[liveGw]", e)),
    intervalMs,
  );
}

export const liveGwService = { subscribe, getCached, startPolling, fetchAndCache };
