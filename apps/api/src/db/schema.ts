export const playerHistoryTableSql = `
CREATE TABLE IF NOT EXISTS player_history (
  player_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  total_points INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  goals_scored INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  clean_sheets INTEGER NOT NULL,
  bonus INTEGER NOT NULL DEFAULT 0,
  bps INTEGER NOT NULL DEFAULT 0,
  creativity REAL NOT NULL DEFAULT 0,
  influence REAL NOT NULL DEFAULT 0,
  threat REAL NOT NULL DEFAULT 0,
  ict_index REAL NOT NULL DEFAULT 0,
  expected_goals REAL NOT NULL DEFAULT 0,
  expected_assists REAL NOT NULL DEFAULT 0,
  expected_goal_involvements REAL NOT NULL DEFAULT 0,
  expected_goal_performance REAL NOT NULL DEFAULT 0,
  expected_assist_performance REAL NOT NULL DEFAULT 0,
  expected_goal_involvement_performance REAL NOT NULL DEFAULT 0,
  expected_goals_conceded REAL NOT NULL DEFAULT 0,
  tackles INTEGER NOT NULL DEFAULT 0,
  recoveries INTEGER NOT NULL DEFAULT 0,
  clearances_blocks_interceptions INTEGER NOT NULL DEFAULT 0,
  defensive_contribution INTEGER NOT NULL DEFAULT 0,
  starts INTEGER NOT NULL DEFAULT 0,
  opponent_team INTEGER NOT NULL,
  value INTEGER NOT NULL,
  was_home INTEGER NOT NULL,
  kickoff_time TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(player_id, round, opponent_team, kickoff_time),
  FOREIGN KEY(player_id) REFERENCES players(id)
);
`;

export const schemaSql = `
CREATE TABLE IF NOT EXISTS gameweeks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  deadline_time TEXT NOT NULL,
  average_entry_score INTEGER,
  highest_score INTEGER,
  is_current INTEGER NOT NULL,
  is_finished INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  code INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  strength INTEGER NOT NULL,
  image_path TEXT,
  image_source TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  code INTEGER NOT NULL DEFAULT 0,
  web_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  second_name TEXT NOT NULL,
  team_id INTEGER NOT NULL,
  position_id INTEGER NOT NULL,
  now_cost INTEGER NOT NULL,
  total_points INTEGER NOT NULL,
  form REAL NOT NULL,
  selected_by_percent REAL NOT NULL,
  points_per_game REAL NOT NULL,
  goals_scored INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  clean_sheets INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  bonus INTEGER NOT NULL DEFAULT 0,
  bps INTEGER NOT NULL DEFAULT 0,
  creativity REAL NOT NULL DEFAULT 0,
  influence REAL NOT NULL DEFAULT 0,
  threat REAL NOT NULL DEFAULT 0,
  ict_index REAL NOT NULL DEFAULT 0,
  expected_goals REAL NOT NULL DEFAULT 0,
  expected_assists REAL NOT NULL DEFAULT 0,
  expected_goal_involvements REAL NOT NULL DEFAULT 0,
  expected_goal_performance REAL NOT NULL DEFAULT 0,
  expected_assist_performance REAL NOT NULL DEFAULT 0,
  expected_goal_involvement_performance REAL NOT NULL DEFAULT 0,
  expected_goals_conceded REAL NOT NULL DEFAULT 0,
  clean_sheets_per_90 REAL NOT NULL DEFAULT 0,
  starts INTEGER NOT NULL DEFAULT 0,
  tackles INTEGER NOT NULL DEFAULT 0,
  recoveries INTEGER NOT NULL DEFAULT 0,
  defensive_contribution INTEGER NOT NULL DEFAULT 0,
  photo TEXT NOT NULL DEFAULT '',
  team_code INTEGER NOT NULL DEFAULT 0,
  image_path TEXT,
  image_source TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(team_id) REFERENCES teams(id),
  FOREIGN KEY(position_id) REFERENCES positions(id)
);

CREATE TABLE IF NOT EXISTS fixtures (
  id INTEGER PRIMARY KEY,
  code INTEGER NOT NULL,
  event_id INTEGER,
  kickoff_time TEXT,
  team_h INTEGER NOT NULL,
  team_a INTEGER NOT NULL,
  team_h_score INTEGER,
  team_a_score INTEGER,
  finished INTEGER NOT NULL,
  started INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(team_h) REFERENCES teams(id),
  FOREIGN KEY(team_a) REFERENCES teams(id)
);

${playerHistoryTableSql}

CREATE TABLE IF NOT EXISTS player_future_fixtures (
  player_id INTEGER NOT NULL,
  fixture_id INTEGER NOT NULL,
  code INTEGER NOT NULL,
  event_id INTEGER,
  kickoff_time TEXT,
  team_h INTEGER NOT NULL,
  team_a INTEGER NOT NULL,
  team_h_score INTEGER,
  team_a_score INTEGER,
  finished INTEGER NOT NULL,
  started INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(player_id, fixture_id),
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS player_sync_status (
  player_id INTEGER PRIMARY KEY,
  bootstrap_updated_at TEXT NOT NULL,
  synced_at TEXT,
  last_error TEXT,
  requested_snapshot TEXT,
  completed_snapshot TEXT
);

CREATE TABLE IF NOT EXISTS gameweek_player_sync_status (
  gameweek_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  synced_at TEXT,
  last_error TEXT,
  requested_snapshot TEXT,
  completed_snapshot TEXT,
  PRIMARY KEY(gameweek_id, player_id),
  FOREIGN KEY(gameweek_id) REFERENCES gameweeks(id),
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  error_message TEXT
);
`;
