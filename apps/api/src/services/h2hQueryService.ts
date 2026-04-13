import type {
  H2HAttributionBreakdown,
  GmRankHistory,
  H2HComparisonResponse,
  H2HLeagueStanding,
  H2HLuckVsSkill,
  H2HPositionalAudit,
  H2HPositionTrend,
  H2HPlayerRef,
  PlayerXpts,
  SquadOverlap,
} from "@fpl/contracts";
import type { AppDatabase } from "../db/database.js";

type RivalEntryRow = {
  entryId: number;
  playerName: string;
  teamName: string;
  rank: number;
  totalPoints: number;
};

type PickRow = {
  playerId: number;
};

type PlayerRefRow = {
  id: number;
  webName: string;
  teamShortName: string;
  nowCost: number;
  positionName: string;
};

type JoinedGameweekRow = {
  gameweek: number;
};

type TotalPointDeltaRow = {
  userTotalPoints: number;
  rivalTotalPoints: number;
};

type SyncStatusRow = {
  lastSyncedGw: number | null;
  fetchedAt: string | null;
};

type TotalRow = {
  total: number | null;
};

type PositionPointsRow = {
  positionName: string;
  totalPoints: number;
};

type PositionSpendRow = {
  positionName: string;
  spend: number;
};

function roundTo(value: number, digits: number) {
  return Number(value.toFixed(digits));
}

export class H2HQueryService {
  constructor(
    private readonly db: AppDatabase,
    private readonly getPlayerXptsForGameweek: (gameweek?: number) => PlayerXpts[] = () => [],
  ) {}

  getH2HComparison(
    accountId: number,
    leagueId: number,
    rivalEntryId: number,
  ): H2HComparisonResponse {
    const rivalEntry = this.db
      .prepare(
        `SELECT
           entry_id AS entryId,
           player_name AS playerName,
           team_name AS teamName,
           COALESCE(overall_rank, 0) AS rank,
           COALESCE(total_points, 0) AS totalPoints
         FROM rival_entries
         WHERE entry_id = ?`,
      )
      .get(rivalEntryId) as RivalEntryRow | undefined;

    const leagueMembership = this.db
      .prepare(
        `SELECT 1
         FROM rival_leagues
         WHERE league_id = ? AND account_id = ? AND league_type IN ('classic', 'h2h')
         LIMIT 1`,
      )
      .get(leagueId, accountId);

    const rivalHasData = this.db
      .prepare(
        `SELECT 1
         FROM rival_gameweeks
         WHERE entry_id = ?
         LIMIT 1`,
      )
      .get(rivalEntryId);

    const syncStatus = this.getSyncStatus(rivalEntryId);

    if (!leagueMembership || !rivalHasData) {
      return {
        syncRequired: true,
        rivalEntry: rivalEntry ? this.mapRivalEntry(rivalEntry) : null,
        squadOverlap: null,
        gmRankHistory: [],
        attribution: null,
        positionalAudit: null,
        luckVsSkill: null,
        syncStatus,
      };
    }

    const latestOverlapGameweek = this.db
      .prepare(
        `SELECT MAX(mp.gameweek_id) AS gameweek
         FROM my_team_picks mp
         INNER JOIN rival_picks rp
           ON rp.entry_id = @rivalEntryId
          AND rp.gameweek_id = mp.gameweek_id
         WHERE mp.account_id = @accountId`,
      )
      .get({ accountId, rivalEntryId }) as { gameweek: number | null };

    return {
      syncRequired: false,
      rivalEntry: rivalEntry ? this.mapRivalEntry(rivalEntry) : null,
      squadOverlap:
        latestOverlapGameweek.gameweek === null
          ? null
          : this.getSquadOverlap(accountId, rivalEntryId, latestOverlapGameweek.gameweek),
      gmRankHistory: this.getGmRankHistory(accountId, rivalEntryId),
      attribution: this.getAttribution(accountId, rivalEntryId),
      positionalAudit:
        latestOverlapGameweek.gameweek === null
          ? null
          : this.getPositionalAudit(accountId, rivalEntryId, latestOverlapGameweek.gameweek),
      luckVsSkill:
        latestOverlapGameweek.gameweek === null
          ? null
          : this.getLuckVsSkill(accountId, rivalEntryId),
      syncStatus,
    };
  }

