---
title: "feat: AI Transfer Recommendations & Price Change Predictor"
type: feat
status: active
date: 2026-03-23
origin: docs/plans/2026-03-23-001-feat-fpl-clone-features-integration-plan.md
---

# feat: AI Transfer Recommendations & Price Change Predictor

## Overview

Two of the highest-impact AI features identified from 30-day FPL community research — both absent from the official app and the primary reason managers use external tools like Fantasy Football Fix and FPL Review mid-week:

1. **Price Change Predictor** — uses live transfer volume data (`transfers_in_event` / `transfers_out_event`) already synced into SQLite to forecast which players will rise or fall in price in the next 24–48 hours. A pure algorithmic feature requiring zero external APIs beyond the existing sync pipeline.

2. **AI Transfer Recommendations** — personalised weekly buy/sell suggestions derived from the manager's linked squad, remaining budget, free transfers, and xPts model from plan 001. Exposed as both a dedicated UI panel on My Team and as a new tool in the existing AI chat agentic loop.

Both features build directly on the infrastructure from plan 001 (xPts model, FDR data, `my_team_*` tables, AI chat).

---

## Problem Statement

**Price changes are invisible until they happen.** Managers checking FPL Monday morning discover Salah already rose £0.1m overnight. The entire "price rise chasing" strategy — which affects millions of transfers weekly — has no in-app support. Users rely on external tools or Twitter alerts.

**Transfer decisions are the hardest part of FPL.** Every GW, managers face: "Is it worth a -4 hit? Who do I actually bring in? What's their fixture run?" The existing AI chat can answer these questions but requires the user to know what to ask. A proactive, contextual "this week's recommended transfer" surfaces the insight without requiring expertise.

---

## Technical Foundation

### Existing data enabling both features (no new FPL API calls needed)

| Column | Table | Purpose |
|---|---|---|
| `transfers_in_event` | `players` | Transfer ins since last deadline — price rise pressure |
| `transfers_out_event` | `players` | Transfer outs since last deadline — price fall pressure |
| `now_cost` | `players` | Current price (tenths of £1m) |
| `selected_by_percent` | `players` | Overall ownership % — denominator for price change math |
| `news`, `news_added` | `players` | Injury/availability news — penalty to sell score |
| `player_history` (last N GWs) | `player_history` | Form, xG, xA, minutes — inputs to xPts and sell score |
| `player_future_fixtures` | `player_future_fixtures` | Upcoming fixtures — buy score input |
| `my_team_picks` | `my_team_picks` | Manager's current squad |
| `my_team_gameweeks.bank` | `my_team_gameweeks` | Available budget |
| `my_team_accounts` | `my_team_accounts` | Linked manager |

### Existing infrastructure to extend

| Asset | Location | Relevance |
|---|---|---|
| xPts model (from plan 001) | `apps/api/src/services/queryService.ts` | Core input to transfer recommendations |
| FDR calculation (from plan 001) | `apps/api/src/services/queryService.ts` | Fixture buy/sell scoring |
| AI chat agentic loop | `apps/api/src/chat/` | Extend with new `get_transfer_recommendations` tool |
| `schemaContext.ts` system prompt | `apps/api/src/chat/schemaContext.ts` | Must update for new tools/columns |
| `@fpl/contracts` | `packages/contracts/src/index.ts` | All new response types go here |
| `AsyncState<T>`, `GlowCard` | `apps/web/src/` | UI patterns for new panels |
| My Team page (pitch view) | `apps/web/src/pages/MyTeamPage.tsx` | Integration point for recommendations panel |
| Players page | `apps/web/src/pages/PlayersPage.tsx` | Integration point for price change column |

**Prerequisite:** Both features depend on the xPts model from plan 001 (Phase 1.2). xPts must be implemented first.

---

## Feature 1: Price Change Predictor

### How FPL price changes work

FPL adjusts player prices based on net transfer activity:
- **Rise:** Net ownership increase > ~1% of total managers (≈ 120,000 managers for a 12M player pool)
- **Fall:** Net ownership decrease > ~0.5% of total managers (asymmetric — falls are easier to trigger)
- Changes happen at a fixed time overnight, typically ~8 AM UTC
- A player can only change by ±£0.1m per change event

