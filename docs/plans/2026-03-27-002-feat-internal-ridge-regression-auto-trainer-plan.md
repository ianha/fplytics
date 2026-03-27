---
title: "feat: Internal Ridge Regression Auto-Trainer for Event Weights"
type: feat
status: active
date: 2026-03-27
---

# Internal Ridge Regression Auto-Trainer for Event Weights

## Overview

Add an internal ridge regression model that automatically retrains the 7 event weight coefficients after each gameweek finishes, eliminating manual MCP-based retraining. The existing MCP tools (`get_training_matrix`, `update_projection_weights`) remain unchanged for external experimentation.

## Problem Statement / Motivation

The current ML pipeline requires a human to manually pull training data via MCP, fit a model externally, and write coefficients back. In practice this means weights go stale — gameweeks finish, nobody retrains, and transfer decisions use outdated coefficients. An automated internal baseline removes this friction while keeping the MCP path available for experimentation with more sophisticated models.

## Proposed Solution

A lightweight ridge regression implemented in pure TypeScript (no external ML dependencies) that:

1. Consumes training data from the existing `TrainingMatrixService`
2. Fits 7 event weight coefficients using the normal equation with L2 regularization
3. Writes results to the existing `MlModelRegistryService` model registry
4. Clears the pending ML evaluation queue on success
5. Exposes a CLI command for manual runs
6. Can be wired into a post-sync hook or cron for full automation

## Technical Approach

### Phase 0: Fix Training Matrix Cameo Bias (Prerequisite)

The `trainingMatrixService.ts` SQL uses `AVG(past_matches.expected_goals)` etc. (lines 77-85), which gives equal weight to 5-minute cameos and 90-minute starts. This creates a systematic train/serve mismatch with the just-fixed `queryService.ts` projection engine (which now uses minute-weighted aggregation). Training on biased data produces coefficients that compensate for a distortion that no longer exists at serving time.

**Fix**: Change the training matrix SQL aggregation to minute-weighted rates matching the live projection engine. Use `SUM(events) / COUNT(*)` or weighted variants consistent with `getRecentPlayerStats()`.

**Files**:
- `apps/api/src/services/trainingMatrixService.ts` — update SQL aggregation
- `apps/api/test/trainingMatrixService.test.ts` — add cameo bias regression test

### Phase 1: Ridge Regression Math Module

Implement the normal equation with L2 regularization: `w = (X^T X + λI)^{-1} X^T y`

For 7 coefficients and hundreds-to-thousands of training rows, this is a small linear algebra problem solvable without external dependencies.

**Key design decisions**:

- **Lambda (λ)**: Fixed at `1.0`. Stored in model metadata for future tuning. This provides moderate regularization — enough to prevent wild coefficients without shrinking everything to defaults.
- **Matrix operations**: Implement `transpose`, `multiply`, `invert` (Gauss-Jordan elimination) for small dense matrices. The matrices are at most 8×8 (7 features + intercept), so numerical stability is not a concern.
- **No intercept term**: The weights are multiplicative adjustments around 1.0, not additive offsets. Center the target variable around the default-weight predictions and fit adjustments.

**Feature column construction** (critical — must match `projectFixturePoints()` coordinate system):

The training matrix provides rolling raw stats, but the projection engine applies positional FPL point multipliers before the event weights. The regression features must be constructed in the same coordinate system:

| Feature column | Construction | Maps to weight |
|---|---|---|
| `goalFeature` | `rollingXg * goalPoints[positionId]` | `goal_weight` |
| `assistFeature` | `rollingXa * 3` | `assist_weight` |
| `cleanSheetFeature` | `rollingCs * cleanSheetPoints[positionId]` | `clean_sheet_weight` |
| `saveFeature` | `rollingSaves / 3` | `save_weight` |
| `bonusFeature` | `rollingBonus` | `bonus_weight` |
| `appearanceFeature` | `rollingMinutes > 0 ? 2 : 0` | `appearance_weight` |
| `concedeFeature` | `rollingXgc * concedePenaltyPoints[positionId]` | `concede_penalty_weight` |

Where positional point values match the FPL scoring rules used in `projectFixturePoints()`:
- Goals: GKP/DEF=6, MID=5, FWD=4
- Clean sheets: GKP/DEF=4, MID=1, FWD=0
- Concede penalty: GKP/DEF=-1 per 2 goals, MID/FWD=0

**Post-fit coefficient bounds**: Clamp all coefficients to `[0.1, 5.0]`. Log a warning if any clamping was needed. A negative `goalWeight` or a weight above 5 would produce pathological projections. The existing `readCoefficient()` guard only catches non-numeric values, not numerically absurd ones.

**Minimum sample size**: Require at least 100 training rows to fit. Below this threshold (roughly < 3 finished gameweeks), skip training with a log message rather than producing a statistically dubious model.

**Files**:
- `apps/api/src/services/ridgeRegressionService.ts` — matrix math + fit logic + feature construction
- `apps/api/test/ridgeRegressionService.test.ts` — unit tests for math correctness, coefficient bounds, minimum sample guard

### Phase 2: CLI Command

Follow the established CLI pattern exactly:

