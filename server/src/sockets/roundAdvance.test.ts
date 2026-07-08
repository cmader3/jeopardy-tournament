import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ClientIo, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../http/app.js';
import { GameEngine } from '../engine/game.js';
import { prisma } from '../repo/prisma.js';
import { boardRepository } from '../repo/board.js';
import { mintHostToken } from '../auth/token.js';
import { registerGameSockets } from './game.js';

function makeBoardWithDoubleJeopardy() {
  return {
    name: 'Round Advance DJ Board',
    includeDoubleJeopardy: true,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    rounds: [
      {
        type: 'JEOPARDY',
        order: 0,
        categories: [
          {
            title: 'Science',
            order: 0,
            clues: [
              { value: 100, row: 0, clueText: 'H2O', answer: 'Water', isDailyDouble: false },
            ],
          },
        ],
      },
      {
        type: 'DOUBLE_JEOPARDY',
        order: 1,
        categories: [
          {
            title: 'Arts',
            order: 0,
            clues: [
              { value: 200, row: 0, clueText: 'Brush', answer: 'Brush', isDailyDouble: false },
            ],
          },
        ],
      },
      {
        type: 'FINAL',
        order: 2,
        categories: [
          {
            title: 'Literature',
            order: 0,
            clues: [
              { value: null, row: 0, clueText: 'Hobbit author', answer: 'Tolkien', isDailyDouble: false },
            ],
          },
        ],
      },
    ],
  };
}

function makeBoardWithoutDoubleJeopardy() {
  return {
    name: 'Round Advance Single Board',
    includeDoubleJeopardy: false,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    rounds: [
      {
        type: 'JEOPARDY',
        order: 0,
        categories: [
          {
            title: 'Science',
            order: 0,
            clues: [
              { value: 100, row: 0, clueText: 'H2O', answer: 'Water', isDailyDouble: false },
            ],
          },
        ],
      },
      {
        type: 'DOUBLE_JEOPARDY',
        order: 1,
        categories: [
          {
            title: 'Hidden DJ',
            order: 0,
            clues: [
              { value: 200, row: 0, clueText: 'Hidden', answer: 'Hidden', isDailyDouble: false },
            ],
          },
        ],
      },
      {
        type: 'FINAL',
        order: 2,
        categories: [
          {
            title: 'Literature',
            order: 0,
            clues: [
              { value: null, row: 0, clueText: 'Hobbit author', answer: 'Tolkien', isDailyDouble: false },
            ],
          },
        ],
      },
    ],
  };
}

interface TestServer {
  http: ReturnType<typeof createServer>;
  io: Server;
  engine: GameEngine;
  url: string;
  close: () => Promise<void>;
}

async function createTestServer(): Promise<TestServer> {
  const engine = new GameEngine();
  await engine.loadActiveSessions();
  const app = createApp(engine);
  const http = createServer(app);
  const io = new Server(http, { cors: { origin: '*' } });
  registerGameSockets(io, engine);

  await new Promise<void>((resolve) => http.listen(0, resolve));
  const port = (http.address() as { port: number }).port;

  return {
    http,
    io,
    engine,
    url: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        engine.clearTimers();
        io.close(() => {
          http.close(() => resolve());
        });
      }),
  };
}

function connectClient(url: string): ClientSocket {
  return ClientIo(url, {
    transports: ['websocket'],
    autoConnect: true,
  });
}

function waitForConnect(client: ClientSocket): Promise<void> {
  return new Promise((resolve) => {
    client.once('connect', () => resolve());
  });
}

