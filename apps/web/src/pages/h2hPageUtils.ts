import type { H2HPlayerRef, H2HPositionTrend } from "@fpl/contracts";

export function formatOverlapLabel(overlapPct: number) {
  return `${overlapPct.toFixed(1)}% overlap`;
}

export function formatPlayerTag(player: H2HPlayerRef) {
  return `${player.webName} · ${player.positionName} · ${player.teamShortName}`;
}

export function formatSignedPoints(value: number) {
  return `${value > 0 ? "+" : ""}${value} pts`;
}

export function formatSignedNumber(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

export function formatGapShare(value: number | null) {
  if (value === null) {
    return "No overall gap";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}% of gap`;
}

export function describeBenchDelta(delta: number) {
  if (delta === 0) {
    return "You matched your rival on unused bench points";
  }
  if (delta < 0) {
    return `You left ${Math.abs(delta)} more pts on the bench`;
  }
  return `Your rival left ${delta} more pts on the bench`;
}

export function getTrendLabel(trend: H2HPositionTrend) {
  switch (trend) {
    case "lead":
      return "Lead";
    case "trail":
      return "Trail";
    default:
      return "Level";
  }
}

export function formatExpectedEdge(value: number | null) {
  if (value === null) {
    return "Expected edge unavailable";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

export function formatVarianceEdge(value: number | null) {
  if (value === null) {
    return "Variance edge unavailable";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

export function getLuckVerdictLabel(verdict: "balanced" | "rival_running_hot" | "user_running_hot" | "insufficient_data") {
  switch (verdict) {
    case "rival_running_hot":
      return "Rival running hot";
    case "user_running_hot":
      return "You are running hot";
    case "insufficient_data":
      return "Insufficient xPts";
    default:
      return "Balanced";
  }
}

export function getLuckVerdictDescription(verdict: "balanced" | "rival_running_hot" | "user_running_hot" | "insufficient_data") {
  switch (verdict) {
    case "rival_running_hot":
      return "Your rival is outperforming the underlying xPts baseline more than you are.";
    case "user_running_hot":
      return "Your current lead is running ahead of the underlying xPts baseline.";
    case "insufficient_data":
      return "Too many player projections are missing to label the edge confidently.";
    default:
      return "The actual gap is close to the projected edge from current squad process.";
  }
}
