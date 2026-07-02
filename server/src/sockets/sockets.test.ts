import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ClientIo, Socket as ClientSocket } from 'socket.io-client';
import { UndoAck } from '@jeopardy/shared';
import { createApp } from '../http/app.js';
import { GameEngine } from '../engine/game.js';
import { prisma } from '../repo/prisma.js';
import { boardRepository } from '../repo/board.js';
import { mintHostToken } from '../auth/token.js';
import { registerGameSockets } from './game.js';

function makeBoardPayload() {
  return {
    name: 'Socket Test Board',
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
              { value: 200, row: 1, clueText: 'This planet is known as the Red Planet', answer: 'Mars', isDailyDouble: true },
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

function waitForUndoAck(client: ClientSocket): Promise<UndoAck> {
  return new Promise((resolve) => {
    client.emit('undo_last_ruling', (ack: UndoAck) => resolve(ack));
  });
}

function waitForToken(client: ClientSocket): Promise<{ reconnectToken: string; playerId: string }> {
  return new Promise((resolve) => {
    client.once('token', (data) => resolve(data as { reconnectToken: string; playerId: string }));
  });
}

function expectProjectionsEqual(a: Record<string, unknown>, b: Record<string, unknown>) {
  const { serverNow: aNow, ...aRest } = a;
  const { serverNow: bNow, ...bRest } = b;
  expect(aRest).toEqual(bRest);
  expect(Math.abs((aNow as number) - (bNow as number))).toBeLessThanOrEqual(50);
}

describe('game sockets', () => {
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

  it('host connects with a valid token and receives a host projection', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);
    const client = connectClient(server.url);
    await waitForConnect(client);

    client.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    const state = await waitForState(client);

    expect(state.roomCode).toBe(roomCode);
    expect(state.phase).toBe('LOBBY');
    expect(state.answer).toBeNull();

    client.disconnect();
    await server.close();
  });

  it('host connection is rejected with an invalid token', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);
    const client = connectClient(server.url);
    await waitForConnect(client);

    client.emit('join', { role: 'host', roomCode, hostToken: 'forged' });
    const error = await waitForError(client);

    expect(error.message).toMatch(/invalid host token/i);

    client.disconnect();
    await server.close();
  });

  it('host receives an error when starting with no connected players', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const host = connectClient(server.url);
    await waitForConnect(host);
    host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    await waitForState(host);

    const alice = connectClient(server.url);
    await waitForConnect(alice);
    const tokenPromise = waitForToken(alice);
    alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    await tokenPromise;

    const hostDisconnect = waitForState(host);
    alice.disconnect();
    await hostDisconnect;

    const errorPromise = waitForError(host);
    host.emit('start_game');
    const error = await errorPromise;

    expect(error.message).toMatch(/connected contestant/i);

    host.disconnect();
    await server.close();
  });

  it('board connects with a room code and receives a board projection', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);
    const client = connectClient(server.url);
    await waitForConnect(client);

    client.emit('join', { role: 'board', roomCode });
    const state = await waitForState(client);

    expect(state.roomCode).toBe(roomCode);
    expect(state.phase).toBe('LOBBY');
    expect(state.answer).toBeNull();

    client.disconnect();
    await server.close();
  });

  it('contestant joins with a name and receives a contestant projection', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);
    const client = connectClient(server.url);
    await waitForConnect(client);

    client.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    const [state, token] = await Promise.all([waitForState(client), waitForToken(client)]);

    expect(state.roomCode).toBe(roomCode);
    expect(state.playerId).toBe(token.playerId);
    expect(state.isControllingPlayer).toBe(false);
    expect(state.answer).toBeNull();
    expect(token.reconnectToken).toBeDefined();

    client.disconnect();
    await server.close();
  });

  it('contestant reconnects with a token and rejoins the same slot', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);
    const first = connectClient(server.url);
    await waitForConnect(first);

    first.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    const token = await waitForToken(first);
    first.disconnect();

    const second = connectClient(server.url);
    await waitForConnect(second);
    second.emit('join', { role: 'contestant', roomCode, reconnectToken: token.reconnectToken });
    const state = await waitForState(second);

    expect(state.playerId).toBe(token.playerId);
    expect((state.players as { id: string; name: string }[]).find((p) => p.id === token.playerId)?.name).toBe('Alice');

    second.disconnect();
    await server.close();
  });

  it('unknown room code is rejected', async () => {
    const server = await createTestServer();
    const client = connectClient(server.url);
    await waitForConnect(client);

    client.emit('join', { role: 'board', roomCode: 'XXXX' });
    const error = await waitForError(client);

    expect(error.message).toMatch(/unknown room code/i);

    client.disconnect();
    await server.close();
  });

  it('rejects a blank or whitespace-only contestant name', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);
    const client = connectClient(server.url);
    await waitForConnect(client);

    const errorPromise = waitForError(client);
    client.emit('join', { role: 'contestant', roomCode, name: '   ' });
    const error = await errorPromise;

    expect(error.message).toMatch(/name/i);

    const host = connectClient(server.url);
    await waitForConnect(host);
    const hostStatePromise = waitForState(host);
    host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    const hostState = (await hostStatePromise) as { players: { name: string }[] };
    expect(hostState.players).toHaveLength(0);

    client.disconnect();
    host.disconnect();
    await server.close();
  });

  it('rejects a duplicate contestant name', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const first = connectClient(server.url);
    await waitForConnect(first);
    const tokenPromise = waitForToken(first);
    first.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    await tokenPromise;

    const second = connectClient(server.url);
    await waitForConnect(second);
    const errorPromise = waitForError(second);
    second.emit('join', { role: 'contestant', roomCode, name: 'alice' });
    const error = await errorPromise;

    expect(error.message).toMatch(/name/i);

    const host = connectClient(server.url);
    await waitForConnect(host);
    const hostStatePromise = waitForState(host);
    host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    const hostState = (await hostStatePromise) as { players: { name: string }[] };
    expect(hostState.players).toHaveLength(1);

    first.disconnect();
    second.disconnect();
    host.disconnect();
    await server.close();
  });

  it('rejects a sixth contestant and does not add them to the roster', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const clients: ClientSocket[] = [];
    for (let i = 0; i < 5; i += 1) {
      const client = connectClient(server.url);
      await waitForConnect(client);
      const tokenPromise = waitForToken(client);
      client.emit('join', { role: 'contestant', roomCode, name: `Player ${i + 1}` });
      await tokenPromise;
      clients.push(client);
    }

    const sixth = connectClient(server.url);
    await waitForConnect(sixth);
    const errorPromise = waitForError(sixth);
    sixth.emit('join', { role: 'contestant', roomCode, name: 'Too Many' });
    const error = await errorPromise;

    expect(error.message).toMatch(/full/i);

    const host = connectClient(server.url);
    await waitForConnect(host);
    const hostStatePromise = waitForState(host);
    host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    const hostState = (await hostStatePromise) as { players: { name: string }[] };
    expect(hostState.players).toHaveLength(5);

    clients.forEach((c) => c.disconnect());
    sixth.disconnect();
    host.disconnect();
    await server.close();
  });

  it('accepts a room code with different case and surrounding whitespace', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);
    const client = connectClient(server.url);
    await waitForConnect(client);

    const paddedCode = `  ${roomCode.toLowerCase()}  `;
    const statePromise = waitForState(client);
    const tokenPromise = waitForToken(client);
    client.emit('join', { role: 'contestant', roomCode: paddedCode, name: 'Alice' });
    const [state, token] = await Promise.all([statePromise, tokenPromise]);

    expect(state.roomCode).toBe(roomCode);
    expect(token.reconnectToken).toBeDefined();

    client.disconnect();
    await server.close();
  });

  it('admits exactly one racer for the last open slot and rejects the other as full', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const existing: ClientSocket[] = [];
    for (let i = 0; i < 4; i += 1) {
      const client = connectClient(server.url);
      await waitForConnect(client);
      const tokenPromise = waitForToken(client);
      client.emit('join', { role: 'contestant', roomCode, name: `Player ${i + 1}` });
      await tokenPromise;
      existing.push(client);
    }

    const racerA = connectClient(server.url);
    const racerB = connectClient(server.url);
    await Promise.all([waitForConnect(racerA), waitForConnect(racerB)]);

    const outcomeAPromise = Promise.race([
      waitForToken(racerA).then(() => 'token' as const),
      waitForError(racerA).then(() => 'error' as const),
    ]);
    const outcomeBPromise = Promise.race([
      waitForToken(racerB).then(() => 'token' as const),
      waitForError(racerB).then(() => 'error' as const),
    ]);

    racerA.emit('join', { role: 'contestant', roomCode, name: 'Racer A' });
    racerB.emit('join', { role: 'contestant', roomCode, name: 'Racer B' });

    const [outcomeA, outcomeB] = await Promise.all([outcomeAPromise, outcomeBPromise]);

    const admitted = [outcomeA, outcomeB].filter((o) => o === 'token').length;
    const rejected = [outcomeA, outcomeB].filter((o) => o === 'error').length;
    expect(admitted).toBe(1);
    expect(rejected).toBe(1);

    const host = connectClient(server.url);
    await waitForConnect(host);
    const hostStatePromise = waitForState(host);
    host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    const hostState = (await hostStatePromise) as { players: { name: string }[] };
    expect(hostState.players).toHaveLength(5);

    existing.forEach((c) => c.disconnect());
    racerA.disconnect();
    racerB.disconnect();
    host.disconnect();
    await server.close();
  });

  it('two board tabs on the same game show identical state and update live on a join', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const boardA = connectClient(server.url);
    const boardB = connectClient(server.url);
    await Promise.all([waitForConnect(boardA), waitForConnect(boardB)]);

    const stateAPromise = waitForState(boardA);
    const stateBPromise = waitForState(boardB);
    boardA.emit('join', { role: 'board', roomCode });
    boardB.emit('join', { role: 'board', roomCode });

    const [stateA, stateB] = await Promise.all([stateAPromise, stateBPromise]);
    expectProjectionsEqual(stateA, stateB);
    expect((stateA as { players: unknown[] }).players).toHaveLength(0);
    expect((stateA as { answer: string | null }).answer).toBeNull();

    const updateAPromise = waitForState(boardA);
    const updateBPromise = waitForState(boardB);

    const contestant = connectClient(server.url);
    await waitForConnect(contestant);
    contestant.emit('join', { role: 'contestant', roomCode, name: 'Alice' });

    const [updateA, updateB] = await Promise.all([updateAPromise, updateBPromise]);
    expectProjectionsEqual(updateA, updateB);
    expect((updateA as { players: { name: string }[] }).players).toHaveLength(1);
    expect((updateA as { players: { name: string }[] }).players[0].name).toBe('Alice');
    expect((updateA as { answer: string | null }).answer).toBeNull();

    boardA.disconnect();
    boardB.disconnect();
    contestant.disconnect();
    await server.close();
  });

  it('contestant explicit leave removes the player and frees a slot', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const host = connectClient(server.url);
    await waitForConnect(host);
    host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    await waitForState(host);

    const alice = connectClient(server.url);
    await waitForConnect(alice);
    const tokenPromise = waitForToken(alice);
    alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    await tokenPromise;

    const hostAfterLeave = waitForState(host);
    alice.emit('leave');
    const hostState = (await hostAfterLeave) as { players: { name: string }[] };
    expect(hostState.players).toHaveLength(0);

    const bob = connectClient(server.url);
    await waitForConnect(bob);
    const bobTokenPromise = waitForToken(bob);
    const hostAfterBob = waitForState(host);
    bob.emit('join', { role: 'contestant', roomCode, name: 'Bob' });
    await bobTokenPromise;
    const hostAfterBobState = (await hostAfterBob) as { players: { name: string }[] };
    expect(hostAfterBobState.players).toHaveLength(1);
    expect(hostAfterBobState.players[0].name).toBe('Bob');

    alice.disconnect();
    bob.disconnect();
    host.disconnect();
    await server.close();
  });

  it('reconnecting with a token after an explicit leave is rejected', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const host = connectClient(server.url);
    await waitForConnect(host);
    host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    await waitForState(host);

    const alice = connectClient(server.url);
    await waitForConnect(alice);
    const tokenPromise = waitForToken(alice);
    alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    const token = await tokenPromise;

    const hostAfterLeave = waitForState(host);
    alice.emit('leave');
    await hostAfterLeave;

    const rejoin = connectClient(server.url);
    await waitForConnect(rejoin);
    const errorPromise = waitForError(rejoin);
    rejoin.emit('join', { role: 'contestant', roomCode, reconnectToken: token.reconnectToken });
    const error = await errorPromise;
    expect(error.message).toMatch(/invalid reconnect token/i);

    alice.disconnect();
    rejoin.disconnect();
    host.disconnect();
    await server.close();
  });

  it('a contestant reload reconnects to the same slot without a new name', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const alice = connectClient(server.url);
    await waitForConnect(alice);
    const tokenPromise = waitForToken(alice);
    alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    const token = await tokenPromise;
    alice.disconnect();

    const rejoin = connectClient(server.url);
    await waitForConnect(rejoin);
    const statePromise = waitForState(rejoin);
    rejoin.emit('join', { role: 'contestant', roomCode, reconnectToken: token.reconnectToken });
    const state = (await statePromise) as { playerId: string; players: { id: string; name: string }[] };

    expect(state.playerId).toBe(token.playerId);
    expect(state.players.find((p) => p.id === token.playerId)?.name).toBe('Alice');

    rejoin.disconnect();
    await server.close();
  });

  it('a dropped contestant shows disconnected then reconnected on host and board', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const host = connectClient(server.url);
    const boardClient = connectClient(server.url);
    await Promise.all([waitForConnect(host), waitForConnect(boardClient)]);
    host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    boardClient.emit('join', { role: 'board', roomCode });
    await Promise.all([waitForState(host), waitForState(boardClient)]);

    const alice = connectClient(server.url);
    await waitForConnect(alice);
    const tokenPromise = waitForToken(alice);
    alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    const token = await tokenPromise;

    const hostDisconnect = waitForState(host);
    const boardDisconnect = waitForState(boardClient);
    alice.disconnect();
    const [hostAfterDrop, boardAfterDrop] = await Promise.all([hostDisconnect, boardDisconnect]);
    expect((hostAfterDrop as { players: { connected: boolean }[] }).players[0].connected).toBe(false);
    expect((boardAfterDrop as { players: { connected: boolean }[] }).players[0].connected).toBe(false);

    const rejoin = connectClient(server.url);
    await waitForConnect(rejoin);
    const hostReconnect = waitForState(host);
    const boardReconnect = waitForState(boardClient);
    rejoin.emit('join', { role: 'contestant', roomCode, reconnectToken: token.reconnectToken });
    const [hostAfterReconnect, boardAfterReconnect] = await Promise.all([hostReconnect, boardReconnect]);
    expect((hostAfterReconnect as { players: { id: string; connected: boolean }[] }).players[0].id).toBe(token.playerId);
    expect((hostAfterReconnect as { players: { connected: boolean }[] }).players[0].connected).toBe(true);
    expect((boardAfterReconnect as { players: { connected: boolean }[] }).players[0].connected).toBe(true);

    rejoin.disconnect();
    host.disconnect();
    boardClient.disconnect();
    await server.close();
  });

  it('host reconnect after a transient drop resyncs to the same session', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const host = connectClient(server.url);
    await waitForConnect(host);
    host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    await waitForState(host);
    host.disconnect();

    const host2 = connectClient(server.url);
    await waitForConnect(host2);
    const statePromise = waitForState(host2);
    host2.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    const state = (await statePromise) as { roomCode: string; phase: string };
    expect(state.roomCode).toBe(roomCode);
    expect(state.phase).toBe('LOBBY');

    host2.disconnect();
    await server.close();
  });

  it('board reconnect after a transient drop resyncs to the same session', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const boardClient = connectClient(server.url);
    await waitForConnect(boardClient);
    boardClient.emit('join', { role: 'board', roomCode });
    await waitForState(boardClient);
    boardClient.disconnect();

    const board2 = connectClient(server.url);
    await waitForConnect(board2);
    const statePromise = waitForState(board2);
    board2.emit('join', { role: 'board', roomCode });
    const state = (await statePromise) as { roomCode: string; phase: string; players: unknown[] };
    expect(state.roomCode).toBe(roomCode);
    expect(state.phase).toBe('LOBBY');
    expect(state.players).toHaveLength(0);

    board2.disconnect();
    await server.close();
  });

  it('two concurrent games never leak roster state across room codes', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode: roomA } = await server.engine.createSession(board.id);
    const { roomCode: roomB } = await server.engine.createSession(board.id);

    const hostA = connectClient(server.url);
    const boardA = connectClient(server.url);
    const hostB = connectClient(server.url);
    const boardB = connectClient(server.url);
    await Promise.all([
      waitForConnect(hostA),
      waitForConnect(boardA),
      waitForConnect(hostB),
      waitForConnect(boardB),
    ]);

    hostA.emit('join', { role: 'host', roomCode: roomA, hostToken: mintHostToken() });
    boardA.emit('join', { role: 'board', roomCode: roomA });
    hostB.emit('join', { role: 'host', roomCode: roomB, hostToken: mintHostToken() });
    boardB.emit('join', { role: 'board', roomCode: roomB });
    await Promise.all([waitForState(hostA), waitForState(boardA), waitForState(hostB), waitForState(boardB)]);

    const contestantA = connectClient(server.url);
    await waitForConnect(contestantA);
    const hostAUpdate = waitForState(hostA);
    const boardAUpdate = waitForState(boardA);
    contestantA.emit('join', { role: 'contestant', roomCode: roomA, name: 'Alice' });
    const [hostAState, boardAState] = await Promise.all([hostAUpdate, boardAUpdate]);

    expect(server.engine.getState(roomB)?.players).toHaveLength(0);
    expect((hostAState as { players: { name: string }[] }).players).toHaveLength(1);
    expect((boardAState as { players: { name: string }[] }).players).toHaveLength(1);

    const contestantB = connectClient(server.url);
    await waitForConnect(contestantB);
    const hostBUpdate = waitForState(hostB);
    const boardBUpdate = waitForState(boardB);
    contestantB.emit('join', { role: 'contestant', roomCode: roomB, name: 'Bob' });
    const [hostBState, boardBState] = await Promise.all([hostBUpdate, boardBUpdate]);

    expect(server.engine.getState(roomA)?.players).toHaveLength(1);
    expect((hostBState as { players: { name: string }[] }).players[0].name).toBe('Bob');
    expect((boardBState as { players: { name: string }[] }).players[0].name).toBe('Bob');

    contestantA.disconnect();
    contestantB.disconnect();
    hostA.disconnect();
    boardA.disconnect();
    hostB.disconnect();
    boardB.disconnect();
    await server.close();
  });

  it('deleting a board in use leaves the live game intact', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode, sessionId } = await server.engine.createSession(board.id);

    const host = connectClient(server.url);
    const boardClient = connectClient(server.url);
    await Promise.all([waitForConnect(host), waitForConnect(boardClient)]);
    host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    boardClient.emit('join', { role: 'board', roomCode });
    await Promise.all([waitForState(host), waitForState(boardClient)]);

    await boardRepository.delete(board.id);

    const alice = connectClient(server.url);
    await waitForConnect(alice);
    const hostUpdate = waitForState(host);
    const boardUpdate = waitForState(boardClient);
    alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    const [hostState, boardState] = await Promise.all([hostUpdate, boardUpdate]);

    expect((hostState as { roomCode: string }).roomCode).toBe(roomCode);
    expect((hostState as { players: { name: string }[] }).players).toHaveLength(1);
    expect((hostState as { players: { name: string }[] }).players[0].name).toBe('Alice');
    expect((boardState as { roomCode: string }).roomCode).toBe(roomCode);
    expect((boardState as { players: { name: string }[] }).players).toHaveLength(1);

    const session = await prisma.gameSession.findUnique({ where: { id: sessionId } });
    expect(session?.boardId).toBeNull();

    alice.disconnect();
    host.disconnect();
    boardClient.disconnect();
    await server.close();
  });

  it('editing a board after game creation does not alter the live game', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const host = connectClient(server.url);
    await waitForConnect(host);
    host.emit('join', { role: 'host', roomCode, hostToken: mintHostToken() });
    await waitForState(host);

    const originalBoard = server.engine.getState(roomCode)!.board;
    await boardRepository.update(board.id, {
      ...makeBoardPayload(),
      name: 'Completely Different Name',
    });

    const alice = connectClient(server.url);
    await waitForConnect(alice);
    const hostUpdate = waitForState(host);
    alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    const hostState = (await hostUpdate) as { roomCode: string; players: { name: string }[] };

    expect(hostState.roomCode).toBe(roomCode);
    expect(hostState.players).toHaveLength(1);
    expect(server.engine.getState(roomCode)!.board.name).toBe(originalBoard.name);

    alice.disconnect();
    host.disconnect();
    await server.close();
  });
});

