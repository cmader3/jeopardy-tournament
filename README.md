# Jeopardy Tournament

A real-time, multiplayer web app for running a live game of Jeopardy the way the show is
operated. One person authors game content, a host runs the live game, a shared display shows
the board, and up to five contestants play from their own phones or laptops with a real-time
buzzer, wagering, and Final Jeopardy answer entry.

The server is the single source of truth for all live game state. Contestants and the host send
intents (typed Socket.IO events); the server validates them, applies a pure reducer, persists a
snapshot, and broadcasts role-filtered views. Correct answers, Daily Double wagers, and Final
wagers/answers live on the server and are only sent to a role at the moment that role is allowed
to see them, so the board and other contestants cannot leak them.

## Key features

- Content authoring in `/admin`: build a board by hand or import an arbitrarily formatted
  spreadsheet (CSV or XLSX) through an offline heuristic parser, then preview and edit before
  saving. Boards are reusable across games.
- Customizable board: grid size, per-clue timer, optional Daily Doubles, optional Double
  Jeopardy round, and a Final Jeopardy clue.
- Room-code lobby for up to five contestants who join from their own devices.
- Server-authoritative timers and a fastest-finger buzzer with a 250ms early-buzz lockout.
- Standard scoring: a correct ruling adds the clue value and passes control; an incorrect ruling
  deducts the value, re-arms the remaining players, and restarts the timer. Manual score edits
  and undo are available to the host.
- Daily Double wager flow, round transitions (Jeopardy to Double Jeopardy to Final), and a
  staged Final Jeopardy reveal.
- Persistence and reconnect: live game state is written to SQLite on every committed transition,
  so a server restart or a dropped contestant recovers cleanly.

## Architecture summary

This is a TypeScript monorepo using npm workspaces with three packages.

- `shared` (`@jeopardy/shared`): pure game logic with zero I/O. It defines the domain models,
  the Socket.IO event contracts, the role-view types, the pure reducer
  `reduce(state, intent, ctx)`, and the projection functions (`projectBoard`, `projectHost`,
  `projectContestant`). Time and randomness are injected through `ctx` so the rules are
  deterministically testable. Both the server and client import from this package.
- `server` (`@jeopardy/server`): Express 5 REST API, Socket.IO transport, and a Prisma
  persistence layer on SQLite. It owns the only authoritative game engine, runs the shared
  reducer with an injected clock, persists snapshots, and broadcasts role-filtered projections.
- `client` (`@jeopardy/client`): React 19 + Vite + React Router 7 front end. Each view holds the
  latest server projection and renders only what the server sends it.

Realtime flow: a client opens a Socket.IO connection and emits `join` with its role (host, board,
or contestant) and identity. The server joins it to the room for that game and a role sub-room,
then emits the current projection. Client intents (for example `buzz`, `select_clue`,
`rule_correct`) are validated with zod, dispatched to the reducer, persisted, and the resulting
projections are broadcast back to each role.

## Monorepo layout

```
jeopardy-tournament/
  package.json            # workspaces: ["shared","server","client"] + root scripts
  tsconfig.base.json      # shared TypeScript compiler options
  eslint.config.js        # ESLint 10 flat config
  shared/                 # pure domain models, event contracts, reducer, projections
  server/                 # Express 5 + Socket.IO + Prisma (SQLite)
  client/                 # React 19 + Vite + React Router 7
```

## Prerequisites

- Node 26 and npm 11.
- No Docker and no database service. SQLite is a plain file on disk.
- `timeout` and `gtimeout` are not required and are not used here.

## Setup

From the repository root:

```
npm install
```

Create `server/.env` (this file is gitignored and must never be committed). See the environment
variables section below for the full list. A minimal development file:

```
HOST_PASSCODE=jeopardy
TOKEN_SECRET=dev-only-change-me
PORT=4000
CLIENT_ORIGIN=http://localhost:4100
DATABASE_URL="file:./dev.db"
```

Generate the Prisma client and apply the database migrations (these run against the SQLite file):

```
npm run prisma:generate -w server
npm run prisma:migrate -w server
```

