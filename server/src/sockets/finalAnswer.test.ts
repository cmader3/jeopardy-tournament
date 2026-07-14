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
    name: 'Final Answer Socket Board',
    includeDoubleJeopardy: false,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 2,
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

async function advanceToFinalClue(
  server: TestServer,
  roomCode: string,
  host: ClientSocket,
  boardClient: ClientSocket,
  alice: ClientSocket,
  bob: ClientSocket,
) {
  const state = server.engine.getState(roomCode)!;
  const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
  const bobId = state.players.find((p) => p.name === 'Bob')!.id;

  host.emit('adjust_score', { playerId: aliceId, score: 100 });
  await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 100, 5000, 'adj-alice');
  host.emit('adjust_score', { playerId: bobId, score: 100 });
  await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === bobId)?.score === 100, 5000, 'adj-bob');

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

  const fcHost = waitForState(host, (s) => s.phase === 'FINAL_CLUE', 5000, 'host-fc');
  const fcBoard = waitForState(boardClient, (s) => s.phase === 'FINAL_CLUE', 5000, 'board-fc');
  const fcAlice = waitForState(alice, (s) => s.phase === 'FINAL_CLUE', 5000, 'alice-fc');
  const fcBob = waitForState(bob, (s) => s.phase === 'FINAL_CLUE', 5000, 'bob-fc');
  alice.emit('submit_final_wager', { amount: 0 });
  bob.emit('submit_final_wager', { amount: 0 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  host.emit('force_final_wagers');
  await Promise.all([fcHost, fcBoard, fcAlice, fcBob]);
}

describe('Final Jeopardy answer sockets', { timeout: 15000 }, () => {
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

  it('eligible contestants submit written answers and see them locked', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);
    await advanceToFinalClue(server, roomCode, host, boardClient, alice, bob);

    alice.emit('submit_final_answer', { answer: 'Tolkien' });
    const aliceState = await waitForState(
      alice,
      (s) => (s as { finalAnswerSubmitted: boolean }).finalAnswerSubmitted === true,
      5000,
      'alice-answer-locked',
    );

    expect((aliceState as { myFinalAnswer: string }).myFinalAnswer).toBe('Tolkien');
    expect((aliceState as { canAnswer: boolean }).canAnswer).toBe(false);

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.finalAnswers[engineState.players.find((p) => p.name === 'Alice')!.id]).toBe('Tolkien');

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('host and board only see submission status, never answer text', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);
    await advanceToFinalClue(server, roomCode, host, boardClient, alice, bob);

    const aliceId = server.engine.getState(roomCode)?.players.find((p) => p.name === 'Alice')?.id;
    alice.emit('submit_final_answer', { answer: 'Tolkien' });

    const hostState = await waitForState(
      host,
      (s) => {
        const status = (s as { finalAnswerSubmissionStatus: Record<string, boolean> }).finalAnswerSubmissionStatus;
        return status[aliceId!] === true;
      },
      5000,
      'host-answer-status',
    );
    const boardState = await waitForState(
      boardClient,
      (s) => {
        const status = (s as { finalAnswerSubmissionStatus: Record<string, boolean> }).finalAnswerSubmissionStatus;
        return status[aliceId!] === true;
      },
      5000,
      'board-answer-status',
    );

    expect((hostState as { finalAnswerSubmissionStatus: Record<string, boolean> }).finalAnswerSubmissionStatus[aliceId!]).toBe(true);
    expect((hostState as { answer: string | null }).answer).toBeNull();
    expect(hostState).not.toHaveProperty('finalAnswers');

    expect((boardState as { finalAnswerSubmissionStatus: Record<string, boolean> }).finalAnswerSubmissionStatus[aliceId!]).toBe(true);
    expect((boardState as { answer: string | null }).answer).toBeNull();
    expect(boardState).not.toHaveProperty('finalAnswers');

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('rejects an answer from an ineligible contestant', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);
    await advanceToFinalClue(server, roomCode, host, boardClient, alice, bob);

    const state = server.engine.getState(roomCode)!;
    const bobId = state.players.find((p) => p.name === 'Bob')!.id;

    host.emit('adjust_score', { playerId: bobId, score: 0 });
    await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === bobId)?.score === 0, 5000, 'adj-bob-zero');

    const errorPromise = waitForError(bob);
    bob.emit('submit_final_answer', { answer: 'Tolkien' });
    const error = await errorPromise;

    expect(error.message).toMatch(/eligible/i);

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.finalAnswers[bobId]).toBeUndefined();

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('records a blank answer for eligible contestants at timer expiry', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);
    await advanceToFinalClue(server, roomCode, host, boardClient, alice, bob);

    const state = server.engine.getState(roomCode)!;
    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
    const bobId = state.players.find((p) => p.name === 'Bob')!.id;

    alice.emit('submit_final_answer', { answer: 'Tolkien' });
    await waitForState(alice, (s) => (s as { finalAnswerSubmitted: boolean }).finalAnswerSubmitted === true, 5000, 'alice-submitted');

    const revealHost = waitForState(host, (s) => s.phase === 'FINAL_REVEAL', 5000, 'host-reveal');
    const revealBoard = waitForState(boardClient, (s) => s.phase === 'FINAL_REVEAL', 5000, 'board-reveal');
    const revealAlice = waitForState(alice, (s) => s.phase === 'FINAL_REVEAL', 5000, 'alice-reveal');
    const revealBob = waitForState(bob, (s) => s.phase === 'FINAL_REVEAL', 5000, 'bob-reveal');

    await new Promise((resolve) => setTimeout(resolve, 2100));

    const [hostState] = await Promise.all([revealHost, revealBoard, revealAlice, revealBob]);

    expect((hostState as { phase: string }).phase).toBe('FINAL_REVEAL');

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.finalAnswers[aliceId]).toBe('Tolkien');
    expect(engineState.finalAnswers[bobId]).toBe('');

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('preserves a submitted answer across a disconnect and reconnect', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);
    await advanceToFinalClue(server, roomCode, host, boardClient, alice, bob);

    const state = server.engine.getState(roomCode)!;
    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;

    alice.emit('submit_final_answer', { answer: 'Tolkien' });
    await waitForState(alice, (s) => (s as { finalAnswerSubmitted: boolean }).finalAnswerSubmitted === true, 5000, 'alice-submitted');

    alice.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const alice2 = connectClient(server.url);
    await waitForConnect(alice2);
    const reconnectState = waitForState(
      alice2,
      (s) => (s as { finalAnswerSubmitted: boolean }).finalAnswerSubmitted === true,
      5000,
      'alice-reconnect',
    );
    alice2.emit('join', { role: 'contestant', roomCode, reconnectToken: tokenA.reconnectToken });
    const reconnected = await reconnectState;

    expect((reconnected as { myFinalAnswer: string }).myFinalAnswer).toBe('Tolkien');
    expect((reconnected as { finalAnswerSubmitted: boolean }).finalAnswerSubmitted).toBe(true);
    expect((reconnected as { canAnswer: boolean }).canAnswer).toBe(false);

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.finalAnswers[aliceId]).toBe('Tolkien');

    host.disconnect();
    boardClient.disconnect();
    alice2.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('syncs a draft answer server-side and retains it at timer expiry', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);
    await advanceToFinalClue(server, roomCode, host, boardClient, alice, bob);

    const state = server.engine.getState(roomCode)!;
    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
    const bobId = state.players.find((p) => p.name === 'Bob')!.id;

    alice.emit('submit_final_answer_draft', { answer: 'Tolkien' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const engineStateAfterDraft = server.engine.getState(roomCode)!;
    expect(engineStateAfterDraft.finalAnswerDrafts[aliceId]).toBe('Tolkien');
    expect(engineStateAfterDraft.finalAnswerDrafts[bobId]).toBeUndefined();

    const revealHost = waitForState(host, (s) => s.phase === 'FINAL_REVEAL', 5000, 'host-reveal');
    const revealBoard = waitForState(boardClient, (s) => s.phase === 'FINAL_REVEAL', 5000, 'board-reveal');
    const revealAlice = waitForState(alice, (s) => s.phase === 'FINAL_REVEAL', 5000, 'alice-reveal');
    const revealBob = waitForState(bob, (s) => s.phase === 'FINAL_REVEAL', 5000, 'bob-reveal');

    await new Promise((resolve) => setTimeout(resolve, 2100));

    await Promise.all([revealHost, revealBoard, revealAlice, revealBob]);

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.finalAnswers[aliceId]).toBe('Tolkien');
    expect(engineState.finalAnswers[bobId]).toBe('');

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('retains a draft typed within the last 300ms before the deadline', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);
    await advanceToFinalClue(server, roomCode, host, boardClient, alice, bob);

    const state = server.engine.getState(roomCode)!;
    const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
    const bobId = state.players.find((p) => p.name === 'Bob')!.id;

    const revealHost = waitForState(host, (s) => s.phase === 'FINAL_REVEAL', 5000, 'host-reveal');
    const revealBoard = waitForState(boardClient, (s) => s.phase === 'FINAL_REVEAL', 5000, 'board-reveal');
    const revealAlice = waitForState(alice, (s) => s.phase === 'FINAL_REVEAL', 5000, 'alice-reveal');
    const revealBob = waitForState(bob, (s) => s.phase === 'FINAL_REVEAL', 5000, 'bob-reveal');

    await new Promise((resolve) => setTimeout(resolve, 1_900));
    alice.emit('submit_final_answer_draft', { answer: 'Tolkien' });

    await Promise.all([revealHost, revealBoard, revealAlice, revealBob]);

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.finalAnswers[aliceId]).toBe('Tolkien');
    expect(engineState.finalAnswers[bobId]).toBe('');

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('draft text is never visible on host or board projections', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob);
    await advanceToFinalClue(server, roomCode, host, boardClient, alice, bob);

    const aliceId = server.engine.getState(roomCode)?.players.find((p) => p.name === 'Alice')?.id;

    alice.emit('submit_final_answer_draft', { answer: 'Tolkien' });

    const hostState = await waitForState(
      host,
      (s) => (s as { finalAnswerSubmissionStatus: Record<string, boolean> }).finalAnswerSubmissionStatus[aliceId!] === false,
      5000,
      'host-draft-broadcast',
    );
    const boardState = await waitForState(
      boardClient,
      (s) => (s as { finalAnswerSubmissionStatus: Record<string, boolean> }).finalAnswerSubmissionStatus[aliceId!] === false,
      5000,
      'board-draft-broadcast',
    );

    expect(hostState).not.toHaveProperty('finalAnswerDrafts');
    expect(boardState).not.toHaveProperty('finalAnswerDrafts');
    expect((hostState as { answer: string | null }).answer).toBeNull();
    expect((boardState as { answer: string | null }).answer).toBeNull();
    expect((hostState as { finalAnswerSubmissionStatus: Record<string, boolean> }).finalAnswerSubmissionStatus[aliceId!]).toBe(false);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });
});
