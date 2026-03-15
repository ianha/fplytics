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
