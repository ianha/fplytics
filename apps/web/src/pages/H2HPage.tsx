import type { H2HComparisonResponse } from "@fpl/contracts";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getH2HComparison, syncH2HRival } from "@/api/client";
import { GlowCard } from "@/components/ui/glow-card";
import { Badge } from "@/components/ui/badge";
import {
  describeBenchDelta,
  formatExpectedEdge,
  formatGapShare,
  formatOverlapLabel,
  formatPlayerTag,
  formatSignedNumber,
  formatSignedPoints,
  formatVarianceEdge,
  getLuckVerdictDescription,
  getLuckVerdictLabel,
  getTrendLabel,
} from "./h2hPageUtils";

type AsyncState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: H2HComparisonResponse };

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative group ml-1.5 inline-flex align-middle">
      <svg className="h-3.5 w-3.5 cursor-help text-white/35" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
      </svg>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-72 -translate-x-1/2 rounded-lg border border-white/10 bg-gray-900 px-3 py-2.5 text-xs leading-relaxed text-white/80 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

const _h2hCache = new Map<string, H2HComparisonResponse>();

export function resetH2HPageCacheForTests() {
  _h2hCache.clear();
}

export function H2HPage() {
  const { leagueId, rivalEntryId } = useParams<{ leagueId?: string; rivalEntryId?: string }>();
  const [state, setState] = useState<AsyncState>({ status: "loading" });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!leagueId || !rivalEntryId) {
      setState({
        status: "ready",
        payload: {
          syncRequired: true,
          rivalEntry: null,
          squadOverlap: null,
          gmRankHistory: [],
          attribution: null,
          positionalAudit: null,
          luckVsSkill: null,
          syncStatus: {
            currentGameweek: null,
            lastSyncedGw: null,
            stale: false,
            fetchedAt: null,
          },
        },
      });
      return;
    }

    const cacheKey = `${leagueId}:${rivalEntryId}`;
    const cached = _h2hCache.get(cacheKey);
    if (cached) {
      setState({ status: "ready", payload: cached });
      return;
    }

    let active = true;
    setState({ status: "loading" });

    getH2HComparison(Number(leagueId), Number(rivalEntryId))
      .then((payload) => {
        if (!active) return;
        _h2hCache.set(cacheKey, payload);
        setState({ status: "ready", payload });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      active = false;
    };
  }, [leagueId, rivalEntryId, refreshNonce]);

  async function handleSync() {
    if (!leagueId || !rivalEntryId) {
      return;
    }

    setSyncing(true);
    try {
      await syncH2HRival(Number(leagueId), Number(rivalEntryId), {});
      _h2hCache.delete(`${leagueId}:${rivalEntryId}`);
      setRefreshNonce((value) => value + 1);
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSyncing(false);
    }
  }

  if (state.status === "loading") {
    return <div className="p-6 text-white/80">Loading mini-league comparison…</div>;
  }

  if (state.status === "error") {
    return <div className="p-6 text-red-300">{state.message}</div>;
  }

  if (!leagueId || !rivalEntryId) {
    return (
      <div className="p-6">
        <GlowCard className="p-6">
          <h1 className="font-display text-2xl font-bold text-white">Mini-League</h1>
          <p className="mt-3 text-sm text-white/70">
            Select a league and rival from the{" "}
            <Link to="/leagues" className="text-accent underline-offset-4 hover:underline">
              Mini-League hub
            </Link>{" "}
            to view comparison insights.
          </p>
        </GlowCard>
      </div>
    );
  }

  if (!state.payload.rivalEntry && state.payload.syncRequired) {
    return (
      <div className="p-6">
        <GlowCard className="p-6">
          <h1 className="font-display text-2xl font-bold text-white">Rival not yet synced</h1>
          <p className="mt-3 text-sm text-white/70">
            This rival's data hasn't been loaded yet. Sync them to see comparison insights.
          </p>
          <button
            type="button"
            onClick={() => {
              void handleSync();
            }}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={syncing}
          >
            {syncing ? "Syncing…" : "Sync rival now"}
          </button>
        </GlowCard>
      </div>
    );
  }

  if (state.payload.syncRequired || !state.payload.squadOverlap) {
    const rivalEntry = state.payload.rivalEntry;
    if (!rivalEntry) {
      return (
        <div className="p-6">
          <GlowCard className="p-6">
            <h1 className="font-display text-2xl font-bold text-white">Rival not available</h1>
            <p className="mt-3 text-sm text-white/70">
              Sync this rival to load comparison insights.
            </p>
          </GlowCard>
        </div>
      );
    }

    return (
      <div className="p-6">
        <GlowCard className="p-6">
          <h1 className="font-display text-2xl font-bold text-white">{rivalEntry.teamName}</h1>
          <p className="mt-3 text-sm text-white/70">
            Sync this rival to load comparison insights.
          </p>
          <p className="mt-2 text-xs text-white/45">
            Rival: {rivalEntry.playerName}
          </p>
          <button
            type="button"
            onClick={() => {
              void handleSync();
            }}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={syncing}
          >
            {syncing ? "Syncing…" : "Sync rival now"}
          </button>
        </GlowCard>
      </div>
    );
  }

  const { rivalEntry, squadOverlap, gmRankHistory } = state.payload;
  const attribution = state.payload.attribution;
  const positionalAudit = state.payload.positionalAudit;
  const luckVsSkill = state.payload.luckVsSkill;
  const syncStatus = state.payload.syncStatus;

  if (!rivalEntry) {
    return <div className="p-6 text-red-300">Rival data is unavailable for this comparison.</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <GlowCard className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-white">{rivalEntry.teamName}</h1>
            <p className="mt-1 text-sm text-white/65">
              {rivalEntry.playerName} · Rank #{rivalEntry.rank} · {rivalEntry.totalPoints} pts
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { void handleSync(); }}
              disabled={syncing}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Re-sync"}
            </button>
            <Link to="/leagues" className="text-sm text-accent underline-offset-4 hover:underline">
              Mini-League hub
            </Link>
          </div>
        </div>
      </GlowCard>

      {syncStatus.stale ? (
        <GlowCard className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                Last synced through GW {syncStatus.lastSyncedGw}
              </p>
              <p className="text-sm text-white/60">
                Current GW is {syncStatus.currentGameweek}. Re-sync to refresh the latest H2H snapshot.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void handleSync();
              }}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60"
              disabled={syncing}
            >
              {syncing ? "Syncing…" : "Re-sync rival"}
            </button>
          </div>
        </GlowCard>
      ) : null}

      <GlowCard className="p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-white">Squad overlap</h2>
          <p className="text-sm text-white/50">GW {squadOverlap.gameweek} · {formatOverlapLabel(squadOverlap.overlapPct)}</p>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl bg-white/5 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">Shared ({squadOverlap.sharedPlayers.length})</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {squadOverlap.sharedPlayers.map((p) => (
                <span key={`shared-${p.id}`} className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/75">{p.webName}</span>
              ))}
            </div>
          </section>
          <section className="rounded-xl bg-white/5 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-400/60">Your differentials ({squadOverlap.userOnlyPlayers.length})</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {squadOverlap.userOnlyPlayers.map((p) => (
                <span key={`user-${p.id}`} className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300/80">{p.webName}</span>
              ))}
            </div>
          </section>
          <section className="rounded-xl bg-white/5 px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-400/60">Rival differentials ({squadOverlap.rivalOnlyPlayers.length})</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {squadOverlap.rivalOnlyPlayers.map((p) => (
                <span key={`rival-${p.id}`} className="rounded-md bg-rose-500/10 px-2 py-0.5 text-xs text-rose-300/80">{p.webName}</span>
              ))}
            </div>
          </section>
        </div>
      </GlowCard>

      {attribution ? (
        <GlowCard className="p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-xl font-semibold text-white">Points attribution</h2>
            <p className="text-sm font-semibold text-accent">Overall gap: {formatSignedPoints(attribution.totalPointDelta)}</p>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <section className="rounded-xl bg-white/5 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">Captaincy swing</h3>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-lg font-semibold text-accent">{formatSignedPoints(attribution.captaincy.delta)}</span>
                <span className="text-xs text-white/45">{formatGapShare(attribution.captaincy.shareOfGap)}</span>
              </div>
              <p className="mt-1 text-xs text-white/50">You: {attribution.captaincy.userPoints} · Rival: {attribution.captaincy.rivalPoints}</p>
            </section>

            <section className="rounded-xl bg-white/5 px-4 py-3">
              <h3 className="flex items-center text-xs font-semibold uppercase tracking-wide text-white/40">
                Transfer net impact
                <InfoTooltip text={`For each GW where a transfer was made: (your GW score) − (GW average) − (hit cost). Positive means transfers added value above the baseline; negative means churning hurt you.\n\n"You" = your linked FPL team. Rival = ${rivalEntry?.teamName ?? "your rival"}.`} />
              </h3>
              <p className="mt-1.5 text-lg font-semibold text-accent">{formatSignedPoints(attribution.transfers.delta)}</p>
              <p className="mt-1 text-xs text-white/50">
                You: {formatSignedNumber(attribution.transfers.userNetImpact)} · {rivalEntry?.teamName ?? "Rival"}: {formatSignedNumber(attribution.transfers.rivalNetImpact)}
              </p>
              <p className="text-xs text-white/35">
                Hits: You −{attribution.transfers.userHitCost} · {rivalEntry?.teamName ?? "Rival"} −{attribution.transfers.rivalHitCost}
              </p>
            </section>

            <section className="rounded-xl bg-white/5 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">Bench points stranded</h3>
              <p className="mt-1.5 text-lg font-semibold text-accent">{describeBenchDelta(attribution.bench.delta)}</p>
              <p className="mt-1 text-xs text-white/50">You: {attribution.bench.userPointsOnBench} · Rival: {attribution.bench.rivalPointsOnBench}</p>
            </section>
          </div>
        </GlowCard>
      ) : null}

      {positionalAudit ? (
        <GlowCard className="p-6">
          <h2 className="font-display text-xl font-semibold text-white">Positional audit</h2>
          <div className="mt-3 space-y-1">
            <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-6 px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-white/35">
              <span>Position</span>
              <span className="w-24 text-right">Delta</span>
              <span className="w-32 text-right">Avg £/GW</span>
              <span className="w-28 text-right">Pts/£m</span>
              <span className="w-16"></span>
            </div>
            {positionalAudit.rows.map((row) => (
              <div key={row.positionName} className="rounded-lg bg-white/5 px-4 py-2.5">
                <div className="md:grid md:grid-cols-[1fr_auto_auto_auto_auto] md:gap-x-6 md:items-center">
                  <div className="flex items-center justify-between md:justify-start gap-2">
                    <div>
                      <span className="text-sm font-semibold text-white/80">{row.positionName}</span>
                      <span className="ml-2 text-xs">
                        <span className={row.userPoints > row.rivalPoints ? "text-emerald-400/70" : row.userPoints < row.rivalPoints ? "text-rose-400/70" : "text-white/45"}>{row.userPoints}</span>
                        {row.userCaptainBonus > 0 && <span className="text-amber-400/60"> +{row.userCaptainBonus}C</span>}
                        <span className="text-white/35"> vs </span>
                        <span className={row.rivalPoints > row.userPoints ? "text-emerald-400/70" : row.rivalPoints < row.userPoints ? "text-rose-400/70" : "text-white/45"}>{row.rivalPoints}</span>
                        {row.rivalCaptainBonus > 0 && <span className="text-amber-400/60"> +{row.rivalCaptainBonus}C</span>}
                        {(row.userCaptainBonus > 0 || row.rivalCaptainBonus > 0) && (() => {
                          const capDelta = row.userCaptainBonus - row.rivalCaptainBonus;
                          return (
                            <span className={`ml-1 ${capDelta > 0 ? "text-emerald-400/70" : capDelta < 0 ? "text-rose-400/70" : "text-white/35"}`}>
                              ({capDelta > 0 ? "+" : ""}{capDelta})
                            </span>
                          );
                        })()}
                      </span>
                    </div>
                    <Badge variant={row.trend === "trail" ? "trail" : row.trend === "lead" ? "lead" : "outline"} className="md:hidden">
                      {getTrendLabel(row.trend)}
                    </Badge>
                  </div>
                  <span className={`hidden md:block w-24 text-right text-sm font-semibold ${row.pointDelta > 0 ? "text-emerald-400" : row.pointDelta < 0 ? "text-rose-400" : "text-white/60"}`}>
                    {formatSignedPoints(row.pointDelta)}
                  </span>
                  <span className="hidden md:block w-32 text-right text-xs">
                    <span className={row.userSpend > row.rivalSpend ? "text-emerald-400" : row.userSpend < row.rivalSpend ? "text-rose-400" : "text-white/45"}>£{row.userSpend.toFixed(1)}m</span>
                    <span className="text-white/30"> vs </span>
                    <span className={row.rivalSpend > row.userSpend ? "text-emerald-400" : row.rivalSpend < row.userSpend ? "text-rose-400" : "text-white/45"}>£{row.rivalSpend.toFixed(1)}m</span>
                  </span>
                  <span className="hidden md:block w-28 text-right text-xs">
                    <span className={row.userValuePerMillion > row.rivalValuePerMillion ? "text-emerald-400" : row.userValuePerMillion < row.rivalValuePerMillion ? "text-rose-400" : "text-white/45"}>{row.userValuePerMillion.toFixed(1)}</span>
                    <span className="text-white/30"> vs </span>
                    <span className={row.rivalValuePerMillion > row.userValuePerMillion ? "text-emerald-400" : row.rivalValuePerMillion < row.userValuePerMillion ? "text-rose-400" : "text-white/45"}>{row.rivalValuePerMillion.toFixed(1)}</span>
                  </span>
                  <span className="hidden md:flex w-16 justify-end">
                    <Badge variant={row.trend === "trail" ? "trail" : row.trend === "lead" ? "lead" : "outline"}>
                      {getTrendLabel(row.trend)}
                    </Badge>
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs md:hidden">
                  <span className={row.pointDelta > 0 ? "text-emerald-400" : row.pointDelta < 0 ? "text-rose-400" : "text-white/45"}>{formatSignedPoints(row.pointDelta)}</span>
                  <span>
                    <span className={row.userSpend > row.rivalSpend ? "text-emerald-400" : row.userSpend < row.rivalSpend ? "text-rose-400" : "text-white/45"}>£{row.userSpend.toFixed(1)}m</span>
                    <span className="text-white/30"> vs </span>
                    <span className={row.rivalSpend > row.userSpend ? "text-emerald-400" : row.rivalSpend < row.userSpend ? "text-rose-400" : "text-white/45"}>£{row.rivalSpend.toFixed(1)}m</span>
                  </span>
                  <span>
                    <span className={row.userValuePerMillion > row.rivalValuePerMillion ? "text-emerald-400" : row.userValuePerMillion < row.rivalValuePerMillion ? "text-rose-400" : "text-white/45"}>{row.userValuePerMillion.toFixed(1)}</span>
                    <span className="text-white/30"> vs </span>
                    <span className={row.rivalValuePerMillion > row.userValuePerMillion ? "text-emerald-400" : row.rivalValuePerMillion < row.userValuePerMillion ? "text-rose-400" : "text-white/45"}>{row.rivalValuePerMillion.toFixed(1)}</span>
                    <span className="text-white/30"> pts/£m</span>
                  </span>
                </div>
              </div>
            ))}
            {attribution ? (() => {
              const positionalDelta = positionalAudit.rows.reduce((sum, row) => sum + row.pointDelta, 0);
              const userHits = attribution.transfers.userHitCost;
              const rivalHits = attribution.transfers.rivalHitCost;
              const hitAdjustment = rivalHits - userHits;
              const netTotal = positionalDelta + hitAdjustment;
              return (
                <div className="border-t border-white/10 pt-2 mt-1 space-y-1 text-xs">
                  <div className="flex justify-between text-white/40 px-4">
                    <span>Subtotal (incl. captain bonus)</span>
                    <span>{formatSignedPoints(positionalDelta)}</span>
                  </div>
                  {hitAdjustment !== 0 && (
                    <div className="flex justify-between text-white/40 px-4">
                      <span>Transfer hits (You −{userHits} · Rival −{rivalHits})</span>
                      <span>{formatSignedPoints(hitAdjustment)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-white/80 px-4 pt-1 border-t border-white/10">
                    <span>Net total</span>
                    <span>{formatSignedPoints(netTotal)}</span>
                  </div>
                </div>
              );
            })() : null}
          </div>
        </GlowCard>
      ) : null}

      {luckVsSkill ? (
        <GlowCard className="px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-xl font-semibold text-white">Luck vs skill</h2>
              <Badge
                variant={
                  luckVsSkill.verdict === "rival_running_hot"
                    ? "lucky-lead"
                    : luckVsSkill.verdict === "user_running_hot"
                      ? "teal"
                      : luckVsSkill.verdict === "insufficient_data"
                        ? "outline"
                        : "secondary"
                }
              >
                {getLuckVerdictLabel(luckVsSkill.verdict)}
              </Badge>
            </div>
            <p className="text-xs text-white/40">GW {luckVsSkill.basedOnGameweek} xPts</p>
          </div>

          <p className="mt-2 text-sm text-white/60">{getLuckVerdictDescription(luckVsSkill.verdict)}</p>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="flex items-baseline justify-between rounded-xl bg-white/5 px-4 py-2.5">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">Expected edge</h3>
                <p className="mt-1 text-lg font-semibold text-accent">{formatExpectedEdge(luckVsSkill.expectedDelta)}</p>
              </div>
              <p className="text-xs text-white/45">
                {luckVsSkill.userExpectedPoints?.toFixed(1) ?? "—"} vs {luckVsSkill.rivalExpectedPoints?.toFixed(1) ?? "—"}
              </p>
            </div>
            <div className="flex items-baseline justify-between rounded-xl bg-white/5 px-4 py-2.5">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">Variance edge</h3>
                <p className="mt-1 text-lg font-semibold text-accent">{formatVarianceEdge(luckVsSkill.varianceEdge)}</p>
              </div>
              <p className="text-xs text-white/45">Actual: {formatSignedPoints(luckVsSkill.actualDelta)}</p>
            </div>
          </div>
        </GlowCard>
      ) : null}

      {gmRankHistory.length > 0 ? (
        <GlowCard className="px-6 py-4">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <div className="flex items-baseline gap-3">
              <h2 className="font-display text-xl font-semibold text-white">Manager history</h2>
              <span className="text-xs text-white/40">{gmRankHistory.length} GWs</span>
            </div>
            <svg
              className={`h-4 w-4 text-white/40 transition-transform ${historyOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {historyOpen && (
            <div className="mt-3 space-y-0.5">
              <div className="grid grid-cols-3 px-4 pb-1.5 text-xs font-semibold uppercase tracking-wide text-white/35">
                <span>GW</span>
                <span className="text-right">Your rank</span>
                <span className="text-right">Rival rank</span>
              </div>
              {gmRankHistory.map((row) => (
                <div key={row.gameweek} className="grid grid-cols-3 rounded bg-white/5 px-4 py-1.5 text-xs text-white/65">
                  <span>{row.gameweek}</span>
                  <span className="text-right">#{row.userOverallRank.toLocaleString()}</span>
                  <span className="text-right">#{row.rivalOverallRank.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </GlowCard>
      ) : null}
    </div>
  );
}
