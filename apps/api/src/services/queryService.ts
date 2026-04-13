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
  TransferDecisionReplayState,
  TransferDecisionResponse,
} from "@fpl/contracts";
import type { AppDatabase } from "../db/database.js";
import { ManagerRoiService, type ManagerRoiProfile } from "./managerRoiService.js";
import { MlModelRegistryService } from "./mlModelRegistryService.js";
import { H2HQueryService } from "./h2hQueryService.js";

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
  recentXg90: number;
  recentXa90: number;
  recentXgc90: number;
  recentBonus90: number;
  recentSaves90: number;
  recentYellow90: number;
  recentRed90: number;
  recentGoalsConceded90: number;
  recentAvgMinutes: number;
  recentStartProbability: number;
  recentGwCount: number;
  seasonXg90: number;
  seasonXa90: number;
  seasonXgc90: number;
  seasonBonus90: number;
  seasonSaves90: number;
  seasonYellow90: number;
  seasonRed90: number;
  seasonGoalsConceded90: number;
  seasonAvgMinutes: number;
  seasonStartProbability: number;
  seasonGwCount: number;
};

type TransferProjectionPlayerRow = {
  id: number;
  webName: string;
  teamId: number;
  teamShortName: string;
  imagePath: string | null;
  positionId: number;
  positionName: string;
  nowCost: number;
  form: number;
  totalMinutes: number;
  totalStarts: number;
  totalExpectedGoals: number;
  totalExpectedAssists: number;
  totalExpectedGoalsConceded: number;
  totalBonus: number;
  status: string;
  hasHistoricalPrice: number;
  hasHistoricalTeam: number;
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
  imagePath: string | null;
  positionId: number;
  positionName: string;
  nowCost: number;
  form: number;
  status: string;
  minutesProbability: number;
  startProbability: number;
  nextOpponent: string;
  nextGameweekDifficulty: number;
  averageDifficulty: number | null;
  perGameweek: number[];
  weightedProjection: number;
  nextGameweekProjection: number;
  attackingWeightedProjection: number;
  attackingNextGameweekProjection: number;
  cleanSheetWeightedProjection: number;
  hasHistoricalPrice: boolean;
};

type RankedTransferDecision = {
  option: TransferDecisionOption;
  rankingScore: number;
  guardrailMetrics: GuardrailMetrics;
};

type GuardrailMetrics = {
  projectedGain: number;
  nextGwGain: number;
};

type HistoricalReplayContext = {
  replayState: TransferDecisionReplayState;
  replayNotes: string[];
  freeTransfers: number;
};

type PositionPrior = {
  positionId: number;
  xg90: number;
  xa90: number;
  xgc90: number;
  bonus90: number;
  saves90: number;
  yellow90: number;
  red90: number;
  goalsConceded90: number;
  avgMinutes: number;
  startProbability: number;
};

type TeamStrengthSnapshot = {
  teamId: number;
  attackStrength: number;
  defenseWeakness: number;
};

type ProjectedFixtureScore = {
  total: number;
  attacking: number;
  cleanSheet: number;
  appearance: number;
  minutesProbability: number;
  startProbability: number;
  expectedGoalsConceded: number;
  cleanSheetProbability: number;
};

type EventModelWeights = {
  goalWeight: number;
  assistWeight: number;
  cleanSheetWeight: number;
  saveWeight: number;
  bonusWeight: number;
  appearanceWeight: number;
  concedePenaltyWeight: number;
};

const ACTIVE_TRANSFER_EVENT_MODEL = "transfer_event_points_v2";
const DEFAULT_EVENT_MODEL_WEIGHTS: EventModelWeights = {
  goalWeight: 1,
  assistWeight: 1,
  cleanSheetWeight: 1,
  saveWeight: 1,
  bonusWeight: 1,
  appearanceWeight: 1,
  concedePenaltyWeight: 1,
};

function mapBoolean(value: number | null | undefined) {
  return Boolean(value);
}

export class QueryService {
  private readonly managerRoiService: ManagerRoiService;
  private readonly mlModelRegistryService: MlModelRegistryService;
  private readonly h2hQueryService: H2HQueryService;

  constructor(private readonly db: AppDatabase) {
    this.managerRoiService = new ManagerRoiService(db);
    this.mlModelRegistryService = new MlModelRegistryService(db);
    this.h2hQueryService = new H2HQueryService(db, this.getPlayerXpts.bind(this));
  }

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

  getH2HComparison(accountId: number, leagueId: number, rivalEntryId: number) {
    return this.h2hQueryService.getH2HComparison(accountId, leagueId, rivalEntryId);
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
    const currentGw = this.db
      .prepare(`SELECT id FROM gameweeks WHERE is_current = 1 ORDER BY id LIMIT 1`)
      .get() as { id: number } | undefined;
    const startingGameweek = gameweek ?? currentGw?.id ?? 1;
    const projections = this.getPlayerProjectionMap(
      startingGameweek,
      1,
      this.getActiveEventModelWeights(),
    );

    return [...projections.values()].map((projection) => ({
      playerId: projection.playerId,
      playerName: projection.playerName,
      teamShortName: projection.teamShortName,
      imagePath: projection.imagePath,
      position: projection.positionName,
      nextOpponent: projection.nextOpponent,
      difficulty: projection.nextGameweekDifficulty,
      xpts: projection.nextOpponent === "BGW" ? null : projection.nextGameweekProjection,
      form: projection.form,
      minutesProbability: projection.minutesProbability,
    }));
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
    const historyRow = myTeam.history.find((row) => row.gameweek === gameweek);
    if (!historyRow) {
      return null;
    }
    const picksResponse = this.getMyTeamPicksForGameweek(accountId, gameweek);
    const isHistoricalReplay = gameweek !== myTeam.currentGameweek;
    const historicalReplay = this.getHistoricalReplayContext(isHistoricalReplay, myTeam.freeTransfers);
    if (picksResponse.picks.length === 0) {
      return this.createUnavailableTransferDecision(
        gameweek,
        historyRow.bank,
        input.horizon,
        historicalReplay,
        "Historical replay is unavailable for this gameweek because stored squad context is incomplete.",
      );
    }

    const bank = historyRow.bank;
    const horizon = input.horizon;
    const eventModelWeights = this.getActiveEventModelWeights();
    const useDefaultGuardrails = this.isDefaultEventModelWeights(eventModelWeights);
    const managerRiskProfile = isHistoricalReplay
      ? null
      : this.getManagerRiskProfile(accountId);
    const projections = isHistoricalReplay
      ? this.getHistoricalPlayerProjectionMap(gameweek, horizon, eventModelWeights)
      : this.getPlayerProjectionMap(gameweek, horizon, eventModelWeights);
    const guardrailProjections = useDefaultGuardrails
      ? projections
      : (
          isHistoricalReplay
            ? this.getHistoricalPlayerProjectionMap(gameweek, horizon, DEFAULT_EVENT_MODEL_WEIGHTS)
            : this.getPlayerProjectionMap(gameweek, horizon, DEFAULT_EVENT_MODEL_WEIGHTS)
        );
    const ownedPlayerIds = new Set(picksResponse.picks.map((pick) => pick.player.id));

    const rollOption = this.createRollDecisionOption(bank, horizon);
    const bestOneFt = this.createBestOneTransferOption(
      picksResponse.picks,
      projections,
      guardrailProjections,
      ownedPlayerIds,
      bank,
      horizon,
      managerRiskProfile,
      { historicalReplay: isHistoricalReplay, gameweek },
    );

    const surfacedBestOneFt = bestOneFt && this.shouldSurfaceTransferOption(
      bestOneFt.option,
      bestOneFt.guardrailMetrics,
    )
      ? bestOneFt.option
      : null;
    const options = [rollOption, ...(surfacedBestOneFt ? [surfacedBestOneFt] : [])];
    const recommended = bestOneFt && this.shouldRecommendTransfer(
      bestOneFt.option,
      bestOneFt.rankingScore,
      managerRiskProfile,
      bestOneFt.guardrailMetrics,
    )
      ? bestOneFt.option
      : rollOption;

    return {
      gameweek,
      freeTransfers: historicalReplay.freeTransfers,
      bank,
      horizon,
      replayState: historicalReplay.replayState,
      replayNotes: historicalReplay.replayNotes,
      recommendedOptionId: recommended.id,
      options,
    };
  }

