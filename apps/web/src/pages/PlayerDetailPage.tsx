import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type { PlayerDetail } from "@fpl/contracts";
import { getPlayer, getPlayerXpts, resolveAssetUrl } from "@/api/client";
import { formatCost, formatPercent } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Users, Zap, Shield, Target, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";

type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

const POSITIONS: Record<number, string> = {
  1: "Goalkeeper",
  2: "Defender",
  3: "Midfielder",
  4: "Forward",
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  a: { label: "Available", color: "text-green-400 bg-green-500/15 border-green-500/25" },
  d: { label: "Doubtful", color: "text-yellow-400 bg-yellow-500/15 border-yellow-500/25" },
  i: { label: "Injured", color: "text-red-400 bg-red-500/15 border-red-500/25" },
  s: { label: "Suspended", color: "text-orange-400 bg-orange-500/15 border-orange-500/25" },
  u: { label: "Unavailable", color: "text-muted-foreground bg-secondary border-border" },
};

function StatBox({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-secondary/40 p-3 text-center">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className={`font-display text-lg font-bold ${accent ?? "text-white"}`}>{value}</p>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#1a0530]/95 backdrop-blur-sm px-3 py-2 shadow-xl text-xs">
      <p className="text-muted-foreground mb-1">GW {label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="font-semibold">
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

const _playerDetailCache = new Map<number, PlayerDetail>();
// Shared xPts lookup — populated once, reused across player detail visits
let _detailXptsMap = new Map<number, number | null>();
let _detailXptsLoaded = false;

export function PlayerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<AsyncState<PlayerDetail>>(() => {
    const numId = Number(id);
    const cached = _playerDetailCache.get(numId);
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  const [playerXpts, setPlayerXpts] = useState<number | null | undefined>(
    _detailXptsLoaded ? (_detailXptsMap.get(Number(id)) ?? null) : undefined,
  );

  useEffect(() => {
    if (!id) return;
    const numId = Number(id);
    const cached = _playerDetailCache.get(numId);
    if (cached) {
      setState({ status: "ready", data: cached });
    } else {
      setState({ status: "loading" });
      getPlayer(numId)
        .then((data) => {
          _playerDetailCache.set(numId, data);
          setState({ status: "ready", data });
        })
        .catch((e) => setState({ status: "error", message: e.message }));
    }
    if (!_detailXptsLoaded) {
      getPlayerXpts()
        .then((data) => {
          _detailXptsMap = new Map(data.map((x) => [x.playerId, x.xpts]));
          _detailXptsLoaded = true;
          setPlayerXpts(_detailXptsMap.get(numId) ?? null);
        })
        .catch(() => {});
    } else {
      setPlayerXpts(_detailXptsMap.get(numId) ?? null);
    }
  }, [id]);

  if (state.status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-destructive">{state.message}</p>
        <Link to="/players" className="text-sm text-primary underline">
          Back to players
        </Link>
      </div>
    );
  }

  const { player, history, upcomingFixtures } = state.data;
  const img = resolveAssetUrl(player.imagePath);
  const status = STATUS_MAP[player.status] ?? STATUS_MAP.u;
  const posLabel = POSITIONS[player.positionId] ?? "Player";

  // History chart data
  const chartData = [...history].reverse().map((h) => ({
    gw: h.round,
    Points: h.totalPoints,
    Minutes: Math.round(h.minutes / 10), // scaled
    xGI: Number(h.expectedGoalInvolvements?.toFixed(2) ?? 0),
  }));

  // Radar data — normalised 0–10
  const radarData = [
    { subject: "Goals", value: Math.min(player.goalsScored * 2, 10), fullMark: 10 },
    { subject: "Assists", value: Math.min(player.assists * 2, 10), fullMark: 10 },
    { subject: "xGI", value: Math.min(player.expectedGoalInvolvements / 3, 10), fullMark: 10 },
    { subject: "Form", value: Math.min(player.form * 1.2, 10), fullMark: 10 },
    { subject: "ICT", value: Math.min(player.ictIndex / 45, 10), fullMark: 10 },
    { subject: "Bonus", value: Math.min(player.bonus / 3, 10), fullMark: 10 },
  ];

  return (
    <div className="space-y-5 p-6 lg:p-8">
      {/* Back */}
      <Link
        to="/players"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Players
      </Link>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#37003c] via-[#5b0075] to-[#200030] p-6">
        <div className="absolute -top-12 -right-12 h-48 w-48 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 h-32 w-32 rounded-full bg-accent/10 blur-2xl pointer-events-none" />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
          {/* Photo */}
          <div className="relative shrink-0">
            {img ? (
              <img
                src={img}
                alt={player.webName}
                className="h-28 w-28 rounded-2xl border-2 border-white/15 object-cover bg-secondary shadow-2xl"
              />
            ) : (
              <div className="h-28 w-28 rounded-2xl border-2 border-white/15 bg-secondary flex items-center justify-center">
                <Users className="h-10 w-10 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Name & meta */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${status.color}`}
              >
                {status.label}
              </span>
              <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-xs text-white/70">
                {posLabel}
              </span>
            </div>
            <h1 className="font-display text-3xl font-bold text-white">
              {player.firstName} {player.secondName}
            </h1>
            <p className="text-sm text-white/60">{player.teamName}</p>
          </div>

          {/* Key stats */}
          <div className="grid grid-cols-3 gap-3 sm:shrink-0">
            <div className="text-center">
              <p className="font-display text-3xl font-bold text-accent">{player.totalPoints}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/50">Points</p>
            </div>
            <div className="text-center">
              <p className="font-display text-3xl font-bold text-primary">{formatCost(player.nowCost)}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/50">Price</p>
            </div>
            <div className="text-center">
              <p className="font-display text-3xl font-bold text-white">{Number(player.form).toFixed(1)}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/50">Form</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-9">
        {playerXpts !== undefined && (
          <div className="col-span-1 rounded-lg border border-accent/30 bg-accent/10 p-3 text-center">
            <p className="text-[10px] text-accent/70 uppercase tracking-wider mb-1">xPts</p>
            <p className="font-display text-lg font-bold text-accent">
              {playerXpts !== null ? playerXpts.toFixed(1) : "—"}
            </p>
          </div>
        )}
        {[
          { label: "Goals", value: player.goalsScored },
          { label: "Assists", value: player.assists },
          { label: "xG", value: player.expectedGoals.toFixed(2), accent: "text-accent" },
          { label: "xA", value: player.expectedAssists.toFixed(2), accent: "text-accent" },
          { label: "xGI", value: player.expectedGoalInvolvements.toFixed(2), accent: "text-primary" },
          { label: "Minutes", value: player.minutes },
          { label: "Bonus", value: player.bonus },
          { label: "Sel%", value: formatPercent(Number(player.selectedByPercent)) },
        ].map(({ label, value, accent }) => (
          <StatBox key={label} label={label} value={value} accent={accent} />
        ))}
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Points history — spans 2 */}
        {chartData.length > 0 && (
          <Card className="lg:col-span-2 border-white/8 bg-card/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Points History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradPoints" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00ffbf" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00ffbf" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="gw"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                    tickFormatter={(v) => `GW${v}`}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="Points"
                    stroke="#00ffbf"
                    strokeWidth={2}
                    fill="url(#gradPoints)"
                    dot={{ fill: "#00ffbf", r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: "#00ffbf", strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Radar */}
        <Card className="border-white/8 bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-accent" />
              Attributes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData} margin={{ top: 8, right: 16, left: 16, bottom: 8 }}>
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis
                  dataKey="subject"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 10]}
                  tick={false}
                  axisLine={false}
                />
                <Radar
                  name={player.webName}
                  dataKey="value"
                  stroke="#e90052"
                  fill="#e90052"
                  fillOpacity={0.2}
                  strokeWidth={2}
                  dot={{ fill: "#e90052", r: 3, strokeWidth: 0 }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Gameweek history table */}
      {history.length > 0 && (
        <Card className="border-white/8 bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Recent Gameweeks</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/8">
                    {["GW", "Pts", "Min", "G", "A", "CS", "Bonus", "xGI"].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:rounded-tl-none last:rounded-tr-none"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 8).map((h, i) => (
                    <tr
                      key={i}
                      className="border-b border-white/4 transition-colors hover:bg-white/3 last:border-0"
                    >
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        GW{h.round}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-display text-sm font-bold text-accent">
                          {h.totalPoints}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-white">{h.minutes}</td>
                      <td className="px-4 py-2.5 text-xs text-white">{h.goalsScored}</td>
                      <td className="px-4 py-2.5 text-xs text-white">{h.assists}</td>
                      <td className="px-4 py-2.5 text-xs text-white">{h.cleanSheets}</td>
                      <td className="px-4 py-2.5 text-xs text-primary font-semibold">{h.bonus}</td>
                      <td className="px-4 py-2.5 text-xs text-white">
                        {(h.expectedGoalInvolvements ?? 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upcoming fixtures */}
      {upcomingFixtures.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-white flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Upcoming Fixtures
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingFixtures.map((f) => {
              const isHome = f.teamH === player.teamId;
              const opponent = isHome ? f.teamAShortName : f.teamHShortName;
              return (
                <div
                  key={f.id}
                  className="rounded-xl border border-white/8 bg-card/50 px-4 py-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {opponent}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        ({isHome ? "H" : "A"})
                      </span>
                    </p>
                    {f.kickoffTime && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(f.kickoffTime).toLocaleDateString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </p>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    isHome ? "bg-accent/15 text-accent" : "bg-white/10 text-white/50"
                  }`}>
                    {isHome ? "Home" : "Away"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
