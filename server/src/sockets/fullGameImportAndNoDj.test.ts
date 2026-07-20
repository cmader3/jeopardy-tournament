import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ClientIo, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../http/app.js';
import { GameEngine } from '../engine/game.js';
import { prisma } from '../repo/prisma.js';
import { boardRepository } from '../repo/board.js';
import { mintHostToken } from '../auth/token.js';
import { registerGameSockets } from './game.js';

function makeImportedCsv(): string {
  return (
    'Category,Value,Clue,Answer,Round\n' +
    'World Capitals,300,This city is the capital of France,Paris,Jeopardy\n' +
    'Literature,,The author of The Hobbit,Tolkien,Final\n'
  );
}

function makeNoDoubleJeopardyBoardPayload() {
  return {
    name: 'No Double Jeopardy Full Game Board',
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
              { value: 200, row: 1, clueText: 'This planet is the Red Planet', answer: 'Mars', isDailyDouble: false },
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
            clues: [{ value: null, row: 0, clueText: 'Hobbit author', answer: 'Tolkien', isDailyDouble: false }],
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

async function setupGameFromImport(server: TestServer) {
  const hostToken = mintHostToken();

  const importResponse = await request(server.http)
    .post('/api/boards/import')
    .set('Authorization', `Bearer ${hostToken}`)
    .attach('file', Buffer.from(makeImportedCsv(), 'utf8'), {
      filename: 'imported-board.csv',
      contentType: 'text/csv',
    })
    .expect(200);

  const preview = importResponse.body.board;
  const savedResponse = await request(server.http)
    .post('/api/boards')
    .set('Authorization', `Bearer ${hostToken}`)
    .send(preview)
    .expect(201);

  const boardId = savedResponse.body.id;
  const gameResponse = await request(server.http)
    .post('/api/games')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ boardId })
    .expect(201);

  const roomCode = gameResponse.body.roomCode;

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

  host.emit('join', { role: 'host', roomCode, hostToken });
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

async function setupGameNoDoubleJeopardy(server: TestServer) {
  const board = await boardRepository.create(makeNoDoubleJeopardyBoardPayload());
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
    Object.entries(clients).map(([role, client]) => waitForState(client, predicate, 5000, `${label}-${role}`)),
  ) as Promise<[Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>]>;
}

function scoreMap(state: Record<string, unknown>) {
  return (state.players as { id: string; score: number }[]).map((p) => ({ id: p.id, score: p.score }));
}

