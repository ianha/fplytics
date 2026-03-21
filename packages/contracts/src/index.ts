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
