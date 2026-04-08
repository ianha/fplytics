# CLAUDE.md

## Project Overview

FPLytics is a Fantasy Premier League analytics platform that mirrors public FPL data into a local SQLite database, serves it via an Express API, and renders it in a React frontend. It includes AI/LLM chat integration, ML-driven player projections, and personal team management.

## Repository Structure

```
fplytics/                          # npm workspaces monorepo
├── apps/
│   ├── api/                       # @fpl/api — Express backend + sync CLI + SQLite
│   │   ├── src/
│   │   │   ├── cli/               # CLI entry points (sync, retrain, link, seed, ack)
│   │   │   ├── client/            # fplApiClient.ts — upstream FPL API fetcher
│   │   │   ├── config/            # env.ts — environment variable loading
│   │   │   ├── db/                # database.ts, schema.ts — SQLite setup + migrations
│   │   │   ├── lib/               # http.ts, rateLimiter.ts — shared utilities
│   │   │   ├── chat/              # LLM chat router, tools, provider configs
│   │   │   ├── mcp/               # Model Context Protocol router
│   │   │   ├── my-team/           # FPL account linking, session auth, team sync
│   │   │   ├── routes/            # createApiRouter.ts — HTTP route handlers
│   │   │   ├── services/          # Core business logic (query, sync, ML, training)
│   │   │   ├── app.ts             # Express app factory
│   │   │   └── index.ts           # Server entry point
│   │   ├── test/                  # Vitest tests + fixtures
│   │   └── data/                  # SQLite DB + downloaded assets (gitignored)
│   └── web/                       # @fpl/web — React frontend (Vite)
│       └── src/
│           ├── api/               # client.ts — typed fetch wrappers
│           ├── components/        # StatPill, layout, ui/ (shadcn components)
│           ├── lib/               # Utility functions (format, points, my-team)
│           ├── pages/             # Route pages + *Utils.ts helpers
│           ├── styles/            # global.css — Tailwind v4 theme
│           └── test/              # setup.ts, factories.ts
├── packages/
│   └── contracts/                 # @fpl/contracts — shared TypeScript types
├── docs/
│   ├── plans/                     # Feature planning documents
│   ├── prd/                       # Product requirements
│   └── solutions/                 # Debugging/solution write-ups
└── design-system/                 # Design assets
```

## Tech Stack

- **Runtime**: Node.js 20+, npm 10+, ESM (`"type": "module"`)
- **Language**: TypeScript 5 (strict mode, `ES2022` target, `Bundler` module resolution)
- **Backend**: Express 5, better-sqlite3, zod, sharp
- **Frontend**: React 19, Vite 7, Tailwind CSS v4, shadcn/ui (Radix), React Router v7, framer-motion, Recharts
- **AI/ML**: @anthropic-ai/sdk, openai, @google/genai, @modelcontextprotocol/sdk
- **Testing**: Vitest 3, Supertest (API), React Testing Library + jsdom (frontend)

## Essential Commands

All commands run from the repository root:

```bash
npm install                        # Install all workspace dependencies
npm run dev                        # Start API (port 4000) + frontend (port 5173) concurrently
npm run dev:api                    # Start API only (tsx watch, hot reload)
npm run dev:web                    # Start frontend only (Vite dev server)
npm run build                      # Build all workspaces
npm run test                       # Run all tests across workspaces
npm run test:watch                 # Run tests in watch mode
npm run sync                       # Sync public FPL data into SQLite (~40 min first run)
npm run sync:my-team               # Refresh linked FPL manager accounts
npm run retrain:model              # Fit ridge regression model on pending gameweeks
```

## Testing

### Running Tests

```bash
npm run test                       # All workspaces
npm run test -w @fpl/api           # Backend only
npm run test -w @fpl/web           # Frontend only
```

### Test Conventions

- **Backend tests** live in `apps/api/test/*.test.ts`. They use in-memory SQLite (`:memory:`) for isolation — never the on-disk database.
- **Test fixtures** are in `apps/api/test/fixtures.ts` and `apps/api/test/myTeamFixtures.ts`. They mirror upstream FPL API response shapes.
- **Frontend tests** are colocated with source: `apps/web/src/**/*.test.{ts,tsx}`. Page logic tests use `*Utils.test.ts` files alongside the page.
- **Frontend test setup** in `apps/web/src/test/setup.ts` imports `@testing-library/jest-dom/vitest` and runs `cleanup()` after each test.
- **Test factories** in `apps/web/src/test/factories.ts` generate mock data for component tests.
- **Framework**: Vitest with `node` environment (API) and `jsdom` environment (frontend).
- **No snapshot tests** — prefer explicit assertions.

### Writing New Tests

