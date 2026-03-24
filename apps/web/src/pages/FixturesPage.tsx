import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import type { FixtureCard, GameweekSummary, GwCalendarRow, TeamSummary } from "@fpl/contracts";
import { getOverview, getFixtures, getGwCalendar } from "@/api/client";
import { Calendar, ChevronLeft, ChevronRight, Shield } from "lucide-react";
import { GlowCard, BGPattern } from "@/components/ui/glow-card";
import { cn } from "@/lib/utils";
import {
  buildFixturesSearchParams,
  getDefaultFixtureGameweek,
  getFixturesCacheKey,
  parseNullableNumber,
} from "./fixturesPageUtils";

type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

type FixturesOverviewCache = { gameweeks: GameweekSummary[]; teams: TeamSummary[] };
let _fixturesOverviewCache: FixturesOverviewCache | null = null;
const _fixturesDataCache = new Map<string, FixtureCard[]>();
let _fixturesSavedParams = "";
let _calendarCache: GwCalendarRow[] | null = null;

function getSavedParam(key: string): string {
  if (!_fixturesSavedParams) return "";
  return new URLSearchParams(_fixturesSavedParams).get(key) ?? "";
}

function GwCalendarGrid({ rows }: { rows: GwCalendarRow[] }) {
  if (rows.length === 0) return null;
  const gameweeks = Object.keys(rows[0].gameweeks)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            <th className="sticky left-0 z-10 bg-[#0d0118] px-3 py-2.5 text-left text-xs font-semibold text-white/50 min-w-[90px]">
              Team
            </th>
            {gameweeks.map((gw) => (
              <th
                key={gw}
                className="px-2 py-2.5 text-center text-xs font-semibold text-white/50 min-w-[72px]"
              >
                GW{gw}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.teamId}
              className={cn(
                "border-b border-white/5 transition-colors hover:bg-white/[0.03]",
                i % 2 === 0 ? "bg-white/[0.01]" : "",
              )}
            >
              <td className="sticky left-0 z-10 bg-[#0d0118] px-3 py-2 text-xs font-semibold text-white">
                <span className="hidden sm:inline">{row.teamName}</span>
                <span className="sm:hidden">{row.teamShortName}</span>
              </td>
              {gameweeks.map((gw) => {
                const fixtures = row.gameweeks[gw] ?? [];

                if (fixtures.length === 0) {
                  return (
                    <td key={gw} className="px-2 py-2 text-center">
                      <span className="text-[11px] font-semibold text-white/20">—</span>
                    </td>
                  );
                }

                if (fixtures.length >= 2) {
                  return (
                    <td key={gw} className="px-1 py-1.5 text-center">
                      <div className="flex flex-col gap-0.5 items-center">
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-accent/20 text-accent border border-accent/30">
                          DGW
                        </span>
                        {fixtures.map((f, fi) => (
                          <span key={fi} className="text-[10px] text-white/60">
                            {f.opponentShort}
                            <span className="text-white/30">{f.isHome ? "H" : "A"}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  );
                }

                const f = fixtures[0];
                return (
                  <td key={gw} className="px-2 py-2 text-center">
                    <span className="text-[11px] text-white/75">
                      {f.opponentShort}
                      <span className="text-white/35 text-[10px]">
                        {f.isHome ? "H" : "A"}
                      </span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FixturesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialGW = parseNullableNumber(searchParams.get("gw") ?? getSavedParam("gw"));
  const initialTeam = parseNullableNumber(searchParams.get("team") ?? getSavedParam("team"));
  const initialKey = getFixturesCacheKey(initialGW, initialTeam);
  const [gameweeks, setGameweeks] = useState<GameweekSummary[]>(_fixturesOverviewCache?.gameweeks ?? []);
  const [teams, setTeams] = useState<TeamSummary[]>(_fixturesOverviewCache?.teams ?? []);
  const [selectedGW, setSelectedGW] = useState<number | null>(initialGW);
  const [selectedTeam, setSelectedTeam] = useState<number | null>(initialTeam);
  const [fixturesState, setFixturesState] = useState<AsyncState<FixtureCard[]>>(() => {
    const cached = _fixturesDataCache.get(initialKey);
    return cached ? { status: "ready", data: cached } : { status: "loading" };
  });
  // Skip entrance animations when data was already in cache at mount time
  const noAnim = useRef(fixturesState.status === "ready").current;

  const [activeTab, setActiveTab] = useState<"fixtures" | "calendar">("fixtures");
  type CalendarState =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: GwCalendarRow[] };
  const [calendarState, setCalendarState] = useState<CalendarState>(() =>
    _calendarCache ? { status: "ready", data: _calendarCache } : { status: "loading" },
  );

  // Load overview (gameweeks + teams) on mount — skip if already cached
  useEffect(() => {
    if (_fixturesOverviewCache) return;
    getOverview().then((data) => {
      _fixturesOverviewCache = { gameweeks: data.gameweeks, teams: data.teams };
      setGameweeks(data.gameweeks);
      setTeams(data.teams);
      // Only set default GW if nothing was previously selected
      if (initialGW === null) {
        setSelectedGW(getDefaultFixtureGameweek(data.gameweeks));
      }
    });
  }, [initialGW]);

  // Load fixtures when gameweek or team filter changes — check cache first
  const loadFixtures = useCallback((gwId: number | null, teamId: number | null) => {
    const key = getFixturesCacheKey(gwId, teamId);
    const cached = _fixturesDataCache.get(key);
    if (cached) {
      setFixturesState({ status: "ready", data: cached });
      return;
    }
    setFixturesState({ status: "loading" });
    getFixtures({
      event: gwId ?? undefined,
      team: teamId ?? undefined,
    })
      .then((data) => {
        _fixturesDataCache.set(key, data);
        setFixturesState({ status: "ready", data });
      })
      .catch((e) => setFixturesState({ status: "error", message: e.message }));
  }, []);

  useEffect(() => {
    if (selectedGW !== null || selectedTeam !== null) {
      loadFixtures(selectedGW, selectedTeam);
    }
  }, [selectedGW, selectedTeam, loadFixtures]);

  useEffect(() => {
    const params = buildFixturesSearchParams(selectedGW, selectedTeam);
    _fixturesSavedParams = params.toString();
    setSearchParams(params, { replace: true });
  }, [selectedGW, selectedTeam, setSearchParams]);

  useEffect(() => {
    if (activeTab !== "calendar" || _calendarCache) {
      if (_calendarCache) setCalendarState({ status: "ready", data: _calendarCache });
      return;
    }
    getGwCalendar()
      .then((data) => {
        _calendarCache = data;
        setCalendarState({ status: "ready", data });
      })
      .catch((e: Error) =>
        setCalendarState({ status: "error", message: e.message }),
      );
  }, [activeTab]);

  const currentGWIndex = gameweeks.findIndex((gw) => gw.id === selectedGW);
  const currentGW = gameweeks[currentGWIndex];
  const fixtures = fixturesState.status === "ready" ? fixturesState.data : [];

  return (
    <MotionConfig skipAnimations={noAnim}>
    <div className="relative min-h-screen text-white">
      <BGPattern variant="dots" mask="fade-edges" />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Calendar className="w-6 h-6 text-accent" />
          <div>
            <h1 className="font-display text-2xl font-bold">Fixtures</h1>
            <p className="text-sm text-white/50">Browse all Premier League fixtures by gameweek</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("fixtures")}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              activeTab === "fixtures"
                ? "bg-primary text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
            )}
          >
            Fixtures
          </button>
          <button
            onClick={() => setActiveTab("calendar")}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              activeTab === "calendar"
                ? "bg-primary text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
            )}
          >
            GW Calendar
          </button>
        </div>

        {activeTab === "fixtures" && (
          <>
            {/* Gameweek navigator */}
            <GlowCard className="p-5" glowColor="teal">
              <div className="flex items-center justify-between gap-4">
                <button
                  onClick={() =>
                    currentGWIndex > 0 && setSelectedGW(gameweeks[currentGWIndex - 1].id)
                  }
                  disabled={currentGWIndex <= 0}
                  className="p-2 rounded-xl hover:bg-white/10 disabled:opacity-30 transition-all"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="text-center">
                  <div className="font-display text-xl font-bold">
                    {currentGW ? currentGW.name : "Loading…"}
                  </div>
                  {currentGW?.deadlineTime && (
                    <div className="text-xs text-white/40 mt-1">
                      Deadline:{" "}
                      {new Date(currentGW.deadlineTime).toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  )}
                </div>

                <button
                  onClick={() =>
                    currentGWIndex < gameweeks.length - 1 &&
                    setSelectedGW(gameweeks[currentGWIndex + 1].id)
                  }
                  disabled={currentGWIndex >= gameweeks.length - 1}
                  className="p-2 rounded-xl hover:bg-white/10 disabled:opacity-30 transition-all"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </GlowCard>

            {/* Team filter chips */}
            {teams.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <button
                  onClick={() => setSelectedTeam(null)}
                  className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    selectedTeam === null
                      ? "bg-accent text-black shadow-lg shadow-accent/25"
                      : "bg-white/8 text-white/60 hover:bg-white/15 hover:text-white"
                  }`}
                >
                  All
                </button>
                {teams.map((team) => (
                  <button
                    key={team.id}
                    onClick={() => setSelectedTeam(selectedTeam === team.id ? null : team.id)}
                    className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      selectedTeam === team.id
                        ? "bg-primary text-white shadow-lg shadow-primary/25"
                        : "bg-white/8 text-white/60 hover:bg-white/15 hover:text-white"
                    }`}
                  >
                    {team.shortName}
                  </button>
                ))}
              </div>
            )}

            {/* Fixtures list */}
            {fixturesState.status === "loading" && (
              <div className="flex justify-center py-16">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}

            {fixturesState.status === "error" && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
                <p className="text-sm text-destructive">{fixturesState.message}</p>
              </div>
            )}

            {fixturesState.status === "ready" && (
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${selectedGW}-${selectedTeam}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="grid grid-cols-1 md:grid-cols-2 gap-3"
                >
                  {fixtures.map((fixture, i) => (
                    <motion.div
                      key={fixture.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.03 * i }}
                    >
                      <GlowCard className="p-4" glowColor={fixture.finished ? "teal" : "purple"}>
                        {/* Kickoff time */}
                        {fixture.kickoffTime && (
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-[11px] text-white/40">
                              {new Date(fixture.kickoffTime).toLocaleDateString("en-GB", {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                              })}
                              {" · "}
                              {new Date(fixture.kickoffTime).toLocaleTimeString("en-GB", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            {fixture.finished && (
                              <span className="text-[10px] bg-accent/15 text-accent px-2 py-0.5 rounded-full font-semibold">
                                FT
                              </span>
                            )}
                            {fixture.started && !fixture.finished && (
                              <span className="text-[10px] bg-primary/15 text-primary px-2 py-0.5 rounded-full font-semibold animate-pulse">
                                LIVE
                              </span>
                            )}
                          </div>
                        )}

                        {/* Teams + score */}
                        <div className="flex items-center gap-4">
                          <span className="font-bold text-sm flex-1 truncate">{fixture.teamHName}</span>
                          <div className="shrink-0 text-center min-w-[56px]">
                            {fixture.teamHScore !== null && fixture.teamAScore !== null ? (
                              <div className="flex items-center gap-1.5">
                                <span className="font-display text-xl font-bold text-accent">
                                  {fixture.teamHScore}
                                </span>
                                <span className="text-white/20 text-sm">–</span>
                                <span className="font-display text-xl font-bold text-accent">
                                  {fixture.teamAScore}
                                </span>
                              </div>
                            ) : (
                              <span className="text-white/30 text-xs font-medium tracking-wider">VS</span>
                            )}
                          </div>
                          <span className="font-bold text-sm flex-1 text-right truncate">
                            {fixture.teamAName}
                          </span>
                        </div>
                      </GlowCard>
                    </motion.div>
                  ))}

                  {fixtures.length === 0 && (
                    <div className="col-span-full py-16 text-center">
                      <Shield className="mx-auto h-8 w-8 text-white/20 mb-2" />
                      <p className="text-sm text-white/40">No fixtures found</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </>
        )}

        {activeTab === "calendar" && (
          <div>
            {calendarState.status === "loading" && (
              <div className="flex justify-center py-20">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
            {calendarState.status === "error" && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
                <p className="text-sm text-destructive">{calendarState.message}</p>
              </div>
            )}
            {calendarState.status === "ready" && (
              <GwCalendarGrid rows={calendarState.data} />
            )}
          </div>
        )}
      </div>
    </div>
    </MotionConfig>
  );
}
