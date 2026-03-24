import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, MotionConfig, useMotionValue, useMotionTemplate, animate } from "framer-motion";
import type { OverviewResponse, PlayerXpts } from "@fpl/contracts";
import { getOverview, getPlayerXpts, resolveAssetUrl } from "@/api/client";
import { formatCost } from "@/lib/format";
import { GlowCard, BGPattern } from "@/components/ui/glow-card";
import {
  TrendingUp,
  Users,
  Trophy,
  Calendar,
  ChevronRight,
  Star,
  Clock,
  Zap,
  Sparkles,
  ShieldAlert,
} from "lucide-react";

type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

const POSITION_LABELS: Record<number, { short: string; color: string }> = {
  1: { short: "GKP", color: "bg-yellow-500/20 text-yellow-300" },
  2: { short: "DEF", color: "bg-blue-500/20 text-blue-300" },
  3: { short: "MID", color: "bg-green-500/20 text-green-300" },
  4: { short: "FWD", color: "bg-pink-500/20 text-pink-300" },
};


let _dashboardCache: OverviewResponse | null = null;
let _dashboardXptsCache: PlayerXpts[] | null = null;

// All valid FPL formations: GKP=1 fixed, DEF 3-5, MID 2-5, FWD 1-3, total outfield = 10
const VALID_FORMATIONS = [
  { def: 3, mid: 5, fwd: 2 },
  { def: 3, mid: 4, fwd: 3 },
  { def: 4, mid: 5, fwd: 1 },
  { def: 4, mid: 4, fwd: 2 },
  { def: 4, mid: 3, fwd: 3 },
  { def: 5, mid: 4, fwd: 1 },
  { def: 5, mid: 3, fwd: 2 },
  { def: 5, mid: 2, fwd: 3 },
];

const POS_ID: Record<string, number> = { Goalkeeper: 1, Defender: 2, Midfielder: 3, Forward: 4 };

// Minimum probability of starting (60+ min) to be eligible for Optimal XI
const MIN_START_PROBABILITY = 0.5;

function buildBestXI(xptsList: PlayerXpts[]): { players: PlayerXpts[]; formation: string } {
  const sorted = (posId: number) =>
    xptsList
      .filter((p) => POS_ID[p.position] === posId && p.xpts !== null && p.minutesProbability >= MIN_START_PROBABILITY)
      .sort((a, b) => (b.xpts ?? 0) - (a.xpts ?? 0));

  const gkp = sorted(1);
  const def = sorted(2);
  const mid = sorted(3);
  const fwd = sorted(4);

  const gkpXpts = gkp[0]?.xpts ?? 0;

  let bestTotal = -Infinity;
  let best = VALID_FORMATIONS[3]; // fallback 4-4-2

  for (const f of VALID_FORMATIONS) {
    const total =
      gkpXpts +
      def.slice(0, f.def).reduce((s, p) => s + (p.xpts ?? 0), 0) +
      mid.slice(0, f.mid).reduce((s, p) => s + (p.xpts ?? 0), 0) +
      fwd.slice(0, f.fwd).reduce((s, p) => s + (p.xpts ?? 0), 0);
    if (total > bestTotal) {
      bestTotal = total;
      best = f;
    }
  }

  const players = [
    ...gkp.slice(0, 1),
    ...def.slice(0, best.def),
    ...mid.slice(0, best.mid),
    ...fwd.slice(0, best.fwd),
  ];

  // Group into pitch rows: GKP, DEF, MID, FWD
  const pitchRows: PlayerXpts[][] = [
    gkp.slice(0, 1),
    def.slice(0, best.def),
    mid.slice(0, best.mid),
    fwd.slice(0, best.fwd),
  ];

  const totalXpts = players.reduce((s, p) => s + (p.xpts ?? 0), 0);

  return { players, pitchRows, formation: `${best.def}-${best.mid}-${best.fwd}`, totalXpts };
}

