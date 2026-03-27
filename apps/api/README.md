# @fpl/api — Backend API and Sync Service

The backend performs two independent tasks:
1. **Sync**: A CLI process that pulls public Fantasy Premier League data into a local SQLite database (`data/fpl.sqlite`).
2. **Serve**: An Express HTTP API providing read-only JSON endpoints queried by the frontend.

## Architecture

- `fplApiClient.ts`: Fetches upstream data from the FPL API.
- `syncService.ts` / `assetSyncService.ts`: Orchestrates database upserts and image downloads into `/assets`.
- `database.ts`: Handles SQLite schema setup and data migrations using `better-sqlite3`.
- `queryService.ts`: Read-only data queries with filtering and sorting.
- `createApiRouter.ts` / `app.ts`: HTTP route handlers.

## Commands

Run from repo root or with `-w @fpl/api`.

| Command | Description |
|---|---|
| `npm run dev:api` | Start API server (Hot reload) |
| `npm run test` | Run API tests (uses in-memory `:memory:` SQLite) |

### Database Sync Commands

You can append flags directly behind the `--` separator to modify the behavior of sync runs.

**`npm run sync`** (Fetches public player/fixture data)
- `--gameweek <id>`: Target a single gameweek (e.g., `npm run sync -- --gameweek 29`).
- `--player <id>`: Target a single player, optionally within one gameweek.
- `--force`: Bypass caching, downloading data and image assets even if hashes match.

**`npm run seed:pending-ml-evaluation`** (One-off backfill for already-finished gameweeks)
- No flags: Queue every currently finished gameweek that is not already pending.
- `--gameweek <id>`: Queue one specific finished gameweek.

**`npm run ack:pending-ml-evaluation`** (Clear processed queue items after successful training)
- `--gameweek <id>`: Remove one successfully processed gameweek from the pending queue.
- `--all`: Clear the full queue after a successful batch training/publish run.

**`npm run sync:my-team`** (Refreshes linked manager account queries)
- `--gameweek <id>`: Fetch picks/scores for a specific GW.
- `--account <id>`: Target an account via local database ID.
- `--email <str>`: Target an account via login email.
- `--force`: Discard cached snapshots and pull fresh JSON.

*Combinations:* You can combine flags freely, e.g. `npm run sync:my-team -- --email test@test.com --gameweek 29 --force`.

## Database Schema Highlights

- **`players`**: Season aggregate stats, ownership, xG/xA, and locally calculated metrics (`xGP`, `xAP`, `xGIP`).
- **`player_history`**: Per-gameweek player performance. Key: `(player_id, round, opponent_team, kickoff_time)`.
- **`fixtures`**: Match schedules and scores.
- **`teams`**, **`positions`**, **`gameweeks`**: Reference meta data.
- **`sync_state`**, **`player_sync_status`**: Identifies completed tasks to allow interrupted syncs to resume intelligently tracking upstream data hashes.
- **`ml_model_registry`**, **`ml_model_versions`**: Explicit model version metadata and active raw-point coefficient payloads.

## Retry-Safe ML Evaluation Loop

Public-data sync now owns the durable handoff for retraining after finished gameweeks:

1. `npm run sync` (or `npm run sync -- --gameweek <id>`) updates `gameweeks`.
2. When a gameweek transitions from `is_finished = 0` to `is_finished = 1`, the sync layer appends that gameweek id to the `sync_state` key `pending_ml_evaluation`.
3. External training code can poll that state, fetch training data through MCP, publish a validated model version, and only then clear the completed gameweek from the queue with `npm run ack:pending-ml-evaluation -- --gameweek <id>` (or `--all` for a full successful batch).

Operational guarantees:

- Finished-gameweek work is queued exactly once per gameweek transition.
- Re-running sync does not duplicate already queued work.
- If sync or external training fails later, the pending ML evaluation state remains in place for the next retry.
- Learned model activation stays decoupled from sync, so upstream data refreshes are not blocked by trainer availability.

The CLI prints queued gameweeks after a successful run whenever pending ML evaluation work exists, making stalled retraining windows visible during normal operations.

If you need to backfill already-finished historical gameweeks after enabling this workflow, run `npm run seed:pending-ml-evaluation`. The command is idempotent and only appends gameweeks that are finished and not already present in the pending queue.

Example manual loop:

1. Run `npm run sync`
2. Read `pending_ml_evaluation` from `sync_state` or via your trainer
3. Train and publish through MCP
4. Run `npm run ack:pending-ml-evaluation -- --gameweek <id>` for each successful publish

## API Endpoints (`PORT=4000`)

All responses are JSON. Read-only.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check (`{ "ok": true }`) |
| `GET` | `/api/overview` | Dashboard data: current gameweek, top players, fixtures, teams |
| `GET` | `/api/gameweeks` | All gameweeks with deadlines/scores |
| `GET` | `/api/fixtures` | All fixtures (`?event=GW` or `?team=ID`) |
| `GET` | `/api/players` | Search/filter players (`?search=`, `?team=`, `?position=`, `?sort=`) |
| `GET` | `/api/players/:id`| Full detail: history (last 8 GWs) + future fixtures |
| `GET` | `/assets/*` | Local player and team JPEG images |

## Rate Limiting
Sync limits upstream fetches to avoid IP blockages by FPL. Configured via `FPL_MIN_REQUEST_INTERVAL_MS` (default: 3000ms).

## Testing
API tests use an in-memory SQLite database, avoiding the corruption of local files.`test/fixtures.ts` generates mock data shapes equivalent to upstream FPL responses.
