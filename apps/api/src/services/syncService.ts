import type { AppDatabase } from "../db/database.js";
import type {
  BootstrapResponse,
  ElementSummaryResponse,
  FixturesResponse,
} from "../client/fplApiClient.js";
import { FplApiClient } from "../client/fplApiClient.js";
import { createHash } from "node:crypto";
import { AssetSyncService } from "./assetSyncService.js";

type SyncLogger = {
  info(message: string): void;
  error(message: string): void;
};

function now() {
  return new Date().toISOString();
}

function toSqliteBoolean(value: boolean | null | undefined) {
  return Number(Boolean(value));
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function calculateExpectedGoalPerformance(
  goalsScored: number,
  expectedGoals: number,
) {
  return goalsScored - expectedGoals;
}

function calculateExpectedAssistPerformance(
  assists: number,
  expectedAssists: number,
) {
  return assists - expectedAssists;
}

function calculateExpectedGoalInvolvementPerformance(
  expectedGoalPerformance: number,
  expectedAssistPerformance: number,
) {
  return expectedGoalPerformance + expectedAssistPerformance;
}

export class SyncService {
  constructor(
    private readonly db: AppDatabase,
    private readonly client = new FplApiClient(),
    private readonly logger?: SyncLogger,
    private readonly assetSyncService = new AssetSyncService(db),
  ) {}

  private logInfo(message: string) {
    this.logger?.info(message);
  }

  private logError(message: string) {
    this.logger?.error(message);
  }

  private startRun() {
    const startedAt = now();
    const result = this.db
      .prepare(
        "INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')",
      )
      .run(startedAt);
    return Number(result.lastInsertRowid);
  }

  private finishRun(runId: number, status: "success" | "failed", error?: string) {
    this.db
      .prepare(
        `UPDATE sync_runs
         SET finished_at = ?, status = ?, error_message = ?
         WHERE id = ?`,
      )
      .run(now(), status, error ?? null, runId);
  }

  private getSyncState(key: string) {
    const row = this.db
      .prepare("SELECT value FROM sync_state WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setSyncState(key: string, value: string) {
    this.db
      .prepare(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, value, now());
  }

  private buildSnapshot(parts: unknown[]) {
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  }

  private computeFullSnapshot(
    bootstrap: BootstrapResponse,
    fixtures: FixturesResponse,
  ) {
    return this.buildSnapshot([bootstrap.elements, fixtures]);
  }

  private computeGameweekSnapshot(
    bootstrap: BootstrapResponse,
    fixtures: FixturesResponse,
    gameweekId: number,
  ) {
    const gameweekFixtures = fixtures.filter((fixture) => fixture.event === gameweekId);
    const teamIds = new Set(
      gameweekFixtures.flatMap((fixture) => [fixture.team_h, fixture.team_a]),
    );
    const gameweekPlayers = bootstrap.elements.filter((player) =>
      teamIds.has(player.team),
    );
    return this.buildSnapshot([gameweekId, gameweekFixtures, gameweekPlayers]);
  }

  async syncGameweek(gameweekId: number, force = false) {
    const runId = this.startRun();
    this.logInfo(`[run ${runId}] Starting targeted sync for gameweek ${gameweekId}.`);

    try {
      this.logInfo(`[run ${runId}] Fetching bootstrap data from FPL.`);
      const bootstrap = await this.client.getBootstrap();
      this.syncBootstrap(bootstrap);
      const assetResult = await this.assetSyncService.syncBootstrapAssets(
        bootstrap,
        force,
      );
      this.logInfo(
        `[run ${runId}] Bootstrap synced: ${bootstrap.events.length} gameweeks, ${bootstrap.teams.length} teams, ${bootstrap.elements.length} players.`,
      );
      this.logInfo(
        `[run ${runId}] Assets synced: ${assetResult.playersDownloaded} player images downloaded, ${assetResult.teamsDownloaded} team images downloaded, ${assetResult.playerPlaceholdersGenerated} player placeholders generated, ${assetResult.teamPlaceholdersGenerated} team placeholders generated, ${assetResult.playersSkipped + assetResult.teamsSkipped} skipped.`,
      );

      this.logInfo(`[run ${runId}] Fetching fixtures from FPL.`);
      const fixtures = await this.client.getFixtures();
      this.syncFixtures(fixtures);
      this.logInfo(`[run ${runId}] Fixtures synced: ${fixtures.length} rows.`);

      const playerIds = this.getPlayerIdsForGameweek(gameweekId);
      this.logInfo(
        `[run ${runId}] Found ${playerIds.length} players attached to gameweek ${gameweekId}.`,
      );
      const snapshot = force
        ? `${this.computeGameweekSnapshot(bootstrap, fixtures, gameweekId)}:force:${now()}`
        : this.computeGameweekSnapshot(bootstrap, fixtures, gameweekId);
      this.prepareGameweekRefresh(gameweekId, playerIds, snapshot, force);
      const pendingPlayerIds = this.getPendingPlayerIdsForGameweek(
        gameweekId,
        snapshot,
      );
      this.logInfo(
        `[run ${runId}] ${pendingPlayerIds.length} player summaries need refresh for gameweek ${gameweekId}.`,
      );

      await this.syncPlayerSummaries(pendingPlayerIds, runId, snapshot, gameweekId);

      this.finishRun(runId, "success");
      this.logInfo(
        `[run ${runId}] Gameweek ${gameweekId} sync finished successfully. Refreshed ${pendingPlayerIds.length} player summaries.`,
      );
      return { runId, syncedPlayers: pendingPlayerIds.length, gameweekId };
    } catch (error) {
      this.finishRun(
        runId,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
      this.logError(
        `[run ${runId}] Gameweek ${gameweekId} sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async syncAll(force = false) {
    const runId = this.startRun();
    this.logInfo(`[run ${runId}] Starting full sync.`);

    try {
      this.logInfo(`[run ${runId}] Fetching bootstrap data from FPL.`);
      const bootstrap = await this.client.getBootstrap();
      this.syncBootstrap(bootstrap);
      const assetResult = await this.assetSyncService.syncBootstrapAssets(
        bootstrap,
        force,
      );
      this.logInfo(
        `[run ${runId}] Bootstrap synced: ${bootstrap.events.length} gameweeks, ${bootstrap.teams.length} teams, ${bootstrap.elements.length} players.`,
      );
      this.logInfo(
        `[run ${runId}] Assets synced: ${assetResult.playersDownloaded} player images downloaded, ${assetResult.teamsDownloaded} team images downloaded, ${assetResult.playerPlaceholdersGenerated} player placeholders generated, ${assetResult.teamPlaceholdersGenerated} team placeholders generated, ${assetResult.playersSkipped + assetResult.teamsSkipped} skipped.`,
      );

      this.logInfo(`[run ${runId}] Fetching fixtures from FPL.`);
      const fixtures = await this.client.getFixtures();
      this.syncFixtures(fixtures);
      this.logInfo(`[run ${runId}] Fixtures synced: ${fixtures.length} rows.`);

      const snapshot = force
        ? `${this.computeFullSnapshot(bootstrap, fixtures)}:force:${now()}`
        : this.computeFullSnapshot(bootstrap, fixtures);
      const playerIds = bootstrap.elements.map((player) => player.id);
      this.prepareFullRefresh(playerIds, snapshot, force);
      const pendingPlayerIds = this.getPendingPlayerIds(snapshot);
      this.logInfo(
        `[run ${runId}] ${pendingPlayerIds.length} player summaries need refresh for the full dataset.`,
      );

      await this.syncPlayerSummaries(pendingPlayerIds, runId, snapshot);

      this.finishRun(runId, "success");
      this.logInfo(
        `[run ${runId}] Full sync finished successfully. Refreshed ${pendingPlayerIds.length} player summaries.`,
      );
      return { runId, syncedPlayers: pendingPlayerIds.length };
    } catch (error) {
      this.finishRun(
        runId,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
      this.logError(
        `[run ${runId}] Full sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async syncPlayerSummaries(
    playerIds: number[],
    runId: number,
    snapshot: string,
    gameweekId?: number,
  ) {
    const total = playerIds.length;
    if (total === 0) {
      this.logInfo(`[run ${runId}] No player summaries needed refresh.`);
      return;
    }

    for (const [index, playerId] of playerIds.entries()) {
      const position = index + 1;
      this.logInfo(
        `[run ${runId}] Refreshing player ${playerId} (${position}/${total})${gameweekId ? ` for gameweek ${gameweekId}` : ""}.`,
      );
      const startedAt = Date.now();
      try {
        const summary = await this.client.getElementSummary(playerId);
        this.syncPlayerSummary(playerId, summary, snapshot, gameweekId);
        const durationMs = Date.now() - startedAt;
        if (position === total || position === 1 || position % 25 === 0) {
          this.logInfo(
            `[run ${runId}] Completed player ${playerId} (${position}/${total}) in ${durationMs}ms.`,
          );
        }
      } catch (error) {
        this.logError(
          `[run ${runId}] Failed player ${playerId} (${position}/${total}): ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    }
  }

  syncBootstrap(bootstrap: BootstrapResponse) {
    const updatedAt = now();
    const insertGameweek = this.db.prepare(
      `INSERT INTO gameweeks (id, name, deadline_time, average_entry_score, highest_score, is_current, is_finished, updated_at)
       VALUES (@id, @name, @deadline_time, @average_entry_score, @highest_score, @is_current, @is_finished, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         deadline_time = excluded.deadline_time,
         average_entry_score = excluded.average_entry_score,
         highest_score = excluded.highest_score,
         is_current = excluded.is_current,
         is_finished = excluded.is_finished,
         updated_at = excluded.updated_at`,
    );
    const insertTeam = this.db.prepare(
      `INSERT INTO teams (id, code, name, short_name, strength, updated_at)
       VALUES (@id, @code, @name, @short_name, @strength, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code,
         name = excluded.name,
         short_name = excluded.short_name,
         strength = excluded.strength,
         updated_at = excluded.updated_at`,
    );
    const insertPosition = this.db.prepare(
      `INSERT INTO positions (id, name, short_name, updated_at)
       VALUES (@id, @name, @short_name, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         short_name = excluded.short_name,
         updated_at = excluded.updated_at`,
    );
    const insertPlayer = this.db.prepare(
      `INSERT INTO players (id, code, web_name, first_name, second_name, team_id, position_id, now_cost, total_points, form, selected_by_percent, points_per_game, goals_scored, assists, clean_sheets, minutes, bonus, bps, creativity, influence, threat, ict_index, expected_goals, expected_assists, expected_goal_involvements, expected_goal_performance, expected_assist_performance, expected_goal_involvement_performance, expected_goals_conceded, clean_sheets_per_90, starts, tackles, recoveries, defensive_contribution, photo, team_code, status, updated_at)
       VALUES (@id, @code, @web_name, @first_name, @second_name, @team_id, @position_id, @now_cost, @total_points, @form, @selected_by_percent, @points_per_game, @goals_scored, @assists, @clean_sheets, @minutes, @bonus, @bps, @creativity, @influence, @threat, @ict_index, @expected_goals, @expected_assists, @expected_goal_involvements, @expected_goal_performance, @expected_assist_performance, @expected_goal_involvement_performance, @expected_goals_conceded, @clean_sheets_per_90, @starts, @tackles, @recoveries, @defensive_contribution, @photo, @team_code, @status, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code,
         web_name = excluded.web_name,
         first_name = excluded.first_name,
         second_name = excluded.second_name,
         team_id = excluded.team_id,
         position_id = excluded.position_id,
         now_cost = excluded.now_cost,
         total_points = excluded.total_points,
         form = excluded.form,
         selected_by_percent = excluded.selected_by_percent,
         points_per_game = excluded.points_per_game,
         goals_scored = excluded.goals_scored,
         assists = excluded.assists,
         clean_sheets = excluded.clean_sheets,
         minutes = excluded.minutes,
         bonus = excluded.bonus,
         bps = excluded.bps,
         creativity = excluded.creativity,
         influence = excluded.influence,
         threat = excluded.threat,
         ict_index = excluded.ict_index,
         expected_goals = excluded.expected_goals,
         expected_assists = excluded.expected_assists,
         expected_goal_involvements = excluded.expected_goal_involvements,
         expected_goal_performance = excluded.expected_goal_performance,
         expected_assist_performance = excluded.expected_assist_performance,
         expected_goal_involvement_performance = excluded.expected_goal_involvement_performance,
         expected_goals_conceded = excluded.expected_goals_conceded,
         clean_sheets_per_90 = excluded.clean_sheets_per_90,
         starts = excluded.starts,
         tackles = excluded.tackles,
         recoveries = excluded.recoveries,
         defensive_contribution = excluded.defensive_contribution,
         photo = excluded.photo,
         team_code = excluded.team_code,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    );
    const insertPlayerSyncStatus = this.db.prepare(
      `INSERT INTO player_sync_status (player_id, bootstrap_updated_at, synced_at, last_error)
       VALUES (@player_id, @bootstrap_updated_at, NULL, NULL)
       ON CONFLICT(player_id) DO UPDATE SET
         bootstrap_updated_at = excluded.bootstrap_updated_at`,
    );

    const tx = this.db.transaction(() => {
      for (const event of bootstrap.events) {
        insertGameweek.run({
          ...event,
          average_entry_score: event.average_entry_score,
          highest_score: event.highest_score,
          is_current: Number(event.is_current),
          is_finished: Number(event.finished),
          updated_at: updatedAt,
        });
      }

      for (const team of bootstrap.teams) {
        insertTeam.run({
          id: team.id,
          code: team.code,
          name: team.name,
          short_name: team.short_name,
          strength: team.strength,
          updated_at: updatedAt,
        });
      }

      for (const position of bootstrap.element_types) {
        insertPosition.run({
          id: position.id,
          name: position.singular_name,
          short_name: position.singular_name_short,
          updated_at: updatedAt,
        });
      }

      for (const player of bootstrap.elements) {
        const expectedGoals = toNumber(player.expected_goals);
        const expectedAssists = toNumber(player.expected_assists);
        const expectedGoalPerformance = calculateExpectedGoalPerformance(
          player.goals_scored,
          expectedGoals,
        );
        const expectedAssistPerformance = calculateExpectedAssistPerformance(
          player.assists,
          expectedAssists,
        );
        insertPlayer.run({
          id: player.id,
          code: player.code,
          web_name: player.web_name,
          first_name: player.first_name,
          second_name: player.second_name,
          team_id: player.team,
          position_id: player.element_type,
          now_cost: player.now_cost,
          total_points: player.total_points,
          form: Number(player.form),
          selected_by_percent: Number(player.selected_by_percent),
          points_per_game: Number(player.points_per_game),
          goals_scored: player.goals_scored,
          assists: player.assists,
          clean_sheets: player.clean_sheets,
          minutes: player.minutes,
          bonus: player.bonus,
          bps: player.bps,
          creativity: toNumber(player.creativity),
          influence: toNumber(player.influence),
          threat: toNumber(player.threat),
          ict_index: toNumber(player.ict_index),
          expected_goals: expectedGoals,
          expected_assists: expectedAssists,
          expected_goal_involvements: toNumber(player.expected_goal_involvements),
          expected_goal_performance: expectedGoalPerformance,
          expected_assist_performance: expectedAssistPerformance,
          expected_goal_involvement_performance:
            calculateExpectedGoalInvolvementPerformance(
              expectedGoalPerformance,
              expectedAssistPerformance,
            ),
          expected_goals_conceded: toNumber(player.expected_goals_conceded),
          clean_sheets_per_90: toNumber(player.clean_sheets_per_90),
          starts: player.starts,
          tackles: player.tackles,
          recoveries: player.recoveries,
          defensive_contribution: player.defensive_contribution,
          photo: player.photo,
          team_code: player.team_code,
          status: player.status,
          updated_at: updatedAt,
        });
        insertPlayerSyncStatus.run({
          player_id: player.id,
          bootstrap_updated_at: updatedAt,
        });
      }
    });

    tx();
  }

  syncFixtures(fixtures: FixturesResponse) {
    const updatedAt = now();
    const statement = this.db.prepare(
      `INSERT INTO fixtures (id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (@id, @code, @event_id, @kickoff_time, @team_h, @team_a, @team_h_score, @team_a_score, @finished, @started, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code,
         event_id = excluded.event_id,
         kickoff_time = excluded.kickoff_time,
         team_h = excluded.team_h,
         team_a = excluded.team_a,
         team_h_score = excluded.team_h_score,
         team_a_score = excluded.team_a_score,
         finished = excluded.finished,
         started = excluded.started,
         updated_at = excluded.updated_at`,
    );

    const tx = this.db.transaction(() => {
      for (const fixture of fixtures) {
        statement.run({
          id: fixture.id,
          code: fixture.code,
          event_id: fixture.event,
          kickoff_time: fixture.kickoff_time,
          team_h: fixture.team_h,
          team_a: fixture.team_a,
          team_h_score: fixture.team_h_score,
          team_a_score: fixture.team_a_score,
          finished: toSqliteBoolean(fixture.finished),
          started: toSqliteBoolean(fixture.started),
          updated_at: updatedAt,
        });
      }
    });

    tx();
  }

  prepareFullRefresh(playerIds: number[], snapshot: string, force: boolean) {
    const currentSnapshot = this.getSyncState("full_snapshot");
    const shouldQueue = force || currentSnapshot !== snapshot;
    if (shouldQueue) {
      const statement = this.db.prepare(
        `INSERT INTO player_sync_status (
           player_id, bootstrap_updated_at, synced_at, last_error, requested_snapshot, completed_snapshot
         )
         VALUES (?, ?, NULL, NULL, ?, NULL)
         ON CONFLICT(player_id) DO UPDATE SET
           requested_snapshot = excluded.requested_snapshot,
           last_error = NULL`,
      );
      const requestedAt = now();
      const tx = this.db.transaction(() => {
        for (const playerId of playerIds) {
          statement.run(playerId, requestedAt, snapshot);
        }
      });
      tx();
      this.setSyncState("full_snapshot", snapshot);
    }
  }

  getPendingPlayerIds(snapshot: string): number[] {
    return this.db
      .prepare(
        `SELECT player_id
         FROM player_sync_status
         WHERE requested_snapshot = ?
           AND (
             completed_snapshot IS NULL
             OR completed_snapshot != requested_snapshot
             OR last_error IS NOT NULL
           )
         ORDER BY player_id`,
      )
      .all(snapshot)
      .map((row: any) => row.player_id as number);
  }

  getPlayerIdsForGameweek(gameweekId: number): number[] {
    return this.db
      .prepare(
        `SELECT DISTINCT p.id
         FROM players p
         JOIN fixtures f ON f.event_id = ?
         WHERE p.team_id = f.team_h OR p.team_id = f.team_a
         ORDER BY p.id`,
      )
      .all(gameweekId)
      .map((row: any) => row.id as number);
  }

  prepareGameweekRefresh(
    gameweekId: number,
    playerIds: number[],
    snapshot: string,
    force: boolean,
  ) {
    const stateKey = `gameweek_snapshot:${gameweekId}`;
    const currentSnapshot = this.getSyncState(stateKey);
    const shouldQueue = force || currentSnapshot !== snapshot;
    if (!shouldQueue) {
      return;
    }

    const statement = this.db.prepare(
      `INSERT INTO gameweek_player_sync_status (
         gameweek_id, player_id, synced_at, last_error, requested_snapshot, completed_snapshot
       )
       VALUES (?, ?, NULL, NULL, ?, NULL)
       ON CONFLICT(gameweek_id, player_id) DO UPDATE SET
         requested_snapshot = excluded.requested_snapshot,
         last_error = NULL`,
    );

    const tx = this.db.transaction(() => {
      for (const playerId of playerIds) {
        statement.run(gameweekId, playerId, snapshot);
      }
    });

    tx();
    this.setSyncState(stateKey, snapshot);
  }

  getPendingPlayerIdsForGameweek(gameweekId: number, snapshot: string): number[] {
    return this.db
      .prepare(
        `SELECT player_id
         FROM gameweek_player_sync_status
         WHERE gameweek_id = ?
           AND requested_snapshot = ?
           AND (
             completed_snapshot IS NULL
             OR completed_snapshot != requested_snapshot
             OR last_error IS NOT NULL
           )
         ORDER BY player_id`,
      )
      .all(gameweekId, snapshot)
      .map((row: any) => row.player_id as number);
  }

  syncPlayerSummary(
    playerId: number,
    summary: ElementSummaryResponse,
    snapshot: string,
    gameweekId?: number,
  ) {
    const updatedAt = now();
    const clearHistory = this.db.prepare(
      "DELETE FROM player_history WHERE player_id = ?",
    );
    const clearFutureFixtures = this.db.prepare(
      "DELETE FROM player_future_fixtures WHERE player_id = ?",
    );
    const insertHistory = this.db.prepare(
      `INSERT INTO player_history (player_id, round, total_points, minutes, goals_scored, assists, clean_sheets, bonus, bps, creativity, influence, threat, ict_index, expected_goals, expected_assists, expected_goal_involvements, expected_goal_performance, expected_assist_performance, expected_goal_involvement_performance, expected_goals_conceded, tackles, recoveries, clearances_blocks_interceptions, defensive_contribution, starts, opponent_team, value, was_home, kickoff_time, updated_at)
       VALUES (@player_id, @round, @total_points, @minutes, @goals_scored, @assists, @clean_sheets, @bonus, @bps, @creativity, @influence, @threat, @ict_index, @expected_goals, @expected_assists, @expected_goal_involvements, @expected_goal_performance, @expected_assist_performance, @expected_goal_involvement_performance, @expected_goals_conceded, @tackles, @recoveries, @clearances_blocks_interceptions, @defensive_contribution, @starts, @opponent_team, @value, @was_home, @kickoff_time, @updated_at)`,
    );
    const insertFutureFixture = this.db.prepare(
      `INSERT INTO player_future_fixtures (player_id, fixture_id, code, event_id, kickoff_time, team_h, team_a, team_h_score, team_a_score, finished, started, updated_at)
       VALUES (@player_id, @fixture_id, @code, @event_id, @kickoff_time, @team_h, @team_a, @team_h_score, @team_a_score, @finished, @started, @updated_at)`,
    );
    const markSuccess = this.db.prepare(
      `UPDATE player_sync_status
       SET synced_at = ?, last_error = NULL, completed_snapshot = ?
       WHERE player_id = ?`,
    );
    const markFailure = this.db.prepare(
      "UPDATE player_sync_status SET last_error = ? WHERE player_id = ?",
    );
    const markGameweekSuccess = this.db.prepare(
      `UPDATE gameweek_player_sync_status
       SET synced_at = ?, last_error = NULL, completed_snapshot = ?
       WHERE gameweek_id = ? AND player_id = ?`,
    );
    const markGameweekFailure = this.db.prepare(
      `UPDATE gameweek_player_sync_status
       SET last_error = ?
       WHERE gameweek_id = ? AND player_id = ?`,
    );

    try {
      const tx = this.db.transaction(() => {
        clearHistory.run(playerId);
        clearFutureFixtures.run(playerId);

        for (const history of summary.history) {
          const expectedGoals = toNumber(history.expected_goals);
          const expectedAssists = toNumber(history.expected_assists);
          const expectedGoalPerformance = calculateExpectedGoalPerformance(
            history.goals_scored,
            expectedGoals,
          );
          const expectedAssistPerformance = calculateExpectedAssistPerformance(
            history.assists,
            expectedAssists,
          );
          insertHistory.run({
            player_id: playerId,
            round: history.round,
            total_points: history.total_points,
            minutes: history.minutes,
            goals_scored: history.goals_scored,
            assists: history.assists,
            clean_sheets: history.clean_sheets,
            bonus: history.bonus,
            bps: history.bps,
            creativity: toNumber(history.creativity),
            influence: toNumber(history.influence),
            threat: toNumber(history.threat),
            ict_index: toNumber(history.ict_index),
            expected_goals: expectedGoals,
            expected_assists: expectedAssists,
            expected_goal_involvements: toNumber(history.expected_goal_involvements),
            expected_goal_performance: expectedGoalPerformance,
            expected_assist_performance: expectedAssistPerformance,
            expected_goal_involvement_performance:
              calculateExpectedGoalInvolvementPerformance(
                expectedGoalPerformance,
                expectedAssistPerformance,
              ),
            expected_goals_conceded: toNumber(history.expected_goals_conceded),
            tackles: history.tackles,
            recoveries: history.recoveries,
            clearances_blocks_interceptions: history.clearances_blocks_interceptions,
            defensive_contribution: history.defensive_contribution,
            starts: history.starts,
            opponent_team: history.opponent_team,
            value: history.value,
            was_home: Number(history.was_home),
            kickoff_time: history.kickoff_time,
            updated_at: updatedAt,
          });
        }

        for (const fixture of summary.fixtures) {
          insertFutureFixture.run({
            player_id: playerId,
            fixture_id: fixture.id,
            code: fixture.code,
            event_id: fixture.event,
            kickoff_time: fixture.kickoff_time,
            team_h: fixture.team_h,
            team_a: fixture.team_a,
            team_h_score: fixture.team_h_score,
            team_a_score: fixture.team_a_score,
            finished: toSqliteBoolean(fixture.finished),
            started: toSqliteBoolean(fixture.started),
            updated_at: updatedAt,
          });
        }

        markSuccess.run(updatedAt, snapshot, playerId);
        if (gameweekId !== undefined) {
          markGameweekSuccess.run(updatedAt, snapshot, gameweekId, playerId);
        }
      });

      tx();
    } catch (error) {
      markFailure.run(error instanceof Error ? error.message : String(error), playerId);
      if (gameweekId !== undefined) {
        markGameweekFailure.run(
          error instanceof Error ? error.message : String(error),
          gameweekId,
          playerId,
        );
      }
      throw error;
    }
  }
}
