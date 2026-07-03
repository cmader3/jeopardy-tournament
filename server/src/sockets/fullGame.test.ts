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
    name: 'Full Game Socket Board',
    includeDoubleJeopardy: true,
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
              { value: 100, row: 0, clueText: 'This element has the symbol O', answer: 'Oxygen', isDailyDouble: true },
            ],
          },
          {
            title: 'History',
            order: 1,
            clues: [
              { value: 100, row: 0, clueText: 'This planet is closest to the Sun', answer: 'Mercury', isDailyDouble: false },
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
              { value: 200, row: 0, clueText: 'This painter cut off his own ear', answer: 'Van Gogh', isDailyDouble: false },
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
              { value: null, row: 0, clueText: 'He wrote The Hobbit', answer: 'J.R.R. Tolkien', isDailyDouble: false },
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

  const hostJoinState = waitForState(host, undefined, 5000, 'join-host');
  const boardJoinState = waitForState(boardClient, undefined, 5000, 'join-board');
  const aliceTokenPromise = waitForToken(alice);
  const bobTokenPromise = waitForToken(bob);
  const carolTokenPromise = waitForToken(carol);
  const aliceJoinState = waitForState(alice, undefined, 5000, 'join-alice');
  const bobJoinState = waitForState(bob, undefined, 5000, 'join-bob');
  const carolJoinState = waitForState(carol, undefined, 5000, 'join-carol');

  host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
  boardClient.emit('join', { role: 'board', roomCode });
  alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
  bob.emit('join', { role: 'contestant', roomCode, name: 'Bob' });
  carol.emit('join', { role: 'contestant', roomCode, name: 'Carol' });

  await Promise.all([hostJoinState, boardJoinState, aliceJoinState, bobJoinState, carolJoinState]);
  await Promise.all([aliceTokenPromise, bobTokenPromise, carolTokenPromise]);

  const startPredicates = [host, boardClient, alice, bob, carol].map((c) =>
    waitForState(c, (s) => s.phase === 'BOARD_SELECT', 5000, 'start'),
  );
  host.emit('start_game');
  await Promise.all(startPredicates);

  return { roomCode, host, boardClient, alice, bob, carol };
}

function getPlayerId(engineState: ReturnType<GameEngine['getState']>, name: string) {
  return engineState!.players.find((p) => p.name === name)!.id;
}

type RoleClients = { host: ClientSocket; boardClient: ClientSocket; alice: ClientSocket; bob: ClientSocket; carol: ClientSocket };

function collectStates(
  clients: RoleClients,
  predicate: (state: Record<string, unknown>) => boolean,
  label: string,
) {
  return Promise.all(
    Object.entries(clients).map(([role, client]) =>
      waitForState(client, predicate, 5000, `${label}-${role}`),
    ),
  ) as Promise<[Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>]>;
}

describe('full game sockets', { timeout: 45000 }, () => {
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

  it('plays a full game across Jeopardy, Daily Double, Double Jeopardy, and Final with cross-role consistency and secrecy', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, carol } = await setupGame(server);
    const clients: RoleClients = { host, boardClient, alice, bob, carol };
    const engineState = () => server.engine.getState(roomCode)!;

    const historyClue = engineState().board.rounds[0].clues.find((c) => c.answer === 'Mercury')!;
    const scienceClue = engineState().board.rounds[0].clues.find((c) => c.answer === 'Oxygen')!;
    const aliceId = getPlayerId(engineState(), 'Alice');
    const bobId = getPlayerId(engineState(), 'Bob');
    const carolId = getPlayerId(engineState(), 'Carol');

    // Jeopardy normal clue: host selects, Alice buzzes and is ruled correct.
    let awaitStates = collectStates(clients, (s) => s.phase === 'CLUE_REVEALED' && s.currentClueId === historyClue.id, 'history-clue');
    host.emit('select_clue', { clueId: historyClue.id });
    const [hostClueState, boardClueState, , bobClueState] = await awaitStates;
    expect(hostClueState.answer).toBe('Mercury');
    expect(boardClueState.answer).toBeNull();
    expect(bobClueState.answer).toBeNull();
    expect(boardClueState.currentClueText).toBe('This planet is closest to the Sun');

    awaitStates = collectStates(clients, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(historyClue.id), 'history-resolved');
    host.emit('arm_buzzers');
    await new Promise((r) => setTimeout(r, 50));
    alice.emit('buzz', { playerId: aliceId });
    await waitForState(host, (s) => s.phase === 'BUZZED', 5000, 'history-buzzed');
    host.emit('rule_correct');
    await awaitStates;
    expect(engineState().players.find((p) => p.name === 'Alice')!.score).toBe(100);
    expect(engineState().controllingPlayerId).toBe(aliceId);

    // Daily Double selected by Alice (controller).
    awaitStates = collectStates(clients, (s) => s.phase === 'DAILY_DOUBLE_WAGER', 'daily-double-wager');
    host.emit('select_clue', { clueId: scienceClue.id });
    const [, boardWagerState, , bobWagerState] = await awaitStates;
    expect(boardWagerState.currentClueText).toBeNull();
    expect(boardWagerState.answer).toBeNull();
    expect(boardWagerState.dailyDoubleWager).toBeNull();
    expect(bobWagerState.dailyDoubleWager).toBeNull();
    expect(bobWagerState.canWager).toBe(false);

    awaitStates = collectStates(clients, (s) => s.phase === 'DAILY_DOUBLE_WAGER' && (s.playerId !== aliceId || s.dailyDoubleWager === 100), 'daily-double-wager-locked');
    alice.emit('submit_dd_wager', { amount: 100 });
    const [, boardAfterWager, aliceAfterWager, , carolAfterWager] = await awaitStates;
    expect(aliceAfterWager.dailyDoubleWager).toBe(100);
    expect(boardAfterWager.dailyDoubleWager).toBeNull();
    expect(carolAfterWager.dailyDoubleWager).toBeNull();

    awaitStates = collectStates(clients, (s) => s.phase === 'DAILY_DOUBLE_CLUE', 'daily-double-clue');
    host.emit('reveal_clue');
    const [, boardDDClue] = await awaitStates;
    expect(boardDDClue.currentClueText).toBe('This element has the symbol O');
    expect(boardDDClue.answer).toBeNull();

    awaitStates = collectStates(clients, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(scienceClue.id), 'daily-double-resolved');
    host.emit('rule_correct');
    await awaitStates;
    expect(engineState().players.find((p) => p.name === 'Alice')!.score).toBe(200);

    // Advance to Double Jeopardy.
    awaitStates = collectStates(clients, (s) => s.phase === 'ROUND_TRANSITION', 'round-transition');
    host.emit('advance_round');
    const [, , , , carolTransition] = await awaitStates;
    expect(carolTransition.transitionTarget).toBe('DOUBLE_JEOPARDY');

    awaitStates = collectStates(clients, (s) => s.phase === 'BOARD_SELECT' && s.roundIndex === 1, 'double-jeopardy-start');
    host.emit('advance_round');
    const [, boardDJStart] = await awaitStates;
    expect(boardDJStart.round?.type).toBe('DOUBLE_JEOPARDY');
    expect(boardDJStart.round?.categories[0].clues[0].value).toBe(200);
    expect(engineState().controllingPlayerId).toBe(bobId);

    const doubleClue = engineState().board.rounds[1].clues[0];

    // Double Jeopardy clue: Bob selects, Carol buzzes and is ruled incorrect, Alice wins re-arm.
    awaitStates = collectStates(clients, (s) => s.phase === 'CLUE_REVEALED' && s.currentClueId === doubleClue.id, 'double-clue');
    host.emit('select_clue', { clueId: doubleClue.id });
    await awaitStates;

    host.emit('arm_buzzers');
    await waitForState(host, (s) => s.phase === 'BUZZERS_ARMED', 5000, 'double-armed');
    await new Promise((r) => setTimeout(r, 50));
    carol.emit('buzz', { playerId: carolId });
    await waitForState(host, (s) => s.phase === 'BUZZED', 5000, 'double-buzzed');
    host.emit('rule_incorrect', { playerId: carolId });
    const [hostRearm] = await collectStates(clients, (s) => s.phase === 'BUZZERS_ARMED', 'double-rearm');
    expect((hostRearm.lockedOutPlayerIds as string[])).toContain(carolId);
    await new Promise((r) => setTimeout(r, 50));
    bob.emit('buzz', { playerId: bobId });
    await waitForState(host, (s) => s.phase === 'BUZZED', 5000, 'double-bob-buzzed');
    awaitStates = collectStates(clients, (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(doubleClue.id), 'double-resolved');
    host.emit('rule_correct');
    await awaitStates;
    expect(engineState().players.find((p) => p.name === 'Carol')!.score).toBe(-200);
    expect(engineState().players.find((p) => p.name === 'Alice')!.score).toBe(200);
    expect(engineState().players.find((p) => p.name === 'Bob')!.score).toBe(200);

    // Advance to Final Jeopardy.
    awaitStates = collectStates(clients, (s) => s.phase === 'ROUND_TRANSITION', 'final-transition');
    host.emit('advance_round');
    await awaitStates;

    awaitStates = collectStates(clients, (s) => s.phase === 'FINAL_INTRO', 'final-intro');
    host.emit('advance_round');
    const [, boardFinalIntro] = await awaitStates;
    expect(boardFinalIntro.finalEligiblePlayerIds.sort()).toEqual([aliceId, bobId].sort());
    expect(boardFinalIntro.players.find((p: { id: string; score: number }) => p.id === carolId)!.score).toBeLessThanOrEqual(0);

    awaitStates = collectStates(clients, (s) => s.phase === 'FINAL_WAGER', 'final-wager');
    host.emit('open_final_wagers');
    const [, , , bobFinalWager, carolFinalWager] = await awaitStates;
    expect(bobFinalWager.isEligibleForFinal).toBe(true);
    expect(carolFinalWager.isEligibleForFinal).toBe(false);
    expect(carolFinalWager.canWager).toBe(false);

    // Final wagers are secret from the board and other contestants.
    awaitStates = collectStates(clients, (s) => s.phase === 'FINAL_WAGER' && (s.finalWagerSubmissionStatus as Record<string, boolean>)[aliceId] === true, 'final-wager-alice');
    alice.emit('submit_final_wager', { amount: 200 });
    const [, boardAfterAliceWager] = await awaitStates;
    expect(boardAfterAliceWager).not.toHaveProperty('finalWagers');
    expect(boardAfterAliceWager).not.toHaveProperty('finalAnswers');
    expect((boardAfterAliceWager.finalWagerSubmissionStatus as Record<string, boolean>)[aliceId]).toBe(true);
    expect((boardAfterAliceWager.finalWagerSubmissionStatus as Record<string, boolean>)[bobId]).toBe(false);

    awaitStates = collectStates(clients, (s) => s.phase === 'FINAL_CLUE', 'final-clue');
    bob.emit('submit_final_wager', { amount: 200 });
    const [, boardFinalClue, , aliceFinalClue] = await awaitStates;
    expect(boardFinalClue).not.toHaveProperty('finalWagers');
    expect(boardFinalClue).not.toHaveProperty('finalAnswers');
    expect((boardFinalClue.finalWagerSubmissionStatus as Record<string, boolean>)[aliceId]).toBe(true);
    expect((boardFinalClue.finalWagerSubmissionStatus as Record<string, boolean>)[bobId]).toBe(true);
    expect(aliceFinalClue.myFinalWager).toBe(200);

    // Final answers are secret during the answer phase.
    awaitStates = collectStates(clients, (s) => s.phase === 'FINAL_CLUE' && (s.finalAnswerSubmissionStatus as Record<string, boolean>)[aliceId] === true, 'final-answer-alice');
    alice.emit('submit_final_answer', { answer: 'Tolkien' });
    const [, boardAfterAliceAnswer] = await awaitStates;
    expect(boardAfterAliceAnswer).not.toHaveProperty('finalAnswers');
    expect((boardAfterAliceAnswer.finalAnswerSubmissionStatus as Record<string, boolean>)[aliceId]).toBe(true);

    awaitStates = collectStates(clients, (s) => s.phase === 'FINAL_CLUE' && (s.finalAnswerSubmissionStatus as Record<string, boolean>)[bobId] === true, 'final-answer-bob');
    bob.emit('submit_final_answer', { answer: 'Tolkien' });
    const [, boardAfterBobAnswer, , aliceAnswerLocked] = await awaitStates;
    expect(boardAfterBobAnswer).not.toHaveProperty('finalAnswers');
    expect(aliceAnswerLocked.myFinalAnswer).toBe('Tolkien');

    // Let the Final timer expire to enter the reveal.
    awaitStates = collectStates(clients, (s) => s.phase === 'FINAL_REVEAL', 'final-reveal');
    await new Promise((r) => setTimeout(r, 2500));
    await awaitStates;
    expect(engineState().finalRevealOrder).toEqual([aliceId, bobId]);

    // Reveal Alice's answer and wager (lowest score first, tie broken by seat order).
    awaitStates = collectStates(clients, (s) => s.finalRevealStep === 'RULE', 'reveal-answer-alice');
    host.emit('reveal_final_answer');
    const [, boardRevealAlice] = await awaitStates;
    expect(Object.keys(boardRevealAlice.finalRevealedAnswers as Record<string, string>)).toEqual([aliceId]);
    expect(boardRevealAlice.finalRevealedWagers).toEqual({});

    awaitStates = collectStates(clients, (s) => s.finalRevealStep === 'WAGER', 'reveal-wager-alice');
    host.emit('rule_final_correct');
    await awaitStates;
    expect(engineState().players.find((p) => p.name === 'Alice')!.score).toBe(400);

    awaitStates = collectStates(clients, (s) => s.finalRevealIndex === 1 && s.finalRevealStep === 'ANSWER', 'reveal-next-alice');
    host.emit('reveal_final_wager');
    await awaitStates;

    // Reveal Bob's answer and wager.
    awaitStates = collectStates(clients, (s) => s.finalRevealStep === 'RULE', 'reveal-answer-bob');
    host.emit('reveal_final_answer');
    const [, boardRevealBob] = await awaitStates;
    expect(Object.keys(boardRevealBob.finalRevealedAnswers as Record<string, string>)).toEqual([aliceId, bobId]);

    awaitStates = collectStates(clients, (s) => s.finalRevealStep === 'WAGER', 'reveal-wager-bob');
    host.emit('rule_final_correct');
    await awaitStates;
    expect(engineState().players.find((p) => p.name === 'Bob')!.score).toBe(400);

    awaitStates = collectStates(clients, (s) => s.phase === 'COMPLETE', 'game-complete');
    host.emit('reveal_final_wager');
    const [hostComplete, boardComplete, aliceComplete, bobComplete, carolComplete] = await awaitStates;

    const scoreMap = (state: Record<string, unknown>) =>
      (state.players as { id: string; score: number }[]).map((p) => ({ id: p.id, score: p.score }));
    const expectedScores = [
      { id: aliceId, score: 400 },
      { id: bobId, score: 400 },
      { id: carolId, score: -200 },
    ];
    expect(scoreMap(hostComplete)).toEqual(expectedScores);
    expect(scoreMap(boardComplete)).toEqual(expectedScores);
    expect(scoreMap(aliceComplete)).toEqual(expectedScores);
    expect(scoreMap(bobComplete)).toEqual(expectedScores);
    expect(scoreMap(carolComplete)).toEqual(expectedScores);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    await server.close();
  });
});
