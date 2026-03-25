import type {
  CaptainRecommendation,
  FdrRow,
  FixtureCard,
  GameweekSummary,
  GwCalendarFixture,
  GwCalendarRow,
  MyTeamAccountSummary,
  MyTeamGameweekPicksResponse,
  MyTeamHistoryRow,
  MyTeamPageResponse,
  MyTeamPick,
  MyTeamSeasonSummary,
  MyTeamTransfer,
  OverviewResponse,
  PlayerCard,
  PlayerDetail,
  PlayerHistoryPoint,
  PlayerXpts,
  TeamSummary,
  TransferDecisionHorizon,
  TransferDecisionOption,
  TransferDecisionResponse,
} from "@fpl/contracts";
import type { AppDatabase } from "../db/database.js";

type PlayerQuery = {
  search?: string;
  team?: number;
  position?: number;
  sort?: string;
  fromGW?: number;
  toGW?: number;
};

type PlayerCardRow = PlayerCard;
type GameweekRow = Omit<GameweekSummary, "isCurrent" | "isFinished"> & {
  isCurrent: number;
  isFinished: number;
};
type FixtureRow = Omit<FixtureCard, "finished" | "started"> & {
  finished: number;
  started: number;
};
type PlayerHistoryRow = Omit<PlayerHistoryPoint, "wasHome"> & {
  wasHome: number;
};
type MyTeamPickRow = PlayerCardRow & {
  slotId: string;
  position: number;
  multiplier: number;
  isCaptain: number;
  isViceCaptain: number;
  sellingPrice: number;
  purchasePrice: number;
  role: MyTeamPick["role"];
  benchOrder: number | null;
  gwPoints?: number;
};
type PlayerTransferPrefix = "playerIn" | "playerOut";
type PlayerTransferRow = {
  id: string;
  gameweek: number;
  madeAt: string;
  hitCost: number | null;
} & Record<string, PlayerCard[keyof PlayerCard]>;

type RecentPlayerStats = {
  playerId: number;
  avgXg: number;
  avgXa: number;
  avgMinutes: number;
  avgBonus: number;
  avgXgc: number;
  avgSaves: number;
  gwCount: number;
};

type TransferProjectionPlayerRow = {
  id: number;
  webName: string;
  teamId: number;
  teamShortName: string;
  positionId: number;
  positionName: string;
  nowCost: number;
  status: string;
};

type TeamUpcomingFixture = {
  teamId: number;
  gameweek: number;
  opponentId: number;
  opponentShort: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  isHome: boolean;
};

type PlayerProjection = {
  playerId: number;
  playerName: string;
  teamId: number;
  teamShortName: string;
  positionId: number;
  positionName: string;
  nowCost: number;
  status: string;
  minutesProbability: number;
  nextOpponent: string;
  averageDifficulty: number | null;
  perGameweek: number[];
  weightedProjection: number;
  nextGameweekProjection: number;
};

type RankedTransferDecision = {
  option: TransferDecisionOption;
  rankingScore: number;
};

function mapBoolean(value: number | null | undefined) {
  return Boolean(value);
}

export class QueryService {
  constructor(private readonly db: AppDatabase) {}

