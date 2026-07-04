# @jeopardy/client

The front end for the Jeopardy Tournament app: React 19 + Vite + React Router 7, styled with CSS
Modules and a single design-token stylesheet (`src/theme.css`). Each view opens a Socket.IO
connection, receives a role-filtered projection from the server, and renders only what it is
sent, so the board and contestant views cannot leak answers or hidden wagers.

See the repository root `README.md` for full setup. This file covers client-specific details.

## Purpose

- Render the four game surfaces (admin, host, board, play) plus a landing page.
- Send typed intents to the server over Socket.IO and display the projection the server returns.
- Handle host passcode auth for `/admin` and `/host`, and persist contestant identity (room code
  and reconnect token) in `localStorage` for reconnect.

## Local run

The server must be running first (see the root README). From the repository root:

```
npm run dev:client
```

Vite serves on port 4100 with strict port (configured in `vite.config.ts`). Open the app at
`http://localhost:4100`.

Vite proxies same-origin `/api/*` requests to the server on port 4000, so REST calls work from
the client origin without CORS. The Socket.IO connection is made directly to the server origin
(default `http://localhost:4000`). Set `VITE_API_BASE_URL` to override the base URL if the server
is not at the default location.

## Test

```
npm run test -w client        # vitest run --maxWorkers=4 --environment happy-dom
npm run typecheck -w client   # tsc --noEmit
```

Tests use Vitest with happy-dom and React Testing Library. Setup lives in `src/test-setup.ts`.

## Routes and surfaces

Routes are defined in `src/App.tsx` with React Router 7:

- `/` (landing): links to the other surfaces.
- `/admin` (host passcode required): board library, manual board editor, and spreadsheet import
  with a preview you edit before saving.
- `/host` (host passcode required): create a game to get a room code, manage the lobby, and drive
  live gameplay (select clues, arm buzzers, rule correct/incorrect, adjust scores, undo, handle
  Daily Double and Final wagers, and step through the Final reveal).
- `/board` (open): projector view with the category grid, full-screen clue overlay, scoreboard,
  armed lights, countdown, round banners, the Daily Double splash, the staged Final reveal, and
  audio cues with mute.
- `/play` (room code and name): per-contestant device with a full-screen state-driven buzzer,
  own name and score, wager inputs (Daily Double and Final), and the Final answer form.

## Key directories

```
client/
  vite.config.ts          # dev server on port 4100 (strict) + /api proxy to :4000
  vitest.config.ts        # test config
  src/
    main.tsx              # React entry point
    App.tsx               # React Router route table
    theme.css             # design tokens (Jeopardy colors and fonts)
    routes/               # one module per surface: landing, admin, host, board, play
    views/                # view-level building blocks
    components/           # shared UI (PasscodeGate, Countdown, AudioToggle, RoundBanner, FitText)
    hooks/                # audio + server-time synchronization hooks
    socket/               # useSocket wrapper and contestant token storage
    api/                  # REST clients: auth, boards, games
    auth/                 # host auth helpers
    test-setup.ts         # Vitest setup
```
