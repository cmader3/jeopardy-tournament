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
});