The inputs we already have:
```
net_transfers = transfers_in_event - transfers_out_event
rise_threshold ≈ total_managers × 0.01     (approximate, varies ~1-2%)
fall_threshold ≈ total_managers × 0.005
rise_probability = clamp(net_transfers / rise_threshold, 0, 1)
fall_probability = clamp((-net_transfers) / fall_threshold, 0, 1)
```

`total_managers` is available from `/api/bootstrap-static/` response field `total_players`, already consumed in `syncService.ts`. Store it in `sync_state` key-value table (already exists).

### Algorithm

```typescript
// apps/api/src/services/queryService.ts (new method)
function getPriceChangePredictions(): PriceChangePrediction[] {
  const totalManagers = getTotalManagers(); // from sync_state
  const RISE_THRESHOLD_PCT = 0.01;
  const FALL_THRESHOLD_PCT = 0.005;

  return db.prepare(`
    SELECT
      id, web_name, team_id, now_cost,
      transfers_in_event, transfers_out_event,
      selected_by_percent,
      (transfers_in_event - transfers_out_event) AS net_transfers
    FROM players
    WHERE ABS(transfers_in_event - transfers_out_event) > 5000
    ORDER BY ABS(net_transfers) DESC
    LIMIT 50
  `).all().map(p => ({
    ...p,
    riseProbability: Math.min(1, Math.max(0,
      p.net_transfers / (totalManagers * RISE_THRESHOLD_PCT)
    )),
    fallProbability: Math.min(1, Math.max(0,
      (-p.net_transfers) / (totalManagers * FALL_THRESHOLD_PCT)
    )),
    direction: p.net_transfers > 0 ? 'rise' : 'fall',
  }));
}
```

### New contract type

```typescript
// packages/contracts/src/index.ts
export interface PriceChangePrediction {
  playerId: number;
  playerName: string;
  teamShortName: string;
  position: string;
  nowCost: number;           // in tenths — display as "£X.Xm"
  netTransfers: number;      // positive = net buys, negative = net sells
  riseProbability: number;   // 0–1
  fallProbability: number;   // 0–1
  direction: 'rise' | 'fall' | 'stable';
  transfersIn: number;
  transfersOut: number;
}
```

### New API endpoint

```
GET /api/players/price-changes
```

Returns top 50 players sorted by absolute net transfer volume (highest price change risk at top).

### UI integration: three surfaces

**1. Players page new column — "Price"**

Replace or augment the existing cost display with a directional badge:
- `↑ 82%` in green if rise probability > 30%
- `↓ 67%` in red if fall probability > 30%
- Plain cost if probability < 30%

**2. Price Changes page — `/players/price-changes`**

New standalone page showing a ranked table of imminent risers and fallers:

```
┌─────────────────────────────────────────────────────────────┐
│  🔥 Imminent Risers          │  ⚠️  Likely Fallers          │
├──────────────────────────────┼──────────────────────────────┤
│  Salah       £13.2m   ↑ 94% │  Rashford  £6.8m   ↓ 71%   │
│  Palmer      £11.6m   ↑ 78% │  Vardy     £5.4m   ↓ 58%   │
│  Saka        £10.1m   ↑ 61% │  Toney     £7.2m   ↓ 43%   │
└──────────────────────────────┴──────────────────────────────┘
│  Last updated: 2 hours ago                [Refresh]         │
└─────────────────────────────────────────────────────────────┘
```

Show "Last updated" timestamp pulled from `sync_state.last_sync_time`.

**3. Player Detail page badge**

If a player's `riseProbability > 0.5`, show a prominent "⚡ Price Rise Likely" amber badge at the top of the detail page. If `fallProbability > 0.5`, show "📉 Price Fall Risk" in red.

### Files to create/modify

- `packages/contracts/src/index.ts` — `PriceChangePrediction` type
- `apps/api/src/services/syncService.ts` — persist `total_players` from bootstrap to `sync_state`
- `apps/api/src/services/queryService.ts` — `getPriceChangePredictions()` method
- `apps/api/src/routes/createApiRouter.ts` — `GET /api/players/price-changes`
- `apps/web/src/api/client.ts` — `fetchPriceChangePredictions()`
- `apps/web/src/pages/PriceChangesPage.tsx` — new page
- `apps/web/src/pages/PriceChangesPageUtils.ts` — probability formatting, colour mapping
- `apps/web/src/pages/PlayersPage.tsx` — add price direction badge to cost column
- `apps/web/src/pages/PlayerDetailPage.tsx` — price change badge
- `apps/web/src/App.tsx` — add route `/players/price-changes`
- `apps/web/src/components/layout/Sidebar.tsx` — add nav item under Players
- `apps/api/src/chat/schemaContext.ts` — add price change columns to column annotations