export function Dashboard() {
  const [state, setState] = useState<AsyncState<OverviewResponse>>(
    () => _dashboardCache ? { status: "ready", data: _dashboardCache } : { status: "loading" }
  );
  const [bestXI, setBestXI] = useState<{ players: PlayerXpts[]; pitchRows: PlayerXpts[][]; formation: string; totalXpts: number }>(
    () => _dashboardXptsCache ? buildBestXI(_dashboardXptsCache) : { players: [], pitchRows: [], formation: "", totalXpts: 0 },
  );
  // Skip entrance animations when data was already in cache at mount time
  const noAnim = useRef(state.status === "ready").current;
  const color = useMotionValue("#a855f7");

  useEffect(() => {
    animate(color, ["#a855f7", "#e90052", "#00ffbf", "#a855f7"], {
      ease: "easeInOut",
      duration: 12,
      repeat: Infinity,
      repeatType: "mirror",
    });
  }, [color]);

  const backgroundImage = useMotionTemplate`radial-gradient(125% 125% at 50% 0%, #0d0118 50%, ${color})`;

  useEffect(() => {
    if (!_dashboardXptsCache) {
      getPlayerXpts()
        .then((data) => {
          _dashboardXptsCache = data;
          setBestXI(buildBestXI(data));
        })
        .catch(() => {});
    }
    if (_dashboardCache) return;
    getOverview()
      .then((data) => {
        _dashboardCache = data;
        setState({ status: "ready", data });
      })
      .catch((e) => setState({ status: "error", message: e.message }));
  }, []);

  if (state.status === "loading") {
    return (
      <motion.div
        style={{ backgroundImage }}
        className="min-h-screen flex items-center justify-center"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-white/50">Loading dashboard…</p>
        </div>
      </motion.div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-destructive">{state.message}</p>
      </div>
    );
  }

  const { topPlayers, fixtures, gameweeks } = state.data;
  const currentGW = gameweeks.find((gw) => gw.isCurrent) ?? gameweeks[gameweeks.length - 1];
  const nextGW = gameweeks.find((gw) => !gw.isFinished && !gw.isCurrent);

  const heroStats = [
    {
      label: "Gameweek",
      value: currentGW ? `GW ${currentGW.id}` : "—",
      icon: <Trophy className="w-4 h-4" />,
      trend: currentGW?.isFinished ? "Finished" : "Live",
    },
    {
      label: "Next Deadline",
      value: nextGW?.deadlineTime
        ? new Date(nextGW.deadlineTime).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
        : "—",
      icon: <Clock className="w-4 h-4" />,
      trend: nextGW?.deadlineTime
        ? new Date(nextGW.deadlineTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
        : "",
    },
    {
      label: "Top Players",
      value: topPlayers.length,
      icon: <TrendingUp className="w-4 h-4" />,
      trend: "Tracked",
    },
    {
      label: "Fixtures",
      value: fixtures.length,
      icon: <Calendar className="w-4 h-4" />,
      trend: "This GW",
    },
  ];

  return (
    <MotionConfig skipAnimations={noAnim}>
      <motion.div
        style={{ backgroundImage }}
        className="min-h-screen w-full text-white relative overflow-x-hidden"
      >
        <BGPattern variant="grid" mask="fade-edges" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
          {/* Hero Banner */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <GlowCard className="p-8 md:p-10" glowColor="magenta">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-accent" />
                    <span className="text-xs font-semibold uppercase tracking-widest text-accent">
                      Fantasy Premier League analytics
                    </span>
                  </div>
                  <h1 className="font-display text-4xl md:text-5xl font-bold bg-gradient-to-r from-white via-purple-200 to-pink-200 bg-clip-text text-transparent">
                    {currentGW ? `Gameweek ${currentGW.id}` : "FPLytics"}
                  </h1>
                  {nextGW?.deadlineTime && (
                    <p className="text-white/60 text-base">
                      Deadline:{" "}
                      {new Date(nextGW.deadlineTime).toLocaleDateString("en-GB", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3 pt-1">
                    <Link to="/players">
                      <button className="px-5 py-2.5 bg-gradient-to-r from-primary to-purple-600 rounded-xl hover:from-primary/90 hover:to-purple-500 transition-all flex items-center gap-2 text-sm font-medium cursor-pointer shadow-lg shadow-primary/20">
                        Browse Players
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </Link>
                    <Link to="/fixtures">
                      <button className="px-5 py-2.5 bg-white/8 border border-white/15 rounded-xl hover:bg-white/15 transition-all text-sm font-medium cursor-pointer backdrop-blur-xl">
                        View Fixtures
                      </button>
                    </Link>
                  </div>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-2 gap-3 shrink-0">
                  {heroStats.map((stat, i) => (
                    <motion.div
                      key={stat.label}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.1 + i * 0.08 }}
                      className="bg-white/6 backdrop-blur-xl border border-white/10 rounded-xl p-4 min-w-[130px]"
                    >
                      <div className="flex items-center gap-1.5 mb-2 text-purple-300">
                        {stat.icon}
                        <span className="text-[10px] uppercase tracking-wider">{stat.label}</span>
                      </div>
                      <div className="font-display text-2xl font-bold text-white">{stat.value}</div>
                      {stat.trend && (
                        <div className="text-[11px] text-accent mt-0.5">{stat.trend}</div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            </GlowCard>
          </motion.div>

          {/* Bento grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Top players */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-400" />
                  Top Performers
                </h2>
                <Link
                  to="/players"
                  className="text-xs text-white/50 hover:text-primary transition-colors flex items-center gap-1"
                >
                  View all <ChevronRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {topPlayers.slice(0, 6).map((player, i) => {
                  const img = resolveAssetUrl(player.imagePath);
                  const pos = POSITION_LABELS[player.positionId];
                  return (
                    <motion.div
                      key={player.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05 * i }}
                    >
                      <Link to={`/players/${player.id}`}>
                        <GlowCard
                          className="p-5 hover:scale-[1.02] transition-transform cursor-pointer"
                          glowColor="purple"
                        >
                          <div className="flex items-start gap-4">
                            <div className="relative shrink-0">
                              {img ? (
                                <img
                                  src={img}
                                  alt={player.webName}
                                  className="w-14 h-14 rounded-xl object-cover ring-1 ring-white/15"
                                />
                              ) : (
                                <div className="w-14 h-14 rounded-xl bg-white/8 flex items-center justify-center ring-1 ring-white/15">
                                  <Users className="w-6 h-6 text-white/40" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-bold text-sm truncate">{player.webName}</h3>
                              <div className="flex items-center gap-2 text-xs text-white/50 mb-3 mt-0.5">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pos?.color ?? ""}`}>
                                  {pos?.short}
                                </span>
                                <span>{player.teamShortName}</span>
                              </div>
                              <div className="grid grid-cols-4 gap-1 text-xs">
                                {[
                                  { label: "Pts", value: player.totalPoints, color: "text-accent" },
                                  { label: "Form", value: Number(player.form).toFixed(1), color: "text-primary" },
                                  { label: "Price", value: formatCost(player.nowCost), color: "text-white" },
                                  { label: "xGI", value: player.expectedGoalInvolvements.toFixed(1), color: "text-white" },
                                ].map(({ label, value, color }) => (
                                  <div key={label}>
                                    <div className="text-[10px] text-white/40">{label}</div>
                                    <div className={`font-bold ${color}`}>{value}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </GlowCard>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Fixtures + quick stats */}
            <div className="space-y-4">
              <h2 className="font-display text-xl font-bold flex items-center gap-2">
                <Calendar className="w-5 h-5 text-accent" />
                Fixtures
              </h2>

              <GlowCard className="p-5" glowColor="teal">
                <div className="space-y-2.5">
                  {fixtures.slice(0, 6).map((fixture, i) => (
                    <motion.div
                      key={fixture.id}
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i }}
                      className="bg-white/5 border border-white/8 rounded-xl px-4 py-3 hover:bg-white/10 transition-colors"
                    >
                      {fixture.kickoffTime && (
                        <div className="mb-1.5">
                          <span className="text-[11px] text-white/40">
                            {new Date(fixture.kickoffTime).toLocaleDateString("en-GB", {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold">{fixture.teamHShortName}</span>
                        {fixture.teamHScore !== null && fixture.teamAScore !== null ? (
                          <span className="font-display font-bold text-accent">
                            {fixture.teamHScore}–{fixture.teamAScore}
                          </span>
                        ) : (
                          <span className="text-white/40 text-xs">vs</span>
                        )}
                        <span className="font-semibold">{fixture.teamAShortName}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </GlowCard>

              {/* Quick stats */}
              <GlowCard className="p-5" glowColor="purple">
                <h3 className="font-bold text-sm mb-3 text-white/80">Season Stats</h3>
                <div className="space-y-2.5">
                  {[
                    { label: "Gameweeks played", value: gameweeks.filter((g) => g.isFinished).length },
                    { label: "Total fixtures", value: fixtures.length },
                    { label: "GWs remaining", value: gameweeks.filter((g) => !g.isFinished).length },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center">
                      <span className="text-sm text-white/50">{label}</span>
                      <span className="font-display font-bold text-accent">{value}</span>
                    </div>
                  ))}
                </div>
              </GlowCard>
            </div>
          </div>

          {/* Optimal XI pitch view */}
          {bestXI.players.length > 0 && (
            <div className="space-y-4 max-w-lg mx-auto w-full">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-accent" />
                  Optimal XI
                  {bestXI.formation && (
                    <span className="text-sm font-normal text-white/40 ml-1">({bestXI.formation})</span>
                  )}
                  {bestXI.totalXpts > 0 && (
                    <span className="text-sm font-bold text-accent ml-2">{bestXI.totalXpts.toFixed(1)} xPts</span>
                  )}
                </h2>
                <Link
                  to="/players?col=xPts&dir=desc"
                  className="text-xs text-white/50 hover:text-accent transition-colors flex items-center gap-1"
                >
                  All players <ChevronRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="overflow-hidden rounded-2xl border border-white/8">
                {/* Pitch area */}
                <div className="relative bg-[linear-gradient(180deg,#2d8a4e_0%,#1f6335_55%,#174d28_100%)] px-4 pb-8 pt-5">
                  {/* SVG field markings */}
                  <svg
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <rect x="18" y="0" width="64" height="18" rx="0.3" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="0.6" />
                    <rect x="34" y="0" width="32" height="8" rx="0.3" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="0.6" />
                    <circle cx="50" cy="13" r="0.8" fill="white" fillOpacity="0.12" />
                    <line x1="0" y1="84" x2="100" y2="84" stroke="white" strokeOpacity="0.09" strokeWidth="0.6" />
                    <circle cx="50" cy="84" r="10" fill="none" stroke="white" strokeOpacity="0.09" strokeWidth="0.6" />
                    <circle cx="50" cy="84" r="0.8" fill="white" fillOpacity="0.12" />
                  </svg>

                  <div className="relative z-10 space-y-5">
                    {bestXI.pitchRows.map((row, rowIdx) => (
                      <div
                        key={rowIdx}
                        className="grid gap-2"
                        style={{ gridTemplateColumns: `repeat(${Math.max(row.length, 1)}, minmax(0, 1fr))` }}
                      >
                        {row.map((p) => {
                          const image = resolveAssetUrl(p.imagePath);
                          return (
                            <Link key={p.playerId} to={`/players/${p.playerId}`}>
                              <div className="group flex flex-col items-center text-center cursor-pointer">
                                <div className="mb-1 relative">
                                  {image ? (
                                    <img
                                      src={image}
                                      alt={p.playerName}
                                      className="h-16 w-16 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.55)] sm:h-20 sm:w-20 transition-transform duration-200 group-hover:scale-105"
                                    />
                                  ) : (
                                    <div className="flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20">
                                      <ShieldAlert className="h-7 w-7 text-white/50 drop-shadow" />
                                    </div>
                                  )}
                                </div>
                                <div className="w-full max-w-[86px] rounded-md bg-[rgba(5,1,15,0.82)] px-1.5 py-1 backdrop-blur-sm">
                                  <div className="truncate font-display text-[11px] font-bold leading-tight text-white">
                                    {p.playerName}
                                  </div>
                                  <div className="font-display text-[13px] font-bold tabular-nums leading-tight text-accent">
                                    {p.xpts?.toFixed(1)}
                                  </div>
                                </div>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </MotionConfig>
  );
}