  private getSquadOverlap(
    accountId: number,
    rivalEntryId: number,
    gameweek: number,
  ): SquadOverlap {
    const userPickRows = this.db
      .prepare(
        `SELECT player_id AS playerId
         FROM my_team_picks
         WHERE account_id = ? AND gameweek_id = ?
         ORDER BY position`,
      )
      .all(accountId, gameweek) as PickRow[];
    const rivalPickRows = this.db
      .prepare(
        `SELECT player_id AS playerId
         FROM rival_picks
         WHERE entry_id = ? AND gameweek_id = ?
         ORDER BY position`,
      )
      .all(rivalEntryId, gameweek) as PickRow[];

    const userPlayerIds = userPickRows.map((row) => row.playerId);
    const rivalPlayerIds = rivalPickRows.map((row) => row.playerId);
    const rivalSet = new Set(rivalPlayerIds);
    const userSet = new Set(userPlayerIds);

    const sharedIds = [...new Set(userPlayerIds.filter((playerId) => rivalSet.has(playerId)))];
    const userOnlyIds = [...new Set(userPlayerIds.filter((playerId) => !rivalSet.has(playerId)))];
    const rivalOnlyIds = [...new Set(rivalPlayerIds.filter((playerId) => !userSet.has(playerId)))];

    const comparisonBase = Math.max(userPlayerIds.length, rivalPlayerIds.length, 1);
    return {
      gameweek,
      overlapPct: Number(((sharedIds.length / comparisonBase) * 100).toFixed(1)),
      sharedPlayers: this.getPlayerRefs(sharedIds),
      userOnlyPlayers: this.getPlayerRefs(userOnlyIds),
      rivalOnlyPlayers: this.getPlayerRefs(rivalOnlyIds),
    };
  }

  private getGmRankHistory(accountId: number, rivalEntryId: number): GmRankHistory[] {
    return this.db
      .prepare(
        `SELECT
           mtg.gameweek_id AS gameweek,
           mtg.overall_rank AS userOverallRank,
           rg.overall_rank AS rivalOverallRank
         FROM my_team_gameweeks mtg
         INNER JOIN rival_gameweeks rg
           ON rg.entry_id = @rivalEntryId
          AND rg.gameweek_id = mtg.gameweek_id
         WHERE mtg.account_id = @accountId
         ORDER BY mtg.gameweek_id`,
      )
      .all({ accountId, rivalEntryId }) as GmRankHistory[];
  }