### Tests

- `apps/api/test/queryService.test.ts` — `getPriceChangePredictions()`: correct probability math, edge case when `total_managers` is 0 or missing
- `apps/web/src/pages/priceChangesPageUtils.test.ts` — probability → label/colour mapping

---

## Feature 2: AI Transfer Recommendations

### Algorithm: "Transfer Score" per player

Each player in the manager's squad gets a **sell score**; each player in the pool gets a **buy score**. The top sell + top buy pairs become the recommendations.

**Sell score** (higher = more urgently sell):
```
sell_score =
  (1 - xPts_next_gw / league_avg_xPts_for_position)  // below-average return
  + (injury_news_flag × 2.0)                          // has injury news
  + (1 - minutes_per_game / 90 × 0.5)                // rotation risk
  + (fall_probability × 1.5)                          // price about to drop
  + (form_rank_in_position / total_in_position × 0.5) // poor form
```

**Buy score** (higher = stronger buy):
```
buy_score =
  (xPts_next_gw / league_avg_xPts_for_position)  // above-average expected return
  + (fixture_difficulty_bonus × 1.0)              // good upcoming fixtures (3+ GWs)
  + (rise_probability × 0.8)                      // price rising — buy now
  + (ownership_differential × 0.4)                // low ownership = differential
  + (form_score × 0.5)                            // recent form
```

**Pair ranking:** For each player to sell, find the top 3 replacements in the same position within budget. Return top 3 sell/buy pairs overall, each with a human-readable reason string.

**Reason generation (deterministic, no LLM call):**
```typescript
function buildReason(sell: Player, buy: Player): string {
  const reasons = [];
  if (sell.news) reasons.push(`${sell.name} has injury concern`);
  if (buy.xPts > sell.xPts * 1.3) reasons.push(`${buy.name} has ${((buy.xPts/sell.xPts - 1)*100).toFixed(0)}% higher xPts`);
  if (buy.riseProbability > 0.5) reasons.push(`price rise likely`);
  if (buy.ownershipPct < 10) reasons.push(`differential (${buy.ownershipPct}% owned)`);
  return reasons.join(' · ');
}
```

This is intentionally deterministic — no LLM latency for the primary recommendation list. The AI chat integration (below) provides conversational depth on top.

### New contract types

```typescript
// packages/contracts/src/index.ts
export interface TransferRecommendation {
  sell: {
    playerId: number;
    playerName: string;
    position: string;
    xPts: number;
    nowCost: number;
    sellScore: number;
    reason: string;
  };
  buy: {
    playerId: number;
    playerName: string;
    teamShortName: string;
    position: string;
    xPts: number;
    nowCost: number;
    costDelta: number;       // positive = costs more (need to sell another), negative = profit
    buyScore: number;
    reason: string;
  };
  combinedScore: number;
  hit: boolean;             // true if this transfer requires a -4 hit
  hitWorthIt: boolean;      // true if (buy.xPts - sell.xPts) > 4 (net gain > hit cost)
}

export interface TransferRecommendationsResponse {
  gameweek: number;
  freeTransfers: number;
  bank: number;
  recommendations: TransferRecommendation[];
  generatedAt: string;
}
```

### New API endpoint

```
GET /api/my-team/:accountId/transfer-recommendations?gw=31
```

Requires linked account. Returns top 3 recommended transfers with scores and reasons.

### UI: Transfer Recommendations panel on My Team page

A new collapsible panel below the pitch view, shown only when an account is linked:

```
┌──────────────────────────────────────────────────────────────┐
│  🤖 This Week's Transfers   GW31 │ 1 Free Transfer │ £1.2m  │
├──────────────────────────────────────────────────────────────┤
│  #1  Sell Rashford  →  Buy Palmer                            │
│      +8.4 xPts differential · price rise likely · 78% score  │
│      No hit needed  ✓                                         │
├──────────────────────────────────────────────────────────────┤
│  #2  Sell Toney  →  Buy Salah                                │
│      Injury concern · good fixtures (GW31-34)                │
│      Costs -£0.3m · No hit needed  ✓                         │
├──────────────────────────────────────────────────────────────┤
│  #3  Sell Flekken  →  Buy Raya  (-4 hit)                     │
│      Net gain +6.1 xPts > hit cost · worth it ✓              │
│                                            [Ask AI more ↗]   │
└──────────────────────────────────────────────────────────────┘
```

The "Ask AI more ↗" button deep-links to the AI chat with pre-seeded context: `"Based on my squad, I'm considering selling ${sell.name} for ${buy.name}. Is this the right call?"`.

### AI Chat Integration: `get_transfer_recommendations` tool

Add a new tool to the agentic loop alongside `query` and `get_schema`:

```typescript
// apps/api/src/chat/fplTools.ts (new tool definition)
{
  name: "get_transfer_recommendations",
  description: "Get personalised transfer recommendations for the linked FPL manager's squad. Returns top 3 recommended sell/buy pairs with xPts differential, price change signals, and fixture analysis. Use this when asked about transfers, who to buy/sell, or whether a hit is worth it.",
  input_schema: {
    type: "object",
    properties: {
      gameweek: { type: "number", description: "Target gameweek number" },
      account_id: { type: "number", description: "Manager account ID from my_team_accounts" }
    },
    required: ["gameweek"]
  }
}
```

When the AI calls this tool, it executes the same `getTransferRecommendations()` service method used by the REST endpoint. The AI then interprets the structured output conversationally:

> "Based on your squad, your best move this week is selling Rashford (xPts: 3.2) for Palmer (xPts: 7.8) — Palmer has a great run of fixtures and his price is likely rising. You have 1 free transfer so no hit needed. Want me to simulate how this affects your GW31 projected score?"

This makes the chat advisor genuinely useful for the #1 FPL use case (transfer decisions) without requiring the user to phrase the right SQL question.

### Files to create/modify

- `packages/contracts/src/index.ts` — `TransferRecommendation`, `TransferRecommendationsResponse`
- `apps/api/src/services/transferRecommendationService.ts` — new service with sell/buy scoring logic
- `apps/api/src/routes/createApiRouter.ts` — `GET /api/my-team/:id/transfer-recommendations`
- `apps/web/src/api/client.ts` — `fetchTransferRecommendations(accountId, gw)`
- `apps/web/src/pages/MyTeamPage.tsx` — recommendations panel, "Ask AI" deep link
- `apps/web/src/pages/MyTeamPageUtils.ts` — panel render logic, hit worthiness display
- `apps/api/src/chat/fplTools.ts` — `get_transfer_recommendations` tool definition
- `apps/api/src/chat/chatRouter.ts` — execute new tool in agentic loop
- `apps/api/src/chat/anthropic.ts` / `openai.ts` / `gemini.ts` — add tool to provider tool lists
- `apps/api/src/chat/schemaContext.ts` — add tool description + usage guidance to system prompt
- `apps/api/src/db/schema.ts` — no schema change needed (uses existing tables)

### Tests

- `apps/api/test/transferRecommendationService.test.ts`:
  - Sell score correctly penalises injured player
  - Buy score rewards high xPts + low ownership
  - Hit worthiness: `(buy.xPts - sell.xPts) > 4` → `hitWorthIt: true`
  - Budget constraint respected (no buy exceeds `bank + sell.nowCost`)
  - Position constraint respected (GKP never recommended to replace MID)
  - Edge case: manager has 0 free transfers → all recommendations marked `hit: true`
  - Edge case: xPts not yet computed (plan 001 not shipped) → graceful fallback using `form` as proxy
- `apps/web/src/pages/myTeamPageUtils.test.ts` — hit badge display logic

---

## System-Wide Impact

### Interaction Graph