describe('clue selection sockets', () => {
  function makePlayableBoardPayload() {
    return {
      name: 'Playable Socket Board',
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
                { value: 200, row: 1, clueText: 'Red Planet', answer: 'Mars', isDailyDouble: true },
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

  async function setupGame(server: Awaited<ReturnType<typeof createTestServer>>) {
    const board = await boardRepository.create(makePlayableBoardPayload());
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

    const hostStart = waitForState(host);
    const boardStart = waitForState(boardClient);
    const aliceStart = waitForState(alice);
    const bobStart = waitForState(bob);
    host.emit('start_game');
    await Promise.all([hostStart, boardStart, aliceStart, bobStart]);

    return { roomCode, host, boardClient, alice, bob, tokenA, tokenB };
  }

  it('host selects a clue and board + contestants see the clue text', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    const state = server.engine.getState(roomCode)!;
    const firstClue = state.board.rounds[0].clues[0];

    const hostUpdate = waitForState(host);
    const boardUpdate = waitForState(boardClient);
    const aliceUpdate = waitForState(alice);
    const bobUpdate = waitForState(bob);

    host.emit('select_clue', { clueId: firstClue.id });
    const [hostState, boardState, aliceState, bobState] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    expect((hostState as { phase: string }).phase).toBe('CLUE_REVEALED');
    expect((boardState as { currentClueText: string }).currentClueText).toBe(firstClue.clueText);
    expect((aliceState as { currentClueText: string }).currentClueText).toBe(firstClue.clueText);
    expect((bobState as { currentClueText: string }).currentClueText).toBe(firstClue.clueText);
    expect((hostState as { answer: string }).answer).toBe(firstClue.answer);
    expect((boardState as { answer: string | null }).answer).toBeNull();

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('controlling contestant selects a clue and it reveals on all views', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);

    const state = server.engine.getState(roomCode)!;
    const firstClue = state.board.rounds[0].clues[0];
    const controllerId = state.controllingPlayerId;
    const controller = controllerId === tokenA.playerId ? alice : bob;

    const hostUpdate = waitForState(host);
    const boardUpdate = waitForState(boardClient);
    const aliceUpdate = waitForState(alice);
    const bobUpdate = waitForState(bob);

    controller.emit('select_clue', { clueId: firstClue.id });
    const [hostState, boardState] = await Promise.all([hostUpdate, boardUpdate, aliceUpdate, bobUpdate]);

    expect((boardState as { phase: string }).phase).toBe('CLUE_REVEALED');
    expect((boardState as { currentClueText: string }).currentClueText).toBe(firstClue.clueText);
    expect((hostState as { phase: string }).phase).toBe('CLUE_REVEALED');
    expect((hostState as { currentClueText: string }).currentClueText).toBe(firstClue.clueText);
    expect((hostState as { answer: string }).answer).toBe(firstClue.answer);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('non-controlling contestant cannot select a clue', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);

    const state = server.engine.getState(roomCode)!;
    const firstClue = state.board.rounds[0].clues[0];
    const controllerId = state.controllingPlayerId;
    const nonController = controllerId === tokenA.playerId ? bob : alice;

    const errorPromise = waitForError(nonController);
    nonController.emit('select_clue', { clueId: firstClue.id });
    const error = await errorPromise;

    expect(error.message).toMatch(/controlling player/i);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('controlling contestant submits a Daily Double wager and all views advance to the clue', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);
    const state = server.engine.getState(roomCode)!;
    const ddClue = state.board.rounds[0].clues[1];
    const controllerId = state.controllingPlayerId;
    const controller = controllerId === tokenA.playerId ? alice : bob;
    const other = controllerId === tokenA.playerId ? bob : alice;

    host.emit('select_clue', { clueId: ddClue.id });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    const hostUpdate = waitForState(host, (s) => s.phase === 'DAILY_DOUBLE_CLUE');
    const boardUpdate = waitForState(boardClient, (s) => s.phase === 'DAILY_DOUBLE_CLUE');
    const controllerUpdate = waitForState(controller, (s) => s.phase === 'DAILY_DOUBLE_CLUE');
    const otherUpdate = waitForState(other, (s) => s.phase === 'DAILY_DOUBLE_CLUE');

    controller.emit('submit_dd_wager', { amount: 200 });
    const [hostState, boardState, controllerState, otherState] = await Promise.all([
      hostUpdate,
      boardUpdate,
      controllerUpdate,
      otherUpdate,
    ]);

    expect((hostState as { phase: string }).phase).toBe('DAILY_DOUBLE_CLUE');
    expect((hostState as { dailyDoubleWager: number | null }).dailyDoubleWager).toBe(200);
    expect((controllerState as { dailyDoubleWager: number | null }).dailyDoubleWager).toBe(200);
    expect((boardState as { dailyDoubleWager: number | null }).dailyDoubleWager).toBeNull();
    expect((otherState as { dailyDoubleWager: number | null }).dailyDoubleWager).toBeNull();
    expect((boardState as { currentClueText: string | null }).currentClueText).toBe(ddClue.clueText);
    expect((otherState as { currentClueText: string | null }).currentClueText).toBe(ddClue.clueText);
    expect((controllerState as { currentClueText: string | null }).currentClueText).toBe(ddClue.clueText);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('rejects a Daily Double wager from a non-controlling contestant', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);
    const state = server.engine.getState(roomCode)!;
    const ddClue = state.board.rounds[0].clues[1];
    const controllerId = state.controllingPlayerId;
    const nonController = controllerId === tokenA.playerId ? bob : alice;

    host.emit('select_clue', { clueId: ddClue.id });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    const errorPromise = waitForError(nonController);
    nonController.emit('submit_dd_wager', { amount: 200 });
    const error = await errorPromise;

    expect(error.message).toMatch(/controlling contestant/i);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('rejects an out-of-range Daily Double wager with a clear message', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob, tokenA } = await setupGame(server);
    const state = server.engine.getState(roomCode)!;
    const ddClue = state.board.rounds[0].clues[1];
    const controllerId = state.controllingPlayerId;
    const controller = controllerId === tokenA.playerId ? alice : bob;

    host.emit('select_clue', { clueId: ddClue.id });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    const lowErrorPromise = waitForError(controller);
    controller.emit('submit_dd_wager', { amount: 4 });
    const lowError = await lowErrorPromise;
    expect(lowError.message).toMatch(/minimum/i);

    const highErrorPromise = waitForError(controller);
    controller.emit('submit_dd_wager', { amount: 201 });
    const highError = await highErrorPromise;
    expect(highError.message).toMatch(/maximum/i);

    const engineState = server.engine.getState(roomCode)!;
    expect(engineState.phase).toBe('DAILY_DOUBLE_WAGER');
    expect(engineState.dailyDoubleWager).toBeNull();

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('host reveal answer returns to board select and marks the clue used', async () => {
    const server = await createTestServer();
    const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
    const state = server.engine.getState(roomCode)!;
    const firstClue = state.board.rounds[0].clues[0];

    host.emit('select_clue', { clueId: firstClue.id });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    const hostUpdate = waitForState(host);
    const boardUpdate = waitForState(boardClient);
    const aliceUpdate = waitForState(alice);
    const bobUpdate = waitForState(bob);

    host.emit('reveal_answer');
    const [hostState, boardState] = await Promise.all([hostUpdate, boardUpdate, aliceUpdate, bobUpdate]);

    expect((hostState as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((boardState as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((boardState as { usedClueIds: string[] }).usedClueIds).toContain(firstClue.id);
    expect((boardState as { currentClueId: string | null }).currentClueId).toBeNull();

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it(
    'host reveals the answer before expiry with no buzz and resolves the clue',
    async () => {
      const server = await createTestServer();
      const { roomCode, host, boardClient, alice, bob } = await setupGame(server);
      const state = server.engine.getState(roomCode)!;
      const firstClue = state.board.rounds[0].clues[0];

      host.emit('select_clue', { clueId: firstClue.id });
      await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

      host.emit('arm_buzzers');
      await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

      const isBoardSelect = (s: Record<string, unknown>) => s.phase === 'BOARD_SELECT';
      const hostUpdate = waitForState(host, isBoardSelect, 10000);
      const boardUpdate = waitForState(boardClient, isBoardSelect, 10000);
      const aliceUpdate = waitForState(alice, isBoardSelect, 10000);
      const bobUpdate = waitForState(bob, isBoardSelect, 10000);

      host.emit('reveal_answer');
      const [hostState, boardState, aliceState, bobState] = await Promise.all([
        hostUpdate,
        boardUpdate,
        aliceUpdate,
        bobUpdate,
      ]);

      expect((hostState as { phase: string }).phase).toBe('BOARD_SELECT');
      expect((boardState as { phase: string }).phase).toBe('BOARD_SELECT');
      expect((aliceState as { phase: string }).phase).toBe('BOARD_SELECT');
      expect((bobState as { phase: string }).phase).toBe('BOARD_SELECT');
      expect((boardState as { usedClueIds: string[] }).usedClueIds).toContain(firstClue.id);
      expect((boardState as { currentClueId: string | null }).currentClueId).toBeNull();
      expect((boardState as { answer: string | null }).answer).toBe(firstClue.answer);
      expect((aliceState as { answer: string | null }).answer).toBe(firstClue.answer);
      expect((bobState as { answer: string | null }).answer).toBe(firstClue.answer);
      expect((aliceState as { players: { score: number }[] }).players[0].score).toBe(0);
      expect((bobState as { players: { score: number }[] }).players[0].score).toBe(0);

      host.disconnect();
      boardClient.disconnect();
      alice.disconnect();
      bob.disconnect();
      await server.close();
    },
    10000,
  );
});

describe('buzzer arming and fastest-finger sockets', () => {
  async function setupGame(server: Awaited<ReturnType<typeof createTestServer>>) {
    const board = await boardRepository.create({
      name: 'Buzzer Socket Board',
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
              clues: [{ value: null, row: 0, clueText: 'Hobbit author', answer: 'Tolkien', isDailyDouble: false }],
            },
          ],
        },
      ],
    });
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

    const hostStart = waitForState(host);
    const boardStart = waitForState(boardClient);
    const aliceStart = waitForState(alice);
    const bobStart = waitForState(bob);
    host.emit('start_game');
    await Promise.all([hostStart, boardStart, aliceStart, bobStart]);

    const gameState = server.engine.getState(roomCode)!;
    const firstClue = gameState.board.rounds[0].clues[0];
    const hostSelect = waitForState(host);
    const boardSelect = waitForState(boardClient);
    const aliceSelect = waitForState(alice);
    const bobSelect = waitForState(bob);
    host.emit('select_clue', { clueId: firstClue.id });
    await Promise.all([hostSelect, boardSelect, aliceSelect, bobSelect]);

    return { roomCode, host, boardClient, alice, bob, tokenA, tokenB, firstClue };
  }

  it('host arms buzzers and all views transition to BUZZERS_ARMED', async () => {
    const server = await createTestServer();
    const { host, boardClient, alice, bob } = await setupGame(server);

    const hostUpdate = waitForState(host);
    const boardUpdate = waitForState(boardClient);
    const aliceUpdate = waitForState(alice);
    const bobUpdate = waitForState(bob);

    host.emit('arm_buzzers');
    const [hostState, boardState, aliceState, bobState] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    expect((hostState as { phase: string }).phase).toBe('BUZZERS_ARMED');
    expect((boardState as { phase: string }).phase).toBe('BUZZERS_ARMED');
    expect((aliceState as { phase: string }).phase).toBe('BUZZERS_ARMED');
    expect((bobState as { phase: string }).phase).toBe('BUZZERS_ARMED');
    expect((boardState as { deadline: number }).deadline).toBeGreaterThan(0);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('early buzz applies a lockout and no winner is recorded', async () => {
    const server = await createTestServer();
    const { host, boardClient, alice, bob, tokenA } = await setupGame(server);

    const aliceUpdate = waitForState(alice);
    const hostUpdate = waitForState(host);
    const boardUpdate = waitForState(boardClient);
    const bobUpdate = waitForState(bob);

    alice.emit('buzz', { playerId: tokenA.playerId });
    const [aliceState, hostState, boardState, bobState] = await Promise.all([
      aliceUpdate,
      hostUpdate,
      boardUpdate,
      bobUpdate,
    ]);

    expect((aliceState as { isLockedOut: boolean }).isLockedOut).toBe(true);
    expect((aliceState as { lockoutUntil: number }).lockoutUntil).toBeGreaterThan(0);
    expect((hostState as { buzzWinnerId: string | null }).buzzWinnerId).toBeNull();
    expect((boardState as { buzzWinnerId: string | null }).buzzWinnerId).toBeNull();
    expect((bobState as { buzzWinnerId: string | null }).buzzWinnerId).toBeNull();
    expect((aliceState as { phase: string }).phase).toBe('CLUE_REVEALED');

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('first buzz after arming wins and locks out later buzzers', async () => {
    const server = await createTestServer();
    const { host, boardClient, alice, bob, tokenA, tokenB } = await setupGame(server);

    host.emit('arm_buzzers');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    const aliceUpdate = waitForState(alice);
    const hostUpdate = waitForState(host);
    const boardUpdate = waitForState(boardClient);
    const bobUpdate = waitForState(bob);

    alice.emit('buzz', { playerId: tokenA.playerId });
    const [aliceState, hostState, boardState, bobState] = await Promise.all([
      aliceUpdate,
      hostUpdate,
      boardUpdate,
      bobUpdate,
    ]);

    expect((aliceState as { phase: string }).phase).toBe('BUZZED');
    expect((hostState as { buzzWinnerId: string | null }).buzzWinnerId).toBe(tokenA.playerId);
    expect((boardState as { buzzWinnerId: string | null }).buzzWinnerId).toBe(tokenA.playerId);
    expect((bobState as { buzzWinnerId: string | null }).buzzWinnerId).toBe(tokenA.playerId);

    const bobError = waitForError(bob);
    bob.emit('buzz', { playerId: tokenB.playerId });
    const error = await bobError;
    expect(error.message).toMatch(/already buzzed/i);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('host rules correct and score/control propagate', async () => {
    const server = await createTestServer();
    const { host, boardClient, alice, bob, tokenA } = await setupGame(server);

    host.emit('arm_buzzers');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);
    alice.emit('buzz', { playerId: tokenA.playerId });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    const hostUpdate = waitForState(host);
    const boardUpdate = waitForState(boardClient);
    const aliceUpdate = waitForState(alice);
    const bobUpdate = waitForState(bob);

    host.emit('rule_correct');
    const [hostState, boardState, aliceState, bobState] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    expect((hostState as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((boardState as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((bobState as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((aliceState as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(100);
    expect((boardState as { controllingPlayerId: string | null }).controllingPlayerId).toBe(tokenA.playerId);
    expect((aliceState as { isControllingPlayer: boolean }).isControllingPlayer).toBe(true);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  }, 10000);

  it('wrong-then-right sequence broadcasts consistent scores and control to all roles', async () => {
    const server = await createTestServer();
    const { host, boardClient, alice, bob, tokenA, tokenB } = await setupGame(server);

    host.emit('arm_buzzers');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    // Alice buzzes first and is ruled incorrect.
    alice.emit('buzz', { playerId: tokenA.playerId });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    let hostUpdate = waitForState(host, (s) => s.phase === 'BUZZERS_ARMED');
    let boardUpdate = waitForState(boardClient, (s) => s.phase === 'BUZZERS_ARMED');
    let aliceUpdate = waitForState(alice, (s) => s.phase === 'BUZZERS_ARMED');
    let bobUpdate = waitForState(bob, (s) => s.phase === 'BUZZERS_ARMED');
    host.emit('rule_incorrect', { playerId: tokenA.playerId });
    const [rearmHost, rearmBoard, rearmAlice, rearmBob] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    expect((rearmHost as { phase: string }).phase).toBe('BUZZERS_ARMED');
    expect((rearmBoard as { phase: string }).phase).toBe('BUZZERS_ARMED');
    expect((rearmAlice as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(-100);
    expect((rearmBoard as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(-100);
    expect((rearmBob as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(-100);
    expect((rearmAlice as { isLockedOut: boolean }).isLockedOut).toBe(true);

    // Bob buzzes on the re-arm and is ruled correct.
    bob.emit('buzz', { playerId: tokenB.playerId });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    hostUpdate = waitForState(host);
    boardUpdate = waitForState(boardClient);
    aliceUpdate = waitForState(alice);
    bobUpdate = waitForState(bob);
    host.emit('rule_correct');
    const [finalHost, finalBoard, finalAlice, finalBob] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    expect((finalHost as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((finalBoard as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((finalAlice as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((finalBob as { phase: string }).phase).toBe('BOARD_SELECT');
    expect((finalHost as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(-100);
    expect((finalBoard as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenB.playerId)?.score).toBe(100);
    expect((finalAlice as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(-100);
    expect((finalBob as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenB.playerId)?.score).toBe(100);
    expect((finalHost as { controllingPlayerId: string | null }).controllingPlayerId).toBe(tokenB.playerId);
    expect((finalBoard as { controllingPlayerId: string | null }).controllingPlayerId).toBe(tokenB.playerId);
    expect((finalBob as { isControllingPlayer: boolean }).isControllingPlayer).toBe(true);
    expect((finalBoard as { answer: string | null }).answer).toBe('Water');
    expect((finalAlice as { answer: string | null }).answer).toBe('Water');

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });
});

describe('host score tools and undo sockets', () => {
  function makeScoreToolsBoardPayload() {
    return {
      name: 'Score Tools Socket Board',
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

  async function setupGame(server: Awaited<ReturnType<typeof createTestServer>>) {
    const board = await boardRepository.create(makeScoreToolsBoardPayload());
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

    const state = server.engine.getState(roomCode)!;
    const firstClue = state.board.rounds[0].clues[0];

    const hostStart = waitForState(host);
    const boardStart = waitForState(boardClient);
    const aliceStart = waitForState(alice);
    const bobStart = waitForState(bob);
    host.emit('select_clue', { clueId: firstClue.id });
    await Promise.all([hostStart, boardStart, aliceStart, bobStart]);

    return { host, boardClient, alice, bob, tokenA, tokenB, roomCode, firstClue };
  }

  it('adjust_score updates a contestant score on all roles', async () => {
    const server = await createTestServer();
    const { host, boardClient, alice, bob, tokenA } = await setupGame(server);

    const hostUpdate = waitForState(host);
    const boardUpdate = waitForState(boardClient);
    const aliceUpdate = waitForState(alice);
    const bobUpdate = waitForState(bob);

    host.emit('adjust_score', { playerId: tokenA.playerId, score: 500 });
    const [hostState, boardState, aliceState, bobState] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    expect((hostState as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(500);
    expect((boardState as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(500);
    expect((aliceState as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(500);
    expect((bobState as { players: { id: string; score: number }[] }).players.find((p) => p.id === tokenA.playerId)?.score).toBe(500);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('undo_last_ruling reverts the most recent correct ruling and restores control', async () => {
    const server = await createTestServer();
    const { host, boardClient, alice, bob, tokenA, tokenB, roomCode } = await setupGame(server);

    const state = server.engine.getState(roomCode)!;
    const controllerId = state.controllingPlayerId;
    const nonController = controllerId === tokenA.playerId ? bob : alice;
    const nonControllerId = controllerId === tokenA.playerId ? tokenB.playerId : tokenA.playerId;

    host.emit('arm_buzzers');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);
    nonController.emit('buzz', { playerId: nonControllerId });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);
    host.emit('rule_correct');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    const hostUpdate = waitForState(host);
    const boardUpdate = waitForState(boardClient);
    const aliceUpdate = waitForState(alice);
    const bobUpdate = waitForState(bob);

    host.emit('undo_last_ruling');
    const [hostState, boardState, aliceState, bobState] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    expect((hostState as { players: { id: string; score: number }[] }).players.find((p) => p.id === nonControllerId)?.score).toBe(0);
    expect((boardState as { players: { id: string; score: number }[] }).players.find((p) => p.id === nonControllerId)?.score).toBe(0);
    expect((aliceState as { players: { id: string; score: number }[] }).players.find((p) => p.id === nonControllerId)?.score).toBe(0);
    expect((bobState as { players: { id: string; score: number }[] }).players.find((p) => p.id === nonControllerId)?.score).toBe(0);
    expect((hostState as { controllingPlayerId: string | null }).controllingPlayerId).toBe(controllerId);
    expect((boardState as { controllingPlayerId: string | null }).controllingPlayerId).toBe(controllerId);
    expect((aliceState as { isControllingPlayer: boolean }).isControllingPlayer).toBe(controllerId === tokenA.playerId);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('undo_last_ruling is a safe no-op with no prior ruling', async () => {
    const server = await createTestServer();
    const { host, boardClient, alice, bob, tokenA } = await setupGame(server);

    const beforeState = await new Promise<Record<string, unknown>>((resolve) => {
      host.once('state', (data) => resolve(data as Record<string, unknown>));
      host.emit('arm_buzzers');
    });

    let errorReceived: { message: string } | null = null;
    host.on('error', (e) => {
      errorReceived = e as { message: string };
    });

    const ack = await waitForUndoAck(host);

    expect(ack).toEqual({ ok: true });
    expect(errorReceived).toBeNull();
    expect((beforeState.players as { id: string; score: number }[]).find((p) => p.id === tokenA.playerId)?.score).toBe(0);
    expect(server.engine.getState(beforeState.roomCode as string)?.players.find((p) => p.id === tokenA.playerId)?.score).toBe(0);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('undo_last_ruling is a safe no-op after a manual score adjustment', async () => {
    const server = await createTestServer();
    const { host, boardClient, alice, bob, tokenA } = await setupGame(server);

    const state = await new Promise<Record<string, unknown>>((resolve) => {
      host.once('state', (data) => resolve(data as Record<string, unknown>));
      host.emit('adjust_score', { playerId: tokenA.playerId, score: 500 });
    });

    let errorReceived: { message: string } | null = null;
    host.on('error', (e) => {
      errorReceived = e as { message: string };
    });

    const ack = await waitForUndoAck(host);

    expect(ack).toEqual({ ok: true });
    expect(errorReceived).toBeNull();
    expect((state.players as { id: string; score: number }[]).find((p) => p.id === tokenA.playerId)?.score).toBe(500);
    expect(server.engine.getState(state.roomCode as string)?.players.find((p) => p.id === tokenA.playerId)?.score).toBe(500);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('undo_last_ruling reverts only the ruling when a manual adjustment was made after it', async () => {
    const server = await createTestServer();
    const { host, boardClient, alice, bob, tokenA, tokenB, roomCode } = await setupGame(server);

    const state = server.engine.getState(roomCode)!;
    const controllerId = state.controllingPlayerId;
    const nonController = controllerId === tokenA.playerId ? bob : alice;
    const nonControllerId = controllerId === tokenA.playerId ? tokenB.playerId : tokenA.playerId;

    host.emit('arm_buzzers');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);
    nonController.emit('buzz', { playerId: nonControllerId });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);
    host.emit('rule_correct');
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    host.emit('adjust_score', { playerId: nonControllerId, score: 300 });
    await Promise.all([waitForState(host), waitForState(boardClient), waitForState(alice), waitForState(bob)]);

    const hostUpdate = waitForState(host);
    const boardUpdate = waitForState(boardClient);
    const aliceUpdate = waitForState(alice);
    const bobUpdate = waitForState(bob);

    host.emit('undo_last_ruling');
    const [hostState, boardState, aliceState, bobState] = await Promise.all([
      hostUpdate,
      boardUpdate,
      aliceUpdate,
      bobUpdate,
    ]);

    // The ruling delta is reverted, but the later manual adjustment remains.
    expect((hostState as { players: { id: string; score: number }[] }).players.find((p) => p.id === nonControllerId)?.score).toBe(200);
    expect((boardState as { players: { id: string; score: number }[] }).players.find((p) => p.id === nonControllerId)?.score).toBe(200);
    expect((aliceState as { players: { id: string; score: number }[] }).players.find((p) => p.id === nonControllerId)?.score).toBe(200);
    expect((bobState as { players: { id: string; score: number }[] }).players.find((p) => p.id === nonControllerId)?.score).toBe(200);
    expect((hostState as { controllingPlayerId: string | null }).controllingPlayerId).toBe(controllerId);
    expect((hostState as { auditLog: { type: string }[] }).auditLog.some((r) => r.type === 'MANUAL')).toBe(true);
    expect((hostState as { auditLog: { type: string }[] }).auditLog.some((r) => r.type === 'CORRECT' || r.type === 'INCORRECT')).toBe(false);

    host.disconnect();
    boardClient.disconnect();
    alice.disconnect();
    bob.disconnect();
    await server.close();
  });

  it('non-host cannot adjust scores or undo', async () => {
    const server = await createTestServer();
    const { host, alice, tokenA } = await setupGame(server);

    const aliceError = waitForError(alice);
    alice.emit('adjust_score', { playerId: tokenA.playerId, score: 500 });
    expect((await aliceError).message).toMatch(/only the host/i);

    const aliceError2 = waitForError(alice);
    alice.emit('undo_last_ruling');
    expect((await aliceError2).message).toMatch(/only the host/i);

    host.disconnect();
    alice.disconnect();
    await server.close();
  });
});
