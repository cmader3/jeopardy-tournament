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
    name: 'Final Reveal Socket Board',
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
  const carol = connectClient(server.url);

  await Promise.all([
    waitForConnect(host),
    waitForConnect(boardClient),
    waitForConnect(alice),
    waitForConnect(bob),
    waitForConnect(carol),
  ]);

  const hostJoinState = waitForState(host, undefined, 5000, 'sg-join-host');
  const boardJoinState = waitForState(boardClient, undefined, 5000, 'sg-join-board');
  const aliceTokenPromise = waitForToken(alice);
  const bobTokenPromise = waitForToken(bob);
  const carolTokenPromise = waitForToken(carol);
  const aliceJoinState = waitForState(alice, undefined, 5000, 'sg-join-alice');
  const bobJoinState = waitForState(bob, undefined, 5000, 'sg-join-bob');
  const carolJoinState = waitForState(carol, undefined, 5000, 'sg-join-carol');

  host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
  boardClient.emit('join', { role: 'board', roomCode });
  alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
  bob.emit('join', { role: 'contestant', roomCode, name: 'Bob' });
  carol.emit('join', { role: 'contestant', roomCode, name: 'Carol' });

  await Promise.all([hostJoinState, boardJoinState, aliceJoinState, bobJoinState, carolJoinState]);
  const [tokenA, tokenB, tokenC] = await Promise.all([aliceTokenPromise, bobTokenPromise, carolTokenPromise]);

  const hostStartState = waitForState(host, undefined, 5000, 'sg-start-host');
  const boardStartState = waitForState(boardClient, undefined, 5000, 'sg-start-board');
  const aliceStartState = waitForState(alice, undefined, 5000, 'sg-start-alice');
  const bobStartState = waitForState(bob, undefined, 5000, 'sg-start-bob');
  const carolStartState = waitForState(carol, undefined, 5000, 'sg-start-carol');

  host.emit('start_game');
  await Promise.all([hostStartState, boardStartState, aliceStartState, bobStartState, carolStartState]);

  return { roomCode, host, boardClient, alice, bob, carol, tokenA, tokenB, tokenC };
}

async function advanceToFinalWager(
  server: TestServer,
  roomCode: string,
  host: ClientSocket,
  boardClient: ClientSocket,
  alice: ClientSocket,
  bob: ClientSocket,
  carol: ClientSocket,
) {
  const state = server.engine.getState(roomCode)!;
  const firstClue = state.board.rounds[0].clues[0];

  const selHost = waitForState(host, (s) => s.phase === 'CLUE_REVEALED', 5000, 'sel-host');
  const selBoard = waitForState(boardClient, (s) => s.phase === 'CLUE_REVEALED', 5000, 'sel-board');
  const selAlice = waitForState(alice, (s) => s.phase === 'CLUE_REVEALED', 5000, 'sel-alice');
  const selBob = waitForState(bob, (s) => s.phase === 'CLUE_REVEALED', 5000, 'sel-bob');
  const selCarol = waitForState(carol, (s) => s.phase === 'CLUE_REVEALED', 5000, 'sel-carol');
  host.emit('select_clue', { clueId: firstClue.id });
  await Promise.all([selHost, selBoard, selAlice, selBob, selCarol]);

  const revHost = waitForState(host, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(firstClue.id), 5000, 'rev-host');
  const revBoard = waitForState(boardClient, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(firstClue.id), 5000, 'rev-board');
  const revAlice = waitForState(alice, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(firstClue.id), 5000, 'rev-alice');
  const revBob = waitForState(bob, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(firstClue.id), 5000, 'rev-bob');
  const revCarol = waitForState(carol, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(firstClue.id), 5000, 'rev-carol');
  host.emit('reveal_answer');
  await Promise.all([revHost, revBoard, revAlice, revBob, revCarol]);

  return { roomCode, firstClue };
}

