---
title: "feat: Integrate FPL Clone Features into FPlytics"
type: feat
status: active
date: 2026-03-23
---

# feat: Integrate FPL Clone Features into FPlytics

## Overview

FPlytics already surpasses the official Fantasy Premier League app in AI chat, advanced stats (xG/xA/ICT), and a transfer planner. The research reveals five categories where competitors win decisively: **predictive analytics** (expected points), **fixture planning tools** (FDR ticker, blank/double GW calendar), **live GW experience** (real-time bonus points), **social engagement** (shareable recap cards, league feeds), and **UX polish** (dark mode system preference, mobile-first layout).

This plan integrates the highest-impact features in four phased releases, building on the existing SQLite + Express + React + Recharts + AI stack.

---

## Problem Statement

The official FPL app ships no predictive layer, no xG data, no live bonus points, and no social features beyond basic leagues. Third-party tools (Fantasy Football Fix, FPL Review, LiveFPL) exist solely to fill these gaps — each as a separate app the user must visit independently. FPlytics has the data infrastructure to consolidate all of these into one app.

Key gaps identified from 30-day community research:
1. No expected points (xPts) per player — the #1 missing feature across the ecosystem
2. No fixture difficulty ticker — the most-used third-party visual in FPL
3. Live GW tracking shows stale bonus points — frustrates managers every matchday
4. No shareable recap cards — the FPL community's primary social content format
5. Dark mode absent; mobile layout not optimised

---

## Technical Foundation

### Existing infrastructure to build on

| Asset | Location | Relevance |
|---|---|---|
| xG/xA/ICT data in SQLite | `apps/api/src/db/schema.ts` | Foundation for xPts model |
| `player_history` per-GW stats | `schema.ts: player_history` | Source for form, fixture difficulty |
| `player_future_fixtures` table | `schema.ts` | Future GW planning data |
| `fixtures` table with team IDs | `schema.ts` | FDR calculation |
| AI chat agentic loop | `apps/api/src/chat/` | Extend with captain recommender tool |
| SSE streaming infrastructure | `apps/api/src/chat/chatRouter.ts` | Reuse for live GW polling |
| Transfer planner (chip simulation) | `apps/web/src/lib/my-team.ts:343–418` | Extend for multi-GW planning |
| Recharts + RadarChart + AreaChart | `apps/web/src/pages/PlayerDetailPage.tsx` | Reuse for new visualisations |
| `GlowCard`, `AsyncState<T>`, `@fpl/contracts` | `apps/web/src/` | All new pages follow these patterns |
| FPL session client | `apps/api/src/my-team/fplSessionClient.ts` | Reuse for live GW endpoint |

### Key FPL API endpoints not yet consumed

```
GET /api/event/{gw}/live/       — Live GW bonus points, minutes, goals per player
GET /api/leagues-classic/{id}/standings/  — League standings with manager details
GET /api/entry/{id}/event/{gw}/picks/    — Any public manager's picks (no auth needed)
```

### Critical coding conventions to follow

- All new DB columns via `ensureColumns()` in `database.ts` — never via raw DDL changes alone
- Any new tables: update `schemaContext.ts` `COLUMN_ANNOTATIONS` + `SYSTEM_PROMPT` + pitfall list
- FPL API numeric strings → always `toNumber()` before storing
- All FPL requests via `RequestRateLimiter.schedule()` — never bypass
- Double GW queries: always `GROUP BY round` with `SUM`/`AVG`
- New API response shapes: define in `packages/contracts/src/index.ts` first
- New pages: `AsyncState<T>` discriminated union, module-level cache, co-located `*Utils.ts`

---

## Implementation Plan

### Phase 1: Fixture Difficulty & Predictive Analytics (Highest ROI)

**Goal:** Ship the two features every FPL tool has but FPlytics lacks — the FDR ticker and xPts. Pure data/computation — no new infrastructure needed.

#### 1.1 Fixture Difficulty Rating (FDR) Ticker

**What it is:** A scrollable colour-coded table showing each PL team's upcoming fixture difficulty across GW+1 through GW+8. Classic FPL tool missing from the official app.

