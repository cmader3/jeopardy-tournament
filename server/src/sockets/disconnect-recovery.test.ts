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
    name: 'Disconnect Recovery Board',
    includeDoubleJeopardy: false,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    rounds: [
      {
        type: 'JEOPARDY' as const,
        order: 0,
        categories: [
          {
            title: 'Science',
            order: 0,
            clues: [
              { value: 100, row: 0, clueText: 'H2O', answer: 'Water', isDailyDouble: false },
              { value: 200, row: 1, clueText: 'Red Planet', answer: 'Mars', isDailyDouble: false },
            ],
          },
          {
            title: 'History',
            order: 1,
            clues: [{ value: 100, row: 0, clueText: 'First president', answer: 'Washington', isDailyDouble: false }],
          },
        ],
      },
      {
        type: 'FINAL' as const,
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

async function createTestServer(engine?: GameEngine): Promise<TestServer> {
  const serverEngine = engine ?? new GameEngine();
  await serverEngine.loadActiveSessions();
  const app = createApp(serverEngine);
  const http = createServer(app);
  const io = new Server(http, { cors: { origin: '*' } });
  registerGameSockets(io, serverEngine);

  await new Promise<void>((resolve) => http.listen(0, resolve));
  const port = (http.address() as { port: number }).port;

  return {
    http,
    io,
    engine: serverEngine,
    url: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        serverEngine.clearTimers();
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

function waitForToken(client: ClientSocket): Promise<{ reconnectToken: string; playerId: string }> {
  return new Promise((resolve) => {
    client.once('token', (data) => resolve(data as { reconnectToken: string; playerId: string }));
  });
}

async function setupGame(server: Awaited<ReturnType<typeof createTestServer>>) {
  const board = await boardRepository.create(makeBoardPayload());
  const { roomCode } = await server.engine.createSession(board.id);

  const host = connectClient(server.url);
  const boardClient = connectClient(server.url);
  await Promise.all([waitForConnect(host), waitForConnect(boardClient)]);
  host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
  boardClient.emit('join', { role: 'board', roomCode });
  await Promise.all([waitForState(host), waitForState(boardClient)]);

  const alice = connectClient(server.url);
  const bob = connectClient(server.url);
  await Promise.all([waitForConnect(alice), waitForConnect(bob)]);
  const aliceToken = waitForToken(alice);
  const bobToken = waitForToken(bob);
  const aliceState = waitForState(alice);
  const bobState = waitForState(bob);
  alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
  bob.emit('join', { role: 'contestant', roomCode, name: 'Bob' });
  const [tokenA, tokenB] = await Promise.all([aliceToken, bobToken]);
  await Promise.all([aliceState, bobState]);

  host.emit('start_game');
  await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

  return { roomCode, host, boardClient, alice, bob, tokenA, tokenB };
}

describe('disconnect and recovery during active play', { timeout: 15000 }, () => {
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

  it('buzzed-in contestant disconnecting before the ruling does not stall the clue; host rules correct', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);
    const gameState = server.engine.getState(roomCode)!;
    const firstClue = gameState.board.rounds[0].clues[0];

    host.emit('select_clue', { clueId: firstClue.id });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    host.emit('arm_buzzers');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    alice.emit('buzz', { playerId: tokenA.playerId });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    const hostAfterDrop = waitForState(host);
    const boardAfterDrop = waitForState(boardClient);
    const bobAfterDrop = waitForState(bob);
    alice.disconnect();
    const [hostState, boardState, bobState] = await Promise.all([hostAfterDrop, boardAfterDrop, bobAfterDrop]);
    expect((hostState as { buzzWinnerId: string | null }).buzzWinnerId).toBe(tokenA.playerId);
    expect((hostState as { players: { id: string; connected: boolean }[] }).players.find((p) => p.id === tokenA.playerId)?.connected).toBe(false);
    expect((boardState as { players: { id: string; connected: boolean }[] }).players.find((p) => p.id === tokenA.playerId)?.connected).toBe(false);
    expect((bobState as { players: { id: string; connected: boolean }[] }).players.find((p) => p.id === tokenA.playerId)?.connected).toBe(false);

    const hostAfterRule = waitForState(host);
    const boardAfterRule = waitForState(boardClient);
    const bobAfterRule = waitForState(bob);
    host.emit('rule_correct');
    const [hostFinal, boardFinal, bobFinal] = await Promise.all([hostAfterRule, boardAfterRule, bobAfterRule]);

    expect((hostFinal as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((boardFinal as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((bobFinal as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((hostFinal as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(100);
    expect((boardFinal as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(100);
    expect((bobFinal as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(100);
    expect((hostFinal as { controllingPlayerId: string | null }).controllingPlayerId).toBe(tokenA.playerId);

    host.disconnect();
    boardClient.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('buzzed-in contestant disconnecting before the ruling does not stall the clue; host rules incorrect and re-arms', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);
    const gameState = server.engine.getState(roomCode)!;
    const firstClue = gameState.board.rounds[0].clues[0];

    host.emit('select_clue', { clueId: firstClue.id });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    host.emit('arm_buzzers');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    alice.emit('buzz', { playerId: tokenA.playerId });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    alice.disconnect();
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(bob)]);

    const hostAfterRule = waitForState(host, (s) => s.phase === 'BUZZERS_ARMED');
    const boardAfterRule = waitForState(boardClient, (s) => s.phase === 'BUZZERS_ARMED');
    const bobAfterRule = waitForState(bob, (s) => s.phase === 'BUZZERS_ARMED');
    host.emit('rule_incorrect', { playerId: tokenA.playerId });
    const [hostFinal, boardFinal, bobFinal] = await Promise.all([hostAfterRule, boardAfterRule, bobAfterRule]);

    expect((hostFinal as { phase: string }).phase).toBe('BUZZERS_ARMED');
    expect((boardFinal as { phase: string }).phase).toBe('BUZZERS_ARMED');
    expect((bobFinal as { phase: string }).phase).toBe('BUZZERS_ARMED');
    expect((hostFinal as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(-100);
    expect((hostFinal as { buzzWinnerId: string | null }).buzzWinnerId).toBeNull();
    expect((hostFinal as { deadline: number | null }).deadline).not.toBeNull();

    host.disconnect();
    boardClient.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('controlling contestant disconnecting during board-select does not stall the game; host can select via override', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);
    const gameState = server.engine.getState(roomCode)!;
    const firstClue = gameState.board.rounds[0].clues[0];
    expect(gameState.controllingPlayerId).toBe(tokenA.playerId);

    const hostAfterDrop = waitForState(host);
    const boardAfterDrop = waitForState(boardClient);
    const bobAfterDrop = waitForState(bob);
    alice.disconnect();
    const [hostState, boardState] = await Promise.all([hostAfterDrop, boardAfterDrop, bobAfterDrop]);
    expect((hostState as { players: { id: string; connected: boolean }[] }).players.find((p) => p.id === tokenA.playerId)?.connected).toBe(false);
    expect((boardState as { phase: string }).phase).toBe('BOARD_SELECT');

    const hostAfterSelect = waitForState(host);
    const boardAfterSelect = waitForState(boardClient);
    const bobAfterSelect = waitForState(bob);
    host.emit('select_clue', { clueId: firstClue.id });
    const [hostFinal, boardFinal, bobFinal] = await Promise.all([hostAfterSelect, boardAfterSelect, bobAfterSelect]);

    expect((hostFinal as { phase: string }).phase).toBe('CLUE_REVEALED');
    expect((boardFinal as { phase: string }).phase).toBe('CLUE_REVEALED');
    expect((bobFinal as { phase: string }).phase).toBe('CLUE_REVEALED');
    expect((hostFinal as { currentClueId: string | null }).currentClueId).toBe(firstClue.id);

    host.disconnect();
    boardClient.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('reconnect during active play restores the same slot, score, and current clue state', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);
    const gameState = server.engine.getState(roomCode)!;
    const firstClue = gameState.board.rounds[0].clues[0];

    host.emit('select_clue', { clueId: firstClue.id });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    host.emit('arm_buzzers');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    alice.emit('buzz', { playerId: tokenA.playerId });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    host.emit('rule_correct');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    alice.disconnect();
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(bob)]);

    // Give the server a moment to finish processing the disconnect before reconnecting.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const rejoin = connectClient(server.url);
    await waitForConnect(rejoin);

    // Set up both listeners before emitting the reconnect so neither misses the broadcast.
    const rejoinStatePromise = new Promise<Record<string, unknown>>((resolve) => {
      rejoin.once('state', (state) => resolve(state as Record<string, unknown>));
    });
    const hostFinalPromise = waitForState(host, (s) =>
      (s.players as { id: string; connected: boolean }[]).find((p) => p.id === tokenA.playerId)?.connected === true,
    );

    rejoin.emit('join', { role: 'contestant', roomCode, reconnectToken: tokenA.reconnectToken });
    const rejoinState = await rejoinStatePromise;
    const hostFinal = await hostFinalPromise;

    expect((rejoinState as { playerId: string }).playerId).toBe(tokenA.playerId);
    expect((rejoinState as { players: { id: string; name: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)).toEqual(
      expect.objectContaining({ name: 'Alice', score: 100 }),
    );
    expect((rejoinState as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((rejoinState as { controllingPlayerId: string | null }).controllingPlayerId).toBe(tokenA.playerId);

    expect((hostFinal.players as { id: string; connected: boolean }[]).find((p) => p.id === tokenA.playerId)?.connected).toBe(true);
    expect((hostFinal.players as { id: string; score: number }[]).find((p) => p.id === tokenA.playerId)?.score).toBe(100);

    rejoin.disconnect();
    host.disconnect();
    boardClient.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('server restart mid-game recovers the session for host, board, and contestants', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);
    const gameState = server.engine.getState(roomCode)!;
    const firstClue = gameState.board.rounds[0].clues[0];

    host.emit('select_clue', { clueId: firstClue.id });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    host.emit('arm_buzzers');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    alice.emit('buzz', { playerId: tokenA.playerId });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    host.emit('rule_correct');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    const snapshotBeforeRestart = await prisma.gameSession.findUnique({ where: { roomCode } });
    expect(snapshotBeforeRestart).not.toBeNull();
    expect(snapshotBeforeRestart!.snapshot).toContain('BOARD_SELECT');

    const recoveredEngine = new GameEngine();
    await recoveredEngine.loadActiveSessions();

    const recoveredState = recoveredEngine.getState(roomCode);
    expect(recoveredState).toBeDefined();
    expect(recoveredState!.phase).toBe('BOARD_SELECT');
    expect(recoveredState!.players).toHaveLength(2);
    expect(recoveredState!.players.find((p) => p.id === tokenA.playerId)?.score).toBe(100);
    expect(recoveredState!.players.find((p) => p.id === tokenA.playerId)?.name).toBe('Alice');
    expect(recoveredState!.controllingPlayerId).toBe(tokenA.playerId);

    const recoveredServer = await createTestServer(recoveredEngine);

    const recoveredHost = connectClient(recoveredServer.url);
    const recoveredBoard = connectClient(recoveredServer.url);
    await Promise.all([waitForConnect(recoveredHost), waitForConnect(recoveredBoard)]);
    recoveredHost.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    recoveredBoard.emit('join', { role: 'board', roomCode });
    const [hostState, boardState] = await Promise.all([waitForState(recoveredHost), waitForState(recoveredBoard)]);

    expect((hostState as { roomCode: string }).roomCode).toBe(roomCode);
    expect((hostState as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((hostState as { players: { id: string; name: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)).toEqual(
      expect.objectContaining({ name: 'Alice', score: 100 }),
    );
    expect((boardState as { roomCode: string }).roomCode).toBe(roomCode);
    expect((boardState as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((boardState as { players: { id: string; name: string }[] }).players.find((p) => p.id === tokenA.playerId)?.name).toBe('Alice');

    const recoveredAlice = connectClient(recoveredServer.url);
    await waitForConnect(recoveredAlice);
    const aliceStatePromise = waitForState(recoveredAlice, (s) => s.phase === 'BOARD_SELECT');
    recoveredAlice.emit('join', { role: 'contestant', roomCode, reconnectToken: tokenA.reconnectToken });
    const aliceState = await aliceStatePromise;

    expect((aliceState as { playerId: string }).playerId).toBe(tokenA.playerId);
    expect((aliceState as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(100);
    expect((aliceState as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((aliceState as { controllingPlayerId: string | null }).controllingPlayerId).toBe(tokenA.playerId);

    recoveredAlice.disconnect();
    recoveredHost.disconnect();
    recoveredBoard.disconnect();
    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
    await recoveredServer.close();
  });

  it('new contestant joining after the game has started is rejected deterministically', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);

    const lateJoiner = connectClient(server.url);
    await waitForConnect(lateJoiner);
    const errorPromise = waitForError(lateJoiner);
    lateJoiner.emit('join', { role: 'contestant', roomCode, name: 'Late Joiner' });
    const error = await errorPromise;

    expect(error.message).toMatch(/lobby|started|not in the lobby/i);

    // A rejected join emits no state broadcast, so verify the roster directly.
    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.players).toHaveLength(2);
    expect(engineState.players.every((p) => p.name !== 'Late Joiner')).toBe(true);

    lateJoiner.disconnect();
    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('switching to a new device without a token is deterministically rejected, never duplicating the player', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);

    alice.disconnect();
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(bob)]);

    const newDevice = connectClient(server.url);
    await waitForConnect(newDevice);
    const errorPromise = waitForError(newDevice);
    newDevice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    const error = await errorPromise;

    // Rejection is clear and deterministic; the original disconnected slot is preserved.
    expect(error.message).toMatch(/lobby|started|not in the lobby|name|already joined/i);

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.players.filter((p) => p.name === 'Alice')).toHaveLength(1);
    expect(engineState.players.find((p) => p.id === tokenA.playerId)).toEqual(
      expect.objectContaining({ name: 'Alice', score: 0 }),
    );

    newDevice.disconnect();
    host.disconnect();
    boardClient.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('a stale duplicate socket closing does not disconnect a contestant still connected on another socket, so they can still buzz', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);

    // Alice ends up with a second, live socket (as happens on a mobile
    // wifi/cellular handoff or tab resume) by reconnecting with her token.
    // Both of Alice's sockets are now connected.
    const aliceSecond = connectClient(server.url);
    await waitForConnect(aliceSecond);
    const secondStatePromise = waitForState(aliceSecond);
    aliceSecond.emit('join', { role: 'contestant', roomCode, reconnectToken: tokenA.reconnectToken });
    await secondStatePromise;

    const previousGrace = process.env.DISCONNECT_GRACE_MS;
    process.env.DISCONNECT_GRACE_MS = '100';
    try {
      // The original socket now drops. It must NOT mark Alice offline, because
      // her second socket is still connected. Wait well past the grace window.
      alice.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const state = server.engine.getState(roomCode)!;
      expect(state.players.find((p) => p.id === tokenA.playerId)?.connected).toBe(true);

      // She can still buzz from her live socket.
      const firstClue = state.board.rounds[0].clues[0];
      host.emit('select_clue', { clueId: firstClue.id });
      await Promise.all([waitForState(host), waitForState(boardClient), waitForState(aliceSecond), waitForState(bob)]);
      host.emit('arm_buzzers');
      await Promise.all([waitForState(host), waitForState(boardClient), waitForState(aliceSecond), waitForState(bob)]);

      const hostBuzzed = waitForState(host, (s) => s.phase === 'BUZZED');
      aliceSecond.emit('buzz', { playerId: tokenA.playerId });
      const buzzedState = await hostBuzzed;
      expect((buzzedState as { buzzWinnerId: string | null }).buzzWinnerId).toBe(tokenA.playerId);
    } finally {
      if (previousGrace === undefined) delete process.env.DISCONNECT_GRACE_MS;
      else process.env.DISCONNECT_GRACE_MS = previousGrace;
    }

    aliceSecond.disconnect();
    host.disconnect();
    boardClient.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('lets a disconnected contestant rejoin by name into their existing slot mid-game', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);

    const previousGrace = process.env.DISCONNECT_GRACE_MS;
    process.env.DISCONNECT_GRACE_MS = '100';
    try {
      // Alice closes her browser and is marked offline once the grace elapses.
      const hostSawOffline = waitForState(
        host,
        (s) =>
          (s.players as { id: string; connected: boolean }[]).find((p) => p.id === tokenA.playerId)?.connected ===
          false,
      );
      alice.disconnect();
      await hostSawOffline;

      // She reopens on a new device with no reconnect token and simply enters
      // her name and the room code again.
      const aliceReturns = connectClient(server.url);
      await waitForConnect(aliceReturns);
      const rejoinState = waitForState(aliceReturns);
      const rejoinToken = waitForToken(aliceReturns);
      aliceReturns.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
      const [state, token] = await Promise.all([rejoinState, rejoinToken]);

      // Reclaims the existing slot (same id + token, still one player) rather
      // than creating a duplicate or being rejected for not being in the lobby.
      expect(token.playerId).toBe(tokenA.playerId);
      expect(token.reconnectToken).toBe(tokenA.reconnectToken);
      expect((state as { playerId: string }).playerId).toBe(tokenA.playerId);
      const players = (state as { players: { id: string; connected: boolean }[] }).players;
      expect(players.find((p) => p.id === tokenA.playerId)?.connected).toBe(true);
      expect(players.filter((p) => p.id === tokenA.playerId).length).toBe(1);
      expect(players.length).toBe(2);

      aliceReturns.disconnect();
    } finally {
      if (previousGrace === undefined) delete process.env.DISCONNECT_GRACE_MS;
      else process.env.DISCONNECT_GRACE_MS = previousGrace;
    }

    host.disconnect();
    boardClient.disconnect();
    bob.disconnect();
    await server.close();
  });
});
