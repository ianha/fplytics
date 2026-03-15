# @fpl/web — React Frontend

A responsive React dashboard that consumes the local FPL API and presents player stats, fixtures, team badges, and player portraits in an FPL-inspired UI.

---

## What it shows

The app is a single-page dashboard with four main sections:

| Section | What it displays |
|---|---|
| **Hero** | App title, description, and the current gameweek deadline |
| **Overview grid** | Top 8 players by total points, each with a points/form/xGI/price summary |
| **Dashboard grid** | Two-column layout: upcoming fixtures on the left, player search on the right |
| **Detail panel** | Appears when a player is selected — season stats, last 8 gameweeks of history, upcoming fixtures |

### User flow

When the page loads, two fetches fire simultaneously: `getOverview()` populates the hero and overview grid, and `getPlayers("")` loads the initial player list. As soon as the player list resolves, the first result is automatically selected and `getPlayer(id)` fires to populate the detail panel — so the panel is never empty as long as there are players in the database.

Typing in the search input triggers a new `getPlayers(search)` call on every keystroke. The player list updates in real time, and the detail panel updates to show the first result of each new search.

Clicking any player card calls `getPlayer(id)` and replaces the detail panel's content. The panel shows the player's full season stats, a table of their last 8 gameweeks (points, minutes, goals/assists, xGI, tackles), and a list of their upcoming fixtures.

Player portraits and team badges are loaded from the local API asset paths stored in SQLite (`/assets/players/...` and `/assets/teams/...`), not from the FPL CDN directly.

---

## Commands

Run these from the repository root, or with `-w @fpl/web` from elsewhere.

| Command | Description |
|---|---|
| `npm run dev:web` | Start the Vite dev server at `http://localhost:5173` with HMR |
| `npm run build` | Type-check (`tsc --noEmit`) then bundle to `dist/` |
| `npm run test` | Run all frontend tests once |

The frontend requires the API to be running at the same time. Start both together with `npm run dev` from the repo root.

---

## Architecture

The frontend is a single `App.tsx` component tree. There are no client-side routes — everything is rendered in one page with conditional display based on state.

| Technology | Purpose |
|---|---|
| React 19 | UI rendering and state management |
| Vite 7 | Dev server, HMR, production bundler |
| `@fpl/contracts` | Shared TypeScript types (imported from the monorepo `packages/contracts`) |
| No CSS framework | Plain CSS in `src/styles/global.css` with FPL color palette |

**Why no routing library?** This is a single-view dashboard. Nothing about the UI needs to be URL-addressable — you don't need a shareable link to "the Salah player card" or "the GW29 fixtures". Adding React Router or a similar library would introduce complexity (route definitions, `<Link>` components, `useParams` calls) with no benefit for this use case.

**Why no state management library?** The entire application state is three `useState` hooks: one for the overview, one for the player list, one for the selected player. Redux, Zustand, or Jotai would all require additional setup, boilerplate, and concepts for what is, at its core, three fetch-and-display operations. The right amount of state management is the minimum needed — and here, React's built-in hooks are sufficient.

---

## State management

All state lives in `App.tsx` using React hooks. There is no external state library.

The `AsyncState<T>` type models every remote data fetch:

```ts
type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
```

This is a TypeScript discriminated union — a type where one property (here `status`) acts as a "tag" that narrows the type in an `if` or `switch`. The advantage over using separate boolean flags (`isLoading`, `hasError`, `data`) is that the compiler enforces exhaustive handling. You can't accidentally access `data` when the status is `"loading"` because the `data` property simply doesn't exist on the `loading` variant.

In practice, the component renders conditionally based on the status tag:

```tsx
// overview is AsyncState<OverviewResponse>
if (overview.status === "loading") {
  return <p>Loading...</p>;
}
if (overview.status === "error") {
  return <p>Error: {overview.message}</p>;
}
// After the above checks, TypeScript knows overview.status === "ready"
// and that overview.data is a OverviewResponse — safe to access
const { topPlayers, fixtures, gameweeks } = overview.data;
```

Three pieces of state are tracked:

| State | Type | Populated by |
|---|---|---|
| `overview` | `AsyncState<OverviewResponse>` | `getOverview()` — called once on mount |
| `players` | `AsyncState<PlayerCard[]>` | `getPlayers(search)` — called whenever the search input changes |
| `selectedPlayer` | `AsyncState<PlayerDetail \| null>` | `getPlayer(id)` — called when a player card is clicked |

When the players list loads, the first result is automatically selected so the detail panel is never empty.

---

## Source files

| File | Description |
|---|---|
| `src/main.tsx` | React DOM root — mounts `<App />` into `#root` |
| `src/App.tsx` | Root component containing all sections, state, and event handlers |
| `src/api/client.ts` | Typed fetch wrapper that calls the three API endpoints |
| `src/components/StatPill.tsx` | Reusable label + value badge used throughout the dashboard |
| `src/lib/format.ts` | Formatting utilities: cost and percentage display |
| `src/styles/global.css` | All CSS — layout, color palette, responsive breakpoints |
| `src/test/setup.ts` | Vitest + jsdom + `@testing-library/jest-dom` setup file |

---

## API client (`src/api/client.ts`)

The client wraps `fetch` with typed return values from `@fpl/contracts`. Base URL is read from the `VITE_API_BASE_URL` environment variable at build time, falling back to `http://localhost:4000/api`.

```ts
getOverview()          // → Promise<OverviewResponse>
getPlayers(search?)    // → Promise<PlayerCard[]>
getPlayer(playerId)    // → Promise<PlayerDetail>
resolveAssetUrl(path)  // → string | null
```

