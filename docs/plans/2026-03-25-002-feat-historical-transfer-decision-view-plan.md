---
title: "feat: Show Historical Transfer Decisions by Gameweek"
type: feat
status: completed
date: 2026-03-25
origin: docs/plans/2026-03-24-004-feat-transfer-decision-workflow-plan.md + docs/plans/2026-03-25-001-fix-transfer-decision-bias-plan.md
deepened: 2026-03-25
---

# feat: Show Historical Transfer Decisions by Gameweek

## Overview

Extend the My Team `Transfer Decision` workspace so it follows the same selected gameweek as the pitch view. When a user switches the pitch to a past gameweek, the recommendation card should show what the app would have recommended before that gameweek's deadline, using that gameweek's squad, bank, fixtures, and pre-deadline projection context instead of today's.

## Problem Frame

The My Team page already lets the user move the pitch view across historical gameweeks, but the `Transfer Decision` card still fetches recommendations for `payload.currentGameweek`. That creates a context mismatch: the squad and points shown on the pitch can be historical while the recommendation card stays anchored to the current deadline.

This is more than a UI wiring issue. The current transfer-decision engine accepts a `gw` parameter, but its richer projection helpers still rely on current-club player rows and global recent-history aggregation. If the product now claims to show what the recommendation was "at the time," it must avoid lookahead bias and reconstruct historical context carefully enough that the recommendation is believable for that selected deadline.

The replay also has to be economically faithful. If a past recommendation uses today's player prices, today's club affiliation, or today's affordability checks, it is not actually showing what the app would have recommended before that deadline. Historical replay should therefore be treated as a full pre-deadline context reconstruction for every mutable input the repo can support.

## Requirements Trace

- R1. When the user changes the pitch view to a past gameweek, the `Transfer Decision` workspace should refresh to that same gameweek automatically.
- R2. Historical recommendations must be computed from information available before the selected gameweek's deadline, not from future rounds.
- R3. Historical recommendations must use the selected gameweek's squad and bank context rather than the current gameweek's.
- R3a. Historical recommendations must use the selected gameweek's mutable economic context, including historical player prices and owned-player selling values, rather than current `players.now_cost`.
- R4. Current-gameweek behavior and existing transfer-decision controls should remain unchanged.
- R5. If historical recommendation context is incomplete, the UI must show an explicit unavailable/degraded state rather than a misleading modern recommendation.
- R6. API and web tests must cover historical selection, no-lookahead behavior, and unavailable-state handling.

## Scope Boundaries

- No new selector or additional transfer-decision controls; reuse the existing pitch/gameweek selection state.
- No 2FT, hit, chip, or wildcard expansion.
- No attempt to reconstruct exact historical injury/news flags when the repo does not store them per gameweek.
- No permanent snapshotting of past recommendations; compute them on demand from historical data already stored in the DB.
- No comparison UI between "recommended then" and "what actually happened" in this slice.

## Context & Research

### Relevant Code and Patterns

- [MyTeamPage.tsx](/Users/iha/github/ianha/fplytics-transfer-decision/apps/web/src/pages/MyTeamPage.tsx): already owns `viewGameweek`, historical picks loading, and the `Transfer Decision` card, but the transfer-decision effect currently calls `getTransferDecision(accountId, { gw: payload.currentGameweek, ... })`.
- [client.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/web/src/api/client.ts): already supports `getTransferDecision(accountId, { gw, horizon })`, so the client contract does not need to change.
- [createApiRouter.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/src/routes/createApiRouter.ts): the route already accepts `gw` and `horizon`.
- [queryService.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/src/services/queryService.ts): `getTransferDecision` already selects picks/bank for a requested gameweek, but its projection helpers still use broader current-state assumptions that create lookahead risk for historical requests.
- [queryService.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/src/services/queryService.ts): `getMyTeamPicksForGameweek` is the right pattern for pulling historical squad context.
- [schemaContext.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/src/chat/schemaContext.ts): explicitly documents that `players.team_id` is current-club data and that `player_history.team_id` should be used for historical club affiliation.
- [schemaContext.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/src/chat/schemaContext.ts): also documents that `player_history.value` is the historical player price for that GW, while `my_team_picks.selling_price` / `purchase_price` and `my_team_gameweeks.bank` / `value` already preserve important historical affordability context for owned squads.
- [queryService.test.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/test/queryService.test.ts), [myTeam.test.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/test/myTeam.test.ts), and [MyTeamPage.test.tsx](/Users/iha/github/ianha/fplytics-transfer-decision/apps/web/src/pages/MyTeamPage.test.tsx): existing seeded tests already cover transfer-decision ranking and historical pitch selection patterns.