  getGameweeks(): GameweekSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, deadline_time AS deadlineTime, average_entry_score AS averageEntryScore,
                highest_score AS highestScore, is_current AS isCurrent, is_finished AS isFinished
         FROM gameweeks
         ORDER BY id`,
      )
      .all() as GameweekRow[];

    return rows.map((row) => this.mapGameweek(row));
  }

  getTeams(): TeamSummary[] {
    return this.db
      .prepare(
        `SELECT id, name, short_name AS shortName, strength
                , image_path AS imagePath
         FROM teams
         ORDER BY name`,
      )
      .all() as TeamSummary[];
  }

  getFixtures(eventId?: number, teamId?: number): FixtureCard[] {
    const filters = [];
    const params: Record<string, number> = {};

    if (eventId) {
      filters.push("f.event_id = @eventId");
      params.eventId = eventId;
    }

    if (teamId) {
      filters.push("(f.team_h = @teamId OR f.team_a = @teamId)");
      params.teamId = teamId;
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const rows = this.db
      .prepare(
        `SELECT f.id, f.code, f.event_id AS eventId, f.kickoff_time AS kickoffTime,
                f.team_h AS teamH, f.team_a AS teamA,
                th.name AS teamHName, ta.name AS teamAName,
                th.short_name AS teamHShortName, ta.short_name AS teamAShortName,
                f.team_h_score AS teamHScore, f.team_a_score AS teamAScore,
                f.finished, f.started
         FROM fixtures f
         JOIN teams th ON th.id = f.team_h
         JOIN teams ta ON ta.id = f.team_a
         ${where}
         ORDER BY COALESCE(f.event_id, 999), COALESCE(f.kickoff_time, '')`,
      )
      .all(params) as FixtureRow[];

    return rows.map((row) => this.mapFixture(row));
  }

  getPlayers(query: PlayerQuery): PlayerCard[] {
    const filters = [];
    const params: Record<string, string | number> = {};

    if (query.search) {
      filters.push("(LOWER(p.web_name) LIKE @search OR LOWER(p.first_name || ' ' || p.second_name) LIKE @search)");
      params.search = `%${query.search.toLowerCase()}%`;
    }

    if (query.team) {
      filters.push("p.team_id = @team");
      params.team = query.team;
    }

    if (query.position) {
      filters.push("p.position_id = @position");
      params.position = query.position;
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    // When a gameweek range is specified, aggregate per-GW history instead of using season totals
    if (query.fromGW !== undefined && query.toGW !== undefined) {
      params.fromGW = query.fromGW;
      params.toGW = query.toGW;
      return this.db
        .prepare(
          `SELECT p.id, p.web_name AS webName, p.first_name AS firstName, p.second_name AS secondName,
                  p.team_id AS teamId, t.name AS teamName, t.short_name AS teamShortName,
                  p.image_path AS imagePath,
                  p.position_id AS positionId, pos.name AS positionName,
                  p.now_cost AS nowCost, p.form,
                  p.selected_by_percent AS selectedByPercent, p.status,
                  COALESCE(SUM(ph.total_points), 0) AS totalPoints,
                  CASE WHEN COUNT(ph.round) > 0
                       THEN ROUND(CAST(SUM(ph.total_points) AS REAL) / COUNT(ph.round), 1)
                       ELSE 0 END AS pointsPerGame,
                  COALESCE(SUM(ph.goals_scored), 0) AS goalsScored,
                  COALESCE(SUM(ph.assists), 0) AS assists,
                  COALESCE(SUM(ph.clean_sheets), 0) AS cleanSheets,
                  COALESCE(SUM(ph.minutes), 0) AS minutes,
                  COALESCE(SUM(ph.bonus), 0) AS bonus,
                  COALESCE(SUM(ph.bps), 0) AS bps,
                  COALESCE(SUM(ph.creativity), 0) AS creativity,
                  COALESCE(SUM(ph.influence), 0) AS influence,
                  COALESCE(SUM(ph.threat), 0) AS threat,
                  COALESCE(SUM(ph.ict_index), 0) AS ictIndex,
                  COALESCE(SUM(ph.expected_goals), 0) AS expectedGoals,
                  COALESCE(SUM(ph.expected_assists), 0) AS expectedAssists,
                  COALESCE(SUM(ph.expected_goal_involvements), 0) AS expectedGoalInvolvements,
                  COALESCE(SUM(ph.expected_goal_performance), 0) AS expectedGoalPerformance,
                  COALESCE(SUM(ph.expected_assist_performance), 0) AS expectedAssistPerformance,
                  COALESCE(SUM(ph.expected_goal_involvement_performance), 0) AS expectedGoalInvolvementPerformance,
                  COALESCE(SUM(ph.expected_goals_conceded), 0) AS expectedGoalsConceded,
                  CASE WHEN SUM(ph.minutes) > 0
                       THEN ROUND(CAST(SUM(ph.clean_sheets) AS REAL) / (SUM(ph.minutes) / 90.0), 2)
                       ELSE 0 END AS cleanSheetsPer90,
                  COALESCE(SUM(ph.starts), 0) AS starts,
                  COALESCE(SUM(ph.tackles), 0) AS tackles,
                  COALESCE(SUM(ph.recoveries), 0) AS recoveries,
                  COALESCE(SUM(ph.defensive_contribution), 0) AS defensiveContribution
           FROM players p
           JOIN teams t ON t.id = p.team_id
           JOIN positions pos ON pos.id = p.position_id
           LEFT JOIN player_history ph ON ph.player_id = p.id
                                      AND ph.round >= @fromGW
                                      AND ph.round <= @toGW
           ${where}
           GROUP BY p.id
           ORDER BY COALESCE(SUM(ph.total_points), 0) DESC, p.web_name ASC`,
        )
        .all(params) as PlayerCardRow[];
    }

    // Default: season totals from the players table
    const sortMap: Record<string, string> = {
      total_points: "p.total_points DESC",
      form: "p.form DESC",
      cost: "p.now_cost DESC",
      minutes: "p.minutes DESC",
    };
    const orderBy = sortMap[query.sort ?? "total_points"] ?? sortMap.total_points;

    return this.db
      .prepare(
        `SELECT p.id, p.web_name AS webName, p.first_name AS firstName, p.second_name AS secondName,
                p.team_id AS teamId, t.name AS teamName, t.short_name AS teamShortName,
                p.image_path AS imagePath,
                p.position_id AS positionId, pos.name AS positionName,
                p.now_cost AS nowCost, p.total_points AS totalPoints, p.form,
                p.selected_by_percent AS selectedByPercent, p.points_per_game AS pointsPerGame,
                p.goals_scored AS goalsScored, p.assists, p.clean_sheets AS cleanSheets,
                p.minutes, p.bonus, p.bps, p.creativity, p.influence, p.threat,
                p.ict_index AS ictIndex, p.expected_goals AS expectedGoals,
                p.expected_assists AS expectedAssists,
                p.expected_goal_involvements AS expectedGoalInvolvements,
                p.expected_goal_performance AS expectedGoalPerformance,
                p.expected_assist_performance AS expectedAssistPerformance,
                p.expected_goal_involvement_performance AS expectedGoalInvolvementPerformance,
                p.expected_goals_conceded AS expectedGoalsConceded,
                p.clean_sheets_per_90 AS cleanSheetsPer90, p.starts, p.tackles,
                p.recoveries, p.defensive_contribution AS defensiveContribution,
                p.status
         FROM players p
         JOIN teams t ON t.id = p.team_id
         JOIN positions pos ON pos.id = p.position_id
         ${where}
         ORDER BY ${orderBy}, p.web_name ASC`,
      )
      .all(params) as PlayerCardRow[];
  }

  getPlayerById(playerId: number): PlayerDetail | null {
    const player = this.db
      .prepare(
        `SELECT p.id, p.web_name AS webName, p.first_name AS firstName, p.second_name AS secondName,
                p.team_id AS teamId, t.name AS teamName, t.short_name AS teamShortName,
                p.image_path AS imagePath,
                p.position_id AS positionId, pos.name AS positionName,
                p.now_cost AS nowCost, p.total_points AS totalPoints, p.form,
                p.selected_by_percent AS selectedByPercent, p.points_per_game AS pointsPerGame,
                p.goals_scored AS goalsScored, p.assists, p.clean_sheets AS cleanSheets,
                p.minutes, p.bonus, p.bps, p.creativity, p.influence, p.threat,
                p.ict_index AS ictIndex, p.expected_goals AS expectedGoals,
                p.expected_assists AS expectedAssists,
                p.expected_goal_involvements AS expectedGoalInvolvements,
                p.expected_goal_performance AS expectedGoalPerformance,
                p.expected_assist_performance AS expectedAssistPerformance,
                p.expected_goal_involvement_performance AS expectedGoalInvolvementPerformance,
                p.expected_goals_conceded AS expectedGoalsConceded,
                p.clean_sheets_per_90 AS cleanSheetsPer90, p.starts, p.tackles,
                p.recoveries, p.defensive_contribution AS defensiveContribution,
                p.status
         FROM players p
         JOIN teams t ON t.id = p.team_id
         JOIN positions pos ON pos.id = p.position_id
         WHERE p.id = ?`,
      )
      .get(playerId) as PlayerCardRow | undefined;

    if (!player) {
      return null;
    }

    const historyRows = this.db
      .prepare(
        `SELECT player_id AS element, round, total_points AS totalPoints, minutes, goals_scored AS goalsScored,
                assists, clean_sheets AS cleanSheets, bonus, bps, creativity,
                influence, threat, ict_index AS ictIndex,
                expected_goals AS expectedGoals,
                expected_assists AS expectedAssists,
                expected_goal_involvements AS expectedGoalInvolvements,
                expected_goal_performance AS expectedGoalPerformance,
                expected_assist_performance AS expectedAssistPerformance,
                expected_goal_involvement_performance AS expectedGoalInvolvementPerformance,
                expected_goals_conceded AS expectedGoalsConceded,
                saves, yellow_cards AS yellowCards, red_cards AS redCards,
                own_goals AS ownGoals, penalties_saved AS penaltiesSaved,
                penalties_missed AS penaltiesMissed, goals_conceded AS goalsConceded,
                tackles, recoveries,
                clearances_blocks_interceptions AS clearancesBlocksInterceptions,
                defensive_contribution AS defensiveContribution, starts,
                opponent_team AS opponentTeam, value, was_home AS wasHome,
                kickoff_time AS kickoffTime
         FROM player_history
         WHERE player_id = ?
         ORDER BY round DESC`,
      )
      .all(playerId) as PlayerHistoryRow[];
    const history = historyRows.map((row) => this.mapPlayerHistory(row));

    const upcomingFixtureRows = this.db
      .prepare(
        `SELECT pf.fixture_id AS id, pf.code, pf.event_id AS eventId, pf.kickoff_time AS kickoffTime,
                pf.team_h AS teamH, pf.team_a AS teamA,
                th.name AS teamHName, ta.name AS teamAName,
                th.short_name AS teamHShortName, ta.short_name AS teamAShortName,
                pf.team_h_score AS teamHScore, pf.team_a_score AS teamAScore,
                pf.finished, pf.started
         FROM player_future_fixtures pf
         JOIN teams th ON th.id = pf.team_h
         JOIN teams ta ON ta.id = pf.team_a
         WHERE pf.player_id = ?
         ORDER BY COALESCE(pf.event_id, 999), COALESCE(pf.kickoff_time, '')`,
      )
      .all(playerId) as FixtureRow[];
    const upcomingFixtures = upcomingFixtureRows.map((row) => this.mapFixture(row));

    return { player, history, upcomingFixtures };
  }

  getOverview(): OverviewResponse {
    return {
      generatedAt: new Date().toISOString(),
      gameweeks: this.getGameweeks(),
      topPlayers: this.getPlayers({ sort: "total_points" }).slice(0, 8),
      fixtures: this.getFixtures().slice(0, 12),
      teams: this.getTeams(),
    };
  }

  getMyTeamAccounts(): MyTeamAccountSummary[] {
    return this.db
      .prepare(
        `SELECT id, email, entry_id AS entryId,
                TRIM(COALESCE(player_first_name, '') || ' ' || COALESCE(player_last_name, '')) AS managerName,
                COALESCE(team_name, '') AS teamName, auth_status AS authStatus,
                auth_error AS authError, last_authenticated_at AS lastAuthenticatedAt
         FROM my_team_accounts
         ORDER BY updated_at DESC`,
      )
      .all() as MyTeamAccountSummary[];
  }

  getMyTeam(accountId?: number): MyTeamPageResponse | null {
    const accounts = this.getMyTeamAccounts();
    const selectedAccount = accountId
      ? accounts.find((account) => account.id === accountId)
      : accounts[0];

    if (!selectedAccount) {
      return {
        accounts,
        selectedAccountId: null,
        currentGameweek: null,
        freeTransfers: 0,
        bank: 0,
        overallPoints: 0,
        overallRank: 0,
        teamName: "",
        managerName: "",
        picks: [],
        transfers: [],
        seasons: [],
        history: [],
      };
    }

    const history = this.db
      .prepare(
        `SELECT gameweek_id AS gameweek, points, total_points AS totalPoints,
                overall_rank AS overallRank, rank, bank, value,
                event_transfers AS eventTransfers, event_transfers_cost AS eventTransfersCost,
                points_on_bench AS pointsOnBench, active_chip AS activeChip
         FROM my_team_gameweeks
         WHERE account_id = ?
         ORDER BY gameweek_id DESC`,
      )
      .all(selectedAccount.id) as MyTeamHistoryRow[];

    const currentGameweek = history[0]?.gameweek ?? null;
    const current = history[0];
    const picks = currentGameweek
      ? ((this.db
          .prepare(
            `SELECT
               'pick-' || mp.position AS slotId,
               mp.position,
               mp.multiplier AS multiplier,
               mp.is_captain AS isCaptain,
               mp.is_vice_captain AS isViceCaptain,
               mp.selling_price AS sellingPrice,
               mp.purchase_price AS purchasePrice,
               CASE WHEN mp.position <= 11 THEN 'starter' ELSE 'bench' END AS role,
               CASE WHEN mp.position <= 11 THEN NULL ELSE mp.position - 11 END AS benchOrder,
               p.id, p.web_name AS webName, p.first_name AS firstName, p.second_name AS secondName,
               p.team_id AS teamId, t.name AS teamName, t.short_name AS teamShortName,
               p.image_path AS imagePath, p.position_id AS positionId, pos.name AS positionName,
               p.now_cost AS nowCost, p.total_points AS totalPoints, p.form,
               p.selected_by_percent AS selectedByPercent, p.points_per_game AS pointsPerGame,
               p.goals_scored AS goalsScored, p.assists, p.clean_sheets AS cleanSheets,
               p.minutes, p.bonus, p.bps, p.creativity, p.influence, p.threat,
               p.ict_index AS ictIndex, p.expected_goals AS expectedGoals, p.expected_assists AS expectedAssists,
               p.expected_goal_involvements AS expectedGoalInvolvements,
               p.expected_goal_performance AS expectedGoalPerformance,
               p.expected_assist_performance AS expectedAssistPerformance,
               p.expected_goal_involvement_performance AS expectedGoalInvolvementPerformance,
               p.expected_goals_conceded AS expectedGoalsConceded, p.clean_sheets_per_90 AS cleanSheetsPer90,
               p.starts, p.tackles, p.recoveries, p.defensive_contribution AS defensiveContribution, p.status
             FROM my_team_picks mp
             JOIN players p ON p.id = mp.player_id
             JOIN teams t ON t.id = p.team_id
             JOIN positions pos ON pos.id = p.position_id
             WHERE mp.account_id = ? AND mp.gameweek_id = ?
             ORDER BY mp.position`,
          )
          .all(selectedAccount.id, currentGameweek) as MyTeamPickRow[])
          .map((row) => this.mapMyTeamPick(row)))
      : [];

    const transferRows = this.db
      .prepare(
        `SELECT mt.transfer_id AS id, mt.gameweek_id AS gameweek, mt.transferred_at AS madeAt,
                CASE
                  WHEN ROW_NUMBER() OVER (PARTITION BY mt.account_id, mt.gameweek_id ORDER BY mt.transferred_at DESC)
                       <= COALESCE(gw.event_transfers_cost / 4, 0)
                  THEN 4 ELSE 0
                END AS hitCost,
                pin.id AS playerInId, pin.web_name AS playerInWebName, pin.first_name AS playerInFirstName, pin.second_name AS playerInSecondName,
                tin.name AS playerInTeamName, tin.short_name AS playerInTeamShortName, pin.team_id AS playerInTeamId,
                pin.image_path AS playerInImagePath, pin.position_id AS playerInPositionId, posin.name AS playerInPositionName,
                pin.now_cost AS playerInNowCost, pin.total_points AS playerInTotalPoints, pin.form AS playerInForm,
                pin.selected_by_percent AS playerInSelectedByPercent, pin.points_per_game AS playerInPointsPerGame,
                pin.goals_scored AS playerInGoalsScored, pin.assists AS playerInAssists, pin.clean_sheets AS playerInCleanSheets,
                pin.minutes AS playerInMinutes, pin.bonus AS playerInBonus, pin.bps AS playerInBps, pin.creativity AS playerInCreativity,
                pin.influence AS playerInInfluence, pin.threat AS playerInThreat, pin.ict_index AS playerInIctIndex,
                pin.expected_goals AS playerInExpectedGoals, pin.expected_assists AS playerInExpectedAssists,
                pin.expected_goal_involvements AS playerInExpectedGoalInvolvements,
                pin.expected_goal_performance AS playerInExpectedGoalPerformance,
                pin.expected_assist_performance AS playerInExpectedAssistPerformance,
                pin.expected_goal_involvement_performance AS playerInExpectedGoalInvolvementPerformance,
                pin.expected_goals_conceded AS playerInExpectedGoalsConceded, pin.clean_sheets_per_90 AS playerInCleanSheetsPer90,
                pin.starts AS playerInStarts, pin.tackles AS playerInTackles, pin.recoveries AS playerInRecoveries,
                pin.defensive_contribution AS playerInDefensiveContribution, pin.status AS playerInStatus,
                pout.id AS playerOutId, pout.web_name AS playerOutWebName, pout.first_name AS playerOutFirstName, pout.second_name AS playerOutSecondName,
                tout.name AS playerOutTeamName, tout.short_name AS playerOutTeamShortName, pout.team_id AS playerOutTeamId,
                pout.image_path AS playerOutImagePath, pout.position_id AS playerOutPositionId, posout.name AS playerOutPositionName,
                pout.now_cost AS playerOutNowCost, pout.total_points AS playerOutTotalPoints, pout.form AS playerOutForm,
                pout.selected_by_percent AS playerOutSelectedByPercent, pout.points_per_game AS playerOutPointsPerGame,
                pout.goals_scored AS playerOutGoalsScored, pout.assists AS playerOutAssists, pout.clean_sheets AS playerOutCleanSheets,
                pout.minutes AS playerOutMinutes, pout.bonus AS playerOutBonus, pout.bps AS playerOutBps, pout.creativity AS playerOutCreativity,
                pout.influence AS playerOutInfluence, pout.threat AS playerOutThreat, pout.ict_index AS playerOutIctIndex,
                pout.expected_goals AS playerOutExpectedGoals, pout.expected_assists AS playerOutExpectedAssists,
                pout.expected_goal_involvements AS playerOutExpectedGoalInvolvements,
                pout.expected_goal_performance AS playerOutExpectedGoalPerformance,
                pout.expected_assist_performance AS playerOutExpectedAssistPerformance,
                pout.expected_goal_involvement_performance AS playerOutExpectedGoalInvolvementPerformance,
                pout.expected_goals_conceded AS playerOutExpectedGoalsConceded, pout.clean_sheets_per_90 AS playerOutCleanSheetsPer90,
                pout.starts AS playerOutStarts, pout.tackles AS playerOutTackles, pout.recoveries AS playerOutRecoveries,
                pout.defensive_contribution AS playerOutDefensiveContribution, pout.status AS playerOutStatus
         FROM my_team_transfers mt
         JOIN players pin ON pin.id = mt.player_in_id
         JOIN teams tin ON tin.id = pin.team_id
         JOIN positions posin ON posin.id = pin.position_id
         JOIN players pout ON pout.id = mt.player_out_id
         JOIN teams tout ON tout.id = pout.team_id
         JOIN positions posout ON posout.id = pout.position_id
         LEFT JOIN my_team_gameweeks gw ON gw.account_id = mt.account_id AND gw.gameweek_id = mt.gameweek_id
         WHERE mt.account_id = ?
         ORDER BY mt.transferred_at DESC`,
      )
      .all(selectedAccount.id) as PlayerTransferRow[];
    const transfers: MyTeamTransfer[] = transferRows.map((row) => ({
        id: row.id,
        gameweek: row.gameweek,
        madeAt: row.madeAt,
        cost: row.hitCost ?? 0,
        playerIn: this.mapPlayerFromPrefix(row, "playerIn"),
        playerOut: this.mapPlayerFromPrefix(row, "playerOut"),
      }));

    const seasons = this.db
      .prepare(
        `SELECT season_name AS season, total_points AS overallPoints,
                overall_rank AS overallRank, rank
         FROM my_team_seasons
         WHERE account_id = ?
         ORDER BY season_name DESC`,
      )
      .all(selectedAccount.id) as MyTeamSeasonSummary[];

    return {
      accounts,
      selectedAccountId: selectedAccount.id,
      currentGameweek,
      freeTransfers: current ? Math.max(1, 1 + (current.activeChip ? 0 : 0)) : 1,
      bank: current?.bank ?? 0,
      overallPoints: current?.totalPoints ?? 0,
      overallRank: current?.overallRank ?? 0,
      teamName: selectedAccount.teamName,
      managerName: selectedAccount.managerName,
      picks,
      transfers,
      seasons,
      history,
    };
  }

  getMyTeamPicksForGameweek(accountId: number, gameweek: number): MyTeamGameweekPicksResponse {
    const pickRows = this.db
      .prepare(
        `SELECT
           'pick-' || mp.position AS slotId,
           mp.position,
           mp.multiplier,
           mp.is_captain AS isCaptain,
           mp.is_vice_captain AS isViceCaptain,
           mp.selling_price AS sellingPrice,
           mp.purchase_price AS purchasePrice,
           CASE WHEN mp.position <= 11 THEN 'starter' ELSE 'bench' END AS role,
           CASE WHEN mp.position <= 11 THEN NULL ELSE mp.position - 11 END AS benchOrder,
           COALESCE(mp.gw_points, ph.total_points, 0) AS gwPoints,
           p.id, p.web_name AS webName, p.first_name AS firstName, p.second_name AS secondName,
           p.team_id AS teamId, t.name AS teamName, t.short_name AS teamShortName,
           p.image_path AS imagePath, p.position_id AS positionId, pos.name AS positionName,
           p.now_cost AS nowCost, p.total_points AS totalPoints, p.form,
           p.selected_by_percent AS selectedByPercent, p.points_per_game AS pointsPerGame,
           p.goals_scored AS goalsScored, p.assists, p.clean_sheets AS cleanSheets,
           p.minutes, p.bonus, p.bps, p.creativity, p.influence, p.threat,
           p.ict_index AS ictIndex, p.expected_goals AS expectedGoals, p.expected_assists AS expectedAssists,
           p.expected_goal_involvements AS expectedGoalInvolvements,
           p.expected_goal_performance AS expectedGoalPerformance,
           p.expected_assist_performance AS expectedAssistPerformance,
           p.expected_goal_involvement_performance AS expectedGoalInvolvementPerformance,
           p.expected_goals_conceded AS expectedGoalsConceded, p.clean_sheets_per_90 AS cleanSheetsPer90,
           p.starts, p.tackles, p.recoveries, p.defensive_contribution AS defensiveContribution, p.status
         FROM my_team_picks mp
         JOIN players p ON p.id = mp.player_id
         JOIN teams t ON t.id = p.team_id
         JOIN positions pos ON pos.id = p.position_id
         LEFT JOIN player_history ph ON ph.player_id = mp.player_id AND ph.round = mp.gameweek_id
         WHERE mp.account_id = ? AND mp.gameweek_id = ?
         ORDER BY mp.position`,
      )
      .all(accountId, gameweek) as MyTeamPickRow[];
    const picks = pickRows.map((row) => this.mapMyTeamPick(row));

    const gw = this.db
      .prepare(
        `SELECT points AS totalPoints, points_on_bench AS pointsOnBench
         FROM my_team_gameweeks
         WHERE account_id = ? AND gameweek_id = ?`,
      )
      .get(accountId, gameweek) as { totalPoints: number; pointsOnBench: number } | undefined;

    return {
      gameweek,
      picks,
      totalPoints: gw?.totalPoints ?? 0,
      pointsOnBench: gw?.pointsOnBench ?? 0,
    };
  }

  private mapGameweek(row: GameweekRow): GameweekSummary {
    return {
      ...row,
      isCurrent: mapBoolean(row.isCurrent),
      isFinished: mapBoolean(row.isFinished),
    };
  }

  private mapFixture(row: FixtureRow): FixtureCard {
    return {
      ...row,
      finished: mapBoolean(row.finished),
      started: mapBoolean(row.started),
    };
  }

  private mapPlayerHistory(row: PlayerHistoryRow): PlayerHistoryPoint {
    return {
      ...row,
      wasHome: mapBoolean(row.wasHome),
    };
  }

  private mapMyTeamPick(row: MyTeamPickRow): MyTeamPick {
    const pick: MyTeamPick = {
      slotId: row.slotId,
      position: row.position,
      multiplier: row.multiplier,
      isCaptain: mapBoolean(row.isCaptain),
      isViceCaptain: mapBoolean(row.isViceCaptain),
      sellingPrice: row.sellingPrice,
      purchasePrice: row.purchasePrice,
      role: row.role,
      benchOrder: row.benchOrder,
      player: this.mapPlayerCard(row),
    };

    if (row.gwPoints !== undefined) {
      pick.gwPoints = row.gwPoints;
    }

    return pick;
  }

  private mapPlayerCard(row: PlayerCardRow): PlayerCard {
    return { ...row };
  }

  private getPrefixedPlayerValue<K extends keyof PlayerCard>(
    row: PlayerTransferRow,
    prefix: PlayerTransferPrefix,
    suffix: string,
  ): PlayerCard[K] {
    return row[`${prefix}${suffix}`] as PlayerCard[K];
  }

  private mapPlayerFromPrefix(row: PlayerTransferRow, prefix: PlayerTransferPrefix): PlayerCard {
    return {
      id: this.getPrefixedPlayerValue<"id">(row, prefix, "Id"),
      webName: this.getPrefixedPlayerValue<"webName">(row, prefix, "WebName"),
      firstName: this.getPrefixedPlayerValue<"firstName">(row, prefix, "FirstName"),
      secondName: this.getPrefixedPlayerValue<"secondName">(row, prefix, "SecondName"),
      teamId: this.getPrefixedPlayerValue<"teamId">(row, prefix, "TeamId"),
      teamName: this.getPrefixedPlayerValue<"teamName">(row, prefix, "TeamName"),
      teamShortName: this.getPrefixedPlayerValue<"teamShortName">(row, prefix, "TeamShortName"),
      imagePath: this.getPrefixedPlayerValue<"imagePath">(row, prefix, "ImagePath"),
      positionId: this.getPrefixedPlayerValue<"positionId">(row, prefix, "PositionId"),
      positionName: this.getPrefixedPlayerValue<"positionName">(row, prefix, "PositionName"),
      nowCost: this.getPrefixedPlayerValue<"nowCost">(row, prefix, "NowCost"),
      totalPoints: this.getPrefixedPlayerValue<"totalPoints">(row, prefix, "TotalPoints"),
      form: this.getPrefixedPlayerValue<"form">(row, prefix, "Form"),
      selectedByPercent: this.getPrefixedPlayerValue<"selectedByPercent">(row, prefix, "SelectedByPercent"),
      pointsPerGame: this.getPrefixedPlayerValue<"pointsPerGame">(row, prefix, "PointsPerGame"),
      goalsScored: this.getPrefixedPlayerValue<"goalsScored">(row, prefix, "GoalsScored"),
      assists: this.getPrefixedPlayerValue<"assists">(row, prefix, "Assists"),
      cleanSheets: this.getPrefixedPlayerValue<"cleanSheets">(row, prefix, "CleanSheets"),
      minutes: this.getPrefixedPlayerValue<"minutes">(row, prefix, "Minutes"),
      bonus: this.getPrefixedPlayerValue<"bonus">(row, prefix, "Bonus"),
      bps: this.getPrefixedPlayerValue<"bps">(row, prefix, "Bps"),
      creativity: this.getPrefixedPlayerValue<"creativity">(row, prefix, "Creativity"),
      influence: this.getPrefixedPlayerValue<"influence">(row, prefix, "Influence"),
      threat: this.getPrefixedPlayerValue<"threat">(row, prefix, "Threat"),
      ictIndex: this.getPrefixedPlayerValue<"ictIndex">(row, prefix, "IctIndex"),
      expectedGoals: this.getPrefixedPlayerValue<"expectedGoals">(row, prefix, "ExpectedGoals"),
      expectedAssists: this.getPrefixedPlayerValue<"expectedAssists">(row, prefix, "ExpectedAssists"),
      expectedGoalInvolvements: this.getPrefixedPlayerValue<"expectedGoalInvolvements">(
        row,
        prefix,
        "ExpectedGoalInvolvements",
      ),
      expectedGoalPerformance: this.getPrefixedPlayerValue<"expectedGoalPerformance">(
        row,
        prefix,
        "ExpectedGoalPerformance",
      ),
      expectedAssistPerformance: this.getPrefixedPlayerValue<"expectedAssistPerformance">(
        row,
        prefix,
        "ExpectedAssistPerformance",
      ),
      expectedGoalInvolvementPerformance: this.getPrefixedPlayerValue<"expectedGoalInvolvementPerformance">(
        row,
        prefix,
        "ExpectedGoalInvolvementPerformance",
      ),
      expectedGoalsConceded: this.getPrefixedPlayerValue<"expectedGoalsConceded">(
        row,
        prefix,
        "ExpectedGoalsConceded",
      ),
      cleanSheetsPer90: this.getPrefixedPlayerValue<"cleanSheetsPer90">(row, prefix, "CleanSheetsPer90"),
      starts: this.getPrefixedPlayerValue<"starts">(row, prefix, "Starts"),
      tackles: this.getPrefixedPlayerValue<"tackles">(row, prefix, "Tackles"),
      recoveries: this.getPrefixedPlayerValue<"recoveries">(row, prefix, "Recoveries"),
      defensiveContribution: this.getPrefixedPlayerValue<"defensiveContribution">(
        row,
        prefix,
        "DefensiveContribution",
      ),
      status: this.getPrefixedPlayerValue<"status">(row, prefix, "Status"),
    };
  }

  // ─── FDR ──────────────────────────────────────────────────────────────────

  getFdrData(): FdrRow[] {
    // Compute per-team xG averages from recent player_history (last 38 rounds)
    const teamStats = this.db.prepare(`
      SELECT
        ph.team_id AS teamId,
        AVG(ph.expected_goals) AS avgXg,
        AVG(ph.expected_goals_conceded) AS avgXgc
      FROM player_history ph
      WHERE ph.team_id IS NOT NULL
      GROUP BY ph.team_id
    `).all() as { teamId: number; avgXg: number; avgXgc: number }[];

    const leagueAvgXg = teamStats.reduce((s, t) => s + (t.avgXg ?? 0), 0) / (teamStats.length || 1);
    const leagueAvgXgc = teamStats.reduce((s, t) => s + (t.avgXgc ?? 0), 0) / (teamStats.length || 1);

    const strengthMap = new Map(teamStats.map((t) => {
      const attackStrength = leagueAvgXg > 0 ? (t.avgXg ?? 0) / leagueAvgXg : 1;
      const defenceWeakness = leagueAvgXgc > 0 ? (t.avgXgc ?? 0) / leagueAvgXgc : 1;
      // Higher score = harder opponent (strong attack + weak defence)
      const raw = (attackStrength + defenceWeakness) / 2;
      return [t.teamId, raw];
    }));

    // Bin raw scores into 1–5
    const allScores = [...strengthMap.values()];
    const minScore = Math.min(...allScores);
    const maxScore = Math.max(...allScores);
    const range = maxScore - minScore || 1;

    function binDifficulty(raw: number): 1 | 2 | 3 | 4 | 5 {
      const normalised = (raw - minScore) / range; // 0–1
      if (normalised < 0.2) return 1;
      if (normalised < 0.4) return 2;
      if (normalised < 0.6) return 3;
      if (normalised < 0.8) return 4;
      return 5;
    }

    // Get upcoming fixtures (not yet finished) with GW numbers
    type FdrFixtureRow = {
      teamId: number;
      teamName: string;
      teamShortName: string;
      gameweek: number;
      opponentId: number;
      opponentShort: string;
      isHome: number;
    };
    const upcoming = this.db.prepare(`
      SELECT
        t.id AS teamId,
        t.name AS teamName,
        t.short_name AS teamShortName,
        f.event_id AS gameweek,
        opp.id AS opponentId,
        opp.short_name AS opponentShort,
        CASE WHEN f.team_h = t.id THEN 1 ELSE 0 END AS isHome
      FROM teams t
      JOIN fixtures f ON (f.team_h = t.id OR f.team_a = t.id)
      JOIN teams opp ON opp.id = CASE WHEN f.team_h = t.id THEN f.team_a ELSE f.team_h END
      WHERE f.finished = 0
        AND f.event_id IS NOT NULL
      ORDER BY t.id, f.event_id
    `).all() as FdrFixtureRow[];

    // Group by team, take next 8 gameweeks
    const teamMap = new Map<number, FdrRow>();
    for (const row of upcoming) {
      if (!teamMap.has(row.teamId)) {
        teamMap.set(row.teamId, {
          teamId: row.teamId,
          teamName: row.teamName,
          teamShortName: row.teamShortName,
          fixtures: [],
        });
      }
      const team = teamMap.get(row.teamId)!;
      if (team.fixtures.length < 8) {
        const opponentStrength = strengthMap.get(row.opponentId) ?? (minScore + range / 2);
        team.fixtures.push({
          gameweek: row.gameweek,
          opponentId: row.opponentId,
          opponentShort: row.opponentShort,
          difficulty: binDifficulty(opponentStrength),
          isHome: Boolean(row.isHome),
        });
      }
    }

    return [...teamMap.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
  }

  // ─── xPts ─────────────────────────────────────────────────────────────────

  getPlayerXpts(gameweek?: number): PlayerXpts[] {
    // Points values by position (FPL scoring)
    const GOAL_POINTS: Record<number, number> = { 1: 6, 2: 6, 3: 5, 4: 4 };
    const CS_POINTS: Record<number, number>   = { 1: 6, 2: 6, 3: 1, 4: 0 };
    const ASSIST_POINTS = 3;
    const APPEARANCE_POINTS_PER_90 = 2;
    const SAVE_POINTS_PER_3 = 1;

    // Use recent player history for form stats (last 5 GWs)
    type HistoryAgg = {
      playerId: number; avgXg: number; avgXa: number;
      avgMinutes: number; avgBonus: number; avgXgc: number; avgSaves: number;
      gwCount: number;
    };
    const historyRows = this.db.prepare(`
      SELECT
        ph.player_id AS playerId,
        AVG(ph.expected_goals) AS avgXg,
        AVG(ph.expected_assists) AS avgXa,
        AVG(ph.minutes) AS avgMinutes,
        AVG(ph.bonus) AS avgBonus,
        AVG(ph.expected_goals_conceded) AS avgXgc,
        AVG(ph.saves) AS avgSaves,
        COUNT(*) AS gwCount
      FROM player_history ph
      WHERE ph.round IN (
        SELECT DISTINCT round FROM player_history ORDER BY round DESC LIMIT 5
      )
      GROUP BY ph.player_id
    `).all() as HistoryAgg[];
    const histMap = new Map(historyRows.map((r) => [r.playerId, r]));

    // Get FDR data to compute fixture difficulty multiplier
    const fdrRows = this.getFdrData();
    const fdrMap = new Map(fdrRows.map((r) => [r.teamId, r]));

    // Get all players with their team, position, and next fixture
    type PlayerRow = {
      id: number; webName: string; teamId: number; teamShortName: string;
      imagePath: string | null; positionId: number; positionName: string; form: number;
    };
    const players = this.db.prepare(`
      SELECT p.id, p.web_name AS webName, p.team_id AS teamId,
             t.short_name AS teamShortName,
             p.image_path AS imagePath,
             p.position_id AS positionId, pos.name AS positionName,
             p.form
      FROM players p
      JOIN teams t ON t.id = p.team_id
      JOIN positions pos ON pos.id = p.position_id
      WHERE p.status != 'u'
      ORDER BY p.id
    `).all() as PlayerRow[];

    // Get next fixture per team (for specified GW or very next one)
    type NextFixtureRow = {
      teamId: number; opponentId: number; opponentShort: string;
      isHome: number; gameweek: number;
    };
    const gwFilter = gameweek ? `AND f.event_id = ${gameweek}` : "";
    const nextFixtures = this.db.prepare(`
      SELECT
        t.id AS teamId,
        opp.id AS opponentId,
        opp.short_name AS opponentShort,
        CASE WHEN f.team_h = t.id THEN 1 ELSE 0 END AS isHome,
        f.event_id AS gameweek
      FROM teams t
      JOIN fixtures f ON (f.team_h = t.id OR f.team_a = t.id)
      JOIN teams opp ON opp.id = CASE WHEN f.team_h = t.id THEN f.team_a ELSE f.team_h END
      WHERE f.finished = 0
        AND f.event_id IS NOT NULL
        ${gwFilter}
      ORDER BY t.id, f.event_id
    `).all() as NextFixtureRow[];

    // Pick first upcoming fixture per team
    const nextFixtureMap = new Map<number, NextFixtureRow>();
    for (const f of nextFixtures) {
      if (!nextFixtureMap.has(f.teamId)) nextFixtureMap.set(f.teamId, f);
    }

    return players.map((p) => {
      const hist = histMap.get(p.id);
      const nextFix = nextFixtureMap.get(p.teamId);
      const fdrTeam = nextFix ? fdrMap.get(p.teamId) : undefined;
      const fixture = fdrTeam?.fixtures.find((f) => f.opponentId === nextFix?.opponentId);
      const difficulty = fixture?.difficulty ?? (nextFix ? 3 : 0);

      if (!hist || hist.gwCount < 2 || !nextFix) {
        return {
          playerId: p.id,
          playerName: p.webName,
          teamShortName: p.teamShortName,
          imagePath: p.imagePath,
          position: p.positionName,
          nextOpponent: nextFix?.opponentShort ?? "BGW",
          difficulty,
          xpts: null,
          form: p.form,
          minutesProbability: 0,
        };
      }

      const minutesProbability = Math.min(1, (hist.avgMinutes ?? 0) / 90);
      const posId = p.positionId;
      const goalPts = GOAL_POINTS[posId] ?? 4;
      const csPts = CS_POINTS[posId] ?? 0;

      // Fixture difficulty multiplier: easy=1.2, hard=0.75
      const diffMultipliers: Record<number, number> = { 1: 1.2, 2: 1.1, 3: 1.0, 4: 0.85, 5: 0.75 };
      const diffMult = diffMultipliers[difficulty] ?? 1.0;

      const xg = (hist.avgXg ?? 0) * goalPts;
      const xa = (hist.avgXa ?? 0) * ASSIST_POINTS;
      const csProb = csPts > 0 ? Math.max(0, 1 - (hist.avgXgc ?? 0)) : 0;
      const appearance = minutesProbability * APPEARANCE_POINTS_PER_90;
      const bonus = hist.avgBonus ?? 0;
      const saves = posId === 1 ? ((hist.avgSaves ?? 0) / 3) * SAVE_POINTS_PER_3 : 0;

      const rawXpts =
        (xg + xa + saves) * minutesProbability +
        csProb * csPts +
        appearance +
        bonus;

      return {
        playerId: p.id,
        playerName: p.webName,
        teamShortName: p.teamShortName,
        imagePath: p.imagePath,
        position: p.positionName,
        nextOpponent: nextFix.opponentShort,
        difficulty,
        xpts: Math.round(rawXpts * 10) / 10,
        form: p.form,
        minutesProbability,
      };
    });
  }

  getCaptainRecommendations(accountId: number, gameweek: number): CaptainRecommendation[] {
    // Get the manager's current squad
    type PickRow = { playerId: number };
    const picks = this.db.prepare(`
      SELECT player_id AS playerId
      FROM my_team_picks
      WHERE account_id = ? AND gameweek_id = ?
        AND position <= 11
    `).all(accountId, gameweek) as PickRow[];

    if (picks.length === 0) return [];

    const xptsAll = this.getPlayerXpts(gameweek);
    const xptsMap = new Map(xptsAll.map((x) => [x.playerId, x]));

    const squadXpts = picks
      .map((p) => xptsMap.get(p.playerId))
      .filter((x): x is PlayerXpts => x !== undefined && x.xpts !== null)
      .sort((a, b) => (b.xpts ?? 0) - (a.xpts ?? 0))
      .slice(0, 3);

    return squadXpts.map((x, i) => ({
      rank: i + 1,
      playerId: x.playerId,
      playerName: x.playerName,
      teamShortName: x.teamShortName,
      position: x.position,
      xpts: x.xpts,
      nextOpponent: x.nextOpponent,
      difficulty: x.difficulty,
      reasoning: [
        `xPts: ${x.xpts?.toFixed(1)}`,
        x.difficulty <= 2 ? "great fixture" : x.difficulty >= 4 ? "tough fixture" : "decent fixture",
        `${(x.minutesProbability * 100).toFixed(0)}% chance of playing`,
      ].join(" · "),
    }));
  }

  getTransferDecision(
    accountId: number,
    input: { gw?: number; horizon: TransferDecisionHorizon },
  ): TransferDecisionResponse | null {
    const myTeam = this.getMyTeam(accountId);
    if (!myTeam?.selectedAccountId || !myTeam.currentGameweek) {
      return null;
    }

    const gameweek = input.gw ?? myTeam.currentGameweek;
    const historyRow = myTeam.history.find((row) => row.gameweek === gameweek) ?? myTeam.history[0];
    const picksResponse = this.getMyTeamPicksForGameweek(accountId, gameweek);
    if (picksResponse.picks.length === 0 || !historyRow) {
      return null;
    }

    const bank = historyRow.bank;
    const horizon = input.horizon;
    const projections = this.getPlayerProjectionMap(gameweek, horizon);
    const ownedPlayerIds = new Set(picksResponse.picks.map((pick) => pick.player.id));

    const rollOption = this.createRollDecisionOption(bank, horizon);
    const bestOneFt = this.createBestOneTransferOption(
      picksResponse.picks,
      projections,
      ownedPlayerIds,
      bank,
      horizon,
    );

    const options = [rollOption, ...(bestOneFt ? [bestOneFt.option] : [])];
    const recommended = bestOneFt && bestOneFt.rankingScore > 0
      ? bestOneFt.option
      : rollOption;

    return {
      gameweek,
      freeTransfers: myTeam.freeTransfers,
      bank,
      horizon,
      recommendedOptionId: recommended.id,
      options,
    };
  }

  private createRollDecisionOption(
    bank: number,
    horizon: TransferDecisionHorizon,
  ): TransferDecisionOption {
    return {
      id: "roll",
      label: "roll",
      transfers: [],
      horizon,
      projectedGain: 0,
      nextGwGain: 0,
      hitCost: 0,
      remainingBank: bank,
      confidence: "medium",
      reasons: [
        "Sets the baseline for this week's decision.",
        `Keeps ${this.formatBank(bank)} in the bank for later moves.`,
      ],
      warnings: [],
    };
  }

  private createBestOneTransferOption(
    picks: MyTeamPick[],
    projections: Map<number, PlayerProjection>,
    ownedPlayerIds: Set<number>,
    bank: number,
    horizon: TransferDecisionHorizon,
  ): RankedTransferDecision | null {
    let bestOption: RankedTransferDecision | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const pick of picks) {
      const outgoingProjection = projections.get(pick.player.id);
      if (!outgoingProjection) continue;

      const sellValue = pick.sellingPrice ?? pick.player.nowCost;
      const pickWeight = this.getPickTransferWeight(pick);
      const affordableBudget = bank + sellValue;
      const candidates = [...projections.values()]
        .filter((candidate) => (
          candidate.positionId === pick.player.positionId &&
          candidate.playerId !== pick.player.id &&
          !ownedPlayerIds.has(candidate.playerId) &&
          candidate.nowCost <= affordableBudget
        ))
        .sort((a, b) => (
          b.weightedProjection - a.weightedProjection ||
          a.nowCost - b.nowCost ||
          a.playerName.localeCompare(b.playerName)
        ))
        .slice(0, 12);

      for (const incomingProjection of candidates) {
        const projectedGain = this.roundToTenth(
          incomingProjection.weightedProjection - outgoingProjection.weightedProjection,
        );
        const nextGwGain = this.roundToTenth(
          incomingProjection.nextGameweekProjection - outgoingProjection.nextGameweekProjection,
        );
        const remainingBank = bank + sellValue - incomingProjection.nowCost;
        const option: TransferDecisionOption = {
          id: `best-1ft-${pick.player.id}-${incomingProjection.playerId}-${horizon}`,
          label: "best_1ft",
          transfers: [
            {
              outPlayerId: pick.player.id,
              outPlayerName: pick.player.webName,
              inPlayerId: incomingProjection.playerId,
              inPlayerName: incomingProjection.playerName,
              position: incomingProjection.positionName,
              priceDelta: incomingProjection.nowCost - sellValue,
            },
          ],
          horizon,
          projectedGain,
          nextGwGain,
          hitCost: 0,
          remainingBank,
          confidence: this.getTransferConfidence(projectedGain, nextGwGain, incomingProjection),
          reasons: this.buildTransferReasons(
            pick,
            projectedGain,
            nextGwGain,
            horizon,
            outgoingProjection,
            incomingProjection,
            remainingBank,
            bank,
          ),
          warnings: this.buildTransferWarnings(
            pick,
            projectedGain,
            outgoingProjection,
            incomingProjection,
          ),
        };
        const optionScore = this.getDecisionOptionScore(option, pickWeight);

        if (optionScore > bestScore) {
          bestScore = optionScore;
          bestOption = {
            option,
            rankingScore: optionScore,
          };
        }
      }
    }

    return bestOption;
  }

  private getDecisionOptionScore(option: TransferDecisionOption, pickWeight = 1): number {
    if (option.label === "roll") {
      return 0;
    }

    let score = (option.projectedGain * pickWeight) + (option.nextGwGain * 0.35 * pickWeight);

    if (option.projectedGain < 0.6) {
      score -= 0.45;
    }

    if (option.projectedGain < 0.3) {
      score -= 0.2;
    }

    if (option.remainingBank > 0 && option.projectedGain >= 0.4) {
      score += Math.min(option.remainingBank, 20) * 0.005;
    }

    for (const warning of option.warnings) {
      if (warning.includes("bench depth")) score -= 0.2;
      if (warning.includes("availability") || warning.includes("minutes")) score -= 0.2;
      if (warning.includes("Close to rolling")) score -= 0.15;
      if (warning.includes("blank next gameweek")) score -= 0.35;
    }

    return this.roundToTenth(score);
  }

  private getTransferConfidence(
    projectedGain: number,
    nextGwGain: number,
    incomingProjection: PlayerProjection,
  ): TransferDecisionOption["confidence"] {
    if (projectedGain >= 2.5 && nextGwGain >= 1.2 && incomingProjection.minutesProbability >= 0.8) {
      return "strong";
    }

    if (projectedGain >= 1) {
      return "medium";
    }

    return "close_call";
  }

  private buildTransferReasons(
    pick: MyTeamPick,
    projectedGain: number,
    nextGwGain: number,
    horizon: TransferDecisionHorizon,
    outgoingProjection: PlayerProjection,
    incomingProjection: PlayerProjection,
    remainingBank: number,
    currentBank: number,
  ) {
    const reasons = [
      `${projectedGain >= 0 ? "+" : ""}${projectedGain.toFixed(1)} xPts over ${horizon} GW${horizon > 1 ? "s" : ""}.`,
    ];

    if (pick.role === "starter") {
      reasons.push("Improves a likely starter rather than just your bench.");
    }

    if (nextGwGain >= 0.4) {
      reasons.push(
        `${incomingProjection.playerName} improves the immediate outlook by ${nextGwGain.toFixed(1)} xPts next GW.`,
      );
    }

    if (
      incomingProjection.averageDifficulty !== null &&
      outgoingProjection.averageDifficulty !== null &&
      incomingProjection.averageDifficulty < outgoingProjection.averageDifficulty
    ) {
      reasons.push(
        `${incomingProjection.playerName} has the softer short-term fixture run.`,
      );
    }

    if (remainingBank > currentBank) {
      reasons.push(`Leaves ${this.formatBank(remainingBank)} in the bank for next week.`);
    }

    return reasons;
  }

  private buildTransferWarnings(
    pick: MyTeamPick,
    projectedGain: number,
    outgoingProjection: PlayerProjection,
    incomingProjection: PlayerProjection,
  ) {
    const warnings: string[] = [];

    if (projectedGain < 0.75) {
      warnings.push("Close to rolling this week.");
    }

    if (pick.role !== "starter") {
      warnings.push("Mostly improves bench depth rather than the starting XI.");
    }

    if (incomingProjection.minutesProbability < 0.75 || incomingProjection.status !== "a") {
      warnings.push("Incoming player carries some availability or minutes risk.");
    }

    if (incomingProjection.nextOpponent === "BGW" && outgoingProjection.nextOpponent !== "BGW") {
      warnings.push("Incoming player has a blank next gameweek.");
    }

    return warnings;
  }

  private getPickTransferWeight(pick: MyTeamPick) {
    if (pick.role === "starter") {
      return 1;
    }

    if (pick.player.positionId === 1) {
      return 0.15;
    }

    switch (pick.benchOrder) {
      case 1:
        return 0.45;
      case 2:
        return 0.3;
      case 3:
        return 0.15;
      default:
        return 0.2;
    }
  }

  private getPlayerProjectionMap(
    startingGameweek: number,
    horizon: TransferDecisionHorizon,
  ): Map<number, PlayerProjection> {
    const weights = this.getProjectionWeights(horizon);
    const targetGameweeks = weights.map((_, index) => startingGameweek + index);
    const recentStats = this.getRecentPlayerStats();
    const teamFixtures = this.getUpcomingTeamFixtures(
      startingGameweek,
      targetGameweeks[targetGameweeks.length - 1] ?? startingGameweek,
    );

    const players = this.db.prepare(
      `SELECT p.id, p.web_name AS webName, p.team_id AS teamId, t.short_name AS teamShortName,
              p.position_id AS positionId, pos.name AS positionName, p.now_cost AS nowCost, p.status
       FROM players p
       JOIN teams t ON t.id = p.team_id
       JOIN positions pos ON pos.id = p.position_id
       WHERE p.status != 'u'
       ORDER BY p.id`,
    ).all() as TransferProjectionPlayerRow[];

    return new Map(players.map((player) => {
      const stats = recentStats.get(player.id);
      const minutesProbability = Math.min(1, (stats?.avgMinutes ?? 0) / 90);
      const fixturesByGw = teamFixtures.get(player.teamId) ?? new Map<number, TeamUpcomingFixture[]>();
      const perGameweek = targetGameweeks.map((gameweek, index) => {
        const fixtures = fixturesByGw.get(gameweek) ?? [];
        const total = fixtures.reduce((sum, fixture) => {
          return sum + this.projectFixturePoints(player.positionId, player.status, stats, fixture.isHome, fixture.difficulty);
        }, 0);
        return this.roundToTenth(total * weights[index]);
      });

      const nextGameweekFixtures = fixturesByGw.get(startingGameweek) ?? [];
      const nextGameweekProjection = this.roundToTenth(
        nextGameweekFixtures.reduce((sum, fixture) => (
          sum + this.projectFixturePoints(player.positionId, player.status, stats, fixture.isHome, fixture.difficulty)
        ), 0),
      );
      const allFixtures = targetGameweeks.flatMap((gameweek) => fixturesByGw.get(gameweek) ?? []);
      const averageDifficulty = allFixtures.length > 0
        ? this.roundToTenth(
            allFixtures.reduce((sum, fixture) => sum + fixture.difficulty, 0) / allFixtures.length,
          )
        : null;
      const nextOpponent = nextGameweekFixtures.length > 0
        ? nextGameweekFixtures
          .map((fixture) => `${fixture.opponentShort}${fixture.isHome ? " (H)" : " (A)"}`)
          .join(", ")
        : "BGW";

      return [player.id, {
        playerId: player.id,
        playerName: player.webName,
        teamId: player.teamId,
        teamShortName: player.teamShortName,
        positionId: player.positionId,
        positionName: player.positionName,
        nowCost: player.nowCost,
        status: player.status,
        minutesProbability,
        nextOpponent,
        averageDifficulty,
        perGameweek,
        weightedProjection: this.roundToTenth(perGameweek.reduce((sum, score) => sum + score, 0)),
        nextGameweekProjection,
      }];
    }));
  }

  private getProjectionWeights(horizon: TransferDecisionHorizon) {
    switch (horizon) {
      case 1:
        return [1];
      case 3:
        return [0.55, 0.3, 0.15];
      case 5:
        return [0.4, 0.25, 0.15, 0.12, 0.08];
      default:
        return [1];
    }
  }

  private getRecentPlayerStats() {
    const rows = this.db.prepare(
      `SELECT
         ph.player_id AS playerId,
         AVG(ph.expected_goals) AS avgXg,
         AVG(ph.expected_assists) AS avgXa,
         AVG(ph.minutes) AS avgMinutes,
         AVG(ph.bonus) AS avgBonus,
         AVG(ph.expected_goals_conceded) AS avgXgc,
         AVG(ph.saves) AS avgSaves,
         COUNT(*) AS gwCount
       FROM player_history ph
       WHERE ph.round IN (
         SELECT DISTINCT round
         FROM player_history
         ORDER BY round DESC
         LIMIT 5
       )
       GROUP BY ph.player_id`,
    ).all() as RecentPlayerStats[];

    return new Map(rows.map((row) => [row.playerId, row]));
  }

  private getUpcomingTeamFixtures(startingGameweek: number, endingGameweek: number) {
    const fdrMap = new Map(
      this.getFdrData().map((row) => [
        row.teamId,
        new Map(row.fixtures.map((fixture) => [`${fixture.gameweek}-${fixture.opponentId}`, fixture])),
      ]),
    );

    const rows = this.db.prepare(
      `SELECT
         t.id AS teamId,
         f.event_id AS gameweek,
         opp.id AS opponentId,
         opp.short_name AS opponentShort,
         CASE WHEN f.team_h = t.id THEN 1 ELSE 0 END AS isHome
       FROM teams t
       JOIN fixtures f ON (f.team_h = t.id OR f.team_a = t.id)
       JOIN teams opp ON opp.id = CASE WHEN f.team_h = t.id THEN f.team_a ELSE f.team_h END
       WHERE f.finished = 0
         AND f.event_id IS NOT NULL
         AND f.event_id >= ?
         AND f.event_id <= ?
       ORDER BY t.id, f.event_id, f.kickoff_time`,
    ).all(startingGameweek, endingGameweek) as Array<{
      teamId: number;
      gameweek: number;
      opponentId: number;
      opponentShort: string;
      isHome: number;
    }>;

    const fixturesByTeam = new Map<number, Map<number, TeamUpcomingFixture[]>>();
    for (const row of rows) {
      const difficulty = fdrMap.get(row.teamId)?.get(`${row.gameweek}-${row.opponentId}`)?.difficulty ?? 3;
      if (!fixturesByTeam.has(row.teamId)) {
        fixturesByTeam.set(row.teamId, new Map<number, TeamUpcomingFixture[]>());
      }
      const byGameweek = fixturesByTeam.get(row.teamId)!;
      if (!byGameweek.has(row.gameweek)) {
        byGameweek.set(row.gameweek, []);
      }
      byGameweek.get(row.gameweek)!.push({
        teamId: row.teamId,
        gameweek: row.gameweek,
        opponentId: row.opponentId,
        opponentShort: row.opponentShort,
        difficulty,
        isHome: Boolean(row.isHome),
      });
    }

    return fixturesByTeam;
  }

  private projectFixturePoints(
    positionId: number,
    status: string,
    stats: RecentPlayerStats | undefined,
    isHome: boolean,
    difficulty: number,
  ) {
    if (!stats || stats.gwCount < 2) {
      return 0;
    }

    const goalPoints: Record<number, number> = { 1: 6, 2: 6, 3: 5, 4: 4 };
    const cleanSheetPoints: Record<number, number> = { 1: 6, 2: 6, 3: 1, 4: 0 };
    const difficultyMultipliers: Record<number, number> = {
      1: 1.2,
      2: 1.1,
      3: 1,
      4: 0.85,
      5: 0.75,
    };
    const availabilityPenalty = status === "a" ? 1 : 0.7;
    const homeBoost = isHome ? 1.05 : 1;
    const minutesProbability = Math.min(1, (stats.avgMinutes ?? 0) / 90);
    const attackingContribution =
      (stats.avgXg ?? 0) * (goalPoints[positionId] ?? 4) +
      (stats.avgXa ?? 0) * 3 +
      (positionId === 1 ? (stats.avgSaves ?? 0) / 3 : 0);
    const cleanSheetProbability =
      cleanSheetPoints[positionId] > 0
        ? Math.max(0, 1 - (stats.avgXgc ?? 0))
        : 0;
    const appearance = minutesProbability * 2;
    const bonus = stats.avgBonus ?? 0;

    return (
      (((attackingContribution * minutesProbability) + (cleanSheetProbability * (cleanSheetPoints[positionId] ?? 0)) + appearance + bonus)
        * (difficultyMultipliers[difficulty] ?? 1)
        * homeBoost
        * availabilityPenalty)
    );
  }

  private roundToTenth(value: number) {
    return Math.round(value * 10) / 10;
  }

  private formatBank(bank: number) {
    return `${(bank / 10).toFixed(1)}m`;
  }

  getGwCalendar(): GwCalendarRow[] {
    const teams = this.db
      .prepare(`SELECT id, name, short_name AS shortName FROM teams ORDER BY name`)
      .all() as Array<{ id: number; name: string; shortName: string }>;

    const currentGwRow = this.db
      .prepare(`SELECT id FROM gameweeks WHERE is_current = 1 ORDER BY id LIMIT 1`)
      .get() as { id: number } | undefined;
    const currentGw = currentGwRow?.id ?? 1;

    const fixtures = this.db
      .prepare(
        `SELECT f.event_id AS gameweek,
                f.team_h AS homeTeamId, f.team_a AS awayTeamId,
                th.short_name AS homeShort, ta.short_name AS awayShort
         FROM fixtures f
         JOIN teams th ON th.id = f.team_h
         JOIN teams ta ON ta.id = f.team_a
         WHERE f.event_id >= ? AND f.event_id <= ? AND f.event_id IS NOT NULL
         ORDER BY f.event_id, f.id`,
      )
      .all(currentGw, currentGw + 9) as Array<{
        gameweek: number;
        homeTeamId: number;
        awayTeamId: number;
        homeShort: string;
        awayShort: string;
      }>;

    const lookup = new Map<number, Map<number, GwCalendarFixture[]>>();
    for (const t of teams) lookup.set(t.id, new Map());

    for (const f of fixtures) {
      const home = lookup.get(f.homeTeamId);
      if (home) {
        const arr = home.get(f.gameweek) ?? [];
        arr.push({ opponentShort: f.awayShort, isHome: true });
        home.set(f.gameweek, arr);
      }
      const away = lookup.get(f.awayTeamId);
      if (away) {
        const arr = away.get(f.gameweek) ?? [];
        arr.push({ opponentShort: f.homeShort, isHome: false });
        away.set(f.gameweek, arr);
      }
    }

    const gwRange = Array.from(new Set(fixtures.map((f) => f.gameweek))).sort(
      (a, b) => a - b,
    );

    return teams.map((t) => ({
      teamId: t.id,
      teamName: t.name,
      teamShortName: t.shortName,
      gameweeks: Object.fromEntries(
        gwRange.map((gw) => [gw, lookup.get(t.id)?.get(gw) ?? []]),
      ),
    }));
  }
}
