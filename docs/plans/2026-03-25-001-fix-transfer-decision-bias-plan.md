---
title: "fix: Improve Transfer Decision Upside Bias"
type: fix
status: completed
date: 2026-03-25
origin: docs/plans/2026-03-24-004-feat-transfer-decision-workflow-plan.md
deepened: 2026-03-25
---

# fix: Improve Transfer Decision Upside Bias

## Overview

Tighten the Phase 1 transfer recommendation engine so it behaves more like a deadline decision assistant and less like a raw xPts sorter. The current implementation can surface low-impact goalkeeper swaps and bench-only moves because it scores all same-position replacements too mechanically. This plan biases recommendation quality toward regular starters, higher-upside roles, and meaningful attacking upside without expanding scope into 2FT, hit logic, or Phase 2 product work.

## Problem Frame

Phase 1 shipped the `Roll` vs `Best 1FT` workflow from the transfer decision roadmap (see origin: `docs/plans/2026-03-24-004-feat-transfer-decision-workflow-plan.md`), but current scoring and candidate generation still allow weak recommendation shapes:

- low-ceiling goalkeeper moves can outrank more meaningful attacking moves
- regular bench players can become preferred sells even when they barely affect the starting XI
- defenders and keepers are treated too similarly to midfielders and forwards despite lower upside profiles

That undermines the product goal of giving a believable pre-deadline answer quickly. The fix is not to add more product surface area; it is to improve the ranking behavior within the existing Phase 1 contract and UI.

## Requirements Trace

- R1. The engine should prefer transfers that meaningfully improve likely starters over bench churn.
- R2. The engine should bias toward higher-upside midfield and forward moves when gains are otherwise comparable.
- R3. Goalkeeper and low-ceiling defensive moves should be de-emphasized unless their projected gain is materially better.
- R4. The deterministic API contract and existing Phase 1 UI must remain intact.
- R5. Ranking behavior must be covered by API-level tests so the bias is reproducible and reviewable.

## Scope Boundaries

- No 2FT path generation
- No hit logic changes
- No new API shape or new frontend controls
- No chip-aware or ownership-aware planning
- No AI-only narrative layer
- This fix is allowed to change the user-facing `projectedGain` / `nextGwGain` values because those values are intended to reflect the best available deterministic forecast, not preserve legacy heuristics. The contract shape stays the same, but the underlying forecast model gets stronger.

## Context & Research

### Relevant Code and Patterns

- [queryService.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/src/services/queryService.ts): current transfer decision scoring, projection generation, and candidate selection all live here
- [createApiRouter.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/src/routes/createApiRouter.ts): existing route shape should stay stable
- [MyTeamPage.tsx](/Users/iha/github/ianha/fplytics-transfer-decision/apps/web/src/pages/MyTeamPage.tsx): current UI consumes `projectedGain`, `nextGwGain`, reasons, warnings, and the recommended option id
- [queryService.test.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/test/queryService.test.ts): best place to add ranking-focused seed scenarios
- [myTeam.test.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/test/myTeam.test.ts): route-level recommendation coverage already exists and should absorb new prioritization expectations

### Institutional Learnings

- The repo already treats My Team data as the grounding context for personalized decisions; recommendation quality is expected to come from deterministic service logic, not frontend post-processing.
- Existing tests seed small, explicit fixture and player-history datasets. That is the right pattern for validating heuristic ranking changes.

### External References

