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

function makeBoardPayload() {
  return {
    name: 'Final Wager Socket Board',
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
        type: 'FINAL',
        order: 1,
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
  label = 'state',
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('state', handler);
      reject(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`));
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

function waitForToken(client: ClientSocket): Promise<{ reconnectToken: string; playerId: string }> {
  return new Promise((resolve) => {
    client.once('token', (data) => resolve(data as { reconnectToken: string; playerId: string }));
  });
}

async function setupGame(server: TestServer) {
  const board = await boardRepository.create(makeBoardPayload());
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

  const hostJoinState = waitForState(host, undefined, 5000, 'sg-join-host');
  const boardJoinState = waitForState(boardClient, undefined, 5000, 'sg-join-board');
  const aliceTokenPromise = waitForToken(alice);
  const bobTokenPromise = waitForToken(bob);
  const aliceJoinState = waitForState(alice, undefined, 5000, 'sg-join-alice');
  const bobJoinState = waitForState(bob, undefined, 5000, 'sg-join-bob');

  host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
  boardClient.emit('join', { role: 'board', roomCode });
  alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
  bob.emit('join', { role: 'contestant', roomCode, name: 'Bob' });

  await Promise.all([hostJoinState, boardJoinState, aliceJoinState, bobJoinState]);
  const [tokenA, tokenB] = await Promise.all([aliceTokenPromise, bobTokenPromise]);

  const hostStartState = waitForState(host, undefined, 5000, 'sg-start-host');
  const boardStartState = waitForState(boardClient, undefined, 5000, 'sg-start-board');
  const aliceStartState = waitForState(alice, undefined, 5000, 'sg-start-alice');
  const bobStartState = waitForState(bob, undefined, 5000, 'sg-start-bob');

  host.emit('start_game');
  await Promise.all([hostStartState, boardStartState, aliceStartState, bobStartState]);

  return { roomCode, host, boardClient, alice, bob, tokenA, tokenB };
}

async function advanceToFinalWager(
  server: TestServer,
  roomCode: string,
  host: ClientSocket,
  boardClient: ClientSocket,
  alice: ClientSocket,
  bob: ClientSocket,
) {
  const state = server.engine.getState(roomCode)!;
  const firstClue = state.board.rounds[0].clues[0];

  const selHost = waitForState(host, (s) => s.phase === 'CLUE_REVEALED', 5000, 'sel-host');
  const selBoard = waitForState(boardClient, (s) => s.phase === 'CLUE_REVEALED', 5000, 'sel-board');
  const selAlice = waitForState(alice, (s) => s.phase === 'CLUE_REVEALED', 5000, 'sel-alice');
  const selBob = waitForState(bob, (s) => s.phase === 'CLUE_REVEALED', 5000, 'sel-bob');
  host.emit('select_clue', { clueId: firstClue.id });
  await Promise.all([selHost, selBoard, selAlice, selBob]);

  const revHost = waitForState(host, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(firstClue.id), 5000, 'rev-host');
  const revBoard = waitForState(boardClient, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(firstClue.id), 5000, 'rev-board');
  const revAlice = waitForState(alice, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(firstClue.id), 5000, 'rev-alice');
  const revBob = waitForState(bob, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(firstClue.id), 5000, 'rev-bob');
  host.emit('reveal_answer');
  await Promise.all([revHost, revBoard, revAlice, revBob]);

  return { roomCode, firstClue };
}

async function openFinalWagers(
  host: ClientSocket,
  boardClient: ClientSocket,
  alice: ClientSocket,
  bob: ClientSocket,
) {
  const rtHost = waitForState(host, (s) => s.phase === 'ROUND_TRANSITION', 5000, 'host-rt');
  const rtBoard = waitForState(boardClient, (s) => s.phase === 'ROUND_TRANSITION', 5000, 'board-rt');
  const rtAlice = waitForState(alice, (s) => s.phase === 'ROUND_TRANSITION', 5000, 'alice-rt');
  const rtBob = waitForState(bob, (s) => s.phase === 'ROUND_TRANSITION', 5000, 'bob-rt');
  host.emit('advance_round');
  await Promise.all([rtHost, rtBoard, rtAlice, rtBob]);

  const fiHost = waitForState(host, (s) => s.phase === 'FINAL_INTRO', 5000, 'host-fi');
  const fiBoard = waitForState(boardClient, (s) => s.phase === 'FINAL_INTRO', 5000, 'board-fi');
  const fiAlice = waitForState(alice, (s) => s.phase === 'FINAL_INTRO', 5000, 'alice-fi');
  const fiBob = waitForState(bob, (s) => s.phase === 'FINAL_INTRO', 5000, 'bob-fi');
  host.emit('advance_round');
  await Promise.all([fiHost, fiBoard, fiAlice, fiBob]);

  const fwHost = waitForState(host, (s) => s.phase === 'FINAL_WAGER', 5000, 'host-fw');
  const fwBoard = waitForState(boardClient, (s) => s.phase === 'FINAL_WAGER', 5000, 'board-fw');
  const fwAlice = waitForState(alice, (s) => s.phase === 'FINAL_WAGER', 5000, 'alice-fw');
  const fwBob = waitForState(bob, (s) => s.phase === 'FINAL_WAGER', 5000, 'bob-fw');
  host.emit('open_final_wagers');
  await Promise.all([fwHost, fwBoard, fwAlice, fwBob]);
}

describe('Final Jeopardy wager sockets', { timeout: 15000 }, () => {
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

  it('contestant submits a valid Final wager of 0 and sees their own locked state', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);

    const aliceId = server.engine.getState(roomCode)?.players.find((p) => p.name === 'Alice')?.id;
    host.emit('adjust_score', { playerId: aliceId, score: 100 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 100, 5000, 'host-adj');

    await openFinalWagers(host, boardClient, alice, bob);

    alice.emit('submit_final_wager', { amount: 0 });
    const aliceState = await waitForState(alice, (s) => (s as { finalWagerSubmitted: boolean }).finalWagerSubmitted === true, 5000, 'alice-submit');

    expect((aliceState as { myFinalWager: number }).myFinalWager).toBe(0);
    expect((aliceState as { finalWagerSubmitted: boolean }).finalWagerSubmitted).toBe(true);
    expect((aliceState as { canWager: boolean }).canWager).toBe(false);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('contestant submits a valid Final wager equal to their full score', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);

    const aliceId = server.engine.getState(roomCode)?.players.find((p) => p.name === 'Alice')?.id;
    host.emit('adjust_score', { playerId: aliceId, score: 250 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 250);

    await openFinalWagers(host, boardClient, alice, bob);

    alice.emit('submit_final_wager', { amount: 250 });
    const aliceState = await waitForState(alice, (s) => (s as { finalWagerSubmitted: boolean }).finalWagerSubmitted === true);

    expect((aliceState as { myFinalWager: number }).myFinalWager).toBe(250);
    expect((aliceState as { finalWagerSubmitted: boolean }).finalWagerSubmitted).toBe(true);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('rejects a negative Final wager with an error event', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);

    const aliceId = server.engine.getState(roomCode)?.players.find((p) => p.name === 'Alice')?.id;
    host.emit('adjust_score', { playerId: aliceId, score: 100 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 100);

    await openFinalWagers(host, boardClient, alice, bob);

    const errorPromise = waitForError(alice);
    alice.emit('submit_final_wager', { amount: -1 });
    const error = await errorPromise;

    expect(error.message).toMatch(/between 0 and/i);

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.finalWagers[aliceId!]).toBeUndefined();

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('rejects a Final wager above the current score', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);

    const aliceId = server.engine.getState(roomCode)?.players.find((p) => p.name === 'Alice')?.id;
    host.emit('adjust_score', { playerId: aliceId, score: 100 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 100);

    await openFinalWagers(host, boardClient, alice, bob);

    const errorPromise = waitForError(alice);
    alice.emit('submit_final_wager', { amount: 101 });
    const error = await errorPromise;

    expect(error.message).toMatch(/between 0 and/i);

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.finalWagers[aliceId!]).toBeUndefined();

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('rejects a Final wager from an ineligible contestant', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);

    const state = server.engine.getState(roomCode)!;
    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
    const bobId = state.players.find((p) => p.name === 'Bob')!.id;

    host.emit('adjust_score', { playerId: aliceId, score: 100 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 100);
    host.emit('adjust_score', { playerId: bobId, score: 0 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === bobId)?.score === 0);

    await openFinalWagers(host, boardClient, alice, bob);

    const errorPromise = waitForError(bob);
    bob.emit('submit_final_wager', { amount: 0 });
    const error = await errorPromise;

    expect(error.message).toMatch(/eligible/i);

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.finalWagers[bobId]).toBeUndefined();

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('host forces Final wagers and all views advance to FINAL_CLUE with default 0 for missing wagers', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);

    const state = server.engine.getState(roomCode)!;
    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
    const bobId = state.players.find((p) => p.name === 'Bob')!.id;

    host.emit('adjust_score', { playerId: aliceId, score: 100 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 100);
    host.emit('adjust_score', { playerId: bobId, score: 50 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === bobId)?.score === 50);

    await openFinalWagers(host, boardClient, alice, bob);

    alice.emit('submit_final_wager', { amount: 25 });
    await waitForState(alice, (s) => (s as { finalWagerSubmitted: boolean }).finalWagerSubmitted === true);

    const hostUpdate = waitForState(host, (s) => s.phase === 'FINAL_CLUE');
    const boardUpdate = waitForState(boardClient, (s) => s.phase === 'FINAL_CLUE');
    const aliceUpdate = waitForState(alice, (s) => s.phase === 'FINAL_CLUE');
    const bobUpdate = waitForState(bob, (s) => s.phase === 'FINAL_CLUE');

    host.emit('force_final_wagers');
    const [hostState, boardState, aliceState, bobState] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    expect((hostState as { phase: string }).phase).toBe('FINAL_CLUE');
    expect((boardState as { phase: string }).phase).toBe('FINAL_CLUE');
    expect((aliceState as { phase: string }).phase).toBe('FINAL_CLUE');
    expect((bobState as { phase: string }).phase).toBe('FINAL_CLUE');

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.finalWagers[aliceId]).toBe(25);
    expect(engineState.finalWagers[bobId]).toBe(0);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('wager amounts are secret; other contestants and the board only see submission status', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);

    const state = server.engine.getState(roomCode)!;
    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
    const bobId = state.players.find((p) => p.name === 'Bob')!.id;

    host.emit('adjust_score', { playerId: aliceId, score: 100 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 100, 5000, 'sec-adj-alice');
    host.emit('adjust_score', { playerId: bobId, score: 50 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === bobId)?.score === 50, 5000, 'sec-adj-bob');

    await openFinalWagers(host, boardClient, alice, bob);

    const aliceUpdate = waitForState(alice, (s) => (s as { finalWagerSubmitted: boolean }).finalWagerSubmitted === true, 5000, 'sec-alice-update');
    const bobUpdate = waitForState(bob, (s) => {
      const status = (s as { finalWagerSubmissionStatus: Record<string, boolean> }).finalWagerSubmissionStatus;
      return status[aliceId] === true;
    }, 5000, 'sec-bob');
    const boardUpdate = waitForState(boardClient, (s) => {
      const status = (s as { finalWagerSubmissionStatus: Record<string, boolean> }).finalWagerSubmissionStatus;
      return status[aliceId] === true;
    }, 5000, 'sec-board');

    alice.emit('submit_final_wager', { amount: 75 });
    const [aliceStateAfterSubmit, bobState, boardState] = await Promise.all([aliceUpdate, bobUpdate, boardUpdate]);

    expect((bobState as { finalWagerSubmissionStatus: Record<string, boolean> }).finalWagerSubmissionStatus[aliceId]).toBe(true);
    expect((bobState as { myFinalWager: number | null }).myFinalWager).toBeNull();
    expect(bobState).not.toHaveProperty('finalWagers');

    expect((boardState as { finalWagerSubmissionStatus: Record<string, boolean> }).finalWagerSubmissionStatus[aliceId]).toBe(true);
    expect(boardState).not.toHaveProperty('finalWagers');

    expect((aliceStateAfterSubmit as { finalWagerSubmitted: boolean }).finalWagerSubmitted).toBe(true);
    expect((aliceStateAfterSubmit as { myFinalWager: number }).myFinalWager).toBe(75);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });
});