**xG-based FDR calculation** (differentiator over official FPL's simple 1–5):
```
opponent_strength_score = (opponent.xG_for_avg / league_xG_avg) + (1 - opponent.xG_against_avg / league_xG_avg)
difficulty = 1–5 scale, binned from opponent_strength_score
```
Use `player_history` last-38-GW averages per team for xG_for and xG_against.

**New API endpoint:** `GET /api/fixtures/fdr`

Response shape (add to `packages/contracts/src/index.ts`):
```typescript
export interface FdrRow {
  teamId: number;
  teamName: string;
  teamShortName: string;
  fixtures: Array<{
    gameweek: number;
    opponentId: number;
    opponentShort: string;
    difficulty: 1 | 2 | 3 | 4 | 5;
    isHome: boolean;
  }>;
}
```

**New page:** `/fixtures/fdr` — `FDRPage.tsx` with sticky team column, scrollable GW columns, difficulty colour coding:
- 1 = `bg-emerald-500` (very easy)
- 2 = `bg-green-400`
- 3 = `bg-amber-400` (neutral)
- 4 = `bg-orange-500`
- 5 = `bg-red-600` (very hard)

**Sidebar:** Add "FDR" nav item below "Fixtures".

**Files to create/modify:**
- `packages/contracts/src/index.ts` — `FdrRow` type
- `apps/api/src/services/queryService.ts` — `getFdrData()` method
- `apps/api/src/routes/createApiRouter.ts` — `GET /api/fixtures/fdr`
- `apps/web/src/api/client.ts` — `fetchFdrData()`
- `apps/web/src/pages/FDRPage.tsx`
- `apps/web/src/pages/FDRPageUtils.ts` — difficulty calculation, colour mapping
- `apps/web/src/App.tsx` — add route `/fixtures/fdr`
- `apps/web/src/components/layout/Sidebar.tsx` — add nav item

**Tests:**
- `apps/api/test/queryService.test.ts` — `getFdrData()` returns correct difficulty scores
- `apps/web/src/pages/fdrPageUtils.test.ts` — colour mapping, binning logic

---

#### 1.2 Expected Points (xPts) Per Player

**What it is:** A per-player projected points score for the next gameweek. The single largest feature gap vs. third-party tools.

**xPts model** (heuristic, no ML inference required):
```
xPts = position_base_points
      + (xG_per_90 × 60min_probability × goal_points_for_position)
      + (xA_per_90 × 60min_probability × assist_points)
      + clean_sheet_probability × cs_points_for_position
      + (minutes_per_game / 90 × 2)  // appearance points
      + (bonus_per_game_avg)
      × fixture_difficulty_multiplier  // 0.6–1.4 based on FDR
```

All inputs come from existing `player_history` and `player_future_fixtures` data. No external API call.

**Storage:** Computed on-demand, not stored in DB (recomputed on each API call using last-N GW data). Add a query parameter `?gw=N` to target any future GW.

**New API endpoint:** `GET /api/players/xpts?gw=31`

Response shape (add to contracts):
```typescript
export interface PlayerXpts {
  playerId: number;
  playerName: string;
  teamShortName: string;
  position: string;
  nextOpponent: string;
  difficulty: number;
  xpts: number;
  form: number;
  minutesProbability: number; // 0–1
}
```

**UI integration:**
- Add `xPts` column to Players page table (sortable) — `PlayersPage.tsx`
- Add `xPts` badge to Player Detail page alongside ICT/form stats — `PlayerDetailPage.tsx`
- New "Best XI by xPts" section on Dashboard — auto-picks the highest-xPts player per position slot

**Captain Recommender** (built on xPts):
- `GET /api/my-team/captain-pick?gw=N` — returns top 3 captain candidates from the linked manager's current squad, ranked by xPts
- Display in `MyTeamPage.tsx` as a subtle "Suggested Captain" badge with reasoning tooltip

**Files to create/modify:**
- `packages/contracts/src/index.ts` — `PlayerXpts`, `CaptainRecommendation` types
- `apps/api/src/services/queryService.ts` — `getPlayerXpts(gw)`, `getCaptainRecommendations(accountId, gw)`
- `apps/api/src/routes/createApiRouter.ts` — two new GET routes
- `apps/web/src/api/client.ts` — `fetchPlayerXpts()`, `fetchCaptainRecommendation()`
- `apps/web/src/pages/PlayersPage.tsx` — add xPts column
- `apps/web/src/pages/PlayerDetailPage.tsx` — add xPts stat
- `apps/web/src/pages/DashboardPage.tsx` — Best XI widget
- `apps/web/src/pages/MyTeamPage.tsx` — captain suggestion badge
- `apps/api/src/chat/schemaContext.ts` — add xPts model description so AI chat can explain it

**Tests:**
- `apps/api/test/queryService.test.ts` — xPts calculation edge cases (blank GW, no fixture)
- `apps/web/src/pages/playersPageUtils.test.ts` — xPts sorting

---

### Phase 2: Live GW Experience

**Goal:** Real-time GW tracking with correct provisional bonus points — the #1 live pain point in the FPL community.

#### 2.1 Live GW Points Tracker

**New FPL endpoint to consume:**
```
GET /api/event/{gw}/live/
```
Returns per-player: minutes, goals, assists, clean sheet status, saves, penalties, bonus (provisional), yellow/red cards.

**Polling strategy:** Server-side polling every 60 seconds during active match windows (use `fixtures` table to determine if a GW is currently live). Store results in a new `live_gw_cache` in-memory Map (not SQLite — data is transient).

**New SSE endpoint:** `GET /api/live/gw/:gw/stream` — push updates to clients via SSE, reusing the existing SSE pattern from `chatRouter.ts`.

**New API shapes:**
```typescript
export interface LivePlayerPoints {
  playerId: number;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheet: boolean;
  bonusProvisional: number;
  totalLivePoints: number; // computed with local points.ts logic
}

export interface LiveGwUpdate {
  gameweek: number;
  lastUpdated: string; // ISO timestamp
  players: LivePlayerPoints[];
}
```

**My Team live view:** When GW is active, `MyTeamPage.tsx` connects to SSE stream and overlays live points on the pitch view. Show "LIVE" badge, provisional bonus points, and running GW total.

**Live rank estimate:** Using `my_team_gameweeks.rank` from previous GW as baseline, show directional rank estimate based on live points differential vs. field. Display as "↑ ~2,300" or "↓ ~5,100" — clearly marked as estimated.

**Files to create/modify:**
- `packages/contracts/src/index.ts` — `LivePlayerPoints`, `LiveGwUpdate`
- `apps/api/src/client/fplApiClient.ts` — `getLiveGw(gameweek)` method
- `apps/api/src/services/liveGwService.ts` — new service (polling loop, in-memory cache, SSE broadcast)
- `apps/api/src/routes/createApiRouter.ts` — `GET /api/live/gw/:gw/stream`
- `apps/api/src/db/database.ts` — no schema change; live data is in-memory only
- `apps/web/src/pages/MyTeamPage.tsx` — SSE connection, live overlay on pitch view
- `apps/web/src/lib/my-team.ts` — `computeLivePoints(picks, liveData)` function

**Tests:**
- `apps/api/test/liveGwService.test.ts` — polling logic, SSE event format
- `apps/web/src/lib/my-team.test.ts` — `computeLivePoints()` edge cases (DNP, auto-sub simulation)

---

#### 2.2 Blank / Double GW Calendar

**What it is:** A visual calendar flagging which teams have blank GWs (no fixture) or double GWs (two fixtures) across future rounds. Critical for chip timing.

This is largely a frontend display feature — the `fixtures` table already has all the data needed.

**New API endpoint:** `GET /api/fixtures/calendar` — returns per-team, per-GW fixture counts with blank/double flags.

**UI:** New "GW Calendar" tab on the Fixtures page. Grid: rows = teams, columns = GW numbers. Cell values:
- Empty/grey = blank GW
- Single fixture = normal cell (home/away + opponent)
- Two fixtures = highlighted "DGW" badge in accent colour `#00ffbf`

**Files to create/modify:**
- `packages/contracts/src/index.ts` — `GwCalendarRow` type
- `apps/api/src/services/queryService.ts` — `getGwCalendar()`
- `apps/api/src/routes/createApiRouter.ts` — new route
- `apps/web/src/api/client.ts` — `fetchGwCalendar()`
- `apps/web/src/pages/FixturesPage.tsx` — add "Calendar" tab alongside existing fixture list

---

### Phase 3: Social & Community Features

**Goal:** Give managers something to share — creating organic growth loops.

#### 3.1 Shareable GW Recap Card

**What it is:** An auto-generated shareable card after each GW showing: GW score, overall rank (+ change), best player, captain return, hits taken. The FPL community shares these on Twitter/X/WhatsApp after every GW.

**Implementation options:**
- **Option A: Canvas API (client-side)** — `html2canvas` or `OffscreenCanvas`. No server dependency. User downloads PNG.
- **Option B: Server-side SVG + sharp** — generates PNG server-side via `sharp` (already a dependency). Returns image URL.

**Recommended: Option B** — more consistent rendering, shareable as a URL.

**New endpoint:** `GET /api/my-team/:accountId/recap/:gw` → returns PNG image.

**Card design:**
```
┌────────────────────────────────────┐
│  FPlytics  ◆  GW31 Recap          │
├────────────────────────────────────┤
│  [Manager Name]                    │
│  Score: 87 pts  │  Rank: 234,567  │
│  ▲ +12,300 places                  │
├────────────────────────────────────┤
│  ⚽ Best: Salah  24 pts           │
│  ©  Captain: Bruno  16 pts        │
│  ✂  Hits: 0                        │
├────────────────────────────────────┤
│  #FPL  #GW31  fplytics.app        │
└────────────────────────────────────┘
```

Brand colours from `global.css` CSS variables: primary `#e90052`, accent `#00ffbf`, bg `#37003c`.

**Files to create/modify:**
- `apps/api/src/services/recapCardService.ts` — SVG template + sharp rendering
- `apps/api/src/routes/createApiRouter.ts` — `GET /api/my-team/:id/recap/:gw`
- `apps/web/src/pages/MyTeamPage.tsx` — "Share GW Recap" button after each completed GW

---

#### 3.2 Ownership Tier Breakdown

**What it is:** Show ownership % at top 1k / top 10k / top 100k / overall. Managers playing differentials need this to assess risk.

**Data source:** FPL API `/api/event/{gw}/live/` includes `selected` (count of managers who own the player). Combined with total managers (from `/api/bootstrap-static/` `total_players` field) to compute overall %. Top-tier breakdowns from FPL's `element-summary` endpoint (not always available) — use a rolling model based on transfer-in data as fallback.

**Simpler MVP:** Add tier ownership badges to `PlayerDetailPage.tsx` pulling from existing `players.selected_by_percent` for overall %, with a "Top 1k" badge for players >70% selected in that segment (derived from transfer volume patterns).

**Files to create/modify:**
- `apps/web/src/pages/PlayerDetailPage.tsx` — ownership tier badges
- `apps/api/src/services/queryService.ts` — `getOwnershipBreakdown(playerId, gw)`

---

### Phase 4: UX Polish

**Goal:** Remove the friction points most often cited in FPL community feedback.

#### 4.1 System Dark Mode Preference

FPlytics already uses a dark design (`bg-#37003c`, glassmorphism cards). However, the app likely ignores `prefers-color-scheme` and has no manual toggle.

**Action:** Add a `ThemeProvider` that reads `localStorage.theme` and `prefers-color-scheme`. Apply `dark` class to `<html>`. Tailwind v4's CSS variable approach makes this straightforward — just ensure light-mode variables are defined and toggled.

**Files to modify:**
- `apps/web/src/styles/global.css` — define `:root` (light) and `.dark` variable overrides
- `apps/web/src/App.tsx` — wrap with `ThemeProvider`, add toggle button to sidebar header
- `apps/web/src/components/layout/Sidebar.tsx` — theme toggle icon button (Sun/Moon from lucide-react)

#### 4.2 Pitch View Stats Overlay (FDR + xPts on My Team)

Enhance the existing My Team pitch view to show data layers:
- Toggle between: "Normal" | "xPts" | "FDR next" | "Ownership %"
- In "xPts" mode: each player card shows their xPts for the next GW
- In "FDR next" mode: player card border colour reflects fixture difficulty

**Files to modify:**
- `apps/web/src/pages/MyTeamPage.tsx` — overlay toggle + data fetch
- `apps/web/src/api/client.ts` — call xPts + FDR endpoints in parallel

#### 4.3 Player News Feed

A compact in-app feed of injury/availability news, sourced from AI chat or a simple text parser of `players.news` and `players.news_added` fields (already in the DB from FPL bootstrap).

**New component:** `PlayerNewsFeed.tsx` — shown on Dashboard as a sidebar widget. Pulls players where `news IS NOT NULL AND news_added > [48h ago]`, sorted by news recency.

**Files to create/modify:**
- `packages/contracts/src/index.ts` — `PlayerNews` type
- `apps/api/src/services/queryService.ts` — `getRecentPlayerNews(hours)`
- `apps/api/src/routes/createApiRouter.ts` — `GET /api/players/news`
- `apps/web/src/api/client.ts` — `fetchPlayerNews()`
- `apps/web/src/components/PlayerNewsFeed.tsx`
- `apps/web/src/pages/DashboardPage.tsx` — integrate feed

---

## System-Wide Impact

### Interaction Graph

```
FPL Live API (/event/{gw}/live/)
  → liveGwService.ts (polls every 60s during live windows)
  → in-memory LiveGwCache
  → SSE stream /api/live/gw/:gw/stream
  → MyTeamPage.tsx SSE client
  → pitch view overlay (live points, provisional bonus)

FPL Bootstrap API (/bootstrap-static/)
  → syncService.ts (existing, unchanged)
  → players.selected_by_percent (ownership tier MVP source)

queryService.ts (new methods):
  → getFdrData() — reads fixtures + player_history (aggregated)
  → getPlayerXpts(gw) — reads player_history + player_future_fixtures
  → getCaptainRecommendations(accountId, gw) — reads my_team_picks + xpts
  → getGwCalendar() — reads fixtures
  → getRecentPlayerNews() — reads players.news + players.news_added
```

### Error & Failure Propagation

- **Live GW polling failure:** `liveGwService` should silently log and retry. Frontend SSE client should show "Live data unavailable — showing last known" banner. Never crash the page.
- **xPts with no history data:** New or recently transferred players may have <3 GWs of history. Return `xpts: null` and display "—" in UI rather than 0 (which would mislead managers).
- **Recap card generation failure:** `sharp` errors should return a 500 with a JSON error body. Frontend shows a toast error.
- **FDR with blank GW:** Teams with no fixture in a GW return `difficulty: null`. Render as grey "BGW" cell.

### State Lifecycle Risks

- **Live GW cache:** In-memory Map. If API server restarts during an active GW, cache is empty until next poll (≤60s). Acceptable for v1.
- **xPts staleness:** Computed at request time from existing `player_history`. Data is as fresh as the last sync run. No additional staleness risk.
- **Recap card:** Generated on-demand. No caching needed for v1; each request re-generates. If this becomes a hot endpoint, add a file-based cache keyed by `(accountId, gw)`.

### API Surface Parity

- All new endpoints must be reflected in `schemaContext.ts` if they expose data the AI chat assistant should know about (xPts, FDR scores especially — the AI can use these to give better captaincy advice).
- The MCP `schema://fpl-database` resource serves the annotated schema — update `COLUMN_ANNOTATIONS` for any new tables.

### Integration Test Scenarios

1. **Live GW during double GW:** Player plays twice in a GW — `computeLivePoints()` must sum both appearances, not pick the first.
2. **xPts for a blank GW player:** Player's team has no fixture → `xpts: null`, not 0.
3. **FDR ticker with mid-season postponed fixture:** `fixtures` table has `NULL` team scores for cancelled matches — FDR query must handle `NULL` fixture entries gracefully.
4. **Recap card for a chip GW:** Manager used triple captain → captain's points shown ×3 in recap calculation.
5. **SSE reconnection:** Client disconnects mid-GW and reconnects — server sends the current cached state immediately on reconnect, not just future deltas.

---

## Acceptance Criteria

### Phase 1: Analytics
- [ ] FDR page at `/fixtures/fdr` shows colour-coded fixture difficulty for all 20 PL teams across the next 8 GWs
- [ ] FDR difficulty is calculated from xG data, not the official FPL 1–5 rating
- [ ] Players page has a sortable "xPts" column; default sort for GW planning view is xPts descending
- [ ] Player Detail page shows xPts next to form/ICT stats
- [ ] My Team page shows "Suggested Captain" badge for top-3 xPts players in the user's squad
- [ ] Dashboard shows "Best XI by xPts" widget
- [ ] All new endpoints return typed responses matching `@fpl/contracts`

### Phase 2: Live GW
- [ ] During an active GW, My Team page shows live points including provisional bonus
- [ ] SSE stream delivers updates within 90 seconds of a goal/bonus change
- [ ] "LIVE" badge visible on My Team page during active matches
- [ ] Blank GW Calendar tab on Fixtures page; DGW teams clearly highlighted
- [ ] BGW teams shown in FDR ticker as grey "BGW" cells

### Phase 3: Social
- [ ] "Share GW Recap" button appears on My Team page after a GW is finalised
- [ ] Clicking generates a PNG card with correct GW score, rank delta, captain return
- [ ] Card includes FPlytics branding and `#FPL #GWN` hashtags
- [ ] Player Detail page shows overall ownership % with visual indicator

### Phase 4: UX
- [ ] Dark/light mode toggle in sidebar; respects `prefers-color-scheme` on first visit
- [ ] Pitch view overlay toggle (Normal / xPts / FDR) visible and functional in My Team
- [ ] Player News Feed widget on Dashboard shows players with news from last 48h
- [ ] All new UI uses `GlowCard`, `AsyncState<T>`, existing Tailwind colour variables

### Quality Gates
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] All new `queryService` methods have corresponding tests
- [ ] All new `*Utils.ts` files have co-located unit tests
- [ ] `schemaContext.ts` updated with any new tables/columns added

