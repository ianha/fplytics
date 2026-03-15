import { env } from "../config/env.js";
import { fetchJson } from "../lib/http.js";
import { RequestRateLimiter } from "../lib/rateLimiter.js";

type BootstrapResponse = {
  events: Array<{
    id: number;
    name: string;
    deadline_time: string;
    average_entry_score: number | null;
    highest_score: number | null;
    is_current: boolean;
    finished: boolean;
  }>;
  teams: Array<{
    id: number;
    code: number;
    name: string;
    short_name: string;
    strength: number;
  }>;
  element_types: Array<{
    id: number;
    singular_name: string;
    singular_name_short: string;
  }>;
  elements: Array<{
    id: number;
    code: number;
    web_name: string;
    first_name: string;
    second_name: string;
    team: number;
    element_type: number;
    now_cost: number;
    total_points: number;
    form: string;
    selected_by_percent: string;
    points_per_game: string;
    goals_scored: number;
    assists: number;
    clean_sheets: number;
    minutes: number;
    bonus: number;
    bps: number;
    creativity: string;
    influence: string;
    threat: string;
    ict_index: string;
    expected_goals: string;
    expected_assists: string;
    expected_goal_involvements: string;
    expected_goals_conceded: string;
    clean_sheets_per_90: number | string;
    starts: number;
    tackles: number;
    recoveries: number;
    defensive_contribution: number;
    photo: string;
    team_code: number;
    status: string;
  }>;
};

type FixturesResponse = Array<{
  id: number;
  code: number;
  event: number | null;
  kickoff_time: string | null;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  finished: boolean | null;
  started: boolean | null;
}>;

type ElementSummaryResponse = {
  history: Array<{
    element: number;
    round: number;
    total_points: number;
    minutes: number;
    goals_scored: number;
    assists: number;
    clean_sheets: number;
    bonus: number;
    bps: number;
    creativity: string;
    influence: string;
    threat: string;
    ict_index: string;
    expected_goals: string;
    expected_assists: string;
    expected_goal_involvements: string;
    expected_goals_conceded: string;
    tackles: number;
    recoveries: number;
    clearances_blocks_interceptions: number;
    defensive_contribution: number;
    starts: number;
    opponent_team: number;
    value: number;
    was_home: boolean;
    kickoff_time: string;
  }>;
  fixtures: Array<{
    id: number;
    code: number;
    event: number | null;
    kickoff_time: string | null;
    team_h: number;
    team_a: number;
    team_h_score: number | null;
    team_a_score: number | null;
    finished: boolean | null;
    started: boolean | null;
  }>;
};

export class FplApiClient {
  private readonly rateLimiter: RequestRateLimiter;

  constructor(rateLimiter = new RequestRateLimiter(env.fplMinRequestIntervalMs)) {
    this.rateLimiter = rateLimiter;
  }

  async getBootstrap() {
    return this.rateLimiter.schedule(() =>
      fetchJson<BootstrapResponse>(`${env.baseUrl}/bootstrap-static/`),
    );
  }

  async getFixtures() {
    return this.rateLimiter.schedule(() =>
      fetchJson<FixturesResponse>(`${env.baseUrl}/fixtures/`),
    );
  }

  async getElementSummary(playerId: number) {
    return this.rateLimiter.schedule(() =>
      fetchJson<ElementSummaryResponse>(
        `${env.baseUrl}/element-summary/${playerId}/`,
      ),
    );
  }
}

export type { BootstrapResponse, ElementSummaryResponse, FixturesResponse };