`prisma:generate` maps to `prisma generate` and `prisma:migrate` maps to `prisma migrate deploy`.
The SQLite file is created at `server/prisma/dev.db` (the path comes from `DATABASE_URL`, which is
relative to `server/prisma`).

## Running locally

Start the server (binds port 4000):

```
npm run dev:server
```

Verify the server with the health check:

```
curl -sf http://localhost:4000/api/health
```

In a second terminal, start the client (Vite on port 4100):

```
npm run dev:client
```

The Vite dev server is already pinned to port 4100 with strict port. Open the app at:

```
http://localhost:4100
```

Use the client origin (`http://localhost:4100`) in the browser. The Vite dev server proxies
same-origin `/api/*` requests to the server on port 4000, and the Express API sends no CORS
headers of its own. The Socket.IO connection is made directly to the server origin (default
`http://localhost:4000`), which is why the server allows that origin for Socket.IO through
`CLIENT_ORIGIN`.

## The four app surfaces (end to end)

Landing at `/` links to each surface. A full local game uses four kinds of pages.

1. `/admin` (host passcode required): the content authoring surface. Enter the host passcode,
   then either build a board by hand (categories, clues, answers, grid size, Double Jeopardy
   toggle, timers, Daily Double marks, and the Final clue) or upload a CSV/XLSX spreadsheet. The
   importer returns a preview you review and edit before saving. Saved boards form a reusable
   library.
2. `/host` (host passcode required): run a live game. Create a game from a saved board to get a
   room code, manage the lobby, and drive gameplay from the control panel (select clues, arm the
   buzzers, rule correct/incorrect, adjust scores, undo, handle Daily Double and Final wagers,
   and step through the Final reveal).
3. `/board` (open): the projector or shared-screen view. Open it on the display everyone can see.
   It shows the category grid, full-screen clue overlay, scoreboard, armed lights, countdown,
   round banners, the Daily Double splash, the staged Final reveal, and audio cues with a mute
   toggle. It never receives answers or hidden wagers.
4. `/play` (room code and name): the per-contestant device. Each contestant opens this on their
   own phone or laptop, joins with the room code and a display name, and gets a full-screen
   buzzer plus wager inputs (Daily Double and Final) and the Final answer form.

Typical run: author or import a board in `/admin`, create the game in `/host` to get a room code,
open `/board` on the shared screen, have each contestant join `/play` with the room code, then
start the game from `/host` and play through to Final Jeopardy.

## Testing

All commands run from the repository root and cover every workspace:

```
npm run test        # Vitest run mode, workers capped at 4; builds shared first
npm run typecheck   # tsc --noEmit across shared, server, and client
npm run lint        # ESLint 10 flat config over the whole repo
```

Tests use Vitest with happy-dom (client), supertest (server REST), socket.io-client (socket
integration), and React Testing Library (components). Run per workspace with `-w`, for example
`npm run test -w server`.

## Environment variables

Server variables live in `server/.env`, which is gitignored.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HOST_PASSCODE` | Yes | none (dev setups use `jeopardy`) | Shared passcode that gates `/admin` and `/host`. |
| `TOKEN_SECRET` | Yes | none | Secret used to HMAC-sign the host session token. |
| `DATABASE_URL` | Yes | `file:./dev.db` in dev | SQLite connection string, resolved relative to `server/prisma`. |
| `PORT` | No | `4000` | Port the server listens on. |
| `CLIENT_ORIGIN` | No | `http://localhost:4100` | Origin allowed for the Socket.IO CORS policy. |

Client variable (optional, read at build time by Vite):

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | No | empty for REST (same-origin proxy), `http://localhost:4000` for Socket.IO | Overrides the base URL the client uses to reach the server. |

## Notes

- SQLite is a single file at `server/prisma/dev.db`. There is no database service to start or
  stop, and there is no Docker.
- All processes stay within the port band 4000 to 4199. The server uses 4000 and the client uses
  4100.
- `server/.env` holds the passcode and token secret and is gitignored. Never commit it.