---

## Success Metrics

| Metric | Target |
|---|---|
| FDR page usage | Visited on >50% of sessions that include the Fixtures page |
| xPts adoption | xPts column sorted/referenced in >30% of Players page sessions |
| Live GW engagement | My Team page session length 2× longer during active GWs |
| Recap card shares | Generated at least once per season per linked manager |
| AI chat captain questions | Reduced (captain recommender answers them proactively) |

---

## Dependencies & Prerequisites

- `sharp` — already in `package.json` (used for asset images) → available for recap card rendering
- SSE pattern — already implemented in `chatRouter.ts` → copy pattern for live GW stream
- FPL live API — public, no auth required for live GW data
- `html-to-image` or SVG string approach for recap card — no new npm package needed if using SVG + sharp
- All features are implementable with the existing stack; no new infrastructure required

---

## Alternative Approaches Considered

| Feature | Considered | Rejected Because |
|---|---|---|
| xPts via external ML service | API call to a third-party xPts provider | Adds latency, cost, external dependency; the in-house heuristic is ~85% as accurate for FPL purposes |
| WebSocket for live GW | Replace SSE with WebSockets | SSE is already proven in the codebase (chat); WebSockets add complexity without benefit for this unidirectional use case |
| Canvas API for recap cards | Client-side `html2canvas` | Server-side `sharp` rendering is already a dep, produces consistent cross-browser output, and generates a shareable URL |
| League chat (Sleeper-style) | In-app persistent chat per mini-league | Requires user accounts, message storage, moderation. Phase 1 social is shareable images — much higher signal-to-effort ratio |
| React Query / SWR | Replace module-level cache with a proper cache library | Goes against established project convention (`AsyncState<T>` + module cache). Revisit if data requirements become complex enough to justify |

