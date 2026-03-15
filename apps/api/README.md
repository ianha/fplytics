# @fpl/api — Backend API and Sync Service

This package does two distinct jobs:

1. **Sync** — pulls public Fantasy Premier League data into a local SQLite database
2. **Serve** — exposes an HTTP API that the frontend (and any other tooling) consumes

These two jobs are completely independent. The sync is a CLI process that you run manually (or on a schedule) to populate and refresh the database. The API server is a long-running process that reads from the database and serves JSON responses. You can run the API while a sync is in progress, and the sync while the API is running — they don't interfere with each other.

---

## Architecture overview

```
Public FPL API
  └── fplApiClient.ts        fetches bootstrap, fixtures, player summaries
        └── rateLimiter.ts   enforces minimum interval between requests
              └── syncService.ts    orchestrates all sync logic
                    └── assetSyncService.ts  downloads player/team JPEG files
                    └── database.ts  writes to SQLite (better-sqlite3)

SQLite file (data/fpl.sqlite)
  └── queryService.ts        read-only queries with joins and filters
        └── createApiRouter.ts  Express route handlers
              └── app.ts / index.ts  HTTP server
```

The sync path is a one-directional pipeline: data flows from the public FPL API into the local database, and never the other way. The sync is the only code that writes to the database.

The serve path is entirely read-only. The Express API never modifies the database — it only queries it. This means you can add new API endpoints or change existing queries without worrying about accidentally mutating data.

---

## Commands

Run these from the repository root, or replace `npm run` with `npm run -w @fpl/api` if you are in a different directory.

| Command | Description |
|---|---|
| `npm run dev:api` | Start API in development (auto-restarts on file changes via tsx watch) |
| `npm run sync` | Full sync — fetch all player summaries |
| `npm run sync -- --gameweek 29` | Targeted sync — only players in gameweek 29 |
| `npm run sync -- --force` | Force full refresh even if nothing changed upstream |
| `npm run sync -- --gameweek 29 --force` | Force gameweek refresh |
| `npm run test` | Run all API tests once |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run the compiled production build |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Port the API listens on |
| `DB_PATH` | `apps/api/data/fpl.sqlite` | Path to the SQLite database file, relative to the repo root or absolute |
| `ASSETS_DIR` | `apps/api/data/assets` | Directory where local player/team JPEG files are stored |
| `FPL_BASE_URL` | `https://fantasy.premierleague.com/api` | Base URL for the FPL API — only change this for testing |
| `FPL_MIN_REQUEST_INTERVAL_MS` | `3000` | Minimum milliseconds between outbound FPL requests |

No FPL account or API key is required. All endpoints used are public.

---

## Database

### Location