```
[Sync Pipeline]
  FPL /bootstrap-static/
  → syncService.ts: persists players.transfers_in_event / transfers_out_event
  → sync_state: persists total_players

[Price Change]
  GET /api/players/price-changes
  → queryService.getPriceChangePredictions()
  → reads players.transfers_in_event/out, sync_state.total_players
  → returns PriceChangePrediction[]
  → PriceChangesPage.tsx renders risers/fallers table
  → PlayersPage.tsx renders directional badge on cost column

[Transfer Recommendations]
  GET /api/my-team/:id/transfer-recommendations
  → transferRecommendationService.getRecommendations(accountId, gw)
    → queryService.getPlayerXpts(gw) [requires plan 001]
    → queryService.getPriceChangePredictions()
    → queryService.getManagerSquad(accountId, gw)
    → scoring algorithm → top 3 pairs
  → MyTeamPage.tsx renders recommendations panel

[AI Chat Tool]
  User: "Who should I transfer in this week?"
  → chatRouter.ts agentic loop
  → LLM calls get_transfer_recommendations tool
  → tool executes same transferRecommendationService.getRecommendations()
  → LLM narrates result conversationally
```

### Error & Failure Propagation

- **`total_players` not yet synced:** `getPriceChangePredictions()` falls back to a hardcoded estimate of `12_000_000` with a warning logged. UI shows "approximate" disclaimer.
- **xPts not available (plan 001 not yet shipped):** Transfer recommendations fall back to using `form` from `players` table as proxy xPts. `reason` strings adapt to say "good recent form" rather than "higher xPts".
- **Manager has no picks for current GW:** `getRecommendations()` returns `{ recommendations: [], freeTransfers: 1, bank: 0 }`. UI shows "Sync your team to see recommendations" message.
- **AI tool failure:** If `get_transfer_recommendations` tool throws, the agentic loop catches and returns the error to the LLM as a tool result — same as the existing `query` tool error handling in `chatRouter.ts`.

### State Lifecycle Risks

- **Price predictions stale between syncs:** `transfers_in_event` is only updated when a sync runs. Show `sync_state.last_sync_time` prominently on the price changes page so users understand data freshness. Consider a "Quick Refresh" button that triggers a lightweight bootstrap-only sync.
- **Recommendation caching:** Recommendations are computed on-demand per request. No caching risk. If performance becomes an issue (unlikely given SQLite speed), add a `Map<string, TransferRecommendationsResponse>` cache keyed by `${accountId}:${gw}` with 5-minute TTL.
- **No write operations:** Both features are read-only — zero state mutation risk.

### API Surface Parity

- The `get_transfer_recommendations` AI tool must always return the same shape as the REST endpoint so the AI's interpretation and the UI panel are based on identical data.
- The `schemaContext.ts` system prompt must document `transfers_in_event` and `transfers_out_event` columns so the existing `query` tool can also be used for ad-hoc price change analysis.

### Integration Test Scenarios

1. **Price prediction during a blank GW:** `transfers_in_event` and `transfers_out_event` may reset to 0 at GW start. Predictions for GW transition period should gracefully show "0%" rather than divide-by-zero.
2. **Transfer recommendation for a manager mid-wildcard:** `my_team_picks` may reflect a draft squad not yet confirmed. Recommendations should be based on currently saved picks, clearly noting they reflect the draft state.
3. **AI chat asks for transfers with no linked account:** Tool returns `{ error: "No manager account linked" }`. LLM responds: "I can see recommendations once you link your FPL account in My Team."
4. **Double GW player recommended as buy:** Player has two fixtures next GW — xPts should correctly double their projection. Recommendation reason should call out "Double GW: two fixtures".
5. **Price predictor and transfer recommender agree:** Recommending selling a player with a fall probability of 80% — the combined reasoning should surface both signals ("Below-average xPts AND price likely to fall").

---

## Acceptance Criteria

### Price Change Predictor
- [ ] `GET /api/players/price-changes` returns predictions sorted by absolute net transfer volume
- [ ] Rise/fall probability correctly computed using FPL price change threshold formula
- [ ] Players page cost column shows directional badge (↑/↓) for players with >30% change probability
- [ ] `/players/price-changes` page shows separate risers and fallers panels
- [ ] Player Detail page shows "Price Rise Likely" / "Price Fall Risk" badge when probability >50%
- [ ] "Last updated" timestamp shown from sync state
- [ ] Prediction columns annotated in `schemaContext.ts` for AI chat awareness