- API tests: create a file in `apps/api/test/`, import fixtures from `test/fixtures.ts`, use in-memory SQLite.
- Frontend tests: colocate with the source file using `.test.ts` / `.test.tsx` extension.
- Use Supertest for HTTP endpoint testing (API).
- Use React Testing Library for component testing (frontend).

## Code Conventions

### Commit Messages

Follow conventional commits: `<type>(<scope>): <description>`

- **Types**: `feat`, `fix`, `docs`, `chore`, `refactor`, `plan`, `perf`, `test`, `style`
- **Scopes**: `api`, `ml`, `my-team`, `web`, `share`, `dev`, `test`
- Examples: `feat(ml): add ridge regression service`, `fix(api): stop replay xPts inflation`

### TypeScript

- Strict mode enabled across all workspaces via `tsconfig.base.json`.
- Shared types live in `packages/contracts/src/index.ts` — import from `@fpl/contracts`.
- Use ESM imports with `.js` extensions for local imports in the API (required for Node ESM).
- Frontend uses `@/` path alias mapping to `src/` (configured in `tsconfig.json` and `vite.config.ts`).

### Architecture Patterns

- **Services pattern**: Business logic in `apps/api/src/services/` — each service is a focused module (queryService, syncService, ridgeRegressionService, etc.).
- **CLI pattern**: CLI entry points in `apps/api/src/cli/` — thin wrappers that parse args and call services.
- **State management (frontend)**: Localized `AsyncState<T>` discriminated union (`loading | ready | error`). No global state store.
- **Data fetching (frontend)**: Typed fetch wrappers in `apps/web/src/api/client.ts` backed by `@fpl/contracts` types.
- **Page utilities**: Complex page logic extracted to `*Utils.ts` files alongside pages, independently testable.
- **Read-only API**: All Express endpoints are GET-only JSON responses. No mutations through the API.

### Styling (Frontend)

- Tailwind CSS v4 with CSS variables for the FPL brand palette.
- Colors: `#e90052` (primary), `#00ffbf` (accent), `#37003c` (background).
- UI primitives from shadcn/ui (Radix-based), plus custom `GlowCard` component.
- Dark theme throughout.

## Environment Setup

1. Copy `.env.example` to `.env` at the repo root
2. Key variables:
   - `PORT` (default `4000`) — API server port
   - `DB_PATH` — SQLite database file path
   - `ASSETS_DIR` — Downloaded player/team images
   - `FPL_AUTH_SECRET` — Required for My Team account linking (set to random string)
   - `FPL_MIN_REQUEST_INTERVAL_MS` (default `3000`) — Rate limit for upstream FPL API calls
   - `VITE_API_BASE_URL` — Optional frontend API override

## Key Subsystems

### Sync Pipeline

- Pulls all public FPL data idempotently into SQLite via hash snapshots.
- Supports `--gameweek`, `--player`, and `--force` flags for targeted/forced syncs.
- Interrupted syncs can resume — `sync_state` and `player_sync_status` tables track progress.

### ML Model Training

- Ridge regression auto-trainer fits event weight coefficients (goal, assist, clean sheet, save, bonus, appearance, concede penalty).
- Durable queue: finished gameweeks are appended to `pending_ml_evaluation` in `sync_state`.
- Workflow: `npm run sync` -> `npm run retrain:model` -> model activates in `ml_model_registry`.
- External training also supported via MCP tools (`get_training_matrix`, `update_projection_weights`).

### My Team

- Links real FPL manager accounts via encrypted credentials (`FPL_AUTH_SECRET`).
- Syncs squad picks, transfer history, and scores per gameweek.

### Chat / AI Integration

- Multi-provider LLM chat (Anthropic, OpenAI, Google) with FPL-specific tools.
- Provider configuration in `apps/api/src/chat/providerConfig.ts`.

## Database

- SQLite via `better-sqlite3` (synchronous API).
- Schema managed in `apps/api/src/db/schema.ts` with migrations in `database.ts`.
- Key tables: `players`, `player_history`, `fixtures`, `teams`, `positions`, `gameweeks`, `sync_state`, `player_sync_status`, `ml_model_registry`, `ml_model_versions`.
- Tests always use `:memory:` databases — never touch the on-disk file.

## Workspace Layout

This is an npm workspaces monorepo with three packages:

| Package | Name | Purpose |
|---|---|---|
| `apps/api` | `@fpl/api` | Backend API + sync + ML |
| `apps/web` | `@fpl/web` | React frontend |
| `packages/contracts` | `@fpl/contracts` | Shared TypeScript types |

Cross-workspace imports use the package name (e.g., `import { Player } from "@fpl/contracts"`).
