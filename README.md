# Fun FPL

A TypeScript monorepo that mirrors the public experience of [fantasy.premierleague.com](https://fantasy.premierleague.com) using a local SQLite database, a Node.js/Express API, and a React frontend.

> **What is Fantasy Premier League?** FPL is an official game run by the Premier League where millions of players pick a virtual squad of real footballers and score points based on how those players perform in actual matches each week. This project pulls all publicly available FPL data — every player, every fixture, every gameweek — into a local database that you can query, extend, and build on top of. No FPL account is needed to run this project.

---

## Features

- **Sync pipeline that pulls all public FPL data into a local SQLite database.** A single command fetches everything from the official FPL API and writes it locally. Once the database is populated you have full offline access to all player, fixture, and gameweek data without making further network requests.

- **Idempotent refresh flow: safe to rerun, resumes after interruptions, noops when nothing has changed.** The sync tracks a fingerprint (SHA-256 hash) of the upstream data. If you run it again and the data hasn't changed, nothing happens. If it crashes halfway through, running it again picks up exactly where it left off — no need to start over or clean up.

- **Express HTTP API serving player, fixture, gameweek, and team data.** A thin read-only API layer sits on top of the database, exposing structured JSON endpoints that the frontend (and any external tool) can consume.

- **Multi-page React frontend with premium FPL-inspired design.** A dark-themed, glassmorphism UI across five pages: a dashboard, full player browser with search and filters, per-player stat detail with charts, a fixtures browser with gameweek navigation, and a team detail page. Built with Tailwind CSS, shadcn/ui components, framer-motion animations, and Recharts for data visualisation.
- **My Team sync, account linking, and history tooling in the same house style.** A dedicated `My Team` page extends the current UI language with a pitch view, linked FPL account support, transfer history, season archive, recent gameweek summaries, and a planner shell that keeps sync controls in place while local-only planning actions are rebuilt.

- **Local JPEG asset library for players and teams.** Sync runs download official player portraits and club badges into `apps/api/data/assets`, save their local paths in SQLite, and serve them from the API under `/assets/...`. If FPL has not published a portrait yet, the sync generates a local placeholder JPEG instead of failing.

- **Advanced public metrics: xG, xA, xGI, xGP, xAP, xGIP, ICT index, tackles, recoveries.** Beyond the basic FPL points, the database stores expected-goals statistics and the three locally-derived performance fields (xGP, xAP, xGIP) that measure how much a player is over- or under-performing their expected output.

- **Full game-by-game player history for the current season.** Every played fixture is stored individually so you can analyze trends, form, and home/away splits at the per-gameweek level.

- **Automated tests for the sync service, API routes, and frontend components.** Tests cover the sync pipeline's idempotency logic, the derived stat calculations, all API endpoints, and React rendering — so you can make changes with confidence.

---

## Tech stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5 (ES modules) |
| API framework | Express 5 |
| Database | SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| Frontend framework | React 19 |
| Frontend build tool | Vite 7 |
| Frontend styling | Tailwind CSS v4 + shadcn/ui (new-york) |
| Frontend routing | React Router v7 |
| Frontend charting | Recharts (area, radar charts) |
| Frontend animations | framer-motion |
| Test runner | [Vitest](https://vitest.dev) 3 |
| Frontend test utilities | [React Testing Library](https://testing-library.com/docs/react-testing-library/intro) |
| TypeScript runner (dev) | [tsx](https://github.com/privatenumber/tsx) |
| Monorepo runner | npm workspaces + [concurrently](https://github.com/open-cli-tools/concurrently) |

### Design decisions

**Why SQLite?** SQLite requires no server process — the database is just a file on disk (`apps/api/data/fpl.sqlite`). You can open it directly with any SQLite browser (such as [DB Browser for SQLite](https://sqlitebrowser.org)) to inspect the data without writing code. It's also fast enough for the read-heavy workload this project generates.

**Why better-sqlite3 over other SQLite drivers?** Most Node.js database libraries are asynchronous (callback- or promise-based). `better-sqlite3` is synchronous, which makes the sync CLI straightforward to write — no `await` chains, no callback nesting, just sequential code that reads like pseudocode. The trade-off (blocking the event loop) is acceptable because the sync runs as a standalone CLI process, not inside the API server.

**Why tsx for development?** TypeScript normally needs a compilation step before Node.js can run it. `tsx` eliminates that step by transpiling on the fly, meaning you can edit a file and see the change immediately without running `tsc` first. The API development server runs via `tsx watch`, which also auto-restarts when files change.

**Why npm workspaces + concurrently?** The monorepo structure lets three packages (`api`, `web`, `contracts`) share dependencies and scripts. A single `npm install` at the root installs everything. A single `npm run dev` at the root uses `concurrently` to start both the API and the frontend in the same terminal window, with their output color-coded and labelled.

---

## Prerequisites

- **Node.js 20 or later** — check with `node --version`. If you have an older version, use [nvm](https://github.com/nvm-sh/nvm) (`nvm install 20`) or [fnm](https://github.com/Schniz/fnm) (`fnm install 20`) to manage Node versions without affecting other projects on your machine.
- **npm 10 or later** — bundled with Node 20; check with `npm --version`.

No database server is required. SQLite runs entirely as a file embedded in the project directory. No Postgres, MySQL, or Redis setup is needed.

---

## Quick start

```bash
# 1. Clone and install dependencies
git clone <repo-url> fpl-app
cd fpl-app
npm install
```

`npm install` at the root uses npm workspaces to install dependencies for all three packages (`apps/api`, `apps/web`, and `packages/contracts`) in a single pass. You do not need to `cd` into each directory separately.

```bash
# 2. Create your local environment file
cp .env.example .env
```

`.env.example` is a template committed to the repository. Copying it to `.env` gives you a local config file that is intentionally excluded from git (via `.gitignore`). The [dotenv](https://github.com/motdotla/dotenv) library loads it automatically when the API starts, injecting the values into `process.env`. The defaults in `.env.example` work out of the box for local development — you don't need to change anything unless you want to use a different port or database path.

```bash
# 3. Populate the database (see "Seeding the database" below for details)
npm run sync
```

This is the step that takes the most time on first run. The sync CLI makes one HTTP request per player to the public FPL API, pausing 3 seconds between each request to avoid being throttled. With ~750 players that's around 40 minutes. Subsequent syncs are much faster because the pipeline skips players whose data hasn't changed. See [Seeding the database](#seeding-the-database) below for the full explanation, including how to speed it up.

```bash
# 4. Start the API and frontend together
npm run dev
```

`concurrently` launches both processes — the Express API (port 4000) and the Vite dev server (port 5173) — in a single terminal window. Output from each is prefixed and color-coded (`api` in cyan, `web` in magenta) so you can read them side by side. Both servers support hot reload: save a file and the relevant process restarts automatically.

```bash
# 5. Open the app
open http://localhost:5173
```

The API is also directly accessible at `http://localhost:4000/api` if you want to query it with curl or a REST client.

---

## All available scripts

Run these from the repository root.

| Command | Description |
|---|---|
| `npm run dev` | Start the API and frontend concurrently |
| `npm run dev:api` | Start only the API (port 4000) |
| `npm run dev:web` | Start only the frontend (port 5173) |
| `npm run build` | Type-check and build both apps for production |
| `npm run test` | Run all tests across all packages |
| `npm run test:watch` | Run all tests in watch mode |
| `npm run sync` | Full sync — fetch all player summaries from FPL |
| `npm run sync -- --gameweek 29` | Targeted sync — only players in gameweek 29 |
| `npm run sync -- --force` | Force full refresh even if nothing has changed upstream |
| `npm run sync -- --gameweek 29 --force` | Force gameweek refresh even if unchanged |
| `npm run link:my-team -- --email you@example.com --password "..." --entry 1234567` | Link or relink one FPL account with an optional manual entry ID |
| `npm run sync:my-team` | Sync all linked FPL accounts for the My Team page |
| `npm run sync:my-team -- --gameweek 29` | Refresh linked My Team accounts for one gameweek |
| `npm run sync:my-team -- --force` | Force-refresh all linked My Team accounts |
| `npm run sync:my-team -- --gameweek 29 --force` | Force-refresh linked My Team data for one gameweek |
| `npm run sync:my-team -- --account 3` | Refresh one linked My Team account by local account id |
| `npm run sync:my-team -- --email you@example.com` | Refresh one linked My Team account by email |

The `--` separator in sync commands passes the flags through npm to the underlying script. Without it, npm would try to interpret `--gameweek` as an npm flag rather than passing it to the sync CLI.

---

## Environment variables

Copy `.env.example` to `.env`. All variables have working defaults for local development.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Port the Express API listens on |
| `DB_PATH` | `./apps/api/data/fpl.sqlite` | Path to the SQLite database file |
| `FPL_BASE_URL` | `https://fantasy.premierleague.com/api` | Base URL for the public FPL API |
| `FPL_SITE_URL` | `https://fantasy.premierleague.com` | Base URL for the authenticated FPL website login flow used by My Team |
| `FPL_MIN_REQUEST_INTERVAL_MS` | `3000` | Minimum milliseconds between outbound FPL requests |
| `FPL_AUTH_SECRET` | unset | Required secret used to encrypt stored FPL credentials for My Team account linking |
| `ASSETS_DIR` | `./apps/api/data/assets` | Directory where downloaded/generated player and team JPEG files are stored |
| `VITE_API_BASE_URL` | unset | Optional override for the API base URL used by the frontend; when unset, the frontend uses the current site origin plus `/api` |
| `VITE_ALLOWED_HOSTS` | unset | Optional comma-separated list of hostnames that the Vite dev server should allow, useful for tunnels or custom local domains |

The API reads `.env` automatically via [dotenv](https://github.com/motdotla/dotenv). The frontend reads `VITE_*` variables at build/dev time via Vite's built-in env handling.

**A note on `VITE_*` variables:** Vite treats any environment variable prefixed with `VITE_` specially — during the build (or dev server startup), it replaces every reference to `import.meta.env.VITE_API_BASE_URL` with the literal string value from your `.env` file. If `VITE_API_BASE_URL` is unset, this app falls back to `window.location.origin + "/api"` in the browser, which lets the same frontend work both on `localhost` and through a tunnel as long as `/api` is routed to the API server. If you change `VITE_API_BASE_URL` after the app is built, you need to rebuild. For local development this is transparent because the dev server restarts automatically.

## My Team account linking

The `My Team` page can now sync your real FPL manager account, including your current squad, recent picks, transfer history, and season archive.

Before you use it, set a local encryption secret in `.env`:

```bash
FPL_AUTH_SECRET=use-a-long-random-string-here
```

This secret is required because the API stores your FPL email/password locally in encrypted form so it can re-authenticate during later sync runs. Without `FPL_AUTH_SECRET`, the account-linking flow is intentionally disabled.

### Link your account from the UI

1. Start the API and frontend with `npm run dev`
2. Open [http://localhost:5173/my-team](http://localhost:5173/my-team)
3. Enter your FPL email and password in the `Link your real FPL account` form
4. If FPL blocks automatic entry detection for your account, also enter your current-season entry ID
5. Submit the form to link the account and run the initial sync

The linked manager is then available in the page selector, and the `Sync now` button refreshes that account on demand.

If the stored FPL password stops working later, the account is marked as needing relink in the UI. The last successful My Team snapshot stays visible, but future syncs for that account are blocked until you re-enter the password.

### Sync linked accounts from the CLI

Once one or more accounts are linked, you can refresh them without opening the UI:

```bash
npm run link:my-team -- --email you@example.com --password "your-fpl-password" --entry 1234567
npm run sync:my-team
```

Useful variants:

```bash
npm run sync:my-team -- --gameweek 29
npm run sync:my-team -- --force
npm run sync:my-team -- --gameweek 29 --force
npm run sync:my-team -- --account 3
npm run sync:my-team -- --email you@example.com
```

The `link:my-team` command creates or updates a linked account and accepts an optional manual `--entry` value for accounts where FPL's anti-bot flow blocks automatic entry discovery. The sync commands refresh every linked account by default. If you pass `--account` or `--email`, the sync targets just that linked manager. The current implementation stores encrypted credentials locally and uses them to log back into FPL before each My Team sync. If one account fails FPL authentication during a multi-account run, it is marked as needing relink and the CLI continues syncing the remaining linked accounts before exiting with a non-zero status.

## My Team visual QA checklist

Use this checklist when reviewing the `My Team` page after UI changes:

- Shell consistency: the page should use the same sidebar, spacing rhythm, typography, and glass-card treatment as the dashboard and players pages.
- Pitch responsiveness: no horizontal overflow on mobile; player cards remain tap-friendly and readable.
- Planner shell clarity: the disabled planner state should read intentionally incomplete rather than broken, and the sync action should remain obvious.
- Accessibility: focus rings stay visible, contrast remains readable on dark surfaces, and key controls have descriptive labels.
- Touch targets: manager switching, sync controls, and relink inputs should remain comfortable on mobile.

---

## Seeding the database

"Seeding" in this project means running the sync pipeline, which fetches live data from the official FPL API and writes it to your local SQLite file. There is no seed file with fixed data — the database is always populated from real, current FPL data.

### What is the FPL API?

The FPL API is a set of public JSON endpoints hosted by the Premier League at `https://fantasy.premierleague.com/api/`. No account, login, or API key is required — they are plain HTTP GET requests that anyone can make. This project uses three of them:

| Endpoint | What it returns |
|---|---|
| `/api/bootstrap-static/` | A single large JSON payload containing all 20 teams, 4 positions, up to 38 gameweeks, and summary stats for every player (~750 total) |
| `/api/fixtures/` | Every match in the season with scores, kickoff times, and gameweek assignments |
| `/api/element-summary/{id}/` | For a single player: their game-by-game history this season and their upcoming fixtures |

The bootstrap endpoint is fetched once per sync. The element-summary endpoint is fetched once per player — that's the part that takes time.

### Full sync

```bash
npm run sync
```

This:

1. Fetches bootstrap data from FPL (`/api/bootstrap-static/`) — all gameweeks, teams, positions, and player summaries
2. Fetches all fixtures from FPL (`/api/fixtures/`)
3. Upserts everything into the local database
4. Downloads team badges and player portraits into the local assets directory, generating placeholders when official portraits are unavailable
5. Fetches the detailed season history for every player individually (`/api/element-summary/{id}/`)
6. Records progress so the run can be resumed if it fails

**How long does it take?** With the default 3-second rate limit, fetching all ~750 player summaries takes around 40 minutes. You can lower `FPL_MIN_REQUEST_INTERVAL_MS` (e.g., `1000`) to speed this up, but be conservative to avoid being throttled by FPL.

The sync prints verbose progress as it runs. You'll see output similar to this:

```
[sync] Starting full sync
[sync] Fetching bootstrap data...
[sync] Bootstrap fetched. 750 players, 20 teams, 38 gameweeks.
[sync] Assets synced. 742 player images downloaded, 78 player placeholders generated, 20 team images downloaded.
[sync] Fetching fixtures...
[sync] Fixtures fetched. 380 fixtures upserted.
[sync] 750 player summaries pending.
[sync] [1/750] Fetching element summary for player 233 (Salah)...
[sync] [2/750] Fetching element summary for player 328 (Haaland)...
...
[sync] [750/750] Done.
[sync] Full sync complete. Run recorded as success.
```

**First sync vs subsequent syncs:** The first time you run `npm run sync`, all ~750 players need to be fetched — this is the slow run. On subsequent runs, the pipeline compares a SHA-256 fingerprint of the current upstream data against the fingerprint stored from the last run. If they match, the entire run is skipped as a no-op in seconds. If FPL has updated any player data (typically after each gameweek), the fingerprint changes and only the affected players are re-fetched.

### How the snapshot mechanism works

Think of it like a checksum on the data you're about to download. Before fetching any player summaries, the sync hashes the bootstrap players array and fixtures array together into a single SHA-256 string. It then compares that hash against what it stored the last time it ran successfully.

- **Hash unchanged:** The upstream data is identical to what you already have locally. There's nothing to do, so the sync exits immediately.
- **Hash changed:** Something upstream has changed (a new gameweek was processed, player prices updated, etc.). The sync identifies which players haven't yet been fetched for this new snapshot and fetches only those.

This design means the sync is safe to run as a cron job — running it hourly costs almost nothing when nothing has changed, and automatically picks up updates when they appear.

### Targeted gameweek sync

```bash
npm run sync -- --gameweek 29
```

This still refreshes bootstrap data and fixtures, but only fetches player summaries for players whose teams are involved in gameweek 29's fixtures. Useful for weekly updates — instead of re-fetching all 750 players, you only fetch the ~50 players whose clubs played in that gameweek.

Gameweek syncs also run the asset sync step first, so if a new player is added to the game, their local image file (or fallback placeholder) is created during that refresh without waiting for a later full sync.

### Resume behavior

The sync pipeline is designed to be safe to rerun at any time:

- If a sync run fails halfway through (network error, process killed, power cut), rerunning the same command automatically resumes from the first unfinished player. No need to start over.
- If nothing has changed upstream (same data fingerprint), rerunning is a no-op.
- Use `--force` to bypass the no-op check and re-fetch everything regardless. This also forces player/team images to be re-downloaded, even when the stored image source key is unchanged. This is useful if you suspect the FPL API corrected some historical data or updated image files in place and you want to ensure your local copy is fully up to date.

Progress is tracked per-player in the `player_sync_status` and `gameweek_player_sync_status` database tables using SHA-256 snapshots of the upstream data.

---

## Folder structure

```text
fpl-app/
├── .env.example              # Environment variable template — copy to .env before running
├── .env                      # Your local config (created from .env.example, not committed)
├── package.json              # Root scripts and workspace definitions
├── tsconfig.base.json        # Shared TypeScript compiler settings inherited by all packages
│
├── apps/
│   ├── api/                  # Backend: Express API + sync pipeline + SQLite
│   │   ├── src/
│   │   │   ├── index.ts              # API server entry point — creates and starts the HTTP server
│   │   │   ├── app.ts                # Express app factory — adds CORS, JSON middleware, mounts router
│   │   │   ├── cli/
│   │   │   │   └── sync.ts           # sync CLI entry point — parses --gameweek and --force flags
│   │   │   ├── client/
│   │   │   │   └── fplApiClient.ts   # Typed HTTP client for the three FPL endpoints
│   │   │   ├── config/
│   │   │   │   └── env.ts            # Loads .env and exports a validated env object
│   │   │   ├── db/
│   │   │   │   ├── database.ts       # Opens/creates the SQLite file, runs migrations on startup
│   │   │   │   └── schema.ts         # SQL CREATE TABLE statements for all tables
│   │   │   ├── lib/
│   │   │   │   ├── http.ts           # Thin fetch wrapper (sets User-Agent, throws on non-2xx)
│   │   │   │   └── rateLimiter.ts    # Queue-based rate limiter for outbound FPL requests
│   │   │   ├── routes/
│   │   │   │   └── createApiRouter.ts  # All six Express route handlers
│   │   │   └── services/
│   │   │       ├── queryService.ts   # Read-only database queries used by the API routes
│   │   │       ├── assetSyncService.ts # Downloads/generates local JPEG files for players and teams
│   │   │       └── syncService.ts    # Orchestrates full and gameweek sync runs
│   │   ├── test/
│   │   │   ├── app.test.ts           # HTTP integration tests for all API routes
│   │   │   ├── syncService.test.ts   # Unit tests for sync logic, snapshot checks, derived stats
│   │   │   ├── rateLimiter.test.ts   # Unit tests for rate limiter timing and queuing
│   │   │   └── fixtures.ts           # Shared mock data (FPL API response shapes)
│   │   ├── data/
│   │   │   ├── assets/               # Local JPEG cache served by the API at /assets/*
│   │   │   └── fpl.sqlite            # SQLite database file — created automatically on first sync
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   │
│   └── web/                  # Frontend: React + Vite
│       ├── src/
│       │   ├── main.tsx              # React DOM entry point — mounts <App /> into #root
│       │   ├── App.tsx               # Root component — all sections, state, and event handlers
│       │   ├── App.test.tsx          # Component rendering tests
│       │   ├── api/
│       │   │   └── client.ts         # Typed fetch wrapper for the three local API endpoints
│       │   ├── components/
│       │   │   └── StatPill.tsx      # Reusable stat badge (label + value)
│       │   ├── lib/
│       │   │   └── format.ts         # Formatting helpers: cost (×10 integer → £Xm) and percentages
│       │   ├── styles/
│       │   │   └── global.css        # All CSS — FPL color palette, layout, responsive breakpoints
│       │   └── test/
│       │       └── setup.ts          # Vitest + jsdom + Testing Library bootstrap
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
│
└── packages/
    └── contracts/            # Shared TypeScript types consumed by both api and web
        ├── src/
        │   └── index.ts      # Exports: PlayerCard, PlayerDetail, FixtureCard, GameweekSummary, etc.
        ├── package.json
        └── tsconfig.json
```

The monorepo is intentionally split into three packages with a clear separation of concerns. `@fpl/api` owns all data access and business logic; `@fpl/web` owns the UI; `@fpl/contracts` owns the TypeScript types that define the contract between the two. This means you can work on the frontend without importing anything from the backend, and vice versa — the only shared surface is the type definitions in `contracts`.

---

## API reference

All endpoints are served by the Express API on port 4000. All responses are JSON. The API is read-only — there are no POST, PUT, or DELETE routes.

| Method | Path | Query parameters | Description |
|---|---|---|---|
| `GET` | `/api/health` | — | Returns `{ ok: true }` |
| `GET` | `/api/overview` | — | Current gameweek, top 8 players, upcoming fixtures, all teams |
| `GET` | `/api/gameweeks` | — | All gameweeks with deadlines and scores |
| `GET` | `/api/fixtures` | `event` (gameweek id), `team` (team id) | Fixtures, optionally filtered |
| `GET` | `/api/players` | `search`, `team`, `position`, `sort` | Player search and filter (max 100 results) |
| `GET` | `/api/players/:id` | — | Full player detail: stats + last 8 gameweeks history + upcoming fixtures |

**Player sort options:** `total_points` (default), `form`, `cost`, `minutes`

### Example requests

```bash
# Health check
curl http://localhost:4000/api/health

# All gameweeks
curl http://localhost:4000/api/gameweeks

# Fixtures for gameweek 29
curl "http://localhost:4000/api/fixtures?event=29"

# Fixtures for Arsenal (team ID 1)
curl "http://localhost:4000/api/fixtures?team=1"

# Search for midfielders sorted by form
curl "http://localhost:4000/api/players?position=3&sort=form"

# Search by name
curl "http://localhost:4000/api/players?search=salah"

# Player detail for player ID 308
curl http://localhost:4000/api/players/308
```

### Example response: `GET /api/players?search=salah`

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

Note that `nowCost` is an integer where `130` means £13.0m. The frontend converts this using `formatCost(cost)` from `apps/web/src/lib/format.ts`.

---

## Shared types (`@fpl/contracts`)

Both the API and the frontend share a single set of TypeScript types defined in `packages/contracts/src/index.ts`. This is the key to keeping the two apps in sync: if you add a field to an API response, you update the type in `contracts`, and TypeScript will immediately flag every frontend component that needs updating.

```ts
// In apps/api/src/services/queryService.ts
import type { PlayerCard } from "@fpl/contracts";

// In apps/web/src/api/client.ts
import type { PlayerCard } from "@fpl/contracts";
```

Both packages reference the same type. If the API returns a field that isn't in `PlayerCard`, TypeScript catches it at compile time. If the frontend tries to access a property that doesn't exist in the type, TypeScript catches that too.

Key exported types:

| Type | Description |
|---|---|
| `PlayerCard` | All player stats (points, form, xG, xA, ICT, tackles, …) |
| `PlayerDetail` | `PlayerCard` + game-by-game history + upcoming fixtures |
| `PlayerHistoryPoint` | One gameweek's worth of stats for a player |
| `FixtureCard` | A fixture with home/away team names and scores |
| `GameweekSummary` | Gameweek metadata (deadline, current, finished, scores) |
| `TeamSummary` | Team name, short name, and strength rating |
| `OverviewResponse` | Shape of the `/api/overview` response |

---

## Testing

```bash
# Run all tests once
npm run test

# Run tests in watch mode (re-runs on file save)
npm run test:watch
```

Tests are written with [Vitest](https://vitest.dev). API tests use an in-memory SQLite database (`:memory:`) so they never touch your real `fpl.sqlite` file. This means tests are completely isolated from each other and from your local data — you can run them at any time without worrying about corrupting anything, and they run fast because no disk I/O is involved.

| Package | Test file | What it covers |
|---|---|---|
| `@fpl/api` | `test/app.test.ts` | HTTP routes — status codes, response shapes, query params |
| `@fpl/api` | `test/syncService.test.ts` | Sync idempotency, derived field calculations (xGP, xAP, xGIP), resume logic |
| `@fpl/api` | `test/rateLimiter.test.ts` | Rate limiter timing and request queuing |
| `@fpl/web` | `src/App.test.tsx` | Component rendering |

---

## Key libraries

| Library | Used for | Why this one |
|---|---|---|
| [express](https://expressjs.com) | HTTP server and routing | Industry-standard, minimal boilerplate, extensive ecosystem |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | Synchronous SQLite access | Synchronous API is ideal for CLI scripts; faster than async alternatives for the read-heavy queries this project makes |
| [react](https://react.dev) | Frontend UI | Widely known, excellent TypeScript support, large ecosystem |
| [react-router-dom](https://reactrouter.com) | Client-side routing | Industry-standard routing for React; enables five distinct pages with URL-addressable routes |
| [tailwindcss](https://tailwindcss.com) | Utility-first CSS framework | Eliminates the need for custom CSS files; the `@tailwindcss/vite` plugin integrates with Vite at zero config overhead |
| [shadcn/ui](https://ui.shadcn.com) | Accessible, composable UI components | Pre-built, headless components (buttons, inputs, selects, sheets) that are fully owned by the project — no black-box dependencies |
| [framer-motion](https://www.framer.com/motion/) | Animation library | Declarative, production-grade animations for page transitions, hover states, and staggered list entries |
| [recharts](https://recharts.org) | SVG charting library | Area charts and radar charts for player history and attribute visualisation; integrates cleanly with React and Tailwind themes |
| [vite](https://vitejs.dev) | Frontend dev server and production bundler | Near-instant dev server startup via native ES modules; significantly faster than webpack for the development loop |
| [vitest](https://vitest.dev) | Test runner for both API and frontend | Shares Vite's config and module resolution, so tests run in the same environment as the app with no additional setup |
| [@testing-library/react](https://testing-library.com) | React component testing | Encourages testing user-visible behavior rather than implementation details |
| [tsx](https://github.com/privatenumber/tsx) | Run TypeScript directly in Node | No build step required during development; the API and CLI run TypeScript source files directly |
| [concurrently](https://github.com/open-cli-tools/concurrently) | Run API and frontend dev servers together | Single `npm run dev` command starts both processes with labeled, color-coded output |
| [dotenv](https://github.com/motdotla/dotenv) | Load `.env` files into `process.env` | Zero-config environment variable management; the standard approach in Node.js projects |
| [supertest](https://github.com/ladjs/supertest) | HTTP assertion library in API tests | Makes it easy to fire HTTP requests against an Express app and assert on the response without starting a real server |
| [cors](https://github.com/expressjs/cors) | CORS headers so the frontend can call the API | Required because the frontend (port 5173) and API (port 4000) are on different ports, which the browser treats as cross-origin |

---

## Further reading

- [Backend (API + sync) documentation](apps/api/README.md) — schema details, sync pipeline internals, full endpoint reference with curl examples
- [Frontend documentation](apps/web/README.md) — component architecture, state management patterns, UI sections, styling approach
