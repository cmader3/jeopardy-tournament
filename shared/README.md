# @jeopardy/shared

The pure game-logic core for the Jeopardy Tournament app. This package has zero I/O: no
`Date.now()`, no database, and no sockets. Time and randomness are injected through a `ctx`
argument so the rules are fully deterministic and unit-testable. It is the single place where the
domain models, the Socket.IO event contracts, the game reducer, and the role projections are
defined.

See the repository root `README.md` for full setup. This file covers shared-specific details.

## Purpose

- Domain models: `Board`, `Round`, `Category`, `Clue`, `GameSession`, `Player`, game phases,
  buzz state, and related types.
- Socket.IO event contracts: the client-to-server and server-to-client event payload types used
  on both ends, so there are no stringly-typed events or duplicated shapes.
- Role-view types: the exact shapes projected to the board, host, and contestant roles.
- Pure reducer: `reduce(state, intent, ctx)` returns the next state plus effects. It handles every
  phase transition (lobby, board select, clue reveal, buzz arbitration with the 250ms early-buzz
  lockout, rulings and scoring, Daily Doubles, round advance, and the Final flow). `ctx` carries
  the injected clock (`now`) and optional randomness.
- Projection functions: `projectBoard`, `projectHost`, and `projectContestant`. These are the only
  intended way state leaves the server, and they enforce the secrecy boundary by omitting correct
  answers, Daily Double wagers, and Final wagers/answers until the correct reveal step.
- Board validation helpers used when authoring or importing content.

## How it is consumed

- `server` imports the models, event contracts, reducer, and projections. It holds the only
  authoritative game state, calls `reduce` with a real clock, persists the result, and emits the
  projections to each role.
- `client` imports the models, event contracts, and role-view types so its intents and rendered
  views are typed against the same definitions the server uses.

Because the reducer is pure and I/O free, the correctness-critical logic (scoring, buzz fairness,
phase transitions, wager bounds, and secret filtering) is tested in isolation without a server or
a browser. The root `test` script builds this package first so the server and client consume the
compiled output.

## Test

```
npm run test -w shared        # vitest run --maxWorkers=4
npm run typecheck -w shared   # tsc --noEmit
npm run build -w shared       # tsc build consumed by server and client
```

## Key directories

```
shared/
  src/
    index.ts              # re-exports models, events, reducer, projections, boardValidation
    models/               # domain model types
    events/               # Socket.IO event contracts and role-view types
    reducer/              # pure reducer and its tests (game rules, Final flow, round advance)
    projections/          # projectBoard / projectHost / projectContestant and their tests
    boardValidation.ts    # board content validation helpers
```