async function advanceToFinalReveal(
  server: TestServer,
  roomCode: string,
  host: ClientSocket,
  boardClient: ClientSocket,
  alice: ClientSocket,
  bob: ClientSocket,
  carol: ClientSocket,
) {
  const state = server.engine.getState(roomCode)!;
  const aliceId = state.players.find((p) => p.name === 'Alice')!.id;
  const bobId = state.players.find((p) => p.name === 'Bob')!.id;
  const carolId = state.players.find((p) => p.name === 'Carol')!.id;

  host.emit('adjust_score', { playerId: aliceId, score: 300 });
  await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === aliceId)?.score === 300, 5000, 'adj-alice');
  host.emit('adjust_score', { playerId: bobId, score: 100 });
  await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === bobId)?.score === 100, 5000, 'adj-bob');
  host.emit('adjust_score', { playerId: carolId, score: 200 });
  await waitForState(host, (s) => s.players.find((p: { id: string; score: number }) => p.id === carolId)?.score === 200, 5000, 'adj-carol');

  const rtHost = waitForState(host, (s) => s.phase === 'ROUND_TRANSITION', 5000, 'host-rt');
  const rtBoard = waitForState(boardClient, (s) => s.phase === 'ROUND_TRANSITION', 5000, 'board-rt');
  const rtAlice = waitForState(alice, (s) => s.phase === 'ROUND_TRANSITION', 5000, 'alice-rt');
  const rtBob = waitForState(bob, (s) => s.phase === 'ROUND_TRANSITION', 5000, 'bob-rt');
  const rtCarol = waitForState(carol, (s) => s.phase === 'ROUND_TRANSITION', 5000, 'carol-rt');
  host.emit('advance_round');
  await Promise.all([rtHost, rtBoard, rtAlice, rtBob, rtCarol]);

  const fiHost = waitForState(host, (s) => s.phase === 'FINAL_INTRO', 5000, 'host-fi');
  const fiBoard = waitForState(boardClient, (s) => s.phase === 'FINAL_INTRO', 5000, 'board-fi');
  const fiAlice = waitForState(alice, (s) => s.phase === 'FINAL_INTRO', 5000, 'alice-fi');
  const fiBob = waitForState(bob, (s) => s.phase === 'FINAL_INTRO', 5000, 'bob-fi');
  const fiCarol = waitForState(carol, (s) => s.phase === 'FINAL_INTRO', 5000, 'carol-fi');
  host.emit('advance_round');
  await Promise.all([fiHost, fiBoard, fiAlice, fiBob, fiCarol]);

  const fwHost = waitForState(host, (s) => s.phase === 'FINAL_WAGER', 5000, 'host-fw');
  const fwBoard = waitForState(boardClient, (s) => s.phase === 'FINAL_WAGER', 5000, 'board-fw');
  const fwAlice = waitForState(alice, (s) => s.phase === 'FINAL_WAGER', 5000, 'alice-fw');
  const fwBob = waitForState(bob, (s) => s.phase === 'FINAL_WAGER', 5000, 'bob-fw');
  const fwCarol = waitForState(carol, (s) => s.phase === 'FINAL_WAGER', 5000, 'carol-fw');
  host.emit('open_final_wagers');
  await Promise.all([fwHost, fwBoard, fwAlice, fwBob, fwCarol]);

  const fcHost = waitForState(host, (s) => s.phase === 'FINAL_CLUE', 5000, 'host-fc');
  const fcBoard = waitForState(boardClient, (s) => s.phase === 'FINAL_CLUE', 5000, 'board-fc');
  const fcAlice = waitForState(alice, (s) => s.phase === 'FINAL_CLUE', 5000, 'alice-fc');
  const fcBob = waitForState(bob, (s) => s.phase === 'FINAL_CLUE', 5000, 'bob-fc');
  const fcCarol = waitForState(carol, (s) => s.phase === 'FINAL_CLUE', 5000, 'carol-fc');
  alice.emit('submit_final_wager', { amount: 300 });
  bob.emit('submit_final_wager', { amount: 100 });
  carol.emit('submit_final_wager', { amount: 200 });
  await Promise.all([fcHost, fcBoard, fcAlice, fcBob, fcCarol]);

  const revealHost = waitForState(host, (s) => s.phase === 'FINAL_REVEAL', 5000, 'host-reveal');
  const revealBoard = waitForState(boardClient, (s) => s.phase === 'FINAL_REVEAL', 5000, 'board-reveal');
  const revealAlice = waitForState(alice, (s) => s.phase === 'FINAL_REVEAL', 5000, 'alice-reveal');
  const revealBob = waitForState(bob, (s) => s.phase === 'FINAL_REVEAL', 5000, 'bob-reveal');
  const revealCarol = waitForState(carol, (s) => s.phase === 'FINAL_REVEAL', 5000, 'carol-reveal');

  alice.emit('submit_final_answer', { answer: 'Tolkien' });
  bob.emit('submit_final_answer', { answer: 'Rowling' });
  carol.emit('submit_final_answer', { answer: 'Lewis' });

  await new Promise((resolve) => setTimeout(resolve, 2100));
  await Promise.all([revealHost, revealBoard, revealAlice, revealBob, revealCarol]);
}

