import { afterAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ClientIo, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../http/app.js';
import { GameEngine } from '../engine/game.js';
import { prisma } from '../repo/prisma.js';
import { boardRepository } from '../repo/board.js';
import * as passcode from '../auth/passcode.js';
import { registerGameSockets } from './game.js';

function makeBoardPayload() {
  return {
    name: 'Reconnect Test Board',
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
            ],
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

describe('reconnect token verification', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('accepts a valid reconnect token and rejoins the same slot', async () => {
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

  it('rejects an incorrect reconnect token', async () => {
    const server = await createTestServer();
    const board = await boardRepository.create(makeBoardPayload());
    const { roomCode } = await server.engine.createSession(board.id);

    const alice = connectClient(server.url);
    await waitForConnect(alice);
    const tokenPromise = waitForToken(alice);
    alice.emit('join', { role: 'contestant', roomCode, name: 'Alice' });
    await tokenPromise;
    alice.disconnect();

    const rejoin = connectClient(server.url);
    await waitForConnect(rejoin);
    const errorPromise = waitForError(rejoin);
    rejoin.emit('join', { role: 'contestant', roomCode, reconnectToken: 'not-a-real-token' });
    const error = await errorPromise;

    expect(error.message).toMatch(/invalid reconnect token/i);

    rejoin.disconnect();
    await server.close();
  });

  it('uses constant-time comparison instead of direct string equality for reconnect tokens', async () => {
    const spy = vi.spyOn(passcode, 'constantTimeCompare');
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
    const state = (await statePromise) as { playerId: string };

    expect(state.playerId).toBe(token.playerId);
    const storedToken = server.engine.getState(roomCode)?.players.find((p) => p.id === token.playerId)
      ?.reconnectToken;
    expect(storedToken).toBeDefined();
    expect(spy).toHaveBeenCalledWith(token.reconnectToken, storedToken);

    spy.mockRestore();
    rejoin.disconnect();
    await server.close();
  });
});
