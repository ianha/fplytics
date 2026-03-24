import type { FdrFixture } from "@fpl/contracts";

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export function difficultyColour(d: DifficultyLevel | undefined): string {
  if (d === undefined) return "bg-white/10 text-white/30";
  const map: Record<DifficultyLevel, string> = {
    1: "bg-emerald-500 text-white",
    2: "bg-green-400 text-black",
    3: "bg-amber-400 text-black",
    4: "bg-orange-500 text-white",
    5: "bg-red-600 text-white",
  };
  return map[d];
}

export function difficultyLabel(d: DifficultyLevel): string {
  const labels: Record<DifficultyLevel, string> = {
    1: "Very Easy",
    2: "Easy",
    3: "Neutral",
    4: "Hard",
    5: "Very Hard",
  };
  return labels[d];
}

export function getUniqueGameweeks(fixtures: FdrFixture[][]): number[] {
  const gwSet = new Set<number>();
  for (const teamFixtures of fixtures) {
    for (const f of teamFixtures) gwSet.add(f.gameweek);
  }
  return [...gwSet].sort((a, b) => a - b).slice(0, 8);
}