describe('Final Jeopardy reveal sockets', { timeout: 25000 }, () => {
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

  it('reveals answers and wagers in staged order and advances through every participant', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, carol } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob, carol);
    await advanceToFinalReveal(server, roomCode, host, boardClient, alice, bob, carol);

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.phase).toBe('FINAL_REVEAL');
    expect(engineState.finalRevealOrder).toEqual([
      engineState.players.find((p) => p.name === 'Bob')!.id,
      engineState.players.find((p) => p.name === 'Carol')!.id,
      engineState.players.find((p) => p.name === 'Alice')!.id,
    ]);

    const isLastPlayer = (i: number) => i === 2;

    for (let i = 0; i < 3; i++) {
      const ansHost = waitForState(host, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'RULE', 5000, `ans-host-${i}`);
      const ansBoard = waitForState(boardClient, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'RULE', 5000, `ans-board-${i}`);
      const ansAlice = waitForState(alice, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'RULE', 5000, `ans-alice-${i}`);
      const ansBob = waitForState(bob, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'RULE', 5000, `ans-bob-${i}`);
      const ansCarol = waitForState(carol, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'RULE', 5000, `ans-carol-${i}`);
      host.emit('reveal_final_answer');
      await Promise.all([ansHost, ansBoard, ansAlice, ansBob, ansCarol]);

      const rulHost = waitForState(host, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'WAGER', 5000, `rul-host-${i}`);
      const rulBoard = waitForState(boardClient, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'WAGER', 5000, `rul-board-${i}`);
      const rulAlice = waitForState(alice, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'WAGER', 5000, `rul-alice-${i}`);
      const rulBob = waitForState(bob, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'WAGER', 5000, `rul-bob-${i}`);
      const rulCarol = waitForState(carol, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'WAGER', 5000, `rul-carol-${i}`);
      host.emit('rule_final_correct');
      await Promise.all([rulHost, rulBoard, rulAlice, rulBob, rulCarol]);

      const nextPredicate = isLastPlayer(i)
        ? (s: Record<string, unknown>) => s.phase === 'COMPLETE'
        : (s: Record<string, unknown>) => {
            const step = (s as { finalRevealStep: string }).finalRevealStep;
            const idx = (s as { finalRevealIndex: number }).finalRevealIndex;
            return step === 'ANSWER' && idx === i + 1;
          };

      const wagHost = waitForState(host, nextPredicate, 5000, `wag-host-${i}`);
      const wagBoard = waitForState(boardClient, nextPredicate, 5000, `wag-board-${i}`);
      const wagAlice = waitForState(alice, nextPredicate, 5000, `wag-alice-${i}`);
      const wagBob = waitForState(bob, nextPredicate, 5000, `wag-bob-${i}`);
      const wagCarol = waitForState(carol, nextPredicate, 5000, `wag-carol-${i}`);
      host.emit('reveal_final_wager');
      await Promise.all([wagHost, wagBoard, wagAlice, wagBob, wagCarol]);
    }

    const finalEngineState = server.engine.getState(roomCode)!;
    expect(finalEngineState.phase).toBe('COMPLETE');
    expect(finalEngineState.players.find((p) => p.name === 'Alice')?.score).toBe(600);
    expect(finalEngineState.players.find((p) => p.name === 'Bob')?.score).toBe(200);
    expect(finalEngineState.players.find((p) => p.name === 'Carol')?.score).toBe(400);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    await server.close();
  });

  it('does not leak unrevealed Final answers or wagers to board or contestants', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, carol } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob, carol);

    const boardAnswerStep = waitForState(boardClient, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'ANSWER', 5000, 'board-answer-step');
    const aliceAnswerStep = waitForState(alice, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'ANSWER', 5000, 'alice-answer-step');
    await advanceToFinalReveal(server, roomCode, host, boardClient, alice, bob, carol);

    const boardState = await boardAnswerStep;
    expect(boardState.finalRevealedAnswers).toEqual({});
    expect(boardState.finalRevealedWagers).toEqual({});
    expect(boardState).not.toHaveProperty('finalAnswers');
    expect(boardState).not.toHaveProperty('finalWagers');

    const aliceState = await aliceAnswerStep;
    expect(aliceState.finalRevealedAnswers).toEqual({});
    expect(aliceState.finalRevealedWagers).toEqual({});
    expect(aliceState).not.toHaveProperty('finalAnswers');
    expect(aliceState).not.toHaveProperty('finalWagers');

    host.emit('reveal_final_answer');
    const boardAnswer = await waitForState(boardClient, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'RULE', 5000, 'board-rule-step');
    expect(Object.values(boardAnswer.finalRevealedAnswers as Record<string, string>)).toHaveLength(1);
    expect(boardAnswer.finalRevealedWagers).toEqual({});

    const bobAnswer = await waitForState(bob, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'RULE', 5000, 'bob-rule-step');
    expect(Object.values(bobAnswer.finalRevealedAnswers as Record<string, string>)).toHaveLength(1);
    expect(bobAnswer.finalRevealedWagers).toEqual({});

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    await server.close();
  });

  it('rejects non-host attempts to drive the reveal', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, carol } = await setupGame(server);
    await advanceToFinalWager(server, roomCode, host, boardClient, alice, bob, carol);
    await advanceToFinalReveal(server, roomCode, host, boardClient, alice, bob, carol);

    const errorPromise = waitForError(alice);
    alice.emit('reveal_final_answer');
    const error = await errorPromise;
    expect(error.message).toMatch(/host/i);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    await server.close();
  });
});