function waitForState(
  client: ClientSocket,
  predicate?: (state: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('state', handler);
      reject(new Error(`Timed out waiting for state after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (data: unknown) => {
      const state = data as Record<string, unknown>;
      if (!predicate || predicate(state)) {
        clearTimeout(timer);
        client.off('state', handler);
        resolve(state);
      }
    };

    client.on('state', handler);
  });
}

function waitForError(client: ClientSocket): Promise<{ message: string }> {
  return new Promise((resolve) => {
    client.once('error', (data) => resolve(data as { message: string }));
  });
}

async function setupGame(server: TestServer, boardPayload: ReturnType<typeof makeBoardWithDoubleJeopardy>) {
  const board = await boardRepository.create(boardPayload);
  const { roomCode } = await server.engine.createSession(board.id);

  const host = connectClient(server.url);
  const boardClient = connectClient(server.url);
  const alice = connectClient(server.url);
  const bob = connectClient(server.url);

  await Promise.all([
    waitForConnect(host),
    waitForConnect(boardClient),
    waitForConnect(alice),
    waitForConnect(bob),
  ]);

  host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
  boardClient.emit('join', { role: 'board', roomCode });
  alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
  bob.emit('join', { role: 'contestant', roomCode, name: 'Bob' });

  await Promise.all([
    waitForState(host),
    waitForState(boardClient),
    waitForState(alice),
    waitForState(bob),
  ]);

  host.emit('start_game');
  await Promise.all([
    waitForState(host),
    waitForState(boardClient),
    waitForState(alice),
    waitForState(bob),
  ]);

  return { roomCode, host, boardClient, alice, bob };
}

async function resolveClue(host: ClientSocket, boardClient: ClientSocket, alice: ClientSocket, bob: ClientSocket, clueId: string) {
  const hostReveal = waitForState(host, (s) => s.phase === 'CLUE_REVEALED');
  const boardReveal = waitForState(boardClient, (s) => s.phase === 'CLUE_REVEALED');
  const aliceReveal = waitForState(alice, (s) => s.phase === 'CLUE_REVEALED');
  const bobReveal = waitForState(bob, (s) => s.phase === 'CLUE_REVEALED');

  host.emit('select_clue', { clueId });
  await Promise.all([hostReveal, boardReveal, aliceReveal, bobReveal]);

  const hostUpdate = waitForState(host, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(clueId));
  const boardUpdate = waitForState(boardClient, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(clueId));
  const aliceUpdate = waitForState(alice, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(clueId));
  const bobUpdate = waitForState(bob, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(clueId));

  host.emit('reveal_answer');
  return Promise.all([hostUpdate, boardUpdate, aliceUpdate, bobUpdate]);
}

describe('round advance sockets', { timeout: 15000 }, () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.player.deleteMany();
    await prisma.gameSession.deleteMany();
    await prisma.clue.deleteMany();
    await prisma.category.deleteMany();
    await prisma.round.deleteMany();
    await prisma.board.deleteMany();
  });

  it('host advance moves all views to ROUND_TRANSITION targeting Double Jeopardy', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server, makeBoardWithDoubleJeopardy());
    const state = server.engine.getState(roomCode)!;
    const clueId = state.board.rounds[0].clues[0].id;

    await resolveClue(host, boardClient, alice, bob, clueId);

    const hostUpdate = waitForState(host, (s) => s.phase === 'ROUND_TRANSITION');
    const boardUpdate = waitForState(boardClient, (s) => s.phase === 'ROUND_TRANSITION');
    const aliceUpdate = waitForState(alice, (s) => s.phase === 'ROUND_TRANSITION');
    const bobUpdate = waitForState(bob, (s) => s.phase === 'ROUND_TRANSITION');

    host.emit('advance_round');
    const [hostState, boardState, aliceState, bobState] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    expect((hostState as { phase: string }).phase).toBe('ROUND_TRANSITION');
    expect((hostState as { transitionTarget: string }).transitionTarget).toBe('DOUBLE_JEOPARDY');
    expect((boardState as { transitionTarget: string }).transitionTarget).toBe('DOUBLE_JEOPARDY');
    expect((aliceState as { transitionTarget: string }).transitionTarget).toBe('DOUBLE_JEOPARDY');
    expect((bobState as { transitionTarget: string }).transitionTarget).toBe('DOUBLE_JEOPARDY');

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('advancing from ROUND_TRANSITION enters Double Jeopardy BOARD_SELECT with carried-over scores', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server, makeBoardWithDoubleJeopardy());
    const state = server.engine.getState(roomCode)!;
    const clueId = state.board.rounds[0].clues[0].id;

    await resolveClue(host, boardClient, alice, bob, clueId);
    host.emit('advance_round');
    await Promise.all([
      waitForState(host, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(boardClient, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(alice, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(bob, (s) => s.phase === 'ROUND_TRANSITION'),
    ]);

    const hostUpdate = waitForState(host, (s) => s.phase === 'BOARD_SELECT' && s.roundIndex === 1);
    const boardUpdate = waitForState(boardClient, (s) => s.phase === 'BOARD_SELECT' && s.roundIndex === 1);
    const aliceUpdate = waitForState(alice, (s) => s.phase === 'BOARD_SELECT' && s.roundIndex === 1);
    const bobUpdate = waitForState(bob, (s) => s.phase === 'BOARD_SELECT' && s.roundIndex === 1);

    host.emit('advance_round');
    const [hostState, boardState, aliceState, bobState] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    expect((hostState as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((hostState as { roundIndex: number }).roundIndex).toBe(1);
    expect((boardState as { round: { type: string } | null }).round?.type).toBe('DOUBLE_JEOPARDY');
    expect((aliceState as { players: { score: number }[] }).players[0].score).toBe(0);
    expect((bobState as { players: { score: number }[] }).players[0].score).toBe(0);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('with Double Jeopardy disabled the second advance goes to FINAL_INTRO', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server, makeBoardWithoutDoubleJeopardy());
    const state = server.engine.getState(roomCode)!;
    const clueId = state.board.rounds[0].clues[0].id;

    await resolveClue(host, boardClient, alice, bob, clueId);
    host.emit('advance_round');
    await Promise.all([
      waitForState(host, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(boardClient, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(alice, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(bob, (s) => s.phase === 'ROUND_TRANSITION'),
    ]);

    const hostUpdate = waitForState(host, (s) => s.phase === 'FINAL_INTRO');
    const boardUpdate = waitForState(boardClient, (s) => s.phase === 'FINAL_INTRO');
    const aliceUpdate = waitForState(alice, (s) => s.phase === 'FINAL_INTRO');
    const bobUpdate = waitForState(bob, (s) => s.phase === 'FINAL_INTRO');

    host.emit('advance_round');
    const [hostState, boardState] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    expect((hostState as { phase: string }).phase).toBe('FINAL_INTRO');
    expect((hostState as { roundIndex: number }).roundIndex).toBe(2);
    expect((boardState as { round: { type: string } | null }).round?.type).toBe('FINAL');

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('non-host cannot advance the round', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server, makeBoardWithDoubleJeopardy());
    const state = server.engine.getState(roomCode)!;
    const clueId = state.board.rounds[0].clues[0].id;

    await resolveClue(host, boardClient, alice, bob, clueId);

    const aliceError = waitForError(alice);
    alice.emit('advance_round');
    const error = await aliceError;

    expect(error.message).toMatch(/only the host/i);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('advancing before the round is complete is rejected', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server, makeBoardWithDoubleJeopardy());

    const hostError = waitForError(host);
    host.emit('advance_round');
    const error = await hostError;

    expect(error.message).toMatch(/not complete/i);
    expect(server.engine.getState(roomCode)!.phase).toBe('BOARD_SELECT');

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('new round control goes to the trailing contestant and can be overridden by the host', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server, makeBoardWithDoubleJeopardy());
    const state = server.engine.getState(roomCode)!;
    const clueId = state.board.rounds[0].clues[0].id;
    const doubleJeopardyClueId = state.board.rounds[1].clues[0].id;

    await resolveClue(host, boardClient, alice, bob, clueId);

    // Give Alice a lower score than Bob so Alice is the trailing contestant.
    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
    const bobId = state.players.find((p) => p.name === 'Bob')!.id;
    host.emit('adjust_score', { playerId: aliceId, score: 100 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 100);
    host.emit('adjust_score', { playerId: bobId, score: 200 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === bobId)?.score === 200);

    host.emit('advance_round');
    await Promise.all([
      waitForState(host, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(boardClient, (s) => s.phase === 'ROUND_TRANSITION'),
    ]);

    const hostUpdate = waitForState(host, (s) => s.phase === 'BOARD_SELECT' && s.roundIndex === 1);
    const boardUpdate = waitForState(boardClient, (s) => s.phase === 'BOARD_SELECT' && s.roundIndex === 1);
    host.emit('advance_round');
    const [hostState] = await Promise.all([hostUpdate, boardUpdate]);

    const typedHost = hostState as { controllingPlayerId: string | null; roundIndex: number; phase: string };
    expect(typedHost.phase).toBe('BOARD_SELECT');
    expect(typedHost.roundIndex).toBe(1);
    expect(typedHost.controllingPlayerId).toBe(aliceId);

    const overrideUpdate = waitForState(host, (s) => (s as { controllingPlayerId: string | null }).controllingPlayerId === bobId);
    host.emit('override_control', { playerId: bobId });
    await overrideUpdate;

    host.emit('set_clue_selection_mode', { mode: 'PLAYER' });
    await waitForState(host, (s) => (s as { clueSelectionMode: string }).clueSelectionMode === 'PLAYER');

    const aliceError = waitForError(alice);
    alice.emit('select_clue', { clueId: doubleJeopardyClueId });
    const error = await aliceError;
    expect(error.message).toMatch(/Only the controlling player or host can select a clue/i);

    const bobSelected = waitForState(bob, (s) => s.phase === 'CLUE_SELECTED');
    bob.emit('select_clue', { clueId: doubleJeopardyClueId });
    await bobSelected;

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('new round control prefers a connected contestant over a disconnected trailing contestant', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server, makeBoardWithDoubleJeopardy());
    const state = server.engine.getState(roomCode)!;
    const clueId = state.board.rounds[0].clues[0].id;
    const doubleJeopardyClueId = state.board.rounds[1].clues[0].id;

    await resolveClue(host, boardClient, alice, bob, clueId);

    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
    const bobId = state.players.find((p) => p.name === 'Bob')!.id;
    host.emit('adjust_score', { playerId: aliceId, score: 100 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 100);
    host.emit('adjust_score', { playerId: bobId, score: 200 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === bobId)?.score === 200);

    // Disconnect the trailing contestant (Alice) before the round transition.
    alice.disconnect();
    await waitForState(host, (s) => s.players.find((p: { id: string; connected: boolean }) => p.id === aliceId)?.connected === false);

    host.emit('advance_round');
    await Promise.all([
      waitForState(host, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(boardClient, (s) => s.phase === 'ROUND_TRANSITION'),
    ]);

    const hostUpdate = waitForState(host, (s) => s.phase === 'BOARD_SELECT' && s.roundIndex === 1);
    const boardUpdate = waitForState(boardClient, (s) => s.phase === 'BOARD_SELECT' && s.roundIndex === 1);
    host.emit('advance_round');
    const [hostState] = await Promise.all([hostUpdate, boardUpdate]);

    const typedHost = hostState as { controllingPlayerId: string | null; roundIndex: number; phase: string };
    expect(typedHost.phase).toBe('BOARD_SELECT');
    expect(typedHost.roundIndex).toBe(1);
    expect(typedHost.controllingPlayerId).toBe(bobId);

    // Bob (connected) can select the next round's first clue in player-pick mode.
    host.emit('set_clue_selection_mode', { mode: 'PLAYER' });
    await waitForState(host, (s) => (s as { clueSelectionMode: string }).clueSelectionMode === 'PLAYER');
    const bobSelected = waitForState(bob, (s) => s.phase === 'CLUE_SELECTED');
    bob.emit('select_clue', { clueId: doubleJeopardyClueId });
    await bobSelected;

    host.disconnect();
    boardClient.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('falls back to the all-contestants selection when no contestant is connected', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server, makeBoardWithDoubleJeopardy());
    const state = server.engine.getState(roomCode)!;
    const clueId = state.board.rounds[0].clues[0].id;

    await resolveClue(host, boardClient, alice, bob, clueId);

    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
    const bobId = state.players.find((p) => p.name === 'Bob')!.id;
    host.emit('adjust_score', { playerId: aliceId, score: 100 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 100);
    host.emit('adjust_score', { playerId: bobId, score: 200 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === bobId)?.score === 200);

    // Disconnect both contestants before the round transition.
    alice.disconnect();
    bob.disconnect();
    await waitForState(host, (s) => s.players.every((p: { connected: boolean }) => !p.connected));

    host.emit('advance_round');
    await Promise.all([
      waitForState(host, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(boardClient, (s) => s.phase === 'ROUND_TRANSITION'),
    ]);

    const hostUpdate = waitForState(host, (s) => s.phase === 'BOARD_SELECT' && s.roundIndex === 1);
    const boardUpdate = waitForState(boardClient, (s) => s.phase === 'BOARD_SELECT' && s.roundIndex === 1);
    host.emit('advance_round');
    const [hostState] = await Promise.all([hostUpdate, boardUpdate]);

    const typedHost = hostState as { controllingPlayerId: string | null; roundIndex: number; phase: string };
    expect(typedHost.phase).toBe('BOARD_SELECT');
    expect(typedHost.roundIndex).toBe(1);
    // Fallback uses the existing deterministic tie-break among all contestants: Alice has the lowest score.
    expect(typedHost.controllingPlayerId).toBe(aliceId);

    host.disconnect();
    boardClient.disconnect();
    await server.close();
  });

  it('advances from FINAL_INTRO to FINAL_WAGER when at least one contestant is eligible', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server, makeBoardWithoutDoubleJeopardy());
    const state = server.engine.getState(roomCode)!;
    const clueId = state.board.rounds[0].clues[0].id;

    await resolveClue(host, boardClient, alice, bob, clueId);

    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
    host.emit('adjust_score', { playerId: aliceId, score: 100 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 100);

    host.emit('advance_round');
    await Promise.all([
      waitForState(host, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(boardClient, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(alice, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(bob, (s) => s.phase === 'ROUND_TRANSITION'),
    ]);

    const hostUpdate = waitForState(host, (s) => s.phase === 'FINAL_INTRO');
    const boardUpdate = waitForState(boardClient, (s) => s.phase === 'FINAL_INTRO');
    const aliceUpdate = waitForState(alice, (s) => s.phase === 'FINAL_INTRO');
    const bobUpdate = waitForState(bob, (s) => s.phase === 'FINAL_INTRO');
    host.emit('advance_round');
    await Promise.all([hostUpdate, boardUpdate, aliceUpdate, bobUpdate]);

    const hostWager = waitForState(host, (s) => s.phase === 'FINAL_WAGER');
    const boardWager = waitForState(boardClient, (s) => s.phase === 'FINAL_WAGER');
    const aliceWager = waitForState(alice, (s) => s.phase === 'FINAL_WAGER');
    const bobWager = waitForState(bob, (s) => s.phase === 'FINAL_WAGER');
    host.emit('open_final_wagers');
    const [hostState, boardState, aliceState] = await Promise.all([hostWager, boardWager, aliceWager, bobWager]);

    expect((hostState as { phase: string }).phase).toBe('FINAL_WAGER');
    expect((boardState as { phase: string }).phase).toBe('FINAL_WAGER');
    expect((aliceState as { phase: string }).phase).toBe('FINAL_WAGER');
    expect((aliceState as { finalEligiblePlayerIds: string[] }).finalEligiblePlayerIds).toContain(aliceId);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('skips Final and goes to COMPLETE when no contestants are eligible', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server, makeBoardWithoutDoubleJeopardy());
    const state = server.engine.getState(roomCode)!;
    const clueId = state.board.rounds[0].clues[0].id;

    await resolveClue(host, boardClient, alice, bob, clueId);

    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
    host.emit('adjust_score', { playerId: aliceId, score: 0 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 0);

    host.emit('advance_round');
    await Promise.all([
      waitForState(host, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(boardClient, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(alice, (s) => s.phase === 'ROUND_TRANSITION'),
      waitForState(bob, (s) => s.phase === 'ROUND_TRANSITION'),
    ]);

    const hostIntro = waitForState(host, (s) => s.phase === 'FINAL_INTRO');
    const boardIntro = waitForState(boardClient, (s) => s.phase === 'FINAL_INTRO');
    const aliceIntro = waitForState(alice, (s) => s.phase === 'FINAL_INTRO');
    const bobIntro = waitForState(bob, (s) => s.phase === 'FINAL_INTRO');
    host.emit('advance_round');
    await Promise.all([hostIntro, boardIntro, aliceIntro, bobIntro]);

    const hostComplete = waitForState(host, (s) => s.phase === 'COMPLETE' && s.finalNoEligiblePlayers === true);
    const boardComplete = waitForState(boardClient, (s) => s.phase === 'COMPLETE' && s.finalNoEligiblePlayers === true);
    const aliceComplete = waitForState(alice, (s) => s.phase === 'COMPLETE' && s.finalNoEligiblePlayers === true);
    const bobComplete = waitForState(bob, (s) => s.phase === 'COMPLETE' && s.finalNoEligiblePlayers === true);
    host.emit('open_final_wagers');
    await Promise.all([hostComplete, boardComplete, aliceComplete, bobComplete]);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });
});