### Transfer Recommendations
- [ ] `GET /api/my-team/:id/transfer-recommendations` returns top 3 sell/buy pairs for linked manager
- [ ] Sell score correctly penalises: injured players, rotation risks, poor fixtures, fall probability
- [ ] Buy score correctly rewards: high xPts, good fixture run, rise probability, differential ownership
- [ ] Budget constraint enforced (buy cost ≤ bank + sell price)
- [ ] Position constraint enforced (like-for-like position only)
- [ ] Hit worthiness correctly flagged (`hitWorthIt: true` when net xPts gain > 4)
- [ ] My Team page shows recommendations panel with sell→buy pairs and reason strings
- [ ] "Ask AI" button deep-links to chat with pre-seeded transfer context
- [ ] AI chat `get_transfer_recommendations` tool works across all three providers (Anthropic, OpenAI, Gemini)
- [ ] AI responds sensibly to "who should I transfer?" without a linked account

### Quality Gates
- [ ] `tsc --noEmit` passes with no new errors
- [ ] `transferRecommendationService.ts` has full unit test coverage for scoring edge cases
- [ ] `priceChangesPageUtils.test.ts` covers probability-to-label mapping
- [ ] `schemaContext.ts` updated: `transfers_in_event`, `transfers_out_event`, new tool description

---

## Success Metrics

| Metric | Target |
|---|---|
| Price changes page visits | Present in >25% of mid-week sessions |
| Transfer recommendation adoption | Manager acts on ≥1 recommended transfer in >40% of sessions that view panel |
| AI chat transfer queries | "who should I transfer" style questions answered satisfactorily (no "I don't know your squad") |
| Sync frequency increase | Users trigger manual syncs more often once price change predictions are visible |

---

## Dependencies & Prerequisites

- **Requires plan 001, Phase 1.2 (xPts)** — transfer scoring degrades to form-based fallback without it, but works
- `sharp` and all existing deps sufficient — no new npm packages required
- `total_players` field from bootstrap sync — trivial to add to `sync_state` in `syncService.ts`

---

## Alternative Approaches Considered

| Approach | Considered | Decision |
|---|---|---|
| LLM-generated reason strings | Call LLM to narrate each recommendation | Rejected — adds 2-3s latency per panel load; deterministic string building is fast, predictable, and testable |
| Storing price change history | Add a `player_price_history` table | Deferred — the current threshold model is sufficient for v1; price history enables trend analysis in a future plan |
| Webhook/push for price alerts | Push notification when a watched player's price changes | Deferred — requires notification infrastructure not yet in the stack; the `/players/price-changes` page covers the immediate need |
| ML model for price prediction | Train a regression model on historical transfer volumes vs. actual price changes | Over-engineered for v1 — the FPL price change rules are deterministic and well-documented; the threshold model is ~95% accurate |

---

## Future Considerations

- **Price change history table** (`player_price_history`) — enables "track record" display showing how often our predictions were correct
- **Watchlist alerts** — user saves players to a watchlist; server polls every sync and sends a push/email when a watched player hits >70% rise/fall probability
- **Transfer planner integration** — multi-GW transfer sequence recommendations (e.g. "do this transfer now, plan that transfer in GW33") integrating with the existing chip simulation in `my-team.ts:343`
- **Differential hunting mode** — "Show me the highest-xPts players owned by <5% of managers" — a toggle on the Players page leveraging both xPts and ownership data

---

## Sources & References

### Origin
- **Origin plan:** `docs/plans/2026-03-23-001-feat-fpl-clone-features-integration-plan.md` — parent plan covering FDR, xPts, live GW, and social features. This plan adds the two AI-specific features from that research that deserved standalone treatment.
- **Research basis:** `/last30days` 30-day community research (Fantasy Football Fix, FPL Review, FPL Zone, Draft Sharks — 14 web sources). Community consensus: price change predictor and AI transfer advice are the #3 and #4 most-demanded features after xPts and FDR.

### Internal References
- Transfer planner chip simulation: `apps/web/src/lib/my-team.ts:343–418`
- AI chat agentic loop (pattern to extend): `apps/api/src/chat/chatRouter.ts`
- Tool definition pattern: `apps/api/src/chat/fplTools.ts`
- System prompt + pitfall list: `apps/api/src/chat/schemaContext.ts`
- Rate limiter (all FPL API calls): `apps/api/src/lib/rateLimiter.ts`
- `players` schema with transfer columns: `apps/api/src/db/schema.ts`
- `sync_state` key-value table: `apps/api/src/db/schema.ts`
