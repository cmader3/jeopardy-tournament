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

function waitForState(client: ClientSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.once('state', (data) => resolve(data as Record<string, unknown>));
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
    expect(state).not.toHaveProperty('answer');

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
    expect(state).not.toHaveProperty('answer');
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
    expect(stateA).toEqual(stateB);
    expect((stateA as { players: unknown[] }).players).toHaveLength(0);
    expect(stateA).not.toHaveProperty('answer');

    const updateAPromise = waitForState(boardA);
    const updateBPromise = waitForState(boardB);

    const contestant = connectClient(server.url);
    await waitForConnect(contestant);
    contestant.emit('join', { role: 'contestant', roomCode, name: 'Alice' });

    const [updateA, updateB] = await Promise.all([updateAPromise, updateBPromise]);
    expect(updateA).toEqual(updateB);
    expect((updateA as { players: { name: string }[] }).players).toHaveLength(1);
    expect((updateA as { players: { name: string }[] }).players[0].name).toBe('Alice');
    expect(updateA).not.toHaveProperty('answer');

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