- Official FPL scoring is event-based, with points awarded for minutes, goals, assists, clean sheets, saves, defensive contributions, and bonus. That supports a decomposition-first projection model rather than a single blended heuristic score. See [Premier League: FPL basics explained: Scoring points](https://www.premierleague.com/en/news/2174909).
- FPL-specific forecasting literature has moved toward **position-specific** models using player, team, opponent, and availability inputs over multiple rolling horizons. The strongest recent open benchmark found position-specific ensemble models competitive with commercial services and especially strong on higher-return players, which is directly relevant because those are the moves that swing deadline decisions most. See [OpenFPL (arXiv, 2025)](https://arxiv.org/abs/2508.09992).
- Public xFPL methodology converges on the same decomposition: expected goals, expected assists, expected clean sheets, appearance points, and bonus rather than raw recent points alone. See [Fantasy Football Fix: What is xFPL?](https://support.fantasyfootballfix.com/support/solutions/articles/202000055995-what-is-expected-fpl-points-xfpl-).
- Team-goal and clean-sheet prediction is commonly modeled with Poisson-family methods in football analytics. That makes Poisson-derived clean-sheet and goals-conceded probabilities a stronger foundation than the current direct fixture multiplier shortcut. See [Applied Sciences: Predicting Football Match Results Using a Poisson Regression Model (2024)](https://www.mdpi.com/2076-3417/14/16/7230).
- Shot-conversion research also supports keeping some explicit positional and player-level adjustment in the attacking-event model. Bayesian xG work found persistent player-level effects and initial positional effects, with strikers and attacking midfielders benefiting most when the model is less feature-rich. That supports adding an explicit upside term instead of assuming all positions should be treated identically in close calls. See [Bayes-xG (arXiv, 2023)](https://arxiv.org/abs/2311.13707).

## Key Technical Decisions

- Keep the response contract unchanged and improve behavior behind it. This preserves the current Phase 1 UI and route consumers.
- Keep the response contract unchanged while explicitly allowing the underlying forecast values to improve. The user-facing meaning of `projectedGain` and `nextGwGain` remains “best deterministic expected points delta over the selected horizon,” even if the richer model changes the exact numbers.
- Separate **candidate viability** from **ranking preference**. Raw projected gain should remain truthful in the response, while internal ranking should apply additional bias for starter relevance and upside.
- Replace the current mostly linear projection shortcut with a more FPL-native **event decomposition** for internal forecasting: minutes/appearance expectation, attacking-event expectation, clean-sheet expectation, save or goals-conceded expectation where relevant, and a modest bonus proxy. This stays deterministic but aligns more closely with how high-quality FPL forecasting systems are structured.
- Add an explicit positional upside bias rather than hoping xPts alone handles it. Midfielders and forwards should receive preference when gains are close because they better match the product intent and user complaint. This bias should come primarily from an attacking-ceiling term, not only from a flat hand-tuned position bonus.
- Add a stronger sell-side penalty for low-impact bench removals. Bench upgrades may still surface when clearly worthwhile, but they should not dominate equal or near-equal starter improvements.
- Keep transfer-decision projections and public player xPts semantics aligned. If the transfer-decision service adopts the richer event model first, the plan must either reuse the same projection primitives for public xPts or explicitly regression-test that any temporary divergence is intentional and documented.
- Keep all new heuristics deterministic, explainable, and test-seeded rather than introducing an opaque end-to-end ML ranker in this fix. A full ensemble forecaster is a possible later evolution, but this plan should only borrow the predictive shape, not its operational complexity.

## Open Questions

### Resolved During Planning

- Should this be solved in UI ranking only? No. The bias belongs in the API service so route responses, tests, and future consumers all share the same decision logic.
- Should the fix change contracts? No. Current Phase 1 fields are sufficient.
- Should goalkeepers be fully excluded? No. They should be de-prioritized, not forbidden, so genuinely strong goalkeeper cases can still win.

### Deferred to Implementation

- Exact coefficient values for starter impact, attacking-upside weighting, and close-call penalties. These should be tuned during implementation against seeded ranking tests rather than hard-coded in the plan.
- Whether defender transfers should receive only a relative downgrade or a stronger “material-gain-only” threshold similar to goalkeepers. This can be finalized once the seeded scenarios are in place.
- Whether the current data available in `player_history`, `fixtures`, and team-level rows is sufficient for a stable expected-bonus proxy, or whether bonus should remain a capped secondary term. This is an implementation-owned question, not a product blocker.
- Exact reuse path for public `/players/xpts` style surfaces. The preferred direction is shared projection primitives, but implementation can decide whether that happens in the same patch or via a tightly-scoped follow-up if tests make the temporary split explicit.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
xPts(player, gw) =
  appearance_points(player, gw)
  + goal_points[position] * E[goals(player, gw)]
  + 3 * E[assists(player, gw)]
  + clean_sheet_points[position] * P(clean_sheet(team, gw)) * P(60+ mins)
  + goalkeeper_save_points * E[saves(player, gw)]
  + bonus_proxy(player, gw)
  - concede_penalty[position] * E[goals_conceded(team, gw)] / 2
  - discipline_penalty(player, gw)

where:
- appearance_points is driven by start / 60+ probability, not only raw recent minutes
- E[goals] and E[assists] come from opponent-adjusted player rates with Bayesian-style shrinkage toward position/team priors
- P(clean_sheet) and E[goals_conceded] are derived from a Poisson-style team attack-vs-defense model
- bonus_proxy is intentionally capped so it helps break ties without dominating the score

horizon_xPts(player) =
  sum over target GWs of (gw_weight * xPts(player, gw))

transfer_rank =
  horizon_starting_xPts_gain
  + next_gw_gain_boost
  + attacking_ceiling_gain
  + bank_tiebreaker
  - minutes_risk_penalty
  - bench_transfer_penalty
  - low-impact-position_penalty

where:
- public `projectedGain` should remain a truthful delta of `horizon_xPts`
- `horizon_starting_xPts_gain` should discount bench-only gains by bench order and weight starter gains fully
- `attacking_ceiling_gain` should be derived from goals/assists/bonus-driving events, which naturally advantages MID/FWD profiles
- bench/GK/DEF penalties should be strongest for near-tied moves, not dominant wins

plain-language product rule:
- if two legal moves are close on projected gain, prefer the one that upgrades a likely starter and carries more attacking ceiling
- a GK/DEF move may still win when its projected gain is clearly ahead, not just fractionally ahead
- bench-only moves should win only when they produce a genuinely material forecast edge over starter-focused alternatives
```

## Alternative Approaches Considered

- **Keep tuning the current linear weighted-projection formula.** Rejected because it leaves the engine too dependent on one blended projection number and encourages more ad hoc penalties every time a weak recommendation shape appears.
- **Adopt a full ML ensemble forecaster now.** Rejected for this fix because it would expand scope well beyond the current service, test setup, and review surface. The plan should instead adopt the structure of better forecasting systems while staying deterministic and reviewable.
- **Hard-code a large flat MID/FWD bonus.** Rejected because it would hide legitimate goalkeeper/defender wins and would be harder to explain. A better approach is to compute an attacking-upside term from the event model, then use only a modest residual position tiebreak.

## Implementation Units

- [x] **Unit 1: Refactor transfer ranking inputs for explicit role and upside signals**

**Goal:** Make the scoring layer aware of starter relevance, bench impact, and attacking upside without changing the public response shape.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Modify: `apps/api/src/services/queryService.ts`
- Test: `apps/api/test/queryService.test.ts`

**Approach:**
- Extract or reorganize internal ranking inputs so raw projected gain stays separate from internal recommendation score.
- Replace the current projection shortcut with an event-based xPts builder that decomposes:
  - appearance / 60+ expectation
  - expected goals
  - expected assists
  - clean-sheet / goals-conceded impact
  - saves for goalkeepers
  - capped bonus proxy
- Build player event expectations from short-, medium-, and season-window rates, shrunk toward positional priors so a small sample does not overreact.
- Define a fallback ladder for sparse data so the richer model remains deterministic and stable:
  - if a player has strong recent sample, use the full event decomposition
  - if recent sample is thin, shrink more aggressively toward position/team priors
  - if history is too sparse for stable event decomposition, fall back to the existing fixture-adjusted projection shape
  - keep bonus as a capped secondary term and drop it entirely when source data is too weak
- Add explicit ranking signals for:
  - starter vs bench transfer impact
  - goalkeeper / defender de-prioritization
  - midfielder / forward upside preference via attacking ceiling
  - close-call handling when raw gains are similar
- Keep the response contract fields (`projectedGain`, `nextGwGain`, reasons, warnings) semantically truthful and human-readable.

**Patterns to follow:**
- Mirror the existing Phase 1 deterministic scoring style in `getTransferDecision`
- Preserve current route/client contract usage patterns rather than adding frontend-only transforms

**Test scenarios:**
- A bench move with similar raw gain should lose to a starter improvement.
- A goalkeeper move with only marginal advantage should lose to a comparable attacking move.
- A midfielder or forward move should win when raw gains are within the defined close-call band.
- A clearly dominant low-impact-position move should still be allowed to win when the gain gap is material.

**Verification:**
- The service can explain why a starter MID/FWD move beats an almost-equal bench or goalkeeper alternative without distorting the public gain fields.

- [x] **Unit 2: Tighten candidate generation toward realistic pre-deadline outs**

**Goal:** Reduce noise before scoring by focusing the candidate set on weak links that plausibly matter to this week’s decision.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1

**Files:**
- Modify: `apps/api/src/services/queryService.ts`
- Test: `apps/api/test/queryService.test.ts`

**Approach:**
- Revisit sell-side candidate selection so likely starter weak links are considered first.
- Score outgoing picks by **actionable weakness**, not just low blended projection:
  - low starter xPts
  - poor next-GW starter outlook
  - weak attacking ceiling for MID/FWD slots
  - lower urgency for bench and backup goalkeeper slots
- Cap or down-rank bench-only and goalkeeper outs earlier in the pipeline rather than relying only on the final score.
- Preserve a safety floor in candidate pruning so bias does not erase valid options:
  - always keep at least the strongest affordable same-position candidate for each considered sell
  - do not prune a position entirely before final ranking
- Keep same-position affordability rules, but avoid flooding the best-1FT search with low-value replacement paths that dilute recommendation quality.

**Patterns to follow:**
- Reuse current `getPlayerProjectionMap` and owned-player filtering rather than inventing a new data source
- Follow existing seeded test style for small scenario-specific recommendation cases

**Test scenarios:**
- A squad with a weak starting midfielder and a weak bench defender should prefer improving the midfielder.
- A backup goalkeeper should not become the default sell target unless the starter-heavy options are clearly inferior.
- Candidate generation should still allow legal same-position replacements under current bank constraints.

**Verification:**
- The strongest surfaced 1FT option reflects a realistic manager decision, not the mathematically neatest low-impact swap.

- [x] **Unit 3: Improve explanation and warning heuristics to match the new ranking**

**Goal:** Make surfaced reasons and cautions reflect the new recommendation posture so users understand why a higher-upside starter move is preferred.

**Requirements:** R1, R2, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `apps/api/src/services/queryService.ts`
- Test: `apps/api/test/queryService.test.ts`
- Test: `apps/web/src/pages/MyTeamPage.test.tsx`

**Approach:**
- Update reason generation so recommended options can explicitly signal starter improvement, attacking upside, or meaningful immediate impact.
- Update warning generation so low-impact bench depth or low-ceiling position moves are labeled appropriately when they still surface.
- Ensure explanations refer to the decomposed drivers that actually matter in the new ranking model, such as:
  - stronger goal involvement expectation
  - better chance of 60+ minutes
  - better clean-sheet odds
  - mostly bench-only gain
- Keep UI consumption unchanged, but require the existing top recommendation summary to echo the strongest recommendation reason in plain language so a lower raw-gain-looking move does not feel arbitrary.
- Use the existing option-card warning area as the required placement for low-impact caveats, and surface the same caveat in the highlighted recommendation summary when the winning move is a close call.

**Patterns to follow:**
- Follow current `reasons` / `warnings` array contract
- Keep My Team page tests focused on rendered recommendation outcomes rather than implementation details

**Test scenarios:**
- Recommended attacking moves include a reason aligned with starter or upside improvement.
- Low-impact alternatives carry a caution that makes the tradeoff visible.
- UI tests still render recommendation summaries without needing contract changes.

**Verification:**
- Recommendation text and ranking logic tell the same story instead of working against each other.

- [x] **Unit 4: Lock the behavior with regression coverage at service and route level**

**Goal:** Make the new bias durable so later heuristic tweaks do not reintroduce bench and goalkeeper over-recommendation.

**Requirements:** R5

**Dependencies:** Units 1-3

**Files:**
- Modify: `apps/api/test/queryService.test.ts`
- Modify: `apps/api/test/myTeam.test.ts`
- Optional modify: `apps/web/src/App.test.tsx`

**Approach:**
- Add explicit regression fixtures covering:
  - goalkeeper vs midfielder/forward tie-breaks
  - starter vs bench sell choices
  - material-win exceptions where a low-impact position can still win honestly
- Add regression coverage for gain-semantic stability:
  - if public xPts surfaces are updated in the same patch, assert shared projection behavior
  - if they are intentionally left unchanged for one iteration, assert the split is explicit and contract-safe
- Assert both the recommended option id and the selected in/out players, not just that a result exists.
- Keep route-level assertions lightweight and focused on preserving the service outcome through the API boundary.

**Execution note:** Start with failing API/service tests for the bad recommendation shapes described in this request.

**Patterns to follow:**
- Extend the existing explicit test seed style in `queryService.test.ts` and `myTeam.test.ts`
- Use route tests to confirm contract preservation, not to re-test every scoring branch

**Test scenarios:**
- Regression: avoid recommending a low-ceiling goalkeeper transfer when an attacking starter move is close.
- Regression: avoid recommending a routine bench transfer ahead of a comparable regular starter move.
- Regression: keep `Roll` recommended when only low-impact moves clear the baseline weakly.

**Verification:**
- The seeded regression suite fails under the old heuristic and passes under the new one.

## System-Wide Impact

- **Interaction graph:** The core impact is concentrated in `QueryService.getTransferDecision`, but changes flow through the API route and My Team UI because both consume the same response.
- **Error propagation:** No new error classes or transport behavior should be introduced; this is ranking logic only.
- **State lifecycle risks:** Low. The work is read-only over existing synced data.
- **API surface parity:** Route and client helpers should remain contract-compatible; no new fields are required.
- **Integration coverage:** Service tests alone are not enough; route tests should confirm the API still exposes the expected recommendation after the heuristic change.

## Risks & Dependencies

- Over-biasing attacking positions could hide legitimate goalkeeper or defender improvements. Mitigate by applying the positional bias primarily in near-tied scenarios rather than as a hard exclusion.
- Reweighting bench impact too aggressively could make the engine ignore legitimate first-bench improvements. Mitigate with explicit regression cases for material gain exceptions.
- Explanation wording can drift away from actual ranking criteria if not updated alongside scoring. Mitigate by treating reasons/warnings as part of the heuristic change, not optional polish.
- A richer event model can create false precision if coefficient tuning outpaces the available data. Mitigate by keeping the formula small, using shrinkage toward positional priors, and capping weakly supported terms like bonus.
- A Poisson-style clean-sheet layer may still misestimate low-scoring outliers. Mitigate by using it as one subcomponent of xPts rather than as the dominant ranking driver.
- Public trust can erode if visible gain numbers change without explanation. Mitigate by keeping gain semantics explicit in the plan and ensuring the top recommendation summary tells users why the winning move ranks first.

## Documentation / Operational Notes

- No rollout or monitoring changes are required beyond normal recommendation review, but the plan should be referenced if future Phase 1 scoring complaints recur.
- If the ranking logic becomes substantially more opinionated, update the main transfer decision roadmap later to document the starter/upside bias explicitly.

## Sources & References

- **Origin document:** [docs/plans/2026-03-24-004-feat-transfer-decision-workflow-plan.md](/Users/iha/github/ianha/fplytics-transfer-decision/docs/plans/2026-03-24-004-feat-transfer-decision-workflow-plan.md)
- Related code: [queryService.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/src/services/queryService.ts)
- Related UI consumer: [MyTeamPage.tsx](/Users/iha/github/ianha/fplytics-transfer-decision/apps/web/src/pages/MyTeamPage.tsx)
- Related tests: [queryService.test.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/test/queryService.test.ts), [myTeam.test.ts](/Users/iha/github/ianha/fplytics-transfer-decision/apps/api/test/myTeam.test.ts)
- External research:
  - [Premier League: FPL basics explained: Scoring points](https://www.premierleague.com/en/news/2174909)
  - [Premier League: How the FPL Bonus Points System works](https://www.premierleague.com/en/news/106533)
  - [OpenFPL: An open-source forecasting method rivaling state-of-the-art Fantasy Premier League services](https://arxiv.org/abs/2508.09992)
  - [Fantasy Football Fix: What is Expected FPL Points (xFPL)?](https://support.fantasyfootballfix.com/support/solutions/articles/202000055995-what-is-expected-fpl-points-xfpl-)
  - [Predicting Football Match Results Using a Poisson Regression Model](https://www.mdpi.com/2076-3417/14/16/7230)
  - [Bayes-xG: Player and Position Correction on Expected Goals (xG) using Bayesian Hierarchical Approach](https://arxiv.org/abs/2311.13707)