1. **Arg parser**: `parseRetrainModelArgs(argv)` — supports `--gameweek N` / `-g N` (train on single GW) and `--all` (concatenate all finished GWs). Mutual exclusion enforced. Default (no flags) trains on pending ML evaluation queue.
2. **Core logic**: `retrainModel(db, {gameweek?, all?})` — determines target gameweeks, calls `TrainingMatrixService` + `RidgeRegressionService`, writes to registry, clears pending queue. Returns structured result.
3. **Runner**: `runRetrainModelCli(argv)` — creates DB, parses args, calls core logic, logs output.
4. **Direct-run guard**: `import.meta.url === pathToFileURL(...)` pattern.
5. **npm script**: `"retrain:model": "node --import tsx src/cli/retrainModel.ts"` in `apps/api/package.json`.

**Gameweek resolution**:
- `--gameweek N`: Train on `getTrainingMatrix({targetGameweek: N})` only. Clear pending queue for GW N if present.
- `--all`: Iterate all finished gameweeks, concatenate training matrices, fit single model. Tag as `"auto-gw{earliest}-gw{latest}"`. Clear entire pending queue.
- No flags: Read `getPendingMlEvaluation()`. If pending GWs exist, concatenate their training matrices and fit. Tag as `"auto-gw{N}"` (single) or `"auto-gw{earliest}-gw{latest}"` (multiple). Clear all trained GWs from queue.

**Model metadata stored**: `{ lambda, trainingRows, gameweeks, rSquared, coefficientsClamped: boolean, fittedAt }`.

**Files**:
- `apps/api/src/cli/retrainModel.ts` — CLI command
- `apps/api/test/retrainModelCli.test.ts` — tests for arg parsing, core logic, queue clearing
- `apps/api/package.json` — add npm script

### Phase 3: Auto-Trigger Wiring

The sync service already queues pending ML evaluations. The trigger mechanism needs to be external (no in-process training in Express). Two options:

**Option A (recommended): Post-sync CLI call.** After `npm run sync` completes, the operator (or a wrapper script) runs `npm run retrain:model` with no flags. It consumes the pending queue automatically. Document this in the API README.

**Option B: Cron job.** Run `npm run retrain:model` on a schedule (e.g., every 6 hours). It checks the pending queue and trains if anything is pending, no-ops otherwise.

Either way, the `retrainModel` CLI is idempotent — running it when the queue is empty does nothing.

**Files**:
- `apps/api/README.md` — document the post-sync workflow

## System-Wide Impact

- **Interaction with dual-projection guardrail**: No change. `QueryService.getTransferDecision()` already handles non-default weights by computing dual projection maps (learned weights for gain, default weights for deterministic ranker). The internal trainer writes to the same registry the MCP tool uses — the serving path is identical.
- **MCP tools**: Unchanged. External trainers can still call `update_projection_weights` to overwrite the auto-trained model. The most recently activated version wins.
- **Version archaeology**: Multiple auto-trained versions accumulate in `ml_model_versions`. No unique constraint on `version_tag` — re-running for the same gameweek appends a new version (the previous one is deactivated). This is acceptable for an auto-trainer; the version history provides an audit trail.

## Acceptance Criteria

### Phase 0
- [ ] Training matrix SQL uses minute-weighted aggregation matching the live projection engine
- [ ] Regression test covers cameo bias scenario (5-min cameo with high xG doesn't dominate)

### Phase 1
- [ ] Ridge regression fits 7 coefficients from training matrix data
- [ ] Feature columns constructed in `projectFixturePoints()` coordinate system (positional point values applied)
- [ ] Coefficients clamped to `[0.1, 5.0]` with warning logged if clamped
- [ ] Training skipped with log message if < 100 training rows
- [ ] Lambda fixed at 1.0, stored in model metadata
- [ ] R-squared and training diagnostics stored in `metadata_json`
- [ ] No external ML dependencies — pure TypeScript matrix math

### Phase 2
- [ ] `npm run retrain:model` CLI command works with `--gameweek N`, `--all`, and no-flag (pending queue) modes
- [ ] Model version created with `activate: true` and descriptive version tag
- [ ] Pending ML evaluation queue cleared for trained gameweeks
- [ ] Arg parsing tests, core logic tests with seeded data, queue interaction tests

### Phase 3
- [ ] Post-sync workflow documented in README
- [ ] Running with empty queue is a clean no-op (no error, informative log)

## Dependencies & Risks

- **Risk**: Ridge regression with 7 features on early-season data (< 100 rows) could produce unreliable weights. **Mitigation**: minimum sample size guard, coefficient clamping, and the dual-projection guardrail in `QueryService`.
- **Risk**: Feature column construction diverges from `projectFixturePoints()` assumptions over time. **Mitigation**: Extract FPL positional point values into shared constants used by both the projection engine and the feature constructor.
- **Dependency**: Phase 0 (training matrix cameo fix) should land first to avoid training on biased data.

## Sources & References

### Internal References
- ML model registry: `apps/api/src/services/mlModelRegistryService.ts`
- Training matrix: `apps/api/src/services/trainingMatrixService.ts`
- Projection engine: `apps/api/src/services/queryService.ts:2265` (`projectFixturePoints`)
- Event weight loading: `apps/api/src/services/queryService.ts:1258` (`getActiveEventModelWeights`)
- CLI pattern: `apps/api/src/cli/seedPendingMlEvaluation.ts`
- Cameo fix learning: `docs/solutions/logic-errors/historical-replay-xpts-inflation-query-service-20260327.md`
- Prior ML plan (completed): `docs/plans/2026-03-26-003-feat-ml-transfer-engine-v2-revised-plan.md`
