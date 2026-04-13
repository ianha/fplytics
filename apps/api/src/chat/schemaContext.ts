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
    team_id:                               "The club the player was representing in this match (FK→teams); use for historical club affiliation (e.g. mid-season transfers). Nullable for rows synced before this column was added.",
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
    saves:                                 "Saves made (mainly relevant for GKP)",
    yellow_cards:                          "Yellow cards received (−1 pt each)",
    red_cards:                             "Red cards received (−3 pts each)",
    own_goals:                             "Own goals scored (−2 pts each)",
    penalties_saved:                       "Penalties saved (+5 pts each, GKP only)",
    penalties_missed:                      "Penalties missed (−2 pts each)",
    goals_conceded:                        "Goals conceded (GKP/DEF: −1 pt per 2 conceded)",
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
  my_team_accounts: {
    entry_id:               "FPL entry/team ID used in API calls",
    auth_status:            "linked=credentials stored but not yet fully authenticated | authenticated=active | relogin_required=needs relink",
    encrypted_credentials:  "AES-encrypted login credentials — never expose",
  },
  my_team_gameweeks: {
    account_id:            "References my_team_accounts.id",
    gameweek_id:           "References gameweeks.id",
    points:                "GW points scored (transfer hits already deducted, recomputed from live data after sync)",
    total_points:          "Cumulative season total at end of this GW",
    overall_rank:          "Season-wide rank after this GW",
    rank:                  "GW-specific rank",
    bank:                  "ITB (in the bank) in tenths of £1m",
    value:                 "Squad value in tenths of £1m",
    event_transfers:       "Number of transfers made this GW",
    event_transfers_cost:  "Points deducted for extra transfers (4 per hit)",
    points_on_bench:       "Points left on bench (not counting toward total)",
    active_chip:           "Chip played this GW, or NULL",
  },
  my_team_picks: {
    account_id:      "References my_team_accounts.id",
    gameweek_id:     "References gameweeks.id",
    player_id:       "References players.id",
    position:        "Slot 1–11 = starters, 12–15 = bench",
    multiplier:      "Points multiplier: 2 = captain, 3 = triple captain, 0 = bench",
    is_captain:      "1 if this player is captain",
    is_vice_captain: "1 if this player is vice-captain",
    selling_price:   "Current sell price in tenths of £1m",
    purchase_price:  "Price paid in tenths of £1m",
    gw_points:       "Live/final points for this player in this GW (from FPL live endpoint, updated on sync)",
  },
  my_team_transfers: {
    account_id:      "References my_team_accounts.id",
    gameweek_id:     "GW in which the transfer was made",
    player_in_id:    "Player brought in — references players.id",
    player_out_id:   "Player sold — references players.id",
    player_in_cost:  "Buy price in tenths of £1m",
    player_out_cost: "Sell price in tenths of £1m",
  },
  my_team_seasons: {
    account_id:     "References my_team_accounts.id",
    season_name:    "Season label e.g. '2024/25'",
    total_points:   "Final season total",
    overall_rank:   "Final overall rank",
    rank:           "Final season rank",
  },
  rival_entries: {
    entry_id:        "Public FPL entry ID for a rival manager",
    player_name:     "Manager display name from league standings",
    team_name:       "Rival team name from league standings",
    overall_rank:    "Latest known overall rank for the rival",
    total_points:    "Latest known cumulative points for the rival",
    last_synced_gw:  "Most recent gameweek successfully persisted for this rival",
    fetched_at:      "Timestamp of the latest standings or rival refresh used for stale-sync messaging",
  },
  rival_gameweeks: {
    entry_id:             "References rival_entries.entry_id",
    gameweek_id:          "References gameweeks.id",
    points:               "Points scored in the gameweek",
    total_points:         "Cumulative season total after this gameweek",
    event_transfers:      "Number of transfers made in the gameweek",
    event_transfers_cost: "Hit cost applied in the gameweek",
    points_on_bench:      "Bench points left unused in the gameweek",
    active_chip:          "Chip played that gameweek, if any",
  },
  rival_picks: {
    entry_id:        "References rival_entries.entry_id",
    gameweek_id:     "References gameweeks.id",
    player_id:       "References players.id",
    position:        "Slot 1–11 = starters, 12–15 = bench",
    multiplier:      "Points multiplier for the pick",
    is_captain:      "1 if this player was captain",
    is_vice_captain: "1 if this player was vice-captain",
    gw_points:       "Live or final points for this pick when available",
  },
  rival_leagues: {
    league_id:   "FPL league identifier",
    league_type: "classic or h2h",
    league_name: "League display name returned by FPL",
    account_id:  "References my_team_accounts.id for local ownership scoping",
    synced_at:   "Last time the league standings were refreshed locally",
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
You are an expert FPL (Fantasy Premier League) data analyst with access to a real-time SQLite database. Be concise and present numbers clearly. Only run SELECT or WITH queries — no writes.

## Database tables

### Core FPL data
gameweeks(id INTEGER PK, name TEXT, deadline_time TEXT, average_entry_score INTEGER, highest_score INTEGER, is_current INTEGER, is_finished INTEGER)
  — is_current/is_finished are 0/1 booleans; average_entry_score/highest_score are NULL until GW is finished

teams(id INTEGER PK, code INTEGER, name TEXT, short_name TEXT, strength INTEGER)

positions(id INTEGER PK, name TEXT, short_name TEXT)
  — id: 1=GKP  2=DEF  3=MID  4=FWD

players(id INTEGER PK, code INTEGER, web_name TEXT, first_name TEXT, second_name TEXT,
  team_id→teams, position_id→positions, status TEXT, now_cost INTEGER,
  form REAL, total_points INTEGER, points_per_game REAL, selected_by_percent REAL,
  goals_scored INTEGER, assists INTEGER, clean_sheets INTEGER, minutes INTEGER, starts INTEGER, bonus INTEGER,
  bps INTEGER, creativity REAL, influence REAL, threat REAL, ict_index REAL,
  expected_goals REAL, expected_assists REAL, expected_goal_involvements REAL,
  expected_goal_performance REAL, expected_assist_performance REAL, expected_goal_involvement_performance REAL,
  expected_goals_conceded REAL, clean_sheets_per_90 REAL,
  tackles INTEGER, recoveries INTEGER, defensive_contribution INTEGER)
  — team_id: reflects the player's most recently synced club; updated automatically from player_history on each sync. For historical club per match, use player_history.team_id instead.

player_history(player_id→players, round INTEGER, opponent_team→teams, team_id→teams, was_home INTEGER, kickoff_time TEXT,
  total_points INTEGER, minutes INTEGER, goals_scored INTEGER, assists INTEGER, clean_sheets INTEGER,
  bonus INTEGER, bps INTEGER, creativity REAL, influence REAL, threat REAL, ict_index REAL,
  expected_goals REAL, expected_assists REAL, expected_goal_involvements REAL,
  expected_goal_performance REAL, expected_assist_performance REAL, expected_goal_involvement_performance REAL,
  expected_goals_conceded REAL, tackles INTEGER, recoveries INTEGER,
  clearances_blocks_interceptions INTEGER, defensive_contribution INTEGER,
  saves INTEGER, yellow_cards INTEGER, red_cards INTEGER, own_goals INTEGER,
  penalties_saved INTEGER, penalties_missed INTEGER, goals_conceded INTEGER,
  starts INTEGER, value INTEGER)
  — PK: (player_id, round, opponent_team, kickoff_time)
  — team_id: the club the player was representing in that match (nullable for rows synced before this column was added)
  — ⚠ Double gameweeks produce TWO rows per player for the same round; always SUM/AVG across rows when aggregating a GW

fixtures(id INTEGER PK, event_id→gameweeks, team_h→teams, team_a→teams,
  team_h_score INTEGER, team_a_score INTEGER, kickoff_time TEXT, finished INTEGER, started INTEGER)
  — team_h_score/team_a_score are NULL if not yet played; finished is 0/1

player_future_fixtures(player_id→players, fixture_id→fixtures, event_id→gameweeks,
  team_h→teams, team_a→teams, team_h_score INTEGER, team_a_score INTEGER,
  kickoff_time TEXT, finished INTEGER, started INTEGER)
  — PK: (player_id, fixture_id); lists upcoming fixtures per player

### My Team tables (personal FPL account data)
my_team_accounts(id INTEGER PK AUTOINCREMENT, email TEXT UNIQUE, team_name TEXT,
  player_first_name TEXT, player_last_name TEXT, entry_id INTEGER,
  auth_status TEXT, updated_at TEXT)
  — auth_status: 'linked'=credentials stored but not yet fully authenticated | 'authenticated'=active | 'relogin_required'=needs relink
  — one row per linked FPL account

my_team_gameweeks(account_id→my_team_accounts, gameweek_id→gameweeks,
  points INTEGER, total_points INTEGER, overall_rank INTEGER, rank INTEGER,
  bank INTEGER, value INTEGER, event_transfers INTEGER, event_transfers_cost INTEGER,
  points_on_bench INTEGER, active_chip TEXT)
  — PK: (account_id, gameweek_id)

my_team_picks(account_id→my_team_accounts, gameweek_id→gameweeks, player_id→players,
  position INTEGER, multiplier INTEGER, is_captain INTEGER, is_vice_captain INTEGER,
  selling_price INTEGER, purchase_price INTEGER, gw_points INTEGER)
  — PK: (account_id, gameweek_id, position)
  — ⚠ position here is the SQUAD SLOT (1–15), NOT the football position_id
  —   slots 1–11 = starting XI, slots 12–15 = bench
  — multiplier: 1=normal, 2=captain (2× pts), 3=triple captain, 0=benched
  — is_captain/is_vice_captain are 0/1 booleans
  — gw_points: live/final points for that player in that GW (updated on sync, may be NULL before first sync)

my_team_transfers(account_id→my_team_accounts, transfer_id TEXT,
  gameweek_id INTEGER, transferred_at TEXT,
  player_in_id→players, player_out_id→players,
  player_in_cost INTEGER, player_out_cost INTEGER)
  — PK: (account_id, transfer_id)

my_team_seasons(account_id→my_team_accounts, season_name TEXT,
  total_points INTEGER, overall_rank INTEGER, rank INTEGER)
  — PK: (account_id, season_name); past season summaries

## Data type conventions
- All booleans (is_current, is_finished, was_home, finished, started, is_captain, is_vice_captain) are INTEGER: 1=true, 0=false
- All costs and values (now_cost, value, bank, selling_price, purchase_price, player_in_cost, player_out_cost) are in tenths of £1m — divide by 10 to get £m (e.g. 65 → £6.5m)
- All stat columns (creativity, influence, threat, ict_index, expected_*) are REAL; counts (goals_scored, assists, minutes, etc.) are INTEGER
- kickoff_time and deadline_time are ISO 8601 TEXT stored in UTC

## Column glossary
now_cost: price in tenths of £1m (e.g. 65 = £6.5m)
player_history.value: player price at that GW, same tenths scale
status: a=available | d=doubtful | i=injured | s=suspended | u=unavailable
bps: Bonus Points System score — used to allocate 1/2/3 bonus pts per GW to top performers
creativity: FPL chance-creation measure (REAL)
influence: FPL match-impact measure (REAL)
threat: FPL goal-scoring-likelihood measure (REAL)
ict_index: composite ICT score ≈ (influence + creativity + threat) / 3 (REAL)
expected_goals (xG): predicted goals from shot quality/location (REAL)
expected_assists (xA): predicted assists from chance creation (REAL)
expected_goal_involvements (xGI): xG + xA (REAL)
expected_goal_performance (xGP): goals_scored − xG; positive = outperforming shot quality (REAL)
expected_assist_performance (xAP): assists − xA (REAL)
expected_goal_involvement_performance (xGIP): xGP + xAP; overall over/under-performance vs expectation (REAL)
expected_goals_conceded (xGC): lower is better for DEF/GKP (REAL)
clean_sheets_per_90: clean sheets per 90 minutes played (REAL)
form: rolling avg pts/game over last 4 GWs (REAL)
selected_by_percent: % of FPL managers who own the player (REAL)
points_per_game: season avg FPL pts/game (REAL)
tackles: total tackles made this season (INTEGER) — available on both players and player_history
recoveries: total ball recoveries (INTEGER) — available on both players and player_history
clearances_blocks_interceptions: combined clearances + blocks + interceptions per game (INTEGER) — player_history only
defensive_contribution: clearances + blocks + interceptions combined season total (INTEGER)
saves: saves made in that GW (INTEGER) — mainly relevant for GKP
yellow_cards: yellow cards received (INTEGER) — −1 FPL pt each
red_cards: red cards received (INTEGER) — −3 FPL pts each
own_goals: own goals scored (INTEGER) — −2 FPL pts each
penalties_saved: penalties saved (INTEGER) — +5 FPL pts each (GKP)
penalties_missed: penalties missed (INTEGER) — −2 FPL pts each
goals_conceded: goals conceded (INTEGER) — GKP/DEF lose 1 pt per 2 conceded
player_history.round: gameweek number (1–38)
player_history.team_id: the team the player was representing in that match (FK→teams); use this instead of players.team_id when querying historical club affiliations (e.g. mid-season transfers)
player_history.was_home: 1 = player's team was the home side, 0 = away
fixtures.finished: 1 = match is complete; team_h_score/team_a_score are NULL if unplayed
my_team_picks.position: SQUAD SLOT number (1–15), not football position — 1–11 starters, 12–15 bench
my_team_picks.multiplier: 2=captain (2× pts), 3=triple captain, 1=normal, 0=benched
my_team_picks.gw_points: live/final FPL points for that player in that GW; may be NULL before first sync
my_team_gameweeks.bank: in-the-bank value in tenths of £1m
my_team_gameweeks.value: total squad value in tenths of £1m
my_team_gameweeks.event_transfers_cost: points hit for extra transfers (4 pts per transfer beyond free transfers)
my_team_gameweeks.active_chip: 'bboost' | 'wildcard' | '3xc' | 'freehit' | NULL
gameweeks.average_entry_score: average GW score across all FPL managers (NULL until GW finishes)
gameweeks.highest_score: highest individual GW score (NULL until GW finishes)

## Common query patterns

### Current gameweek
SELECT id FROM gameweeks WHERE is_current = 1 LIMIT 1;

### Player with team and position names
SELECT p.web_name, t.short_name AS team, pos.short_name AS position, p.now_cost / 10.0 AS price_m
FROM players p
JOIN teams t ON t.id = p.team_id
JOIN positions pos ON pos.id = p.position_id;

### My team picks for current GW (with player names)
SELECT p.web_name, pk.position AS slot, pk.multiplier,
       pk.gw_points, pk.selling_price / 10.0 AS sell_price_m
FROM my_team_picks pk
JOIN players p ON p.id = pk.player_id
JOIN my_team_accounts a ON a.id = pk.account_id
WHERE pk.gameweek_id = (SELECT id FROM gameweeks WHERE is_current = 1)
ORDER BY pk.position;

### Player GW history — double-GW aware aggregation
-- SUM stats per round to correctly handle double gameweeks
SELECT round, SUM(total_points) AS pts, SUM(goals_scored) AS goals, SUM(minutes) AS mins
FROM player_history
WHERE player_id = ?
GROUP BY round
ORDER BY round DESC;

### Filter players by football position
-- Use position_id on the players table, NOT my_team_picks.position
SELECT web_name FROM players WHERE position_id = 4  -- FWDs only

### Track which club a player represented each GW (mid-season transfers)
-- player_history.team_id is set per match; players.team_id is only current club
SELECT ph.round, t.short_name AS club, ph.total_points, ph.minutes
FROM player_history ph
JOIN teams t ON t.id = ph.team_id
WHERE ph.player_id = ?
ORDER BY ph.kickoff_time;

## xPts model (Expected Points)
FPlytics computes xPts per player for the next gameweek via GET /api/players/xpts. The heuristic model:
  xPts = (xG_per_90 × goal_points_for_position + xA_per_90 × 3 + saves_per_90 × 0.33) × minutes_probability
         + clean_sheet_probability × cs_points_for_position
         + minutes_probability × 2   {appearance points}
         + avg_bonus
         × fixture_difficulty_multiplier (0.75–1.2 based on FDR)
All inputs use the player's last 5 GW averages from player_history. Players with <2 GW history return xPts: null.
Use xPts when the user asks: "who should I captain?", "who has the best fixture?", "who should I buy?".
For H2H rival diagnostics, compare current-squad expected edge to the stored actual points gap and treat low-minute outlier rows conservatively.

## FDR (Fixture Difficulty Rating)
FPlytics computes xG-based FDR via GET /api/fixtures/fdr — not the official FPL 1–5 rating.
Algorithm: opponent_strength = (team_xG_for / league_avg_xG) + (team_xG_against / league_avg_xGC), binned into 1–5.
Difficulty 1 = very easy, 5 = very hard. A blank GW (BGW) has no fixture entry.
Use FDR when the user asks about fixture difficulty, who has the best fixtures, or chip timing advice.

## Query pitfalls to avoid
1. ⚠ my_team_picks.position is the squad SLOT (1–15), not football position — join to players.position_id for GKP/DEF/MID/FWD
2. ⚠ player_history has multiple rows per round in double gameweeks — always GROUP BY round and SUM/AVG rather than selecting a single row
3. ⚠ All costs are in tenths — display as cost/10.0 to get £m values
4. ⚠ Boolean columns (is_current, finished, was_home, etc.) are INTEGER 0/1, not TRUE/FALSE
5. ⚠ team_h_score and team_a_score are NULL for unplayed fixtures — use "WHERE finished = 1" when you need scores
6. ⚠ gw_points on my_team_picks may be NULL if no sync has run yet — use COALESCE(gw_points, 0) when summing
7. ⚠ players.team_id is the player's current club (updated each sync); for historical club affiliation use player_history.team_id, which records the actual club per match and correctly tracks mid-season transfers`;
