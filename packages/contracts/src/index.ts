export type GameweekSummary = {
  id: number;
  name: string;
  deadlineTime: string;
  averageEntryScore: number | null;
  highestScore: number | null;
  isCurrent: boolean;
  isFinished: boolean;
};

export type TeamSummary = {
  id: number;
  name: string;
  shortName: string;
  strength: number;
  imagePath: string | null;
};

export type PlayerCard = {
  id: number;
  webName: string;
  firstName: string;
  secondName: string;
  teamId: number;
  teamName: string;
  teamShortName: string;
  imagePath: string | null;
  positionId: number;
  positionName: string;
  nowCost: number;
  totalPoints: number;
  form: number;
  selectedByPercent: number;
  pointsPerGame: number;
  goalsScored: number;
  assists: number;
  cleanSheets: number;
  minutes: number;
  bonus: number;
  bps: number;
  creativity: number;
  influence: number;
  threat: number;
  ictIndex: number;
  expectedGoals: number;
  expectedAssists: number;
  expectedGoalInvolvements: number;
  expectedGoalPerformance: number;
  expectedAssistPerformance: number;
  expectedGoalInvolvementPerformance: number;
  expectedGoalsConceded: number;
  cleanSheetsPer90: number;
  starts: number;
  tackles: number;
  recoveries: number;
  defensiveContribution: number;
  status: string;
};

export type FixtureCard = {
  id: number;
  code: number;
  eventId: number | null;
  kickoffTime: string | null;
  teamH: number;
  teamA: number;
  teamHName: string;
  teamAName: string;
  teamHShortName: string;
  teamAShortName: string;
  teamHScore: number | null;
  teamAScore: number | null;
  finished: boolean;
  started: boolean;
};

export type PlayerHistoryPoint = {
  element: number;
  round: number;
  totalPoints: number;
  minutes: number;
  goalsScored: number;
  assists: number;
  cleanSheets: number;
  bonus: number;
  bps: number;
  creativity: number;
  influence: number;
  threat: number;
  ictIndex: number;
  expectedGoals: number;
  expectedAssists: number;
  expectedGoalInvolvements: number;
  expectedGoalPerformance: number;
  expectedAssistPerformance: number;
  expectedGoalInvolvementPerformance: number;
  expectedGoalsConceded: number;
  saves: number;
  yellowCards: number;
  redCards: number;
  ownGoals: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  goalsConceded: number;
  tackles: number;
  recoveries: number;
  clearancesBlocksInterceptions: number;
  defensiveContribution: number;
  starts: number;
  opponentTeam: number;
  value: number;
  wasHome: boolean;
  kickoffTime: string;
};

export type PlayerDetail = {
  player: PlayerCard;
  history: PlayerHistoryPoint[];
  upcomingFixtures: FixtureCard[];
};

export type OverviewResponse = {
  generatedAt: string;
  gameweeks: GameweekSummary[];
  topPlayers: PlayerCard[];
  fixtures: FixtureCard[];
  teams: TeamSummary[];
};

export type MyTeamAuthStatus = "authenticated" | "relogin_required";

export type MyTeamAccountSummary = {
  id: number;
  email: string;
  entryId: number | null;
  managerName: string;
  teamName: string;
  authStatus: MyTeamAuthStatus;
  authError: string | null;
  lastAuthenticatedAt: string | null;
};

export type MyTeamPickRole = "starter" | "bench";

export type MyTeamPick = {
  slotId: string;
  position: number;
  multiplier: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  sellingPrice: number | null;
  purchasePrice: number | null;
  player: PlayerCard;
  role: MyTeamPickRole;
  benchOrder: number | null;
  gwPoints?: number;
};

export type MyTeamGameweekPicksResponse = {
  gameweek: number;
  picks: MyTeamPick[];
  totalPoints: number;
  pointsOnBench: number;
};

export type MyTeamTransfer = {
  id: string;
  gameweek: number | null;
  madeAt: string;
  playerIn: PlayerCard;
  playerOut: PlayerCard;
  cost: number;
};

export type MyTeamSeasonSummary = {
  season: string;
  overallPoints: number;
  overallRank: number;
  rank: number;
};

export type MyTeamHistoryRow = {
  gameweek: number;
  points: number;
  totalPoints: number;
  overallRank: number;
  rank: number;
  bank: number;
  value: number;
  eventTransfers: number;
  eventTransfersCost: number;
  pointsOnBench: number;
  activeChip: string | null;
};

export type MyTeamPageResponse = {
  accounts: MyTeamAccountSummary[];
  selectedAccountId: number | null;
  currentGameweek: number | null;
  freeTransfers: number;
  bank: number;
  overallPoints: number;
  overallRank: number;
  teamName: string;
  managerName: string;
  picks: MyTeamPick[];
  transfers: MyTeamTransfer[];
  seasons: MyTeamSeasonSummary[];
  history: MyTeamHistoryRow[];
};

export type TransferDecisionHorizon = 1 | 3 | 5;

export type TransferDecisionRequest = {
  gw?: number;
  horizon: TransferDecisionHorizon;
  includeHits?: boolean;
  maxHit?: 0 | 4 | 8;
};

export type TransferDecisionOptionLabel = "roll" | "best_1ft" | "best_2ft" | "best_hit";

export type TransferDecisionOption = {
  id: string;
  label: TransferDecisionOptionLabel;
  transfers: Array<{
    outPlayerId: number;
    outPlayerName: string;
    inPlayerId: number;
    inPlayerName: string;
    position: string;
    priceDelta: number;
  }>;
  horizon: TransferDecisionHorizon;
  projectedGain: number;
  nextGwGain: number;
  hitCost: number;
  remainingBank: number;
  confidence: "strong" | "medium" | "close_call" | "aggressive";
  reasons: string[];
  warnings: string[];
};

export type TransferDecisionResponse = {
  gameweek: number;
  freeTransfers: number;
  bank: number;
  horizon: TransferDecisionHorizon;
  recommendedOptionId: string;
  options: TransferDecisionOption[];
};

export type FdrFixture = {
  gameweek: number;
  opponentId: number;
  opponentShort: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  isHome: boolean;
};

export type FdrRow = {
  teamId: number;
  teamName: string;
  teamShortName: string;
  fixtures: FdrFixture[];
};

export type PlayerXpts = {
  playerId: number;
  playerName: string;
  teamShortName: string;
  imagePath: string | null;
  position: string;
  nextOpponent: string;
  difficulty: number;
  xpts: number | null;
  form: number;
  minutesProbability: number;
};

export type CaptainRecommendation = {
  rank: number;
  playerId: number;
  playerName: string;
  teamShortName: string;
  position: string;
  xpts: number | null;
  nextOpponent: string;
  difficulty: number;
  reasoning: string;
};

export type LivePlayerPoints = {
  playerId: number;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheet: boolean;
  saves: number;
  yellowCards: number;
  redCards: number;
  ownGoals: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  goalsConceded: number;
  bonusProvisional: number;
  totalLivePoints: number;
};

export type LiveGwUpdate = {
  gameweek: number;
  lastUpdated: string; // ISO timestamp
  isLive: boolean;     // true when matches actively in progress
  players: LivePlayerPoints[];
};

export type GwCalendarFixture = {
  opponentShort: string;
  isHome: boolean;
};

export type GwCalendarRow = {
  teamId: number;
  teamName: string;
  teamShortName: string;
  gameweeks: Record<number, GwCalendarFixture[]>; // gw number → fixtures (0 = BGW, 1 = normal, 2+ = DGW)
};