All functions throw an `Error` if the HTTP response is not ok (i.e., status is not in the 200–299 range). The caller is responsible for catching this and updating the `AsyncState` to `{ status: "error", message: error.message }`.

**A note on `VITE_API_BASE_URL` as a build-time variable:** Vite replaces every reference to `import.meta.env.VITE_API_BASE_URL` with the literal string value from your `.env` file during the build (or when the dev server starts). This means the value is baked into the JavaScript bundle — it is not read from the environment at runtime. Changing the variable after a build has no effect; you must rebuild.

For local development this is transparent because the Vite dev server restarts automatically when `.env` changes. For production deployments, it means you need to build the frontend with the correct `VITE_API_BASE_URL` pointing to your deployed API host — you cannot change it without rebuilding.

```ts
// src/api/client.ts — the full implementation
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getOverview() {
  return request<OverviewResponse>("/overview");
}

export function getPlayers(search = "") {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return request<PlayerCard[]>(`/players${query}`);
}

export function getPlayer(playerId: number) {
  return request<PlayerDetail>(`/players/${playerId}`);
}
```

---

## Utilities (`src/lib/format.ts`)

| Function | Input | Output | Example |
|---|---|---|---|
| `formatCost(cost)` | Integer price × 10 | `£Xm` string | `125` → `"£12.5m"` |
| `formatPercent(value)` | Float | `X.X%` string | `73.4` → `"73.4%"` |

```ts
export function formatCost(cost: number) {
  return `£${(cost / 10).toFixed(1)}m`;
}

export function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}
```

**Why is cost stored as an integer × 10?** SQLite does not have a native fixed-precision decimal type. Floating-point arithmetic (the `REAL` type) introduces rounding errors — `£12.5m` stored as `12.5` might be retrieved as `12.499999999`. To avoid this, FPL stores prices as integers scaled by 10: £12.5m is stored as `125`. `formatCost` reverses the scaling for display: `125 / 10 = 12.5`, rendered as `"£12.5m"`.

---

## Components

### `StatPill`

```tsx
<StatPill label="xGI" value="7.23" />
```

Renders a small rounded badge with a label and value. Used throughout the dashboard wherever a compact key/value stat needs to be shown.

Examples from `App.tsx`:

```tsx
{/* Player overview grid — one card per top player */}
<StatPill label="Points" value={player.totalPoints} />
<StatPill label="Form" value={player.form.toFixed(1)} />
<StatPill label="xGI" value={player.expectedGoalInvolvements.toFixed(1)} />
<StatPill label="Price" value={formatCost(player.nowCost)} />

{/* Detail panel — full stats for the selected player */}
<StatPill label="Points" value={selectedPlayer.data.player.totalPoints} />
<StatPill label="Goals" value={selectedPlayer.data.player.goalsScored} />
<StatPill label="Assists" value={selectedPlayer.data.player.assists} />
<StatPill label="xG" value={selectedPlayer.data.player.expectedGoals.toFixed(2)} />
<StatPill label="xA" value={selectedPlayer.data.player.expectedAssists.toFixed(2)} />
<StatPill label="T" value={selectedPlayer.data.player.tackles} />
<StatPill label="Price" value={formatCost(selectedPlayer.data.player.nowCost)} />
```

The `value` prop accepts `string | number` — pass a pre-formatted string when you want explicit decimal precision (e.g. `.toFixed(2)`) or a raw number when the default `toString()` rendering is sufficient.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:4000/api` | API base URL injected at build time by Vite |

Set this in the root `.env` file. To point the frontend at a different API host without modifying `.env`:

```bash
VITE_API_BASE_URL=http://localhost:4100/api npm run dev:web
```

---

## Testing

```bash
npm run test          # run once
npm run test:watch    # watch mode
```

### What jsdom is

React components run in the browser, but tests run in Node.js, which has no DOM. [jsdom](https://github.com/jsdom/jsdom) is a pure-JavaScript implementation of the browser's DOM APIs — things like `document`, `window`, `HTMLElement`, event listeners, and CSS class names. When Vitest is configured with `environment: "jsdom"` (see `vite.config.ts`), it sets up a jsdom environment before each test file runs, so React can render components and you can query and interact with the resulting DOM tree in Node.

### What `@testing-library/jest-dom` adds

[React Testing Library](https://testing-library.com/docs/react-testing-library/intro) provides `render()` and `screen` for rendering components and querying the DOM. `@testing-library/jest-dom` extends the standard assertion library with DOM-specific matchers that make test assertions more readable:

```ts
// Without jest-dom — more verbose, less descriptive failure messages
expect(document.querySelector("h1")?.textContent).toBe("FPL Clone");

// With jest-dom — cleaner and produces better failure messages
expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("FPL Clone");
expect(screen.getByRole("button")).toBeInTheDocument();
expect(screen.getByText("Loading...")).toBeVisible();
```

The `src/test/setup.ts` file imports `@testing-library/jest-dom` once, which automatically extends Vitest's `expect` with all the DOM matchers globally across every test file.

---

## Responsive design

The layout uses CSS grid and flexbox with breakpoints in `global.css`:

- On wide screens: hero panel spans full width; overview grid shows multiple columns; dashboard shows two columns side by side
- On narrow screens (mobile): all sections stack vertically; player cards reflow to single column; font sizes and touch targets remain accessible

No CSS framework is used — all styles are in `global.css`. The FPL color palette (purple, green, white) is defined as CSS custom properties at the `:root` level so they can be referenced throughout the file without repetition.