  private getPlayerRefs(playerIds: number[]): H2HPlayerRef[] {
    if (playerIds.length === 0) {
      return [];
    }

    const placeholders = playerIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT
           id,
           web_name AS webName,
           team_short_name AS teamShortName,
           now_cost AS nowCost,
           position_name AS positionName
         FROM (
           SELECT
             p.id,
             p.web_name,
             t.short_name AS team_short_name,
             p.now_cost,
             pos.name AS position_name
           FROM players p
           INNER JOIN teams t ON t.id = p.team_id
           INNER JOIN positions pos ON pos.id = p.position_id
         )
         WHERE id IN (${placeholders})`,
      )
      .all(...playerIds) as PlayerRefRow[];

    const byId = new Map(rows.map((row) => [row.id, row]));
    return playerIds
      .map((playerId) => byId.get(playerId))
      .filter((row): row is PlayerRefRow => Boolean(row))
      .map((row) => ({
        id: row.id,
        webName: row.webName,
        teamShortName: row.teamShortName,
        nowCost: row.nowCost,
        positionName: row.positionName,
      }));
  }

  private mapRivalEntry(row: RivalEntryRow): H2HLeagueStanding {
    return {
      entryId: row.entryId,
      playerName: row.playerName,
      teamName: row.teamName,
      rank: row.rank,
      totalPoints: row.totalPoints,
    };
  }

  private getComparedGameweeks(accountId: number, rivalEntryId: number) {
    return this.db
      .prepare(
        `SELECT mtg.gameweek_id AS gameweek
         FROM my_team_gameweeks mtg
         INNER JOIN rival_gameweeks rg
           ON rg.entry_id = @rivalEntryId
          AND rg.gameweek_id = mtg.gameweek_id
         WHERE mtg.account_id = @accountId
         ORDER BY mtg.gameweek_id`,
      )
      .all({ accountId, rivalEntryId }) as JoinedGameweekRow[];
  }

  private getAttribution(accountId: number, rivalEntryId: number): H2HAttributionBreakdown {
    const comparedGameweeks = this.getComparedGameweeks(accountId, rivalEntryId);
    const totalPointRow = this.db
      .prepare(
        `SELECT
           mtg.total_points AS userTotalPoints,
           rg.total_points AS rivalTotalPoints
         FROM my_team_gameweeks mtg
         INNER JOIN rival_gameweeks rg
           ON rg.entry_id = @rivalEntryId
          AND rg.gameweek_id = mtg.gameweek_id
         WHERE mtg.account_id = @accountId
         ORDER BY mtg.gameweek_id DESC
         LIMIT 1`,
      )
      .get({ accountId, rivalEntryId }) as TotalPointDeltaRow | undefined;

    const captaincyUser = this.getCaptaincyTotal("my_team_picks", "account_id", accountId, comparedGameweeks);
    const captaincyRival = this.getCaptaincyTotal("rival_picks", "entry_id", rivalEntryId, comparedGameweeks);
    const totalPointDelta = (totalPointRow?.userTotalPoints ?? 0) - (totalPointRow?.rivalTotalPoints ?? 0);
    const captaincyDelta = captaincyUser - captaincyRival;

    const userTransferNetImpact = this.getTransferNetImpact(accountId, rivalEntryId, "user", comparedGameweeks);
    const rivalTransferNetImpact = this.getTransferNetImpact(accountId, rivalEntryId, "rival", comparedGameweeks);
    const userHitCost = this.getHitCost(accountId, rivalEntryId, "user", comparedGameweeks);
    const rivalHitCost = this.getHitCost(accountId, rivalEntryId, "rival", comparedGameweeks);

    const userBench = this.getBenchPoints(accountId, rivalEntryId, "user", comparedGameweeks);
    const rivalBench = this.getBenchPoints(accountId, rivalEntryId, "rival", comparedGameweeks);

    return {
      totalPointDelta,
      captaincy: {
        userPoints: captaincyUser,
        rivalPoints: captaincyRival,
        delta: captaincyDelta,
        shareOfGap: totalPointDelta === 0 ? null : roundTo((captaincyDelta / totalPointDelta) * 100, 1),
      },
      transfers: {
        userHitCost,
        rivalHitCost,
        userNetImpact: userTransferNetImpact,
        rivalNetImpact: rivalTransferNetImpact,
        delta: userTransferNetImpact - rivalTransferNetImpact,
      },
      bench: {
        userPointsOnBench: userBench,
        rivalPointsOnBench: rivalBench,
        delta: rivalBench - userBench,
      },
    };
  }

  private getCaptaincyTotal(
    tableName: "my_team_picks" | "rival_picks",
    ownerColumn: "account_id" | "entry_id",
    ownerId: number,
    comparedGameweeks: JoinedGameweekRow[],
  ) {
    if (comparedGameweeks.length === 0) {
      return 0;
    }
    const placeholders = comparedGameweeks.map(() => "?").join(", ");
    const result = this.db
      .prepare(
        `SELECT SUM(gw_points * CASE WHEN multiplier > 1 THEN multiplier - 1 ELSE 0 END) AS total
         FROM ${tableName}
         WHERE ${ownerColumn} = ?
           AND gameweek_id IN (${placeholders})`,
      )
      .get(ownerId, ...comparedGameweeks.map((row) => row.gameweek)) as TotalRow;
    return result.total ?? 0;
  }

  private getTransferNetImpact(
    accountId: number,
    rivalEntryId: number,
    owner: "user" | "rival",
    comparedGameweeks: JoinedGameweekRow[],
  ) {
    const [tableName, ownerColumn, ownerId] =
      owner === "user"
        ? ["my_team_gameweeks", "account_id", accountId]
        : ["rival_gameweeks", "entry_id", rivalEntryId];
    if (comparedGameweeks.length === 0) {
      return 0;
    }
    const placeholders = comparedGameweeks.map(() => "?").join(", ");
    const result = this.db
      .prepare(
        `SELECT SUM(g.points - COALESCE(gw.average_entry_score, 0) - g.event_transfers_cost) AS total
         FROM ${tableName} g
         LEFT JOIN gameweeks gw ON gw.id = g.gameweek_id
         WHERE g.${ownerColumn} = ?
           AND g.gameweek_id IN (${placeholders})
           AND g.event_transfers > 0`,
      )
      .get(ownerId, ...comparedGameweeks.map((row) => row.gameweek)) as TotalRow;
    return result.total ?? 0;
  }

  private getHitCost(
    accountId: number,
    rivalEntryId: number,
    owner: "user" | "rival",
    comparedGameweeks: JoinedGameweekRow[],
  ) {
    const [tableName, ownerColumn, ownerId] =
      owner === "user"
        ? ["my_team_gameweeks", "account_id", accountId]
        : ["rival_gameweeks", "entry_id", rivalEntryId];
    if (comparedGameweeks.length === 0) {
      return 0;
    }
    const placeholders = comparedGameweeks.map(() => "?").join(", ");
    const result = this.db
      .prepare(
        `SELECT SUM(event_transfers_cost) AS total
         FROM ${tableName}
         WHERE ${ownerColumn} = ?
           AND gameweek_id IN (${placeholders})`,
      )
      .get(ownerId, ...comparedGameweeks.map((row) => row.gameweek)) as TotalRow;
    return result.total ?? 0;
  }

  private getBenchPoints(
    accountId: number,
    rivalEntryId: number,
    owner: "user" | "rival",
    comparedGameweeks: JoinedGameweekRow[],
  ) {
    const [tableName, ownerColumn, ownerId] =
      owner === "user"
        ? ["my_team_gameweeks", "account_id", accountId]
        : ["rival_gameweeks", "entry_id", rivalEntryId];
    if (comparedGameweeks.length === 0) {
      return 0;
    }
    const placeholders = comparedGameweeks.map(() => "?").join(", ");
    const result = this.db
      .prepare(
        `SELECT SUM(points_on_bench) AS total
         FROM ${tableName}
         WHERE ${ownerColumn} = ?
           AND gameweek_id IN (${placeholders})`,
      )
      .get(ownerId, ...comparedGameweeks.map((row) => row.gameweek)) as TotalRow;
    return result.total ?? 0;
  }

  private getPositionalAudit(
    accountId: number,
    rivalEntryId: number,
    latestGameweek: number,
  ): H2HPositionalAudit {
    const userPoints = this.getPositionPoints("my_team_picks", "account_id", accountId, accountId, rivalEntryId);
    const rivalPoints = this.getPositionPoints("rival_picks", "entry_id", rivalEntryId, accountId, rivalEntryId);
    const userSpend = this.getPositionSpend("my_team_picks", "account_id", accountId, latestGameweek);
    const rivalSpend = this.getPositionSpend("rival_picks", "entry_id", rivalEntryId, latestGameweek);
    const positionNames = ["Goalkeeper", "Defender", "Midfielder", "Forward"];

    return {
      rows: positionNames.map((positionName) => {
        const userPointTotal = userPoints.get(positionName) ?? 0;
        const rivalPointTotal = rivalPoints.get(positionName) ?? 0;
        const userSpendTotal = userSpend.get(positionName) ?? 0;
        const rivalSpendTotal = rivalSpend.get(positionName) ?? 0;
        const userValuePerMillion =
          userSpendTotal > 0 ? roundTo(userPointTotal / userSpendTotal, 2) : 0;
        const rivalValuePerMillion =
          rivalSpendTotal > 0 ? roundTo(rivalPointTotal / rivalSpendTotal, 2) : 0;
        const pointDelta = userPointTotal - rivalPointTotal;
        const valueDelta = roundTo(userValuePerMillion - rivalValuePerMillion, 2);

        return {
          positionName,
          userPoints: userPointTotal,
          rivalPoints: rivalPointTotal,
          pointDelta,
          userSpend: roundTo(userSpendTotal, 1),
          rivalSpend: roundTo(rivalSpendTotal, 1),
          userValuePerMillion,
          rivalValuePerMillion,
          valueDelta,
          trend: this.getPositionTrend(pointDelta, valueDelta),
        };
      }),
    };
  }

  private getPositionPoints(
    tableName: "my_team_picks" | "rival_picks",
    ownerColumn: "account_id" | "entry_id",
    ownerId: number,
    accountId: number,
    rivalEntryId: number,
  ) {
    const rows = this.getComparedGameweeks(accountId, rivalEntryId);
    if (rows.length === 0) {
      return new Map<string, number>();
    }
    const placeholders = rows.map(() => "?").join(", ");
    const result = this.db
      .prepare(
        `SELECT pos.name AS positionName, SUM(p.gw_points) AS totalPoints
         FROM ${tableName} p
         INNER JOIN players pl ON pl.id = p.player_id
         INNER JOIN positions pos ON pos.id = pl.position_id
         WHERE p.${ownerColumn} = ?
           AND p.gameweek_id IN (${placeholders})
           AND p.position <= 11
         GROUP BY pos.name
         ORDER BY pos.id`,
      )
      .all(ownerId, ...rows.map((row) => row.gameweek)) as PositionPointsRow[];
    return new Map(result.map((row) => [row.positionName, row.totalPoints]));
  }

  private getPositionSpend(
    tableName: "my_team_picks" | "rival_picks",
    ownerColumn: "account_id" | "entry_id",
    ownerId: number,
    gameweek: number,
  ) {
    const result = this.db
      .prepare(
        `SELECT pos.name AS positionName, SUM(pl.now_cost) / 10.0 AS spend
         FROM ${tableName} p
         INNER JOIN players pl ON pl.id = p.player_id
         INNER JOIN positions pos ON pos.id = pl.position_id
         WHERE p.${ownerColumn} = ?
           AND p.gameweek_id = ?
           AND p.position <= 11
         GROUP BY pos.name
         ORDER BY pos.id`,
      )
      .all(ownerId, gameweek) as PositionSpendRow[];
    return new Map(result.map((row) => [row.positionName, row.spend]));
  }

  private getPositionTrend(pointDelta: number, valueDelta: number): H2HPositionTrend {
    if (pointDelta <= -3) {
      return "trail";
    }
    if (pointDelta >= 3) {
      return "lead";
    }
    if (valueDelta <= -0.15) {
      return "trail";
    }
    if (valueDelta >= 0.15) {
      return "lead";
    }
    return "level";
  }

  private getLuckVsSkill(accountId: number, rivalEntryId: number): H2HLuckVsSkill {
    const syncStatus = this.getSyncStatus(rivalEntryId);
    const currentGameweek = syncStatus.currentGameweek;
    if (!currentGameweek) {
      return {
        basedOnGameweek: 0,
        actualDelta: 0,
        expectedDelta: null,
        userActualPoints: 0,
        rivalActualPoints: 0,
        userExpectedPoints: null,
        rivalExpectedPoints: null,
        userVariance: null,
        rivalVariance: null,
        varianceEdge: null,
        verdict: "insufficient_data",
        dataQuality: "insufficient",
        missingPlayerProjections: 0,
      };
    }

    const xptsRows = this.getPlayerXptsForGameweek(currentGameweek);
    const xptsMap = new Map(xptsRows.map((row) => [row.playerId, row.xpts]));
    const userExpected = this.sumProjectedPoints("my_team_picks", "account_id", accountId, syncStatus.lastSyncedGw, xptsMap);
    const rivalExpected = this.sumProjectedPoints("rival_picks", "entry_id", rivalEntryId, syncStatus.lastSyncedGw, xptsMap);
    const currentActual = this.db
      .prepare(
        `SELECT
           mtg.total_points AS userTotalPoints,
           rg.total_points AS rivalTotalPoints
         FROM my_team_gameweeks mtg
         INNER JOIN rival_gameweeks rg
           ON rg.entry_id = @rivalEntryId
          AND rg.gameweek_id = mtg.gameweek_id
         WHERE mtg.account_id = @accountId
         ORDER BY mtg.gameweek_id DESC
         LIMIT 1`,
      )
      .get({ accountId, rivalEntryId }) as TotalPointDeltaRow | undefined;

    const userActualPoints = currentActual?.userTotalPoints ?? 0;
    const rivalActualPoints = currentActual?.rivalTotalPoints ?? 0;
    const actualDelta = userActualPoints - rivalActualPoints;
    const expectedDelta =
      userExpected.total !== null && rivalExpected.total !== null
        ? roundTo(userExpected.total - rivalExpected.total, 1)
        : null;
    const userVariance =
      userExpected.total !== null ? roundTo(userActualPoints - userExpected.total, 1) : null;
    const rivalVariance =
      rivalExpected.total !== null ? roundTo(rivalActualPoints - rivalExpected.total, 1) : null;
    const varianceEdge =
      userVariance !== null && rivalVariance !== null
        ? roundTo(rivalVariance - userVariance, 1)
        : null;
    const missingPlayerProjections = userExpected.missing + rivalExpected.missing;

    return {
      basedOnGameweek: currentGameweek,
      actualDelta,
      expectedDelta,
      userActualPoints,
      rivalActualPoints,
      userExpectedPoints: userExpected.total,
      rivalExpectedPoints: rivalExpected.total,
      userVariance,
      rivalVariance,
      varianceEdge,
      verdict: this.getLuckVerdict(varianceEdge, missingPlayerProjections),
      dataQuality:
        missingPlayerProjections === 0
          ? "full"
          : missingPlayerProjections >= 8
            ? "insufficient"
            : "partial",
      missingPlayerProjections,
    };
  }

  private sumProjectedPoints(
    tableName: "my_team_picks" | "rival_picks",
    ownerColumn: "account_id" | "entry_id",
    ownerId: number,
    gameweek: number | null,
    xptsMap: Map<number, number | null>,
  ) {
    if (!gameweek) {
      return { total: null as number | null, missing: 0 };
    }

    const rows = this.db
      .prepare(
        `SELECT player_id AS playerId, multiplier
         FROM ${tableName}
         WHERE ${ownerColumn} = ?
           AND gameweek_id = ?
           AND position <= 11`,
      )
      .all(ownerId, gameweek) as Array<{ playerId: number; multiplier: number }>;

    let total = 0;
    let missing = 0;
    for (const row of rows) {
      const xpts = xptsMap.get(row.playerId);
      if (xpts === null || xpts === undefined) {
        missing += 1;
        continue;
      }
      total += xpts * Math.max(row.multiplier, 1);
    }

    return {
      total: rows.length === missing ? null : roundTo(total, 1),
      missing,
    };
  }

  private getLuckVerdict(varianceEdge: number | null, missingPlayerProjections: number) {
    if (varianceEdge === null || missingPlayerProjections >= 8) {
      return "insufficient_data" as const;
    }
    if (varianceEdge >= 5) {
      return "rival_running_hot" as const;
    }
    if (varianceEdge <= -5) {
      return "user_running_hot" as const;
    }
    return "balanced" as const;
  }

  private getSyncStatus(rivalEntryId: number) {
    const statusRow = this.db
      .prepare(
        `SELECT last_synced_gw AS lastSyncedGw, fetched_at AS fetchedAt
         FROM rival_entries
         WHERE entry_id = ?`,
      )
      .get(rivalEntryId) as SyncStatusRow | undefined;
    const currentGw = this.db
      .prepare(`SELECT id FROM gameweeks WHERE is_current = 1 ORDER BY id LIMIT 1`)
      .get() as { id: number } | undefined;

    return {
      currentGameweek: currentGw?.id ?? null,
      lastSyncedGw: statusRow?.lastSyncedGw ?? null,
      stale:
        statusRow?.lastSyncedGw !== null &&
        statusRow?.lastSyncedGw !== undefined &&
        currentGw?.id !== undefined &&
        statusRow.lastSyncedGw < currentGw.id,
      fetchedAt: statusRow?.fetchedAt ?? null,
    };
  }
}