The database file is created automatically at `apps/api/data/fpl.sqlite` on first sync. The path can be changed with `DB_PATH`. You can open the file with [DB Browser for SQLite](https://sqlitebrowser.org) or any other SQLite GUI to browse the data directly.

### Setup and migrations

`database.ts` runs automatically whenever the API starts or the sync CLI is invoked. It is safe to call multiple times on an existing database:

- Creates all tables if they do not exist (using `CREATE TABLE IF NOT EXISTS`)
- Adds any missing columns via `ALTER TABLE ... ADD COLUMN` for backward compatibility with existing database files that predate a new column
- Migrates the `player_history` primary key from a single column to the composite `(player_id, round, opponent_team, kickoff_time)` if needed — this supports double gameweeks where a player faces two different opponents in the same round
- Backfills derived performance columns (`expected_goal_performance`, etc.) for any existing rows that were written before those fields were added

The API also serves the local asset directory statically at `/assets/*`. By default, a player image stored on disk at `apps/api/data/assets/players/10.jpg` is reachable at `http://localhost:4000/assets/players/10.jpg`.

SQLite runs in WAL (Write-Ahead Logging) mode. In the default journal mode, SQLite locks the entire file for any write operation, which would prevent the API from serving read requests while the sync is writing. WAL mode separates reads and writes into different files, allowing concurrent reads even during an active write transaction. This is important because the sync can take 40+ minutes and you don't want the API to be blocked for the entire duration.

### Schema

#### `gameweeks`

Stores every gameweek's metadata, updated from the bootstrap payload on each sync.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | FPL gameweek ID (1–38) |
| `name` | TEXT | Display name, e.g. `"Gameweek 29"` |
| `deadline_time` | TEXT | ISO 8601 timestamp of the entry deadline |
| `average_entry_score` | INTEGER | Average score across all managers (null until gameweek finishes) |
| `highest_score` | INTEGER | Highest score in this gameweek (null until gameweek finishes) |
| `is_current` | INTEGER | `1` if this is the live gameweek, `0` otherwise |
| `is_finished` | INTEGER | `1` if the gameweek is complete, `0` otherwise |
| `updated_at` | TEXT | ISO 8601 timestamp of last upsert |

#### `teams`

All 20 Premier League clubs, populated from bootstrap data.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | FPL team ID |
| `code` | INTEGER | FPL's numeric team code used for official badge URLs |
| `name` | TEXT | Full club name, e.g. `"Arsenal"` |
| `short_name` | TEXT | Three-letter abbreviation, e.g. `"ARS"` |
| `strength` | INTEGER | FPL's overall strength rating (used for fixture difficulty calculations) |
| `image_path` | TEXT | Local API-served path to the cached/generated team badge JPEG |
| `image_source` | TEXT | Source key used to decide whether the cached badge is still current |
| `updated_at` | TEXT | ISO 8601 timestamp of last upsert |

#### `positions`

The four player positions (Goalkeeper, Defender, Midfielder, Forward).

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | FPL position ID (1=GK, 2=DEF, 3=MID, 4=FWD) |
| `name` | TEXT | Full name, e.g. `"Midfielder"` |
| `short_name` | TEXT | Short form, e.g. `"MID"` |
| `updated_at` | TEXT | ISO 8601 timestamp of last upsert |

#### `players`

One row per player. Updated on every sync from bootstrap data. This table stores season-aggregate stats — for game-by-game breakdowns see `player_history`.

```sql
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
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
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(team_id) REFERENCES teams(id),
  FOREIGN KEY(position_id) REFERENCES positions(id)
);
```

Column reference:

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | FPL element ID |
| `web_name` | TEXT | Display name used in FPL, e.g. `"Salah"` |
| `first_name` | TEXT | First name |
| `second_name` | TEXT | Surname |
| `team_id` | INTEGER FK | References `teams.id` |
| `position_id` | INTEGER FK | References `positions.id` |
| `now_cost` | INTEGER | Current price × 10 (e.g. `130` = £13.0m) — FPL stores prices as integers to avoid floating-point issues |
| `total_points` | INTEGER | Total FPL points this season |
| `form` | REAL | Rolling average points per game (last 30 days) |
| `selected_by_percent` | REAL | Percentage of FPL managers who own this player |
| `points_per_game` | REAL | Season average points per game |
| `goals_scored` | INTEGER | Goals this season |
| `assists` | INTEGER | Assists this season |
| `clean_sheets` | INTEGER | Clean sheets this season |
| `minutes` | INTEGER | Total minutes played this season |
| `bonus` | INTEGER | Bonus points this season |
| `bps` | INTEGER | Total BPS (Bonus Points System) score |
| `creativity` | REAL | FPL creativity score — measures a player's ability to create chances |
| `influence` | REAL | FPL influence score — measures a player's impact on match outcomes |
| `threat` | REAL | FPL threat score — measures a player's likelihood of scoring |
| `ict_index` | REAL | Composite ICT (Influence, Creativity, Threat) index |
| `expected_goals` | REAL | xG — expected goals this season, based on shot quality |
| `expected_assists` | REAL | xA — expected assists this season, based on chance creation |
| `expected_goal_involvements` | REAL | xGI — sum of xG + xA |
| `expected_goal_performance` | REAL | xGP — goals minus xG (positive = over-performing; calculated locally) |
| `expected_assist_performance` | REAL | xAP — assists minus xA (calculated locally) |
| `expected_goal_involvement_performance` | REAL | xGIP — xGP + xAP (calculated locally) |
| `expected_goals_conceded` | REAL | Expected goals conceded (useful for defenders and goalkeepers) |
| `clean_sheets_per_90` | REAL | Clean sheets per 90 minutes |
| `starts` | INTEGER | Number of starts this season |
| `tackles` | INTEGER | Tackles this season |
| `recoveries` | INTEGER | Recoveries this season |
| `defensive_contribution` | INTEGER | Clearances, blocks, and interceptions combined |
| `code` | INTEGER | FPL's numeric element code |
| `photo` | TEXT | FPL's photo filename from bootstrap data, e.g. `"10010.jpg"` |
| `team_code` | INTEGER | FPL's numeric team code copied onto the player row for asset syncing |
| `image_path` | TEXT | Local API-served path to the cached/generated player JPEG |
| `image_source` | TEXT | Source key used to decide whether the cached portrait is still current |
| `status` | TEXT | Availability: `"a"` (available), `"d"` (doubtful), `"i"` (injured), `"s"` (suspended), `"u"` (unavailable) |
| `updated_at` | TEXT | ISO 8601 timestamp of last upsert |

#### `fixtures`

Every match in the Premier League season. Both finished and unplayed fixtures are stored.

```sql
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
```

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | FPL fixture ID |
| `code` | INTEGER | FPL fixture code (a different internal identifier used by FPL) |
| `event_id` | INTEGER | Gameweek ID — null for blank gameweek (BGW) or double gameweek (DGW) fixtures without an assigned round |
| `kickoff_time` | TEXT | ISO 8601 kickoff timestamp — null if the match hasn't been scheduled yet |
| `team_h` | INTEGER FK | Home team ID → `teams.id` |
| `team_a` | INTEGER FK | Away team ID → `teams.id` |
| `team_h_score` | INTEGER | Home score — null if the match hasn't been played |
| `team_a_score` | INTEGER | Away score — null if the match hasn't been played |
| `finished` | INTEGER | `1` if the match is complete |
| `started` | INTEGER | `1` if the match has kicked off |
| `updated_at` | TEXT | ISO 8601 timestamp of last upsert |

#### `player_history`

One row per player per gameweek played. This is the most granular data in the database and the most expensive to fetch — it comes from the per-player element-summary endpoint.

The primary key is composite: `(player_id, round, opponent_team, kickoff_time)`. A composite key is necessary because of double gameweeks (DGW), where a player can play twice in the same round against two different opponents. A single `round` column alone would not uniquely identify a row in that case.

```sql
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
```

| Column | Type | Description |
|---|---|---|
| `player_id` | INTEGER FK | References `players.id` |
| `round` | INTEGER | Gameweek number |
| `total_points` | INTEGER | FPL points earned in this fixture |
| `minutes` | INTEGER | Minutes played |
| `goals_scored` | INTEGER | Goals scored |
| `assists` | INTEGER | Assists |
| `clean_sheets` | INTEGER | Clean sheet (1 or 0) |
| `bonus` | INTEGER | Bonus points awarded |
| `bps` | INTEGER | BPS score for this fixture |
| `creativity` | REAL | Creativity score |
| `influence` | REAL | Influence score |
| `threat` | REAL | Threat score |
| `ict_index` | REAL | ICT index |
| `expected_goals` | REAL | xG in this fixture |
| `expected_assists` | REAL | xA in this fixture |
| `expected_goal_involvements` | REAL | xGI in this fixture |
| `expected_goal_performance` | REAL | Goals minus xG in this fixture (calculated locally) |
| `expected_assist_performance` | REAL | Assists minus xA in this fixture (calculated locally) |
| `expected_goal_involvement_performance` | REAL | xGP + xAP in this fixture (calculated locally) |
| `expected_goals_conceded` | REAL | xGC in this fixture |
| `tackles` | INTEGER | Tackles in this fixture |
| `recoveries` | INTEGER | Recoveries in this fixture |
| `clearances_blocks_interceptions` | INTEGER | Defensive actions (CBI) |
| `defensive_contribution` | INTEGER | Combined defensive stats |
| `starts` | INTEGER | `1` if the player started, `0` if a substitute |
| `opponent_team` | INTEGER | FPL team ID of the opponent |
| `value` | INTEGER | Player price × 10 at time of this fixture |
| `was_home` | INTEGER | `1` if the player's team was at home |
| `kickoff_time` | TEXT | ISO 8601 kickoff timestamp |
| `updated_at` | TEXT | ISO 8601 timestamp of last write |

#### `player_future_fixtures`

Upcoming fixtures for each player. The content is identical to rows in `fixtures`, with an added `player_id` column. This table is fully rebuilt every time a player's element-summary is fetched — there is no partial update. The FPL API returns a player's future fixtures alongside their history, so both are refreshed together in a single transaction.

Primary key: `(player_id, fixture_id)`

#### `player_sync_status`

Tracks which players have been synced and whether they are up to date for the current upstream snapshot. This is the table that enables the resume-on-failure behavior.

| Column | Type | Description |
|---|---|---|
| `player_id` | INTEGER PK FK | References `players.id` |
| `bootstrap_updated_at` | TEXT | Timestamp from the bootstrap data for this player |
| `synced_at` | TEXT | When this player's summary was last successfully synced |
| `last_error` | TEXT | Error message from the last failed attempt (null if none) |
| `requested_snapshot` | TEXT | SHA-256 hash of the data that was submitted for sync |
| `completed_snapshot` | TEXT | SHA-256 hash that was present when sync completed — if these match, the player is up to date |

#### `gameweek_player_sync_status`

Same purpose as `player_sync_status`, but scoped to a specific gameweek sync run. When you run `npm run sync -- --gameweek 29`, each player's progress is tracked here rather than in `player_sync_status`.

Primary key: `(gameweek_id, player_id)`

#### `sync_state`

A key-value store for global sync metadata. Currently stores two types of entries:

- `"full_snapshot"` — the SHA-256 hash of the last successful full sync
- `"gameweek_snapshot:29"` — the SHA-256 hash of the last successful gameweek 29 sync (one entry per gameweek synced)

| Column | Type | Description |
|---|---|---|
| `key` | TEXT PK | e.g. `"full_snapshot"`, `"gameweek_snapshot:29"` |
| `value` | TEXT | The snapshot hash |
| `updated_at` | TEXT | ISO 8601 timestamp |

#### `sync_runs`

Audit log of every sync invocation. Useful for checking when data was last refreshed and whether the most recent run succeeded.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-incrementing run ID |
| `started_at` | TEXT | ISO 8601 start timestamp |
| `finished_at` | TEXT | ISO 8601 finish timestamp (null if still running or crashed before cleanup) |
| `status` | TEXT | `"running"`, `"success"`, or `"failed"` |
| `error_message` | TEXT | Top-level error message for failed runs |

---

## Sync pipeline

### How it works

`syncService.ts` implements two public functions: `syncAll` and `syncGameweek`.

**Full sync (`npm run sync`):**

1. Fetch `/api/bootstrap-static/` — a single large JSON response containing all gameweeks, teams, positions, and every player's current season summary
2. Upsert gameweeks, teams, positions, and players into the database (insert new rows, update existing ones)
3. Download official team badges and player portraits into `ASSETS_DIR`, converting them to local JPEG files and generating placeholders when an official portrait returns 403/404
4. Fetch `/api/fixtures/` — all 380 matches
5. Upsert all fixtures
6. Compute a SHA-256 hash of the bootstrap players array + the fixtures array and compare it against the stored `full_snapshot` value in `sync_state`
7. If the hash matches and every player already has `completed_snapshot = requested_snapshot`, the run exits as a no-op (unless `--force` was passed)
8. For each player that is pending (never synced, previously errored, or completed_snapshot doesn't match the new hash):
   - Fetch `/api/element-summary/{id}/` — season history and upcoming fixtures for that player
   - Calculate the three derived performance fields from the returned data
   - Delete and replace that player's `player_history` and `player_future_fixtures` rows in a single transaction
   - Update `player_sync_status` marking the player complete for this snapshot
9. Update `full_snapshot` in `sync_state`
10. Record the run result (success or failure) in `sync_runs`

**Gameweek sync (`npm run sync -- --gameweek 29`):**

Steps 1–4 are identical. Then:

5. Find which teams appear in gameweek 29's fixtures
6. Hash the gameweek 29 fixtures + the player entries for players on those teams → store as `gameweek_snapshot:29`
7. Skip players already marked complete for that snapshot
8. Fetch and refresh only the players on those teams (~50 players instead of ~750)
9. Mark the run complete

Asset syncing is not snapshot-skipped. Each sync checks whether the local JPEG and source key already match. If they do, the asset is skipped. If a new player or team appears in bootstrap data, the corresponding local file is created during that same run. Passing `--force` disables that skip check and re-downloads player/team images even when the source key is unchanged.

### What the console output looks like

The sync prints verbose progress as it runs. A typical full sync looks like this:

```
[sync] Starting full sync
[sync] Fetching bootstrap-static...
[sync] Bootstrap fetched. Players: 750, Teams: 20, Gameweeks: 38.
[sync] Assets synced. 742 player images downloaded, 78 player placeholders generated, 20 team images downloaded.
[sync] Fetching fixtures...
[sync] 380 fixtures upserted.
[sync] Computing snapshot...
[sync] Snapshot changed. 750 player summaries pending.
[sync] [1/750]   player_id=233  (Salah)
[sync] [2/750]   player_id=328  (Haaland)
[sync] [3/750]   player_id=401  (Son)
...
[sync] [750/750] player_id=612  (Flekken)
[sync] Full sync complete.
[sync] Run #14 recorded as success.
```

If you run the same command again without any upstream changes:

```
[sync] Starting full sync
[sync] Fetching bootstrap-static...
[sync] Assets synced. 0 player images downloaded, 0 player placeholders generated, 0 team images downloaded, 770 skipped.
[sync] Fetching fixtures...
[sync] Snapshot unchanged. Nothing to do.
```

### Local image assets

Official image URLs are not stored in API responses. Instead, the sync stores local file paths in SQLite:

- team badges: `/assets/teams/<teamId>.jpg`
- player portraits: `/assets/players/<playerId>.jpg`

This has two benefits:

1. The frontend stays fast and does not depend on the Premier League CDN at runtime.
2. Sync runs can backfill new players and teams immediately, keeping the local app self-contained.

If FPL does not publish a portrait for a player yet, `assetSyncService.ts` generates a placeholder JPEG in the same local location so every player row still has a usable image file.

### Snapshot-aware resume

The snapshot mechanism makes the sync both idempotent and resumable. Here is a concrete example:

Suppose a full sync starts and processes players 1 through 41 successfully, but crashes on player 42 due to a network error. At that point the database contains:

```
player_sync_status for player 1..41:
  requested_snapshot = "abc123..."
  completed_snapshot = "abc123..."   ← matches, these players are done

player_sync_status for player 42:
  requested_snapshot = "abc123..."
  completed_snapshot = NULL           ← doesn't match, needs to be retried

player_sync_status for players 43..750:
  requested_snapshot = "abc123..."
  completed_snapshot = NULL           ← not yet started
```

When you rerun `npm run sync`, the pipeline:

1. Fetches bootstrap and fixtures again
2. Computes the same hash `"abc123..."` (nothing upstream changed)
3. Scans `player_sync_status` for players where `completed_snapshot != requested_snapshot`
4. Finds players 42–750 are pending
5. Resumes from player 42

Players 1–41 are skipped entirely. No data is duplicated or corrupted.

### Derived performance fields

Three fields in both `players` and `player_history` are calculated locally by the sync service — they are not provided by the FPL API directly:

```
expected_goal_performance             = goals_scored - expected_goals
expected_assist_performance           = assists - expected_assists
expected_goal_involvement_performance = expected_goal_performance + expected_assist_performance
```

A positive value means the player is over-performing relative to their expected output. A negative value means they are under-performing — scoring (or assisting) less than their shot and chance quality suggests they should be.

**Worked example:**

```
Player: Salah, GW28 vs. Brentford
  goals_scored  = 2      expected_goals  = 0.73
  assists       = 0      expected_assists = 0.41

  xGP  = 2 - 0.73   = +1.27   (scored 1.27 goals more than expected — hot streak)
  xAP  = 0 - 0.41   = -0.41   (assisted 0.41 times less than expected)
  xGIP = +1.27 + (-0.41) = +0.86
```

A season-long positive xGIP suggests a player who consistently takes high-quality shots and converts them at above-expected rates — a sign of quality and finishing ability. A large negative xGIP can indicate a player who is due a correction (lots of shots, few goals) or one who is simply in poor form.

These fields are calculated during sync and are also backfilled for any existing `player_history` rows via the migration in `database.ts`.

---

## Rate limiting

All outbound requests to the FPL API pass through a queue-based `RequestRateLimiter` (`src/lib/rateLimiter.ts`). It enforces a minimum interval between consecutive requests.

- Default: **3000 ms** (one request every 3 seconds)
- Override: set `FPL_MIN_REQUEST_INTERVAL_MS` in your `.env`

**Why can't we just fire all 750 requests at once?** The FPL API is a public, unauthenticated service operated by the Premier League. It doesn't publish rate limit headers or a documented policy, but like most public APIs it will throttle or block clients that make too many requests in a short period. If you're throttled, your requests start returning errors and your sync fails — not just slows down. Recovering from a mid-sync throttle is annoying even with the resume logic.

**What does "queued" mean?** The limiter uses a first-in-first-out queue. When `syncService.ts` asks the limiter to schedule a request, the limiter adds it to the queue and ensures at least 3 seconds pass after the previous request before firing the next one. Requests never fire in parallel — they always wait their turn. No requests are dropped; they just wait.

At the default 3-second interval with ~752 total requests (2 for bootstrap + fixtures, then 750 element summaries), a full sync takes approximately 37 minutes. Setting `FPL_MIN_REQUEST_INTERVAL_MS=1000` brings this down to around 12 minutes. Going below 500ms is not recommended.

---

## API endpoints

The Express app mounts all routes under the `/api` prefix. All responses are JSON. There are no write endpoints.

### `GET /api/health`

Returns a simple health check. Call this to confirm the API server is running and reachable before making other requests.

```bash
curl http://localhost:4000/api/health
```

```json
{ "ok": true }
```

### `GET /api/overview`

Fetches everything needed to render the dashboard in a single request. Returns the top 8 players by total points, the next 12 upcoming fixtures, all gameweeks, and all teams. The frontend calls this once on page load.

```bash
curl http://localhost:4000/api/overview
```

```json
{
  "generatedAt": "2025-03-14T12:00:00.000Z",
  "gameweeks": [
    {
      "id": 29,
      "name": "Gameweek 29",
      "deadlineTime": "2025-03-14T11:00:00Z",
      "averageEntryScore": 52,
      "highestScore": 141,
      "isCurrent": true,
      "isFinished": false
    }
  ],
  "topPlayers": [ /* PlayerCard[] — top 8 by total_points */ ],
  "fixtures": [ /* FixtureCard[] — next 12 upcoming */ ],
  "teams": [ /* TeamSummary[] — all 20 clubs */ ]
}
```

### `GET /api/gameweeks`

All 38 gameweeks with their deadlines, aggregate scores, and status flags.

```bash
curl http://localhost:4000/api/gameweeks
```

```json
[
  {
    "id": 29,
    "name": "Gameweek 29",
    "deadlineTime": "2025-03-14T11:00:00Z",
    "averageEntryScore": 52,
    "highestScore": 141,
    "isCurrent": true,
    "isFinished": false
  }
]
```

### `GET /api/fixtures`

All fixtures, with optional filters. Without any parameters, returns all 380 fixtures for the season. Use `event` to get only one gameweek's fixtures, or `team` to get all fixtures for a specific club.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `event` | integer | Filter to fixtures in this gameweek ID |
| `team` | integer | Filter to fixtures involving this team ID (home or away) |

```bash
# All fixtures
curl http://localhost:4000/api/fixtures

# Gameweek 29 fixtures only
curl "http://localhost:4000/api/fixtures?event=29"

# All fixtures involving Arsenal (team ID varies by season — check /api/overview for IDs)
curl "http://localhost:4000/api/fixtures?team=1"
```

```json
[
  {
    "id": 241,
    "code": 2210241,
    "eventId": 29,
    "kickoffTime": "2025-03-15T15:00:00Z",
    "teamH": 1,
    "teamA": 11,
    "teamHName": "Arsenal",
    "teamAName": "Liverpool",
    "teamHShortName": "ARS",
    "teamAShortName": "LIV",
    "teamHScore": null,
    "teamAScore": null,
    "finished": false,
    "started": false
  }
]
```

### `GET /api/players`

Search and filter the full player pool. Returns up to 100 results sorted by `total_points` by default. This is what powers the player search input in the frontend.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `search` | string | Case-insensitive substring match against `web_name`, `first_name`, and `second_name` |
| `team` | integer | Filter to players in this team |
| `position` | integer | Filter to this position (1=GK, 2=DEF, 3=MID, 4=FWD) |
| `sort` | string | Sort field: `total_points` (default), `form`, `now_cost`, `minutes` |

```bash
# Search by name
curl "http://localhost:4000/api/players?search=salah"

# All midfielders sorted by form
curl "http://localhost:4000/api/players?position=3&sort=form"

# All Liverpool players sorted by total points
curl "http://localhost:4000/api/players?team=11&sort=total_points"

# Goalkeepers sorted by cheapest first
curl "http://localhost:4000/api/players?position=1&sort=now_cost"
```

```json
[
  {
    "id": 308,
    "webName": "Salah",
    "firstName": "Mohamed",
    "secondName": "Salah",
    "teamId": 11,
    "teamName": "Liverpool",
    "teamShortName": "LIV",
    "positionId": 3,
    "positionName": "Midfielder",
    "nowCost": 130,
    "totalPoints": 187,
    "form": 8.2,
    "selectedByPercent": 47.3,
    "pointsPerGame": 7.2,
    "goalsScored": 16,
    "assists": 11,
    "cleanSheets": 5,
    "minutes": 2310,
    "bonus": 24,
    "bps": 612,
    "creativity": 1204.5,
    "influence": 987.3,
    "threat": 1456.8,
    "ictIndex": 367.2,
    "expectedGoals": 12.43,
    "expectedAssists": 8.71,
    "expectedGoalInvolvements": 21.14,
    "expectedGoalPerformance": 3.57,
    "expectedAssistPerformance": 2.29,
    "expectedGoalInvolvementPerformance": 5.86,
    "expectedGoalsConceded": 0.0,
    "cleanSheetsPer90": 0.21,
    "starts": 26,
    "tackles": 18,
    "recoveries": 42,
    "defensiveContribution": 7,
    "status": "a"
  }
]
```

Note: `nowCost` is an integer where `130` represents £13.0m. The frontend divides by 10 using `formatCost()`.

### `GET /api/players/:id`

Full player detail for a single player: their complete season stats, their last 8 gameweeks of history, and their upcoming fixtures. The history is limited to 8 entries to keep the response lean — if you need more history, query the database directly.

```bash
curl http://localhost:4000/api/players/308
```

```json
{
  "player": { /* Full PlayerCard — same shape as in /api/players */ },
  "history": [
    {
      "element": 308,
      "round": 28,
      "totalPoints": 14,
      "minutes": 90,
      "goalsScored": 2,
      "assists": 0,
      "cleanSheets": 1,
      "bonus": 3,
      "bps": 52,
      "creativity": 48.2,
      "influence": 61.4,
      "threat": 72.0,
      "ictIndex": 18.2,
      "expectedGoals": 0.73,
      "expectedAssists": 0.41,
      "expectedGoalInvolvements": 1.14,
      "expectedGoalPerformance": 1.27,
      "expectedAssistPerformance": -0.41,
      "expectedGoalInvolvementPerformance": 0.86,
      "expectedGoalsConceded": 0.0,
      "tackles": 2,
      "recoveries": 4,
      "clearancesBlocksInterceptions": 0,
      "defensiveContribution": 0,
      "starts": 1,
      "opponentTeam": 2,
      "value": 130,
      "wasHome": true,
      "kickoffTime": "2025-03-08T15:00:00Z"
    }
    /* ... up to 7 more gameweeks */
  ],
  "upcomingFixtures": [ /* FixtureCard[] */ ]
}
```

---

## Source files reference

The codebase is small and deliberate. Here's where to look for common tasks:

- **Adding a new API field:** Start in `queryService.ts` to update the SQL query, then update the relevant type in `packages/contracts/src/index.ts`. The TypeScript compiler will then show you every place the new field needs to be used in the frontend.
- **Changing sync behavior:** Look in `syncService.ts`. The two public functions (`syncAll` and `syncGameweek`) are the entry points. The snapshot logic is in the middle of each function.
- **Changing how the database is set up:** `database.ts` handles both initial setup and migrations.
- **Adding a new API endpoint:** Add a route handler in `createApiRouter.ts` and a corresponding query in `queryService.ts`.
- **Understanding what the FPL API returns:** See `fplApiClient.ts` for the response type definitions.

| File | Description |
|---|---|
| `src/index.ts` | Creates and starts the Express HTTP server |
| `src/app.ts` | Express app factory — CORS, JSON middleware, mounts the router |
| `src/cli/sync.ts` | CLI entry point: parses `--gameweek` and `--force` flags, calls sync service |
| `src/client/fplApiClient.ts` | Typed HTTP client for the three FPL endpoints (bootstrap, fixtures, element-summary) |
| `src/config/env.ts` | Loads `.env` with dotenv, exports a validated `env` object |
| `src/db/database.ts` | Opens (or creates) the SQLite file, runs migrations, exports the `db` instance |
| `src/db/schema.ts` | SQL strings for all `CREATE TABLE` statements |
| `src/lib/http.ts` | Thin fetch wrapper that sets a user-agent header and throws on non-2xx responses |
| `src/lib/rateLimiter.ts` | Queue-based rate limiter that enforces minimum intervals between requests |
| `src/routes/createApiRouter.ts` | All six Express route handlers |
| `src/services/queryService.ts` | Read-only database queries with joins, filtering, and sorting |
| `src/services/syncService.ts` | Full sync and gameweek sync orchestration |

---

## Testing

```bash
# Run all API tests
npm run test

# Watch mode (re-runs on save)
npm run test:watch
```

### How test isolation works

Each test creates its own SQLite database using `:memory:` as the path. SQLite's in-memory mode creates a fully functional database that exists only for the lifetime of the connection — it's never written to disk and is automatically destroyed when the test finishes. The in-memory database is initialised with the same schema as production (via the same `database.ts` setup function), so tests run against an exact structural replica of the real database.

This means:
- Tests can insert, update, and delete rows freely without affecting your real `fpl.sqlite` file
- Tests don't need to clean up after themselves — the database simply disappears
- Tests run fast because there's no disk I/O

### What `fixtures.ts` provides

`test/fixtures.ts` exports factory functions that return realistic FPL API response shapes:

- `bootstrapFixture` — a full `/api/bootstrap-static/` response object with a handful of players, all 20 teams, 4 positions, and several gameweeks
- `fixturesFixture` — a `/api/fixtures/` response with a small set of fixtures
- `createElementSummaryFixture(playerId)` — generates a `/api/element-summary/{id}/` response for a given player, including history and upcoming fixtures

These are used in `syncService.test.ts` to seed the sync service with predictable inputs and then assert on what was written to the in-memory database.

| File | What it tests |
|---|---|
| `test/app.test.ts` | HTTP integration — all routes, status codes, query params, error handling |
| `test/syncService.test.ts` | Sync idempotency, snapshot matching, derived field calculations, resume-on-failure |
| `test/rateLimiter.test.ts` | Interval enforcement, request queuing, fake timer assertions |
| `test/fixtures.ts` | Shared mock data factory functions |