### Institutional Learnings

- The repo expects personalized recommendation behavior to live in deterministic backend service logic, not frontend post-processing.
- Seeded fixture/history datasets are the established pattern for validating recommendation behavior, especially where heuristic ranking and historical context matter.
- Historical club affiliation already has a documented source of truth in `player_history.team_id`; the plan should lean on that instead of assuming `players.team_id` is safe for backdated recommendations.
- Historical economic context is also partly available already. The plan should use stored selling prices, stored bank/value, and `player_history.value` before ever considering current-price fallbacks.

### External References

- None. The codebase already contains the relevant route, view-state, and historical-data patterns, so external research would add little value for this bounded feature.

## Key Technical Decisions

- Reuse the existing `gw` route parameter rather than adding a new historical-transfer-decision endpoint. The missing work is correctness and UI wiring, not API surface area.
- Treat historical transfer decisions as **deadline-context replay**, not just "run today's model for an older week number." That means projection helpers must accept a cutoff gameweek and avoid using future rounds when computing historical form/team strength.
- Treat historical transfer decisions as a **full pre-deadline snapshot replay** for mutable inputs the repo can reconstruct. Recommendation search and affordability checks must use historical prices, historical selling values, historical bank, and historical club context, not modern replacements.
- Continue computing recommendations on demand from stored DB state rather than persisting historical recommendations. This keeps the feature deterministic and portable while avoiding snapshot maintenance.
- Reuse the existing pitch gameweek selector as the single source of truth for historical My Team context. The page should not make the user choose a second gameweek for the recommendation card.
- Use `player_history.team_id` or the last known pre-cutoff team affiliation when reconstructing historical player context. Current `players.team_id` should remain a fallback only when no historical data exists before the cutoff.
- Use historical economic inputs wherever possible:
  - owned-player sale value from `my_team_picks.selling_price`
  - historical squad bank/value from `my_team_gameweeks`
  - incoming candidate price from `player_history.value` at or immediately before the selected cutoff
  - current `players.now_cost` only as an explicit degraded fallback when no historical price row exists
- Treat historical replay as a **best-effort deterministic reconstruction** from stored data, not a perfect archive of every pre-deadline input. The plan should explicitly call out where the repo lacks historical snapshots, especially for free-transfer counts, status/news flags, and future fixture publication state.
- If historical context is too sparse to produce a credible recommendation, return an explicit unavailable/degraded result instead of silently falling back to current-context projections.
- Keep unavailable handling contract-safe by preferring a valid response payload with a degraded recommendation state over a route-level 404. That avoids conflating “this account/gameweek exists” with “we cannot replay this recommendation credibly enough,” and it fits the existing page's loading/error model better than a not-found branch.
- Add request-coherency protection on the web side so rapid gameweek switching cannot leave a stale current recommendation visible after a slower historical fetch resolves.

## Open Questions

### Resolved During Planning

- Should this be a separate historical recommendations page? No. It should stay inside the existing `Transfer Decision` workspace and follow the page's selected gameweek.
- Should this require a new API route? No. The existing route and `gw` parameter are sufficient if the service semantics are corrected.
- Should historical recommendations be stored as snapshots? No. On-demand reconstruction from stored historical data is a better fit for the current architecture.

### Deferred to Implementation

- Exact cutoff rule for the form window, for example whether a GW7 historical recommendation should use rounds `< 7` only or a more explicit "latest N completed rounds before deadline" helper. This should be finalized in service code and regression tests.
- Exact degraded-state copy for cases where historical context is too sparse. The plan defines the behavior, but final wording belongs in implementation.
- Exact inference rule for historical `freeTransfers`. The repo stores `event_transfers` and `event_transfers_cost`, but not an explicit per-GW free-transfer balance, so implementation must define a bounded inference or a degraded display rule instead of overclaiming exact historical FT counts.
- Exact fallback rule for future fixture fidelity when the selected historical gameweek predates later schedule changes. The repo appears to store the canonical fixture table, not per-deadline fixture snapshots, so implementation must either accept that limitation explicitly or degrade historical confidence when schedule sensitivity would materially affect the recommendation.
- Exact historical price lookup rule for incoming targets when there is no dedicated per-deadline price snapshot table. Implementation should define a deterministic source order, for example latest `player_history.value` from a round completed before the selected deadline.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
selected_gameweek =
  viewGameweek ?? currentGameweek