  private getHistoricalReplayContext(
    isHistoricalReplay: boolean,
    currentFreeTransfers: number,
  ): HistoricalReplayContext {
    if (!isHistoricalReplay) {
      return {
        replayState: "full",
        replayNotes: [],
        freeTransfers: currentFreeTransfers,
      };
    }

    return {
      replayState: "degraded",
      replayNotes: [
        "Historical replay uses stored pre-deadline squad and price context.",
        "Historical free transfers are inferred conservatively as 1.",
        "Historical availability and future fixture snapshots are partial, so replay confidence is reduced.",
      ],
      freeTransfers: 1,
    };
  }

  private createUnavailableTransferDecision(
    gameweek: number,
    bank: number,
    horizon: TransferDecisionHorizon,
    replay: HistoricalReplayContext,
    note: string,
  ): TransferDecisionResponse {
    return {
      gameweek,
      freeTransfers: replay.freeTransfers,
      bank,
      horizon,
      replayState: "unavailable",
      replayNotes: [...replay.replayNotes, note],
      recommendedOptionId: null,
      options: [],
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

  private shouldRecommendTransfer(
    option: TransferDecisionOption,
    rankingScore: number,
    managerRiskProfile: ManagerRoiProfile | null,
    guardrailMetrics: GuardrailMetrics,
  ) {
    const minimumScore = this.getMinimumRecommendationScore(managerRiskProfile);
    if (rankingScore <= minimumScore || option.label === "roll") {
      return false;
    }

    const transfer = option.transfers[0];
    if (
      transfer?.position === "Goalkeeper" &&
      transfer.priceDelta <= -10 &&
      guardrailMetrics.projectedGain < 4
    ) {
      return false;
    }

    return true;
  }

  private shouldSurfaceTransferOption(
    option: TransferDecisionOption,
    guardrailMetrics: GuardrailMetrics,
  ) {
    if (option.label === "roll") {
      return true;
    }

    const transfer = option.transfers[0];
    if (!transfer) {
      return false;
    }

    if (option.projectedGain <= 0 && option.nextGwGain <= 0) {
      return false;
    }

    if (
      transfer.position === "Goalkeeper" &&
      transfer.priceDelta <= -10 &&
      guardrailMetrics.projectedGain < 4
    ) {
      return false;
    }

    return true;
  }

  private getMinimumRecommendationScore(managerRiskProfile: ManagerRoiProfile | null) {
    switch (managerRiskProfile?.recommendedRiskPosture) {
      case "safe":
        return 0.2;
      case "upside":
        return -0.05;
      default:
        return 0;
    }
  }

  private getManagerRiskProfile(accountId: number): ManagerRoiProfile | null {
    try {
      return this.managerRoiService.evaluateManagerRoi({ accountId });
    } catch {
      return null;
    }
  }

  private getManagerRiskScoreAdjustment(
    managerRiskProfile: ManagerRoiProfile | null,
    option: TransferDecisionOption,
    pick: MyTeamPick,
    incomingProjection: PlayerProjection,
  ) {
    if (!managerRiskProfile) {
      return 0;
    }

    const closeCallMove = option.projectedGain < 1.2;
    let adjustment = 0;

    switch (managerRiskProfile.recommendedRiskPosture) {
      case "safe":
        if (closeCallMove) adjustment -= 0.25;
        if (option.remainingBank < 5) adjustment -= 0.05;
        break;
      case "upside":
        if (closeCallMove && pick.role === "starter") adjustment += 0.12;
        if (incomingProjection.attackingNextGameweekProjection >= 1.5) adjustment += 0.08;
        break;
      default:
        if (closeCallMove && pick.role === "starter") adjustment += 0.03;
        break;
    }

    return this.roundToTenth(adjustment);
  }

  private getActiveEventModelWeights(): EventModelWeights {
    const activeVersion =
      this.mlModelRegistryService.getActiveVersionForModelName(
        ACTIVE_TRANSFER_EVENT_MODEL,
      );

    if (!activeVersion) {
      return DEFAULT_EVENT_MODEL_WEIGHTS;
    }

    const coefficients = activeVersion.coefficients;
    return {
      goalWeight: this.readCoefficient(coefficients, "goal_weight", DEFAULT_EVENT_MODEL_WEIGHTS.goalWeight),
      assistWeight: this.readCoefficient(coefficients, "assist_weight", DEFAULT_EVENT_MODEL_WEIGHTS.assistWeight),
      cleanSheetWeight: this.readCoefficient(coefficients, "clean_sheet_weight", DEFAULT_EVENT_MODEL_WEIGHTS.cleanSheetWeight),
      saveWeight: this.readCoefficient(coefficients, "save_weight", DEFAULT_EVENT_MODEL_WEIGHTS.saveWeight),
      bonusWeight: this.readCoefficient(coefficients, "bonus_weight", DEFAULT_EVENT_MODEL_WEIGHTS.bonusWeight),
      appearanceWeight: this.readCoefficient(coefficients, "appearance_weight", DEFAULT_EVENT_MODEL_WEIGHTS.appearanceWeight),
      concedePenaltyWeight: this.readCoefficient(coefficients, "concede_penalty_weight", DEFAULT_EVENT_MODEL_WEIGHTS.concedePenaltyWeight),
    };
  }

  private isDefaultEventModelWeights(eventModelWeights: EventModelWeights) {
    return (
      eventModelWeights.goalWeight === DEFAULT_EVENT_MODEL_WEIGHTS.goalWeight &&
      eventModelWeights.assistWeight === DEFAULT_EVENT_MODEL_WEIGHTS.assistWeight &&
      eventModelWeights.cleanSheetWeight === DEFAULT_EVENT_MODEL_WEIGHTS.cleanSheetWeight &&
      eventModelWeights.saveWeight === DEFAULT_EVENT_MODEL_WEIGHTS.saveWeight &&
      eventModelWeights.bonusWeight === DEFAULT_EVENT_MODEL_WEIGHTS.bonusWeight &&
      eventModelWeights.appearanceWeight === DEFAULT_EVENT_MODEL_WEIGHTS.appearanceWeight &&
      eventModelWeights.concedePenaltyWeight === DEFAULT_EVENT_MODEL_WEIGHTS.concedePenaltyWeight
    );
  }

  private readCoefficient(
    coefficients: Record<string, unknown>,
    key: string,
    fallback: number,
  ) {
    const value = coefficients[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  private createBestOneTransferOption(
    picks: MyTeamPick[],
    projections: Map<number, PlayerProjection>,
    guardrailProjections: Map<number, PlayerProjection>,
    ownedPlayerIds: Set<number>,
    bank: number,
    horizon: TransferDecisionHorizon,
    managerRiskProfile: ManagerRoiProfile | null,
    options?: { historicalReplay?: boolean; gameweek?: number },
  ): RankedTransferDecision | null {
    let bestOption: RankedTransferDecision | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    const rankedPicks = [...picks].sort((a, b) => {
      const projectionA = projections.get(a.player.id);
      const projectionB = projections.get(b.player.id);
      return this.getPickUrgencyScore(b, projectionB) - this.getPickUrgencyScore(a, projectionA);
    });

    for (const pick of rankedPicks) {
      const outgoingProjection = projections.get(pick.player.id);
      if (!outgoingProjection) continue;

      const sellValue = options?.historicalReplay
        ? this.getHistoricalSellValue(
            pick.player.id,
            options.gameweek ?? 1,
            pick.sellingPrice ?? pick.purchasePrice ?? pick.player.nowCost,
          )
        : (pick.sellingPrice ?? pick.player.nowCost);
      const affordableBudget = bank + sellValue;
      const candidates = [...projections.values()]
        .filter((candidate) => (
          candidate.positionId === pick.player.positionId &&
          candidate.playerId !== pick.player.id &&
          !ownedPlayerIds.has(candidate.playerId) &&
          (!options?.historicalReplay || candidate.hasHistoricalPrice) &&
          candidate.nowCost <= affordableBudget
        ))
        .sort((a, b) => (
          b.weightedProjection - a.weightedProjection ||
          a.nowCost - b.nowCost ||
          a.playerName.localeCompare(b.playerName)
        ))
        .slice(0, this.getCandidateLimitForPick(pick));

      for (const incomingProjection of candidates) {
        const projectedGain = this.roundToTenth(
          incomingProjection.weightedProjection - outgoingProjection.weightedProjection,
        );
        const nextGwGain = this.roundToTenth(
          incomingProjection.nextGameweekProjection - outgoingProjection.nextGameweekProjection,
        );
        const guardrailOutgoingProjection =
          guardrailProjections.get(pick.player.id) ?? outgoingProjection;
        const guardrailIncomingProjection =
          guardrailProjections.get(incomingProjection.playerId) ?? incomingProjection;
        const guardrailMetrics: GuardrailMetrics = {
          projectedGain: this.roundToTenth(
            guardrailIncomingProjection.weightedProjection -
              guardrailOutgoingProjection.weightedProjection,
          ),
          nextGwGain: this.roundToTenth(
            guardrailIncomingProjection.nextGameweekProjection -
              guardrailOutgoingProjection.nextGameweekProjection,
          ),
        };
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
            nextGwGain,
            outgoingProjection,
            incomingProjection,
            incomingProjection.nowCost - sellValue,
          ),
        };
        const optionScore = this.getDecisionOptionScore(
          option,
          pick,
          outgoingProjection,
          incomingProjection,
          managerRiskProfile,
          guardrailMetrics,
        );

        if (optionScore > bestScore) {
          bestScore = optionScore;
          bestOption = {
            option,
            rankingScore: optionScore,
            guardrailMetrics,
          };
        }
      }
    }

    return bestOption;
  }

  private getDecisionOptionScore(
    option: TransferDecisionOption,
    pick: MyTeamPick,
    outgoingProjection: PlayerProjection,
    incomingProjection: PlayerProjection,
    managerRiskProfile: ManagerRoiProfile | null,
    guardrailMetrics: GuardrailMetrics,
  ): number {
    if (option.label === "roll") {
      return 0;
    }

    const pickWeight = this.getPickTransferWeight(pick);
    const attackingGain = incomingProjection.attackingWeightedProjection - outgoingProjection.attackingWeightedProjection;
    const nextGwAttackingGain =
      incomingProjection.attackingNextGameweekProjection - outgoingProjection.attackingNextGameweekProjection;
    const isAttackingSlot = pick.player.positionId === 3 || pick.player.positionId === 4;
    const isLowImpactSlot = pick.player.positionId === 1 || pick.player.positionId === 2;
    const closeCallBand = option.projectedGain < 1.2 ? 1 : 0;
    const priceDelta = option.transfers[0]?.priceDelta ?? 0;
    const isCashGenerationMove = isLowImpactSlot && priceDelta <= -10;
    const isGoalkeeperCashGenerationMove = pick.player.positionId === 1 && priceDelta <= -10;

    let score =
      (option.projectedGain * pickWeight) +
      (option.nextGwGain * 0.45 * pickWeight) +
      (attackingGain * 0.35) +
      (nextGwAttackingGain * 0.25);

    if (option.projectedGain < 0.6) {
      score -= 0.45;
    }

    if (option.projectedGain < 0.3) {
      score -= 0.2;
    }

    if (option.remainingBank > 0 && option.projectedGain >= 0.4) {
      score += Math.min(option.remainingBank, 20) * 0.005;
    }

    if (closeCallBand) {
      if (isAttackingSlot) score += 0.18;
      if (pick.role === "starter") score += 0.12;
      if (isLowImpactSlot) score -= 0.2;
      if (pick.role !== "starter") score -= 0.18;
    }

    if (pick.player.positionId === 1 && guardrailMetrics.projectedGain < 1.4) {
      score -= 0.25;
    }

    if (pick.player.positionId === 1 && guardrailMetrics.projectedGain < 1.8) {
      score -= 0.2;
    }

    if (pick.player.positionId === 1 && guardrailMetrics.nextGwGain < 0.8) {
      score -= 0.15;
    }

    if (isGoalkeeperCashGenerationMove && guardrailMetrics.projectedGain < 4) {
      score -= 1.4;
    }

    if (pick.player.positionId === 2 && option.projectedGain < 1.1) {
      score -= 0.12;
    }

    if (isCashGenerationMove && guardrailMetrics.projectedGain < 1.5) {
      score -= 0.45;
    }

    score += this.getManagerRiskScoreAdjustment(
      managerRiskProfile,
      option,
      pick,
      incomingProjection,
    );

    for (const warning of option.warnings) {
      if (warning.includes("bench depth")) score -= 0.2;
      if (warning.includes("availability") || warning.includes("minutes")) score -= 0.2;
      if (warning.includes("Close to rolling")) score -= 0.15;
      if (warning.includes("blank next gameweek")) score -= 0.35;
      if (warning.includes("low-ceiling")) score -= 0.2;
      if (warning.includes("frees cash")) score -= 0.25;
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

    const attackingGain = this.roundToTenth(
      incomingProjection.attackingWeightedProjection - outgoingProjection.attackingWeightedProjection,
    );
    if ((pick.player.positionId === 3 || pick.player.positionId === 4) && attackingGain >= 0.4) {
      reasons.push(`${incomingProjection.playerName} adds more goal involvement upside across the horizon.`);
    }

    if (nextGwGain >= 0.4) {
      reasons.push(
        `${incomingProjection.playerName} improves the immediate outlook by ${nextGwGain.toFixed(1)} xPts next GW.`,
      );
    }

    if (incomingProjection.minutesProbability - outgoingProjection.minutesProbability >= 0.1) {
      reasons.push(`${incomingProjection.playerName} looks likelier to reach 60+ minutes consistently.`);
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
    nextGwGain: number,
    outgoingProjection: PlayerProjection,
    incomingProjection: PlayerProjection,
    priceDelta: number,
  ) {
    const warnings: string[] = [];

    if (projectedGain < 0.75) {
      warnings.push("Close to rolling this week.");
    }

    if (pick.role !== "starter") {
      warnings.push("Mostly improves bench depth rather than the starting XI.");
    }

    if ((pick.player.positionId === 1 || pick.player.positionId === 2) && projectedGain < 1.2) {
      warnings.push("Still a relatively low-ceiling position move unless the gain grows.");
    }

    if (pick.player.positionId === 1 && priceDelta <= -10 && projectedGain < 4) {
      warnings.push("Mostly frees cash from a low-ceiling goalkeeper slot rather than adding enough upside.");
    } else if ((pick.player.positionId === 1 || pick.player.positionId === 2) && priceDelta <= -10 && projectedGain < 1.5) {
      warnings.push("Mostly frees cash from a low-ceiling slot rather than adding meaningful upside.");
    }

    if (incomingProjection.minutesProbability < 0.75 || incomingProjection.status !== "a") {
      warnings.push("Incoming player carries some availability or minutes risk.");
    }

    if (incomingProjection.nextOpponent === "BGW" && outgoingProjection.nextOpponent !== "BGW") {
      warnings.push("Incoming player has a blank next gameweek.");
    }

    if (pick.role === "starter" && nextGwGain < 0.2 && projectedGain < 0.9) {
      warnings.push("Limited immediate impact for a likely starter this week.");
    }

    return warnings;
  }

  private getPickUrgencyScore(
    pick: MyTeamPick,
    projection: PlayerProjection | undefined,
  ) {
    if (!projection) return 0;

    let score = pick.role === "starter" ? 1.2 : 0.45;

    if (pick.player.positionId === 3 || pick.player.positionId === 4) {
      score += 0.2;
    }

    if (pick.player.positionId === 1 && pick.role !== "starter") {
      score -= 0.45;
    }

    score += Math.max(0, 5 - projection.nextGameweekProjection) * 0.12;
    score += Math.max(0, 3 - projection.attackingNextGameweekProjection) * (
      pick.player.positionId === 3 || pick.player.positionId === 4 ? 0.1 : 0.02
    );

    return this.roundToTenth(score);
  }

  private getCandidateLimitForPick(pick: MyTeamPick) {
    if (pick.role === "starter") {
      return pick.player.positionId === 1 ? 6 : 12;
    }

    if (pick.player.positionId === 1) {
      return 2;
    }

    switch (pick.benchOrder) {
      case 1:
        return 6;
      case 2:
        return 4;
      case 3:
        return 2;
      default:
        return 3;
    }
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

  private getHistoricalSellValue(
    playerId: number,
    gameweek: number,
    fallback: number,
  ) {
    const row = this.db.prepare(
      `SELECT value
       FROM player_history
       WHERE player_id = ?
         AND round < ?
         AND value IS NOT NULL
       ORDER BY round DESC, COALESCE(kickoff_time, '') DESC, rowid DESC
       LIMIT 1`,
    ).get(playerId, gameweek) as { value: number | null } | undefined;

    return row?.value ?? fallback;
  }

  private getPlayerProjectionMap(
    startingGameweek: number,
    horizon: TransferDecisionHorizon,
    eventModelWeights: EventModelWeights,
  ): Map<number, PlayerProjection> {
    const weights = this.getProjectionWeights(horizon);
    const targetGameweeks = weights.map((_, index) => startingGameweek + index);
    const recentStats = this.getRecentPlayerStats();
    const positionPriors = this.getPositionPriors();
    const teamStrengths = this.getTeamStrengths();
    const teamFixtures = this.getUpcomingTeamFixtures(
      startingGameweek,
      targetGameweeks[targetGameweeks.length - 1] ?? startingGameweek,
    );

    const players = this.db.prepare(
      `SELECT p.id, p.web_name AS webName, p.team_id AS teamId, t.short_name AS teamShortName,
              p.image_path AS imagePath, p.position_id AS positionId, pos.name AS positionName,
              p.now_cost AS nowCost, p.form, p.minutes AS totalMinutes, p.starts AS totalStarts,
              p.expected_goals AS totalExpectedGoals, p.expected_assists AS totalExpectedAssists,
              p.expected_goals_conceded AS totalExpectedGoalsConceded, p.bonus AS totalBonus, p.status,
              1 AS hasHistoricalPrice, 1 AS hasHistoricalTeam
       FROM players p
       JOIN teams t ON t.id = p.team_id
       JOIN positions pos ON pos.id = p.position_id
       WHERE p.status != 'u'
       ORDER BY p.id`,
    ).all() as TransferProjectionPlayerRow[];

    return new Map(players.map((player) => {
      const stats = recentStats.get(player.id);
      const prior = positionPriors.get(player.positionId);
      const fixturesByGw = teamFixtures.get(player.teamId) ?? new Map<number, TeamUpcomingFixture[]>();
      const perGameweek = targetGameweeks.map((gameweek, index) => {
        const fixtures = fixturesByGw.get(gameweek) ?? [];
        const total = fixtures.reduce((sum, fixture) => {
          const projected = this.projectFixturePoints(
            player,
            stats,
            prior,
            fixture,
            teamStrengths,
            eventModelWeights,
          );
          return sum + (projected.total * weights[index]);
        }, 0);
        return this.roundToTenth(total);
      });
      const attackingPerGameweek = targetGameweeks.map((gameweek, index) => {
        const fixtures = fixturesByGw.get(gameweek) ?? [];
        const total = fixtures.reduce((sum, fixture) => {
          const projected = this.projectFixturePoints(
            player,
            stats,
            prior,
            fixture,
            teamStrengths,
            eventModelWeights,
          );
          return sum + (projected.attacking * weights[index]);
        }, 0);
        return this.roundToTenth(total);
      });
      const cleanSheetPerGameweek = targetGameweeks.map((gameweek, index) => {
        const fixtures = fixturesByGw.get(gameweek) ?? [];
        const total = fixtures.reduce((sum, fixture) => {
          const projected = this.projectFixturePoints(
            player,
            stats,
            prior,
            fixture,
            teamStrengths,
            eventModelWeights,
          );
          return sum + (projected.cleanSheet * weights[index]);
        }, 0);
        return this.roundToTenth(total);
      });

      const nextGameweekFixtures = fixturesByGw.get(startingGameweek) ?? [];
      const nextFixtureScores = nextGameweekFixtures.map((fixture) => this.projectFixturePoints(
        player,
        stats,
        prior,
        fixture,
        teamStrengths,
        eventModelWeights,
      ));
      const nextGameweekProjection = this.roundToTenth(
        nextFixtureScores.reduce((sum, fixture) => sum + fixture.total, 0),
      );
      const nextGameweekAttackingProjection = this.roundToTenth(
        nextFixtureScores.reduce((sum, fixture) => sum + fixture.attacking, 0),
      );
      const allFixtures = targetGameweeks.flatMap((gameweek) => fixturesByGw.get(gameweek) ?? []);
      const averageDifficulty = allFixtures.length > 0
        ? this.roundToTenth(
            allFixtures.reduce((sum, fixture) => sum + fixture.difficulty, 0) / allFixtures.length,
          )
        : null;
      const nextGameweekDifficulty = nextGameweekFixtures.length > 0
        ? Math.round(
            nextGameweekFixtures.reduce((sum, fixture) => sum + fixture.difficulty, 0) / nextGameweekFixtures.length,
          ) as PlayerProjection["nextGameweekDifficulty"]
        : 0;
      const nextOpponent = nextGameweekFixtures.length > 0
        ? nextGameweekFixtures
          .map((fixture) => `${fixture.opponentShort}${fixture.isHome ? " (H)" : " (A)"}`)
          .join(", ")
        : "BGW";
      const minutesProbability = nextFixtureScores.length > 0
        ? this.roundToTenth(
            nextFixtureScores.reduce((sum, fixture) => sum + fixture.minutesProbability, 0) / nextFixtureScores.length,
          )
        : 0;
      const startProbability = nextFixtureScores.length > 0
        ? this.roundToTenth(
            nextFixtureScores.reduce((sum, fixture) => sum + fixture.startProbability, 0) / nextFixtureScores.length,
          )
        : 0;

      return [player.id, {
        playerId: player.id,
        playerName: player.webName,
        teamId: player.teamId,
        teamShortName: player.teamShortName,
        imagePath: player.imagePath,
        positionId: player.positionId,
        positionName: player.positionName,
        nowCost: player.nowCost,
        form: player.form,
        status: player.status,
        minutesProbability,
        startProbability,
        nextOpponent,
        nextGameweekDifficulty,
        averageDifficulty,
        perGameweek,
        weightedProjection: this.roundToTenth(perGameweek.reduce((sum, score) => sum + score, 0)),
        nextGameweekProjection,
        attackingWeightedProjection: this.roundToTenth(attackingPerGameweek.reduce((sum, score) => sum + score, 0)),
        attackingNextGameweekProjection: nextGameweekAttackingProjection,
        cleanSheetWeightedProjection: this.roundToTenth(cleanSheetPerGameweek.reduce((sum, score) => sum + score, 0)),
        hasHistoricalPrice: true,
      }];
    }));
  }

  private getHistoricalPlayerProjectionMap(
    startingGameweek: number,
    horizon: TransferDecisionHorizon,
    eventModelWeights: EventModelWeights,
  ): Map<number, PlayerProjection> {
    const weights = this.getProjectionWeights(horizon);
    const targetGameweeks = weights.map((_, index) => startingGameweek + index);
    const recentStats = this.getRecentPlayerStats(startingGameweek);
    const positionPriors = this.getPositionPriors(startingGameweek);
    const teamStrengths = this.getTeamStrengths(startingGameweek);
    const teamFixtures = this.getUpcomingTeamFixtures(
      startingGameweek,
      targetGameweeks[targetGameweeks.length - 1] ?? startingGameweek,
      true,
    );

    const players = this.db.prepare(
      `WITH latest_history AS (
         SELECT
           ph.player_id AS playerId,
           ph.team_id AS teamId,
           ph.value AS historicalValue,
           ROW_NUMBER() OVER (
             PARTITION BY ph.player_id
             ORDER BY ph.round DESC, COALESCE(ph.kickoff_time, '') DESC, ph.rowid DESC
           ) AS rn
         FROM player_history ph
         WHERE ph.round < ?
       ),
       historical_totals AS (
         SELECT
           ph.player_id AS playerId,
           SUM(ph.minutes) AS totalMinutes,
           SUM(ph.starts) AS totalStarts,
           SUM(ph.expected_goals) AS totalExpectedGoals,
           SUM(ph.expected_assists) AS totalExpectedAssists,
           SUM(ph.expected_goals_conceded) AS totalExpectedGoalsConceded,
           SUM(ph.bonus) AS totalBonus
         FROM player_history ph
         WHERE ph.round < ?
         GROUP BY ph.player_id
       )
       SELECT
         p.id,
         p.web_name AS webName,
         COALESCE(lh.teamId, p.team_id) AS teamId,
         t.short_name AS teamShortName,
         p.image_path AS imagePath,
         p.position_id AS positionId,
         pos.name AS positionName,
         COALESCE(lh.historicalValue, p.now_cost) AS nowCost,
         0 AS form,
         COALESCE(ht.totalMinutes, 0) AS totalMinutes,
         COALESCE(ht.totalStarts, 0) AS totalStarts,
         COALESCE(ht.totalExpectedGoals, 0) AS totalExpectedGoals,
         COALESCE(ht.totalExpectedAssists, 0) AS totalExpectedAssists,
         COALESCE(ht.totalExpectedGoalsConceded, 0) AS totalExpectedGoalsConceded,
         COALESCE(ht.totalBonus, 0) AS totalBonus,
         'a' AS status,
         CASE WHEN lh.historicalValue IS NOT NULL THEN 1 ELSE 0 END AS hasHistoricalPrice,
         CASE WHEN lh.teamId IS NOT NULL THEN 1 ELSE 0 END AS hasHistoricalTeam
       FROM players p
       LEFT JOIN latest_history lh ON lh.playerId = p.id AND lh.rn = 1
       JOIN teams t ON t.id = COALESCE(lh.teamId, p.team_id)
       JOIN positions pos ON pos.id = p.position_id
       LEFT JOIN historical_totals ht ON ht.playerId = p.id
       WHERE p.status != 'u'
       ORDER BY p.id`,
    ).all(startingGameweek, startingGameweek) as TransferProjectionPlayerRow[];

    return new Map(players.map((player) => {
      const stats = recentStats.get(player.id);
      const prior = positionPriors.get(player.positionId);
      const fixturesByGw = teamFixtures.get(player.teamId) ?? new Map<number, TeamUpcomingFixture[]>();
      const perGameweek = targetGameweeks.map((gameweek, index) => {
        const fixtures = fixturesByGw.get(gameweek) ?? [];
        const total = fixtures.reduce((sum, fixture) => {
          const projected = this.projectFixturePoints(
            player,
            stats,
            prior,
            fixture,
            teamStrengths,
            eventModelWeights,
          );
          return sum + (projected.total * weights[index]);
        }, 0);
        return this.roundToTenth(total);
      });
      const attackingPerGameweek = targetGameweeks.map((gameweek, index) => {
        const fixtures = fixturesByGw.get(gameweek) ?? [];
        const total = fixtures.reduce((sum, fixture) => {
          const projected = this.projectFixturePoints(
            player,
            stats,
            prior,
            fixture,
            teamStrengths,
            eventModelWeights,
          );
          return sum + (projected.attacking * weights[index]);
        }, 0);
        return this.roundToTenth(total);
      });
      const cleanSheetPerGameweek = targetGameweeks.map((gameweek, index) => {
        const fixtures = fixturesByGw.get(gameweek) ?? [];
        const total = fixtures.reduce((sum, fixture) => {
          const projected = this.projectFixturePoints(
            player,
            stats,
            prior,
            fixture,
            teamStrengths,
            eventModelWeights,
          );
          return sum + (projected.cleanSheet * weights[index]);
        }, 0);
        return this.roundToTenth(total);
      });

      const nextGameweekFixtures = fixturesByGw.get(startingGameweek) ?? [];
      const nextFixtureScores = nextGameweekFixtures.map((fixture) => this.projectFixturePoints(
        player,
        stats,
        prior,
        fixture,
        teamStrengths,
        eventModelWeights,
      ));
      const nextGameweekProjection = this.roundToTenth(
        nextFixtureScores.reduce((sum, fixture) => sum + fixture.total, 0),
      );
      const nextGameweekAttackingProjection = this.roundToTenth(
        nextFixtureScores.reduce((sum, fixture) => sum + fixture.attacking, 0),
      );
      const allFixtures = targetGameweeks.flatMap((gameweek) => fixturesByGw.get(gameweek) ?? []);
      const averageDifficulty = allFixtures.length > 0
        ? this.roundToTenth(
            allFixtures.reduce((sum, fixture) => sum + fixture.difficulty, 0) / allFixtures.length,
          )
        : null;
      const nextGameweekDifficulty = nextGameweekFixtures.length > 0
        ? Math.round(
            nextGameweekFixtures.reduce((sum, fixture) => sum + fixture.difficulty, 0) / nextGameweekFixtures.length,
          ) as PlayerProjection["nextGameweekDifficulty"]
        : 0;
      const nextOpponent = nextGameweekFixtures.length > 0
        ? nextGameweekFixtures
          .map((fixture) => `${fixture.opponentShort}${fixture.isHome ? " (H)" : " (A)"}`)
          .join(", ")
        : "BGW";
      const minutesProbability = nextFixtureScores.length > 0
        ? this.roundToTenth(
            nextFixtureScores.reduce((sum, fixture) => sum + fixture.minutesProbability, 0) / nextFixtureScores.length,
          )
        : 0;
      const startProbability = nextFixtureScores.length > 0
        ? this.roundToTenth(
            nextFixtureScores.reduce((sum, fixture) => sum + fixture.startProbability, 0) / nextFixtureScores.length,
          )
        : 0;

      return [player.id, {
        playerId: player.id,
        playerName: player.webName,
        teamId: player.teamId,
        teamShortName: player.teamShortName,
        imagePath: player.imagePath,
        positionId: player.positionId,
        positionName: player.positionName,
        nowCost: player.nowCost,
        form: 0,
        status: "a",
        minutesProbability,
        startProbability,
        nextOpponent,
        nextGameweekDifficulty,
        averageDifficulty,
        perGameweek,
        weightedProjection: this.roundToTenth(perGameweek.reduce((sum, score) => sum + score, 0)),
        nextGameweekProjection,
        attackingWeightedProjection: this.roundToTenth(attackingPerGameweek.reduce((sum, score) => sum + score, 0)),
        attackingNextGameweekProjection: nextGameweekAttackingProjection,
        cleanSheetWeightedProjection: this.roundToTenth(cleanSheetPerGameweek.reduce((sum, score) => sum + score, 0)),
        hasHistoricalPrice: Boolean(player.hasHistoricalPrice),
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

  private getRecentPlayerStats(cutoffRoundExclusive?: number) {
    const recentRoundFilter = cutoffRoundExclusive ? "WHERE round < ?" : "";
    const mainRoundFilter = cutoffRoundExclusive ? "WHERE ph.round < ?" : "";
    const rows = this.db.prepare(
      `SELECT
         ph.player_id AS playerId,
         (SUM(CASE WHEN recent.round IS NOT NULL THEN ph.expected_goals ELSE 0 END) * 90.0) /
           NULLIF(SUM(CASE WHEN recent.round IS NOT NULL THEN ph.minutes ELSE 0 END), 0) AS recentXg90,
         (SUM(CASE WHEN recent.round IS NOT NULL THEN ph.expected_assists ELSE 0 END) * 90.0) /
           NULLIF(SUM(CASE WHEN recent.round IS NOT NULL THEN ph.minutes ELSE 0 END), 0) AS recentXa90,
         (SUM(CASE WHEN recent.round IS NOT NULL THEN ph.expected_goals_conceded ELSE 0 END) * 90.0) /
           NULLIF(SUM(CASE WHEN recent.round IS NOT NULL THEN ph.minutes ELSE 0 END), 0) AS recentXgc90,
         (SUM(CASE WHEN recent.round IS NOT NULL THEN ph.bonus ELSE 0 END) * 90.0) /
           NULLIF(SUM(CASE WHEN recent.round IS NOT NULL THEN ph.minutes ELSE 0 END), 0) AS recentBonus90,
         (SUM(CASE WHEN recent.round IS NOT NULL THEN ph.saves ELSE 0 END) * 90.0) /
           NULLIF(SUM(CASE WHEN recent.round IS NOT NULL THEN ph.minutes ELSE 0 END), 0) AS recentSaves90,
         (SUM(CASE WHEN recent.round IS NOT NULL THEN ph.yellow_cards ELSE 0 END) * 90.0) /
           NULLIF(SUM(CASE WHEN recent.round IS NOT NULL THEN ph.minutes ELSE 0 END), 0) AS recentYellow90,
         (SUM(CASE WHEN recent.round IS NOT NULL THEN ph.red_cards ELSE 0 END) * 90.0) /
           NULLIF(SUM(CASE WHEN recent.round IS NOT NULL THEN ph.minutes ELSE 0 END), 0) AS recentRed90,
         (SUM(CASE WHEN recent.round IS NOT NULL THEN ph.goals_conceded ELSE 0 END) * 90.0) /
           NULLIF(SUM(CASE WHEN recent.round IS NOT NULL THEN ph.minutes ELSE 0 END), 0) AS recentGoalsConceded90,
         AVG(CASE WHEN recent.round IS NOT NULL THEN ph.minutes END) AS recentAvgMinutes,
         AVG(CASE WHEN recent.round IS NOT NULL THEN CASE WHEN ph.starts > 0 THEN 1.0 ELSE 0 END END) AS recentStartProbability,
         SUM(CASE WHEN recent.round IS NOT NULL THEN 1 ELSE 0 END) AS recentGwCount,
         (SUM(ph.expected_goals) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS seasonXg90,
         (SUM(ph.expected_assists) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS seasonXa90,
         (SUM(ph.expected_goals_conceded) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS seasonXgc90,
         (SUM(ph.bonus) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS seasonBonus90,
         (SUM(ph.saves) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS seasonSaves90,
         (SUM(ph.yellow_cards) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS seasonYellow90,
         (SUM(ph.red_cards) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS seasonRed90,
         (SUM(ph.goals_conceded) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS seasonGoalsConceded90,
         AVG(ph.minutes) AS seasonAvgMinutes,
         AVG(CASE WHEN ph.starts > 0 THEN 1.0 ELSE 0 END) AS seasonStartProbability,
         COUNT(*) AS seasonGwCount
       FROM player_history ph
       LEFT JOIN (
         SELECT DISTINCT round
         FROM player_history
         ${recentRoundFilter}
         ORDER BY round DESC
         LIMIT 5
       ) recent ON recent.round = ph.round
       ${mainRoundFilter}
       GROUP BY ph.player_id`,
    ).all(...(cutoffRoundExclusive ? [cutoffRoundExclusive, cutoffRoundExclusive] : [])) as RecentPlayerStats[];

    return new Map(rows.map((row) => [row.playerId, row]));
  }

  private getPositionPriors(cutoffRoundExclusive?: number) {
    const roundFilter = cutoffRoundExclusive ? "WHERE ph.round < ?" : "";
    const rows = this.db.prepare(
      `SELECT
         p.position_id AS positionId,
         (SUM(ph.expected_goals) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS xg90,
         (SUM(ph.expected_assists) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS xa90,
         (SUM(ph.expected_goals_conceded) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS xgc90,
         (SUM(ph.bonus) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS bonus90,
         (SUM(ph.saves) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS saves90,
         (SUM(ph.yellow_cards) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS yellow90,
         (SUM(ph.red_cards) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS red90,
         (SUM(ph.goals_conceded) * 90.0) / NULLIF(SUM(ph.minutes), 0) AS goalsConceded90,
         AVG(ph.minutes) AS avgMinutes,
         AVG(CASE WHEN ph.starts > 0 THEN 1.0 ELSE 0 END) AS startProbability
       FROM player_history ph
       JOIN players p ON p.id = ph.player_id
       ${roundFilter}
       GROUP BY p.position_id`,
    ).all(...(cutoffRoundExclusive ? [cutoffRoundExclusive] : [])) as PositionPrior[];

    return new Map(rows.map((row) => [row.positionId, row]));
  }

  private getUpcomingTeamFixtures(
    startingGameweek: number,
    endingGameweek: number,
    includeFinished = false,
  ) {
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
       WHERE f.event_id IS NOT NULL
         AND (${includeFinished ? "1 = 1" : "f.finished = 0"})
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

  private getTeamStrengths(cutoffRoundExclusive?: number) {
    const cutoffClause = cutoffRoundExclusive ? "AND event_id < ?" : "";
    const teamRows = this.db.prepare(
      `SELECT id, strength FROM teams ORDER BY id`,
    ).all() as Array<{ id: number; strength: number }>;
    const finishedFixtures = this.db.prepare(
      `SELECT team_h AS homeTeamId, team_a AS awayTeamId, team_h_score AS homeGoals, team_a_score AS awayGoals
       FROM fixtures
       WHERE finished = 1
         AND team_h_score IS NOT NULL
         AND team_a_score IS NOT NULL
         ${cutoffClause}
       ORDER BY COALESCE(event_id, 0) DESC, id DESC`,
    ).all(...(cutoffRoundExclusive ? [cutoffRoundExclusive] : [])) as Array<{
      homeTeamId: number;
      awayTeamId: number;
      homeGoals: number;
      awayGoals: number;
    }>;

    const teamStats = new Map<number, { goalsFor: number; goalsAgainst: number; matches: number }>();
    for (const team of teamRows) {
      teamStats.set(team.id, { goalsFor: 0, goalsAgainst: 0, matches: 0 });
    }

    for (const fixture of finishedFixtures) {
      const home = teamStats.get(fixture.homeTeamId);
      if (home && home.matches < 8) {
        home.goalsFor += fixture.homeGoals;
        home.goalsAgainst += fixture.awayGoals;
        home.matches += 1;
      }

      const away = teamStats.get(fixture.awayTeamId);
      if (away && away.matches < 8) {
        away.goalsFor += fixture.awayGoals;
        away.goalsAgainst += fixture.homeGoals;
        away.matches += 1;
      }
    }

    const populated = [...teamStats.values()].filter((row) => row.matches > 0);
    const leagueAvgGoals = populated.length > 0
      ? populated.reduce((sum, row) => sum + (row.goalsFor / row.matches), 0) / populated.length
      : 1.4;
    const strengthByTeam = new Map(teamRows.map((row) => [row.id, row.strength]));

    return new Map(teamRows.map((team) => {
      const stats = teamStats.get(team.id) ?? { goalsFor: 0, goalsAgainst: 0, matches: 0 };
      const strength = strengthByTeam.get(team.id) ?? 3;
      const fallbackFor = leagueAvgGoals * (0.8 + (strength * 0.08));
      const fallbackAgainst = leagueAvgGoals * Math.max(0.75, 1.2 - (strength * 0.08));
      const weight = Math.min(stats.matches / 5, 1);
      const avgGoalsFor = stats.matches > 0 ? stats.goalsFor / stats.matches : fallbackFor;
      const avgGoalsAgainst = stats.matches > 0 ? stats.goalsAgainst / stats.matches : fallbackAgainst;
      const blendedGoalsFor = (avgGoalsFor * weight) + (fallbackFor * (1 - weight));
      const blendedGoalsAgainst = (avgGoalsAgainst * weight) + (fallbackAgainst * (1 - weight));

      return [team.id, {
        teamId: team.id,
        attackStrength: blendedGoalsFor / Math.max(leagueAvgGoals, 0.6),
        defenseWeakness: blendedGoalsAgainst / Math.max(leagueAvgGoals, 0.6),
      }];
    }));
  }

  private projectFixturePoints(
    player: TransferProjectionPlayerRow,
    stats: RecentPlayerStats | undefined,
    prior: PositionPrior | undefined,
    fixture: TeamUpcomingFixture,
    teamStrengths: Map<number, TeamStrengthSnapshot>,
    eventModelWeights: EventModelWeights,
  ): ProjectedFixtureScore {
    const goalPoints: Record<number, number> = { 1: 6, 2: 6, 3: 5, 4: 4 };
    const cleanSheetPoints: Record<number, number> = { 1: 6, 2: 6, 3: 1, 4: 0 };
    const concedePenalty: Record<number, number> = { 1: 1, 2: 1, 3: 0.5, 4: 0 };

    const teamStrength = teamStrengths.get(player.teamId);
    const opponentStrength = teamStrengths.get(fixture.opponentId);
    const attackMultiplier = (teamStrength?.attackStrength ?? 1) * (opponentStrength?.defenseWeakness ?? 1);
    const opponentAttackMultiplier = (opponentStrength?.attackStrength ?? 1) * (teamStrength?.defenseWeakness ?? 1);
    const homeAttackBoost = fixture.isHome ? 1.08 : 0.94;
    const opponentAttackBoost = fixture.isHome ? 0.92 : 1.08;
    const teamExpectedGoals = Math.max(0.35, 1.35 * attackMultiplier * homeAttackBoost);
    const opponentExpectedGoals = Math.max(0.2, 1.15 * opponentAttackMultiplier * opponentAttackBoost);
    const availabilityPenalty = player.status === "a" ? 1 : 0.72;
    const rates = this.getPlayerEventRates(player, stats, prior);
    const minutesProbability = Math.min(1, rates.minutesProbability * availabilityPenalty);
    const startProbability = Math.min(1, rates.startProbability * availabilityPenalty);
    const sixtyProbability = Math.min(startProbability, minutesProbability * 1.08);
    const expectedMinutesShare = minutesProbability;

    const expectedGoals = rates.xg90 * expectedMinutesShare * (teamExpectedGoals / 1.35);
    const expectedAssists = rates.xa90 * expectedMinutesShare * (teamExpectedGoals / 1.35);
    const cleanSheetProbability = cleanSheetPoints[player.positionId] > 0
      ? Math.exp(-opponentExpectedGoals)
      : 0;
    const expectedSaves = player.positionId === 1
      ? rates.saves90 * expectedMinutesShare * Math.max(0.85, opponentExpectedGoals / 1.15)
      : 0;
    const appearance = (startProbability + sixtyProbability) * eventModelWeights.appearanceWeight;
    const bonus = Math.min(
      0.75,
      rates.bonus90 * expectedMinutesShare * Math.max(0.9, teamExpectedGoals / 1.35),
    ) * eventModelWeights.bonusWeight;
    const disciplinePenalty = ((rates.yellow90 * 1) + (rates.red90 * 3)) * expectedMinutesShare;
    const cleanSheetScore =
      cleanSheetProbability *
      (cleanSheetPoints[player.positionId] ?? 0) *
      sixtyProbability *
      eventModelWeights.cleanSheetWeight;
    const concedeScore =
      (concedePenalty[player.positionId] ?? 0) *
      (opponentExpectedGoals / 2) *
      sixtyProbability *
      eventModelWeights.concedePenaltyWeight;
    const attacking =
      (expectedGoals * (goalPoints[player.positionId] ?? 4) * eventModelWeights.goalWeight) +
      (expectedAssists * 3 * eventModelWeights.assistWeight) +
      ((expectedSaves / 3) * eventModelWeights.saveWeight);
    const total = this.roundToTenth(
      appearance + attacking + cleanSheetScore + bonus - concedeScore - disciplinePenalty,
    );

    return {
      total,
      attacking: this.roundToTenth(attacking + bonus),
      cleanSheet: this.roundToTenth(cleanSheetScore),
      appearance: this.roundToTenth(appearance),
      minutesProbability: this.roundToTenth(minutesProbability),
      startProbability: this.roundToTenth(startProbability),
      expectedGoalsConceded: this.roundToTenth(opponentExpectedGoals),
      cleanSheetProbability: this.roundToTenth(cleanSheetProbability),
    };
  }

  private getPlayerEventRates(
    player: TransferProjectionPlayerRow,
    stats: RecentPlayerStats | undefined,
    prior: PositionPrior | undefined,
  ) {
    const seasonMinutes = Math.max(player.totalMinutes ?? 0, 1);
    const seasonStarts = Math.max(player.totalStarts ?? 0, 0);
    const seasonXg90 = seasonMinutes > 0 ? ((player.totalExpectedGoals ?? 0) * 90) / seasonMinutes : 0;
    const seasonXa90 = seasonMinutes > 0 ? ((player.totalExpectedAssists ?? 0) * 90) / seasonMinutes : 0;
    const seasonXgc90 = seasonMinutes > 0 ? ((player.totalExpectedGoalsConceded ?? 0) * 90) / seasonMinutes : 0;
    const seasonBonus90 = seasonMinutes > 0 ? ((player.totalBonus ?? 0) * 90) / seasonMinutes : 0;
    const recentWeight = Math.min((stats?.recentGwCount ?? 0) / 5, 1) * 0.6;
    const seasonWeight = Math.min(seasonMinutes / 900, 1) * (1 - recentWeight) * 0.8;
    const priorWeight = Math.max(0, 1 - recentWeight - seasonWeight);
    const sparseHistoryFallback = (stats?.recentGwCount ?? 0) < 2 && seasonMinutes < 360;

    const blend = (recent: number | undefined, season: number, priorValue: number) => {
      if (sparseHistoryFallback) {
        return (season * 0.3) + (priorValue * 0.7);
      }

      return (
        ((recent ?? 0) * recentWeight) +
        (season * seasonWeight) +
        (priorValue * priorWeight)
      );
    };

    const priorXg90 = prior?.xg90 ?? 0.12;
    const priorXa90 = prior?.xa90 ?? 0.09;
    const priorXgc90 = prior?.xgc90 ?? 1.2;
    const priorBonus90 = prior?.bonus90 ?? 0.18;
    const priorSaves90 = prior?.saves90 ?? (player.positionId === 1 ? 3 : 0);
    const priorYellow90 = prior?.yellow90 ?? 0.12;
    const priorRed90 = prior?.red90 ?? 0.01;
    const priorMinutes = prior?.avgMinutes ?? 62;
    const priorStarts = prior?.startProbability ?? 0.6;

    return {
      xg90: blend(stats?.recentXg90, stats?.seasonXg90 ?? seasonXg90, priorXg90),
      xa90: blend(stats?.recentXa90, stats?.seasonXa90 ?? seasonXa90, priorXa90),
      xgc90: blend(stats?.recentXgc90, stats?.seasonXgc90 ?? seasonXgc90, priorXgc90),
      bonus90: blend(stats?.recentBonus90, stats?.seasonBonus90 ?? seasonBonus90, priorBonus90),
      saves90: blend(stats?.recentSaves90, stats?.seasonSaves90 ?? 0, priorSaves90),
      yellow90: blend(stats?.recentYellow90, stats?.seasonYellow90 ?? 0.1, priorYellow90),
      red90: blend(stats?.recentRed90, stats?.seasonRed90 ?? 0.01, priorRed90),
      goalsConceded90: blend(stats?.recentGoalsConceded90, stats?.seasonGoalsConceded90 ?? 1.2, priorXgc90),
      minutesProbability: Math.min(
        1,
        blend(
          (stats?.recentAvgMinutes ?? 0) / 90,
          seasonMinutes > 0 ? Math.min(1, seasonMinutes / Math.max(90 * Math.max(seasonStarts, 1), 90)) : 0,
          Math.min(1, priorMinutes / 90),
        ),
      ),
      startProbability: Math.min(
        1,
        blend(
          stats?.recentStartProbability,
          seasonStarts > 0 ? Math.min(1, seasonStarts / Math.max((seasonMinutes / 75), 1)) : 0,
          priorStarts,
        ),
      ),
    };
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
