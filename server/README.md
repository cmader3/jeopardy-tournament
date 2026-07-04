# @jeopardy/server

The authoritative back end for the Jeopardy Tournament app: an Express 5 REST API, a Socket.IO
transport layer, and a Prisma persistence layer on SQLite. It owns the single authoritative game
engine, runs the pure reducer from `@jeopardy/shared` with an injected clock, persists a snapshot
on every committed transition, and broadcasts role-filtered projections so secrets never reach
the wrong role.

See the repository root `README.md` for full setup. This file covers server-specific details.

## Purpose

- Serve content and auth over REST: host login, boards CRUD, spreadsheet import preview, and game
  creation.
- Manage live games over Socket.IO: room-per-game, role sub-rooms (host, board, contestant),
  intent validation with zod, and role-filtered broadcasts.
- Own server-authoritative timers and fastest-finger buzz arbitration (single writer per game via
  the Node event loop).
- Persist reusable board content and live-game snapshots to SQLite, and rehydrate active games on
  boot.

## Local run

Set up `server/.env` and the database (see below), then from the repository root:

```
npm run dev:server
```

This runs `tsx watch src/index.ts` with `PORT=4000`. Health check:

```
curl -sf http://localhost:4000/api/health
```

The Socket.IO CORS policy allows `CLIENT_ORIGIN` (default `http://localhost:4100`). The Express
API itself sends no CORS headers; the client reaches `/api/*` through the Vite same-origin proxy.

Key REST endpoints:

- `POST /api/auth/host` and `GET /api/auth/me` (host token via `Authorization: Bearer`).
- `GET/POST/PUT/DELETE /api/boards` and `/api/boards/:id` (host-protected).
- `POST /api/boards/import` (multipart upload, returns a board preview; not persisted).
- `POST /api/games` (create a session from a board id; returns `{ roomCode }`).
- `GET /api/health` (liveness).

## Test

```
npm run test -w server        # vitest run --maxWorkers=4
npm run typecheck -w server   # tsc --noEmit
```

Server tests use supertest for REST and socket.io-client for socket integration. Run the server
suite through the managed `test` script rather than ad-hoc parallel invocations; each Vitest
worker gets its own SQLite database (`src/test-db.ts` and `src/test-setup.ts`) to keep tests
isolated.

## Prisma and the database

- Prisma v6 with a SQLite datasource whose `url` is read from `DATABASE_URL`.
- Schema: `server/prisma/schema.prisma`. Migrations: `server/prisma/migrations`.
- The database file is created at `server/prisma/dev.db`.
- Setup commands (run once, and after any schema change):

```
npm run prisma:generate -w server   # prisma generate
npm run prisma:migrate -w server    # prisma migrate deploy
```

Content models: `Board`, `Round`, `Category`, `Clue`. Live-game models: `GameSession` (holds the
serialized snapshot and a unique `roomCode`) and `Player` (holds `score`, `seatOrder`, and a
unique `reconnectToken`). The in-memory game state is authoritative at runtime; the snapshot is
the durable mirror used for recovery.

## Environment variables

Defined in `server/.env` (gitignored, never commit).

- `HOST_PASSCODE` (required): shared passcode gating `/admin` and `/host`.
- `TOKEN_SECRET` (required): secret used to HMAC-sign the host session token.
- `DATABASE_URL` (required): SQLite connection string, for example `file:./dev.db`, resolved
  relative to `server/prisma`.
- `PORT` (optional, default `4000`): listen port.
- `CLIENT_ORIGIN` (optional, default `http://localhost:4100`): origin allowed for Socket.IO CORS.

`src/env.ts` loads these from `server/.env` at startup if they are not already set in the
environment.

## Key directories

```
server/
  prisma/                 # schema.prisma, migrations, dev.db
  src/
    index.ts              # entry point: load env, start engine, HTTP server, Socket.IO
    env.ts                # loads server/.env into process.env
    http/                 # Express app + routers: auth, boards, import, games, health, validation
    sockets/              # Socket.IO bootstrap and per-game event handlers
    engine/               # authoritative game engine (holds live GameState, applies intents)
    repo/                 # Prisma repository functions
    auth/                 # constant-time passcode check, HMAC token, requireHost middleware
    importer/             # spreadsheet reader + heuristic parser (offline, buffer API)
    utils/                # shared helpers
    test-db.ts            # per-worker SQLite database for isolated tests
    test-setup.ts         # Vitest setup
```
