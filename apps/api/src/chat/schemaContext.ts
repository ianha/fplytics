/**
 * schemaContext.ts
 *
 * Single source of truth for FPL schema semantic annotations.
 *
 * Exports:
 *  - SYSTEM_PROMPT      — used by all LLM provider adapters; includes full schema reference inline
 *  - annotateSchema()   — enriches raw PRAGMA output with column descriptions
 *  - SchemaTable types  — used by fplTools.ts and createMcpRouter.ts
 */

// ── Column annotation registry ────────────────────────────────────────────────
// Keys are exact SQLite column names. Values are one-line descriptions for the LLM.

const COLUMN_ANNOTATIONS: Readonly<Record<string, Record<string, string>>> = {
  players: {
    now_cost:                              "Price in tenths of £1m (e.g. 65 = £6.5m)",
    status:                                "a=available | d=doubtful | i=injured | s=suspended | u=unavailable",
    form:                                  "Rolling avg pts/game over last 4 GWs",
    selected_by_percent:                   "% of FPL managers who own this player",
    points_per_game:                       "Season avg FPL pts/game",
    bps:                                   "Bonus Points System score — allocates 1/2/3 bonus pts per GW",
    creativity:                            "FPL chance-creation measure",
    influence:                             "FPL match-impact measure",
    threat:                                "FPL goal-scoring-likelihood measure",
    ict_index:                             "Composite ICT = (influence + creativity + threat) / 3",
    expected_goals:                        "xG — predicted goals from shot quality/location",
    expected_assists:                      "xA — predicted assists from chance creation",
    expected_goal_involvements:            "xGI = xG + xA",
    expected_goal_performance:             "xGP = goals_scored − xG; positive = outperforming shot quality",
    expected_assist_performance:           "xAP = assists − xA",
    expected_goal_involvement_performance: "xGIP = xGP + xAP; overall performance vs expectation",
    expected_goals_conceded:               "xGC — lower is better for DEF/GKP",
    clean_sheets_per_90:                   "Clean sheets per 90 mins played",
    defensive_contribution:                "clearances + blocks + interceptions combined",
    starts:                                "Number of starts this season",
  },
  player_history: {
    round:                                 "Gameweek number (1–38)",
    value:                                 "Player price at that GW, in tenths of £1m",
    opponent_team:                         "References teams.id",
    was_home:                              "1 = player's team was at home, 0 = away",
    bps:                                   "BPS for that GW",
    creativity:                            "FPL creativity for that GW",
    influence:                             "FPL influence for that GW",
    threat:                                "FPL threat for that GW",
    ict_index:                             "ICT index for that GW",
    expected_goals:                        "xG for that GW",
    expected_assists:                      "xA for that GW",
    expected_goal_involvements:            "xGI for that GW",
    expected_goal_performance:             "xGP for that GW (goals − xG)",
    expected_assist_performance:           "xAP for that GW",
    expected_goal_involvement_performance: "xGIP for that GW",
    expected_goals_conceded:               "xGC for that GW",
    defensive_contribution:                "clearances + blocks + interceptions for that GW",
  },
  fixtures: {
    event_id:      "References gameweeks.id",
    team_h:        "Home team — references teams.id",
    team_a:        "Away team — references teams.id",
    team_h_score:  "NULL if not yet played",
    team_a_score:  "NULL if not yet played",
    finished:      "1 = match complete",
  },
  player_future_fixtures: {
    player_id:  "References players.id",
    fixture_id: "References fixtures.id",
    event_id:   "References gameweeks.id",
    team_h:     "Home team — references teams.id",
    team_a:     "Away team — references teams.id",
    finished:   "1 = match complete",
  },
  positions: {
    id: "1=GKP (Goalkeeper), 2=DEF (Defender), 3=MID (Midfielder), 4=FWD (Forward)",
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SchemaColumn {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
}

export interface SchemaTable {
  table: string;
  createSql: string;
  columns: SchemaColumn[];
}

export interface AnnotatedSchemaTable extends SchemaTable {
  /** Human-readable descriptions keyed by column name. Only non-obvious columns are annotated. */
  columnAnnotations: Record<string, string>;
}

// ── annotateSchema ────────────────────────────────────────────────────────────

/**
 * Enriches raw PRAGMA schema output with human-readable column descriptions.
 * Tables/columns with no annotation get an empty `columnAnnotations` map.
 */
export function annotateSchema(raw: SchemaTable[]): AnnotatedSchemaTable[] {
  return raw.map((t) => ({
    ...t,
    columnAnnotations: COLUMN_ANNOTATIONS[t.table] ?? {},
  }));
}

// ── SYSTEM_PROMPT ─────────────────────────────────────────────────────────────

/**
 * Shared system prompt for all LLM provider adapters.
 *
 * Includes:
 *  1. Persona + behavioural instructions
 *  2. Table overview (columns + FK arrows at a glance)
 *  3. Column glossary (FPL-specific terminology and conventions)
 *
 * Including this inline eliminates the need for models to call get_schema before
 * writing queries, reducing latency and token usage for typical analytical questions.
 * (~600 tokens; cached on providers that support prompt caching)
 */
export const SYSTEM_PROMPT = `\
You are an expert FPL (Fantasy Premier League) data analyst with access to a real-time SQLite database. Be concise and present numbers clearly.

## Database tables
gameweeks(id, name, deadline_time, is_current, is_finished)
teams(id, name, short_name, strength)
positions(id, name, short_name)  — id: 1=GKP 2=DEF 3=MID 4=FWD
players(id, web_name, first_name, second_name, team_id→teams, position_id→positions, status, now_cost, form, total_points, points_per_game, selected_by_percent, goals_scored, assists, clean_sheets, minutes, starts, bonus, bps, creativity, influence, threat, ict_index, expected_goals, expected_assists, expected_goal_involvements, expected_goal_performance, expected_assist_performance, expected_goal_involvement_performance, expected_goals_conceded, clean_sheets_per_90, defensive_contribution)
player_history(player_id→players, round, opponent_team→teams, was_home, kickoff_time, total_points, minutes, goals_scored, assists, clean_sheets, bonus, bps, creativity, influence, threat, ict_index, expected_goals, expected_assists, expected_goal_involvements, expected_goal_performance, expected_assist_performance, expected_goal_involvement_performance, expected_goals_conceded, defensive_contribution, starts, value)  — PK: (player_id, round, opponent_team, kickoff_time); multiple rows per GW on double gameweeks
fixtures(id, event_id→gameweeks, team_h→teams, team_a→teams, team_h_score, team_a_score, kickoff_time, finished, started)
player_future_fixtures(player_id→players, fixture_id→fixtures, event_id→gameweeks, team_h→teams, team_a→teams, finished)  — upcoming fixtures per player

## Column glossary
now_cost: price in tenths of £1m (e.g. 65 = £6.5m)
player_history.value: player price at that GW, same tenths scale
status: a=available | d=doubtful | i=injured | s=suspended | u=unavailable
bps: Bonus Points System score (used to allocate 1/2/3 bonus pts each GW)
creativity: FPL chance-creation measure
influence: FPL match-impact measure
threat: FPL goal-scoring-likelihood measure
ict_index: composite (influence + creativity + threat) / 3
expected_goals (xG): predicted goals from shot quality/location
expected_assists (xA): predicted assists from chance creation
expected_goal_involvements (xGI): xG + xA
expected_goal_performance (xGP): goals_scored − xG; positive = outperforming shot quality
expected_assist_performance (xAP): assists − xA
expected_goal_involvement_performance (xGIP): xGP + xAP; overall over/under-performance
expected_goals_conceded (xGC): lower is better for DEF/GKP
clean_sheets_per_90: clean sheets per 90 mins played
form: rolling avg pts/game over last 4 GWs
selected_by_percent: % of FPL managers who own the player
points_per_game: season avg FPL pts/game
defensive_contribution: clearances + blocks + interceptions combined
player_history.round: gameweek number (1–38)
player_history.was_home: 1 = player's team was the home side, 0 = away
fixtures.finished: 1 = match is complete; team_h_score/team_a_score are NULL if unplayed`;
