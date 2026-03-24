import { useEffect, useState } from "react";
import type { FdrRow } from "@fpl/contracts";
import { getFdrData } from "@/api/client";
import { BarChart2 } from "lucide-react";
import { GlowCard, BGPattern } from "@/components/ui/glow-card";
import { cn } from "@/lib/utils";
import {
  difficultyColour,
  difficultyLabel,
  getUniqueGameweeks,
  type DifficultyLevel,
} from "./FDRPageUtils";

type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

let _fdrCache: FdrRow[] | null = null;

export function FDRPage() {
  const [state, setState] = useState<AsyncState<FdrRow[]>>(() =>
    _fdrCache ? { status: "ready", data: _fdrCache } : { status: "loading" },
  );

  useEffect(() => {
    if (_fdrCache) return;
    getFdrData()
      .then((data) => {
        _fdrCache = data;
        setState({ status: "ready", data });
      })
      .catch((e: Error) => setState({ status: "error", message: e.message }));
  }, []);

  const rows = state.status === "ready" ? state.data : [];
  const gameweeks = getUniqueGameweeks(rows.map((r) => r.fixtures));

  return (
    <div className="relative min-h-screen text-white">
      <BGPattern variant="dots" mask="fade-edges" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <BarChart2 className="w-6 h-6 text-accent" />
          <div>
            <h1 className="font-display text-2xl font-bold">Fixture Difficulty Rating</h1>
            <p className="text-sm text-white/50">
              xG-based FDR across next 8 gameweeks — lower is easier
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2 text-xs">
          {([1, 2, 3, 4, 5] as DifficultyLevel[]).map((d) => (
            <span
              key={d}
              className={cn("px-3 py-1 rounded-full font-semibold", difficultyColour(d))}
            >
              {d} — {difficultyLabel(d)}
            </span>
          ))}
          <span className="px-3 py-1 rounded-full font-semibold bg-white/10 text-white/30">
            BGW — Blank
          </span>
        </div>

        {state.status === "loading" && (
          <div className="flex justify-center py-20">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
            <p className="text-sm text-destructive">{state.message}</p>
          </div>
        )}

        {state.status === "ready" && (
          <GlowCard className="overflow-x-auto" glowColor="teal">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="sticky left-0 z-10 bg-[#0d0118]/90 backdrop-blur-sm px-4 py-3 text-left font-semibold text-white/70 min-w-[120px]">
                    Team
                  </th>
                  {gameweeks.map((gw) => (
                    <th
                      key={gw}
                      className="px-2 py-3 text-center font-semibold text-white/50 text-xs min-w-[70px]"
                    >
                      GW{gw}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((team) => (
                  <tr
                    key={team.teamId}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors"
                  >
                    <td className="sticky left-0 z-10 bg-[#0d0118]/90 backdrop-blur-sm px-4 py-2.5 font-semibold text-white">
                      <span className="hidden sm:inline">{team.teamName}</span>
                      <span className="sm:hidden">{team.teamShortName}</span>
                    </td>
                    {gameweeks.map((gw) => {
                      const fixtures = team.fixtures.filter((f) => f.gameweek === gw);
                      if (fixtures.length === 0) {
                        return (
                          <td key={gw} className="px-2 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center rounded-md px-2 py-1 text-[10px] font-bold bg-white/8 text-white/25 min-w-[56px]">
                              BGW
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={gw} className="px-2 py-2.5 text-center">
                          <div className="flex flex-col gap-1 items-center">
                            {fixtures.map((f) => (
                              <span
                                key={`${f.opponentId}-${f.isHome}`}
                                title={`${f.opponentShort} (${f.isHome ? "H" : "A"}) — ${difficultyLabel(f.difficulty as DifficultyLevel)}`}
                                className={cn(
                                  "inline-flex items-center justify-center rounded-md px-2 py-1 text-[10px] font-bold min-w-[56px] cursor-default",
                                  difficultyColour(f.difficulty as DifficultyLevel),
                                )}
                              >
                                {f.opponentShort}
                                <span className="ml-0.5 opacity-60">{f.isHome ? "H" : "A"}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </GlowCard>
        )}
      </div>
    </div>
  );
}