web page:
  when selected_gameweek changes
    -> fetch historical picks if needed
    -> fetch transfer decision for selected_gameweek

transfer decision service(selected_gameweek):
  historical_squad = picks + bank for selected_gameweek
  historical_ft_context = infer from stored history or mark degraded
  cutoff_rounds = rounds completed before selected_gameweek
  historical_prices =
    owned selling prices from selected_gameweek picks
    + candidate buy prices from player_history.value at/before cutoff
  player_context =
    player rates from cutoff_rounds only
    + last known pre-cutoff club/team context
    + upcoming fixtures from selected_gameweek onward
  recommendation =
    current deterministic ranking logic
    using historical_squad + historical_projection_context + historical_prices

if historical_context insufficient:
  return contract-safe degraded result
  do not substitute current-gameweek recommendation or current price context

web request rule:
  only commit the latest selected_gameweek response
  discard slower stale responses from previously selected GWs
```

## Alternative Approaches Considered

- **Pure UI wiring only.** Rejected because the current backend would still leak future rounds and current-club context into past recommendations, producing a historical-looking but misleading result.
- **Dedicated historical transfer decision endpoint.** Rejected because the route already accepts `gw`; adding a second endpoint would duplicate semantics without solving the real correctness issues.
- **404 when historical replay is degraded.** Rejected because the account and gameweek can still be valid even when replay fidelity is incomplete. A contract-safe degraded payload gives the UI a cleaner way to explain what is missing.

## Implementation Units

- [x] **Unit 1: Parameterize transfer-decision projections by historical cutoff**

**Goal:** Make the backend projection helpers capable of computing a recommendation as-of a selected historical gameweek without future-data leakage.

**Requirements:** R2, R3, R5

**Dependencies:** None

**Files:**
- Modify: `apps/api/src/services/queryService.ts`
- Test: `apps/api/test/queryService.test.ts`

**Approach:**
- Refactor the historical projection helpers used by `getTransferDecision` so they accept an explicit selected gameweek / cutoff context.
- Limit form, team-strength, and projection-window inputs to rounds completed before the selected gameweek rather than the latest rounds in the database.
- Reconstruct historical club/team context for projections using `player_history.team_id` or the latest known pre-cutoff team row, with current player rows as a fallback only when no historical context exists.
- Reconstruct historical economic context alongside projections:
  - use `my_team_picks.selling_price` and `purchase_price` for owned-player economics
  - use `my_team_gameweeks.bank` / `value` for squad-level affordability
  - use `player_history.value` at or before the cutoff for incoming candidate price
  - mark replay degraded if affordability would otherwise require current `players.now_cost`
- Define the replay fidelity ladder up front:
  - full historical replay when squad, history window, and future fixtures are all credible
  - degraded replay when squad exists but one of FT count, status/news, fixture-snapshot fidelity, or historical-price fidelity must be inferred
  - unavailable replay only when the selected gameweek lacks enough stored squad/history context to produce any credible recommendation
- Keep the same transfer-decision contract shape unless the degraded path clearly requires one minimal explicit signal; if so, prefer a small additive field over changing the route shape radically.

**Patterns to follow:**
- Mirror the current shared projection-primitives approach in `queryService.ts`
- Follow the repo's existing seeded-data test style for recommendation and xPts behavior

**Test scenarios:**
- A historical GW recommendation uses only rounds before that GW and ignores stronger future form that would otherwise change the answer.
- A player whose current club differs from their historical club is evaluated using the historical club context for the selected GW.
- A historical GW recommendation does not become affordable or unaffordable because of today's `players.now_cost`; it uses historical price inputs instead.
- A sparse-history case returns an explicit unavailable/degraded result instead of reusing current-context logic.
- A degraded-but-valid historical case still returns a payload while marking that replay fidelity is partial rather than exact.

**Verification:**
- Historical transfer decisions differ when future rounds would have changed the recommendation, proving the cutoff is active rather than cosmetic.

- [x] **Unit 2: Align transfer-decision request semantics with selected historical squad context**

**Goal:** Ensure the requested gameweek controls the recommendation's squad, bank, and recommendation availability consistently.

**Requirements:** R2, R3, R5

**Dependencies:** Unit 1

**Files:**
- Modify: `apps/api/src/services/queryService.ts`
- Modify: `apps/api/src/routes/createApiRouter.ts`
- Test: `apps/api/test/queryService.test.ts`
- Test: `apps/api/test/myTeam.test.ts`

**Approach:**
- Keep `getTransferDecision(accountId, { gw, horizon })` as the entry point, but make its selected gameweek semantics explicit end-to-end.
- Validate that the requested `gw` exists for the account's stored history/picks before computing a recommendation.
- Add a bounded historical free-transfer strategy:
  - derive the minimum plausible free transfers from stored GW transfer counts/hits when possible
  - cap inferred values conservatively
  - degrade the recommendation presentation when the exact FT balance is unknowable from stored history
- Make historical affordability semantics explicit in the service:
  - buying decisions for past GWs must be constrained by historical bank plus historical selling value
  - candidate filtering must not use current player prices for past GWs unless the replay is explicitly degraded
- Decide and document one service behavior for degraded historical context:
  - valid payload with explicit degraded/unavailable recommendation state for replay limitations
  - reserve `null`/404 for truly missing account/gameweek data only
- Preserve current-gameweek behavior exactly for the default path.

**Patterns to follow:**
- Follow the existing route validation and 404 pattern in `createApiRouter.ts`
- Reuse historical squad lookup patterns from `getMyTeamPicksForGameweek`

**Test scenarios:**
- API returns a recommendation for a valid past gameweek with stored picks/history.
- API returns the correct degraded/unavailable-state behavior for a gameweek lacking enough historical context.
- API does not reuse the current-gameweek free-transfer count blindly for past gameweeks when stored history implies a different bounded inference or degraded state.
- API does not recommend a move that only becomes affordable because of current-day price drift; seeded tests should prove historical prices gate the candidate set.
- Current-gameweek API behavior remains unchanged when no historical view is selected.

**Verification:**
- The backend has one unambiguous meaning for `gw`: recommendation as-of that deadline, not simply "label this response with that GW."

- [x] **Unit 3: Make the My Team transfer card follow the selected pitch gameweek**

**Goal:** Synchronize the frontend `Transfer Decision` workspace with the selected historical pitch view.

**Requirements:** R1, R4, R5

**Dependencies:** Unit 2

**Files:**
- Modify: `apps/web/src/pages/MyTeamPage.tsx`
- Test: `apps/web/src/pages/MyTeamPage.test.tsx`

**Approach:**
- Change the transfer-decision effect so it uses the page's selected gameweek state (`viewGameweek ?? currentGameweek`) instead of always using `payload.currentGameweek`.
- Preserve the existing current-gameweek default when no historical gameweek is selected.
- Update the card copy so users can tell when they are looking at a historical pre-deadline recommendation instead of the live/current decision.
- If the API returns an unavailable/degraded result for a historical gameweek, show that explicitly inside the card rather than leaving stale current recommendations on screen.
- Add response-coherency handling so rapid switching between gameweeks cannot race and render an outdated recommendation after the selected gameweek has already changed.

**Patterns to follow:**
- Follow the existing historical picks-loading and cache-key patterns in `MyTeamPage.tsx`
- Preserve the current `Transfer Decision` visual structure rather than adding new controls

**Test scenarios:**
- Selecting a past gameweek triggers `getTransferDecision(accountId, { gw: selectedGw, horizon })`.
- Returning to the current gameweek restores current transfer-decision behavior.
- Historical unavailable/degraded responses render clear user-facing copy instead of stale current data.
- Fast consecutive gameweek switches do not leave the card showing the wrong gameweek's recommendation.

**Verification:**
- The transfer card and pitch always refer to the same selected gameweek context.
- The page never briefly settles on an older response after a newer selected-gameweek request has already been issued.

- [x] **Unit 4: Lock the historical-view behavior with no-lookahead regression coverage**

**Goal:** Make historical transfer decisions durable and reviewable so future ranking work does not reintroduce lookahead or context mismatch.

**Requirements:** R1, R2, R3, R5, R6

**Dependencies:** Units 1-3

**Files:**
- Modify: `apps/api/test/queryService.test.ts`
- Modify: `apps/api/test/myTeam.test.ts`
- Modify: `apps/web/src/pages/MyTeamPage.test.tsx`

**Approach:**
- Add regression fixtures where later-round player form would change the recommendation if future data leaked in.
- Add regression fixtures where present-day price drift would change affordability, and prove historical replay still uses historical prices.
- Add route-level tests proving a historical `gw` request reaches the corrected backend semantics.
- Add page-level tests covering current-vs-historical toggling and unavailable-state rendering.

**Execution note:** Start with characterization-style failing tests for historical `gw` behavior before widening service logic.

**Patterns to follow:**
- Extend the existing seeded transfer-decision tests rather than creating a separate fixture system
- Keep route tests focused on request/response semantics, not every ranking branch

**Test scenarios:**
- Historical recommendation differs from current recommendation when later data would otherwise influence the model.
- Historical recommendation uses the selected GW in both route and page integrations.
- Historical recommendation preserves past affordability semantics instead of using current prices for candidate generation.
- Unavailable historical context is explicit and does not leave the previous recommendation on screen.

**Verification:**
- The regression suite proves historical transfer decisions are context-correct, not just UI-swapped.

## System-Wide Impact

- **Interaction graph:** The main flow crosses `MyTeamPage.tsx`, the API client, the transfer-decision route, and the projection helpers inside `QueryService`.
- **Error propagation:** Historical unavailable-context handling needs one clear backend-to-frontend path so the page does not confuse "loading," "not found," "replay degraded," and "not enough history."
- **State lifecycle risks:** Low write risk, but moderate correctness risk because stale current recommendation state could remain visible when a historical fetch fails, is degraded, or loses a race against a later request.
- **API surface parity:** The existing `gw` route parameter is shared across current and historical contexts, so semantics must stay consistent for every caller.
- **Integration coverage:** Unit tests alone will not catch the pitch/card mismatch, FT inference drift, or response races; page-level tests must verify that changing the selected gameweek updates the transfer-decision request, rendering, and stale-response handling.

## Risks & Dependencies

- The biggest risk is lookahead bias: if any projection helper still uses future rounds, historical recommendations will appear plausible but be wrong. Mitigate with seeded counterexamples where future data would change the answer.
- Historical team affiliation can drift if the service keeps reading `players.team_id`. Mitigate by routing historical context through `player_history.team_id` or latest pre-cutoff team inference.
- Historical price context can drift if the service falls back to `players.now_cost` without surfacing degradation. Mitigate by preferring `player_history.value`, stored pick selling prices, and explicit degraded replay semantics.
- The repo does not appear to store exact per-GW injury/news snapshots. Mitigate by basing historical recommendations primarily on historical picks, minutes, starts, and fixtures rather than pretending exact historical status flags are available.
- The repo also does not appear to store explicit per-GW free-transfer balance. Mitigate by defining a bounded historical FT inference rule and degrading replay confidence when exact FT state cannot be proven.
- Fixture replay fidelity may drift for historical weeks if later reschedules changed the future fixture picture after that deadline. Mitigate by documenting this as best-effort replay from stored canonical fixtures and degrading confidence when schedule sensitivity materially affects the recommendation.
- Historical page interactions can race because pitch history and transfer decision are fetched independently. Mitigate by using request identity or cancellation patterns and covering rapid-switch behavior in page tests.

## Documentation / Operational Notes

- If this lands, the transfer-decision roadmap should eventually mention that historical gameweek replay is supported inside My Team.
- No additional rollout infrastructure is needed, but this feature should be validated manually by switching between current and past gameweeks on a seeded account to confirm the card never lags behind the pitch view.
- Manual validation should include at least one seeded case where a past recommendation would differ if today's player prices were used, to verify replay economics are truly historical.

## Sources & References

- **Origin documents:** [docs/plans/2026-03-24-004-feat-transfer-decision-workflow-plan.md](/Users/iha/github/ianha/fplytics-transfer-decision/docs/plans/2026-03-24-004-feat-transfer-decision-workflow-plan.md), [docs/plans/2026-03-25-001-fix-transfer-decision-bias-plan.md](/Users/iha/github/ianha/fplytics-transfer-decision/docs/plans/2026-03-25-001-fix-transfer-decision-bias-plan.md)
- Related code: [MyTeamPage.tsx](/Users/iha/github/ianha/fplytics-transfer-decision/apps/web/src/pages/MyTeamPage.tsx), [queryService.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/src/services/queryService.ts), [createApiRouter.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/src/routes/createApiRouter.ts), [client.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/web/src/api/client.ts)
- Related tests: [queryService.test.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/test/queryService.test.ts), [myTeam.test.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/test/myTeam.test.ts), [MyTeamPage.test.tsx](/Users/iha/github/ianha/fplytics-transfer-decision/apps/web/src/pages/MyTeamPage.test.tsx)
- Schema guidance: [schemaContext.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/src/chat/schemaContext.ts)