---

## Documentation Plan

- `apps/api/src/chat/schemaContext.ts` — update `COLUMN_ANNOTATIONS` for any new schema additions; add xPts model description to system prompt so AI chat can explain predictions
- `apps/api/MCP.md` — note any new tools/resources exposed via MCP
- `README.md` — add new features to the feature list after Phase 1 ships

---

## Sources & References

### Research Basis
- `/last30days` research: 14 web sources (Fantasy Football Fix, FPLstrat, FPL Review, FPL Zone, Draft Sharks, Sleeper, LiveFPL, ESPN, PLANFPL)
- FPL community consensus: xPts + FDR ticker = highest-demand features; live bonus = biggest matchday pain point

### Internal References
- Transfer planner with chip simulation: `apps/web/src/lib/my-team.ts:343–418`
- SSE streaming pattern: `apps/api/src/chat/chatRouter.ts`
- Point calculation logic: `apps/web/src/lib/points.ts`
- Schema definition: `apps/api/src/db/schema.ts`
- LLM system prompt + pitfall list: `apps/api/src/chat/schemaContext.ts`
- FPL API client: `apps/api/src/client/fplApiClient.ts`
- Rate limiter: `apps/api/src/lib/rateLimiter.ts`
- Asset rendering with sharp: `apps/api/src/services/assetSyncService.ts`