describe('full game sockets - import and no-DJ coverage', { timeout: 45000 }, () => {
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

  it('imports, saves, and creates a game from a CSV board, then plays a full clue across roles', async () => {
    const server = await createTestServer();
    let roomCode: string;
    let host: ClientSocket;
    let boardClient: ClientSocket;
    let alice: ClientSocket;
    let bob: ClientSocket;
    let carol: ClientSocket;
    try {
      const setup = await setupGameFromImport(server);
      roomCode = setup.roomCode;
      host = setup.host;
      boardClient = setup.boardClient;
      alice = setup.alice;
      bob = setup.bob;
      carol = setup.carol;
      const clients: RoleClients = { host, boardClient, alice, bob, carol };
      const engineState = () => server.engine.getState(roomCode)!;

      const importedClue = engineState().board.rounds[0].clues.find((c) => c.answer === 'Paris')!;
      const aliceId = getPlayerId(engineState(), 'Alice');
      const bobId = getPlayerId(engineState(), 'Bob');
      const carolId = getPlayerId(engineState(), 'Carol');

      expect(importedClue.value).toBe(300);
      expect(importedClue.clueText).toBe('This city is the capital of France');
      expect(engineState().board.includeDoubleJeopardy).toBe(false);

      let awaitStates = collectStates(
        clients,
        (s) => s.phase === 'CLUE_REVEALED' && s.currentClueId === importedClue.id,
        'import-clue-revealed',
      );
      host.emit('select_clue', { clueId: importedClue.id });
      const [hostClueState, boardClueState, aliceClueState, bobClueState, carolClueState] = await awaitStates;

      expect(hostClueState.answer).toBe('Paris');
      expect(boardClueState.answer).toBeNull();
      expect(aliceClueState.answer).toBeNull();
      expect(bobClueState.answer).toBeNull();
      expect(carolClueState.answer).toBeNull();
      expect(boardClueState.currentClueText).toBe('This city is the capital of France');
      expect(aliceClueState.currentClueText).toBe('This city is the capital of France');

      awaitStates = collectStates(
        clients,
        (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(importedClue.id),
        'import-clue-resolved',
      );
      host.emit('arm_buzzers');
      await new Promise((r) => setTimeout(r, 50));
      alice.emit('buzz', { playerId: aliceId });
      await waitForState(host, (s) => s.phase === 'BUZZED', 5000, 'import-buzzed');
      host.emit('rule_correct');
      await awaitStates;

      expect(engineState().players.find((p) => p.name === 'Alice')!.score).toBe(300);
      expect(engineState().controllingPlayerId).toBe(aliceId);

      const [hostResolved, boardResolved, aliceResolved, bobResolved, carolResolved] = await awaitStates;
      expect(scoreMap(hostResolved)).toEqual([
        { id: aliceId, score: 300 },
        { id: bobId, score: 0 },
        { id: carolId, score: 0 },
      ]);
      expect(scoreMap(boardResolved)).toEqual(scoreMap(hostResolved));
      expect(scoreMap(aliceResolved)).toEqual(scoreMap(hostResolved));
      expect(scoreMap(bobResolved)).toEqual(scoreMap(hostResolved));
      expect(scoreMap(carolResolved)).toEqual(scoreMap(hostResolved));
    } finally {
      host?.disconnect();
      boardClient?.disconnect();
      alice?.disconnect();
      bob?.disconnect();
      carol?.disconnect();
      await server.close();
    }
  });

  it('plays a full no-Double-Jeopardy game from single round through Final to standings', async () => {
    const server = await createTestServer();
    let roomCode: string;
    let host: ClientSocket;
    let boardClient: ClientSocket;
    let alice: ClientSocket;
    let bob: ClientSocket;
    let carol: ClientSocket;
    try {
      const setup = await setupGameNoDoubleJeopardy(server);
      roomCode = setup.roomCode;
      host = setup.host;
      boardClient = setup.boardClient;
      alice = setup.alice;
      bob = setup.bob;
      carol = setup.carol;
      const clients: RoleClients = { host, boardClient, alice, bob, carol };
      const engineState = () => server.engine.getState(roomCode)!;

      const clue100 = engineState().board.rounds[0].clues.find((c) => c.value === 100)!;
      const clue200 = engineState().board.rounds[0].clues.find((c) => c.value === 200)!;
      const aliceId = getPlayerId(engineState(), 'Alice');
      const bobId = getPlayerId(engineState(), 'Bob');
      const carolId = getPlayerId(engineState(), 'Carol');

      let awaitStates = collectStates(
        clients,
        (s) => s.phase === 'CLUE_REVEALED' && s.currentClueId === clue100.id,
        'clue100-revealed',
      );
      host.emit('select_clue', { clueId: clue100.id });
      const [hostClue100, boardClue100, , bobClue100] = await awaitStates;
      expect(hostClue100.answer).toBe('Water');
      expect(boardClue100.answer).toBeNull();
      expect(bobClue100.answer).toBeNull();
      expect(boardClue100.currentClueText).toBe('H2O');

      awaitStates = collectStates(
        clients,
        (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(clue100.id),
        'clue100-resolved',
      );
      host.emit('arm_buzzers');
      await new Promise((r) => setTimeout(r, 50));
      alice.emit('buzz', { playerId: aliceId });
      await waitForState(host, (s) => s.phase === 'BUZZED', 5000, 'clue100-buzzed');
      host.emit('rule_correct');
      await awaitStates;
      expect(engineState().players.find((p) => p.name === 'Alice')!.score).toBe(100);
      expect(engineState().controllingPlayerId).toBe(aliceId);

      awaitStates = collectStates(
        clients,
        (s) => s.phase === 'CLUE_REVEALED' && s.currentClueId === clue200.id,
        'clue200-revealed',
      );
      host.emit('select_clue', { clueId: clue200.id });
      const [, boardClue200, , bobClue200] = await awaitStates;
      expect(boardClue200.answer).toBeNull();
      expect(bobClue200.answer).toBeNull();
      expect(boardClue200.currentClueText).toBe('This planet is the Red Planet');

      awaitStates = collectStates(
        clients,
        (s) => s.phase === 'BOARD_SELECT' && (s.usedClueIds as string[]).includes(clue200.id),
        'clue200-resolved',
      );
      host.emit('arm_buzzers');
      await new Promise((r) => setTimeout(r, 50));
      bob.emit('buzz', { playerId: bobId });
      await waitForState(host, (s) => s.phase === 'BUZZED', 5000, 'clue200-buzzed');
      host.emit('rule_correct');
      await awaitStates;
      expect(engineState().players.find((p) => p.name === 'Bob')!.score).toBe(200);
      expect(engineState().players.find((p) => p.name === 'Alice')!.score).toBe(100);

      awaitStates = collectStates(clients, (s) => s.phase === 'ROUND_TRANSITION', 'final-transition');
      host.emit('advance_round');
      const [, boardTransition, , bobTransition] = await awaitStates;
      expect(boardTransition.transitionTarget).toBe('FINAL');
      expect(bobTransition.transitionTarget).toBe('FINAL');

      awaitStates = collectStates(clients, (s) => s.phase === 'FINAL_INTRO', 'final-intro');
      host.emit('advance_round');
      const [hostFinalIntro, boardFinalIntro, aliceFinalIntro, bobFinalIntro, carolFinalIntro] = await awaitStates;
      expect(boardFinalIntro.round?.type).toBe('FINAL');
      expect(hostFinalIntro.finalEligiblePlayerIds?.sort()).toEqual([aliceId, bobId].sort());
      expect(aliceFinalIntro.isEligibleForFinal).toBe(true);
      expect(bobFinalIntro.isEligibleForFinal).toBe(true);
      expect(carolFinalIntro.isEligibleForFinal).toBe(false);

      awaitStates = collectStates(clients, (s) => s.phase === 'FINAL_WAGER', 'final-wager');
      host.emit('open_final_wagers');
      const [, boardFinalWager, aliceFinalWager, bobFinalWager, carolFinalWager] = await awaitStates;
      expect(aliceFinalWager.isEligibleForFinal).toBe(true);
      expect(bobFinalWager.isEligibleForFinal).toBe(true);
      expect(carolFinalWager.isEligibleForFinal).toBe(false);
      expect(carolFinalWager.canWager).toBe(false);
      expect(boardFinalWager).not.toHaveProperty('finalWagers');

      awaitStates = collectStates(
        clients,
        (s) => {
          const status = (s.finalWagerSubmissionStatus as Record<string, boolean>) ?? {};
          return status[aliceId] === true;
        },
        'alice-wager-submitted',
      );
      alice.emit('submit_final_wager', { amount: 100 });
      const [, boardAfterAliceWager, aliceAfterWager, bobAfterAliceWager] = await awaitStates;
      expect(boardAfterAliceWager).not.toHaveProperty('finalWagers');
      expect(bobAfterAliceWager).not.toHaveProperty('finalWagers');
      expect((aliceAfterWager as { myFinalWager: number }).myFinalWager).toBe(100);

      awaitStates = collectStates(clients, (s) => s.phase === 'FINAL_CLUE', 'final-clue');
      bob.emit('submit_final_wager', { amount: 200 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      host.emit('force_final_wagers');
      const [, boardFinalClue, aliceFinalClue, bobFinalClue] = await awaitStates;
      expect(boardFinalClue).not.toHaveProperty('finalWagers');
      expect((aliceFinalClue as { myFinalWager: number }).myFinalWager).toBe(100);
      expect((bobFinalClue as { myFinalWager: number }).myFinalWager).toBe(200);
      expect(boardFinalClue).not.toHaveProperty('finalAnswers');

      // The host reads the clue, then starts the answer timer.
      awaitStates = collectStates(clients, (s) => (s.deadline as number | null) != null, 'final-timer-started');
      host.emit('start_final_timer');
      await awaitStates;

      awaitStates = collectStates(
        clients,
        (s) => {
          const status = (s.finalAnswerSubmissionStatus as Record<string, boolean>) ?? {};
          return status[aliceId] === true;
        },
        'alice-answer-submitted',
      );
      alice.emit('submit_final_answer', { answer: 'Tolkien' });
      const [, boardAfterAliceAnswer, , bobAfterAliceAnswer] = await awaitStates;
      expect(boardAfterAliceAnswer).not.toHaveProperty('finalAnswers');
      expect(bobAfterAliceAnswer).not.toHaveProperty('finalAnswers');

      bob.emit('submit_final_answer', { answer: 'Tolkien' });

      awaitStates = collectStates(clients, (s) => s.phase === 'FINAL_REVEAL', 'final-reveal');
      await new Promise((r) => setTimeout(r, 2500));
      const [hostFinalReveal] = await awaitStates;
      expect(engineState().finalRevealOrder).toEqual([aliceId, bobId]);
      expect(hostFinalReveal).not.toHaveProperty('finalAnswers');
      expect(hostFinalReveal).not.toHaveProperty('finalWagers');

      awaitStates = collectStates(clients, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'RULE', 'reveal-answer-alice');
      host.emit('reveal_final_answer');
      const [, boardRevealAlice] = await awaitStates;
      expect(Object.keys(boardRevealAlice.finalRevealedAnswers as Record<string, string>)).toEqual([aliceId]);
      expect(boardRevealAlice.finalRevealedWagers).toEqual({});

      awaitStates = collectStates(clients, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'WAGER', 'reveal-wager-alice');
      host.emit('rule_final_correct');
      await awaitStates;
      expect(engineState().players.find((p) => p.name === 'Alice')!.score).toBe(200);

      awaitStates = collectStates(
        clients,
        (s) => (s as { finalRevealIndex: number }).finalRevealIndex === 1 && (s as { finalRevealStep: string }).finalRevealStep === 'ANSWER',
        'reveal-next-bob',
      );
      host.emit('reveal_final_wager');
      await awaitStates;

      awaitStates = collectStates(clients, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'RULE', 'reveal-answer-bob');
      host.emit('reveal_final_answer');
      const [, boardRevealBob] = await awaitStates;
      expect(Object.keys(boardRevealBob.finalRevealedAnswers as Record<string, string>)).toEqual([aliceId, bobId]);

      awaitStates = collectStates(clients, (s) => (s as { finalRevealStep: string }).finalRevealStep === 'WAGER', 'reveal-wager-bob');
      host.emit('rule_final_correct');
      await awaitStates;
      expect(engineState().players.find((p) => p.name === 'Bob')!.score).toBe(400);

      awaitStates = collectStates(clients, (s) => s.phase === 'COMPLETE', 'game-complete');
      host.emit('reveal_final_wager');
      const [hostComplete, boardComplete, aliceComplete, bobComplete, carolComplete] = await awaitStates;

      const expectedScores = [
        { id: aliceId, score: 200 },
        { id: bobId, score: 400 },
        { id: carolId, score: 0 },
      ];
      expect(scoreMap(hostComplete)).toEqual(expectedScores);
      expect(scoreMap(boardComplete)).toEqual(expectedScores);
      expect(scoreMap(aliceComplete)).toEqual(expectedScores);
      expect(scoreMap(bobComplete)).toEqual(expectedScores);
      expect(scoreMap(carolComplete)).toEqual(expectedScores);
    } finally {
      host?.disconnect();
      boardClient?.disconnect();
      alice?.disconnect();
      bob?.disconnect();
      carol?.disconnect();
      await server.close();
    }
  });
});
