import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { prisma } from '../repo/prisma.js';
import { boardRepository } from '../repo/board.js';
import { GameSessionStatus } from '@prisma/client';
import { closeTestServer, createTestServer, TestServer } from './test-server.js';

function authRequest() {
  return testServer.agent;
}

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer();
});

afterAll(async () => {
  await closeTestServer(testServer.server);
  await prisma.$disconnect();
});

function makeBoardPayload() {
  return {
    name: 'Game Test Board',
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

describe('POST /api/games', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a request with no Authorization header', async () => {
    
    const response = await request(testServer.server).post('/api/games').send({ boardId: 'any-id' }).expect(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('rejects a request with a forged bearer token', async () => {
    
    const response = await request(testServer.server)
      .post('/api/games')
      .set('Authorization', 'Bearer forged-token')
      .send({ boardId: 'any-id' })
      .expect(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('rejects an invalid payload with 400', async () => {
    
    const response = await authRequest().post('/api/games')
      .send({ boardId: 123 })
      .expect(400);
    expect(response.body.error).toBe('Invalid request body');
  });

  it('rejects a non-existent boardId with 404', async () => {
    
    const response = await authRequest().post('/api/games')
      .send({ boardId: 'non-existent-board-id' })
      .expect(404);
    expect(response.body.error).toBe('Board not found');
  });

  it('creates a GameSession with a unique short room code for a valid host', async () => {
    
    const created = await boardRepository.create(makeBoardPayload());

    const response = await authRequest().post('/api/games')
      .send({ boardId: created.id })
      .expect(201);

    expect(response.body.roomCode).toBeDefined();
    expect(response.body.roomCode).toMatch(/^[A-Z0-9]{4,6}$/);

    const session = await prisma.gameSession.findUnique({
      where: { roomCode: response.body.roomCode },
    });
    expect(session).not.toBeNull();
    expect(session?.status).toBe(GameSessionStatus.LOBBY);
    expect(session?.boardId).toBe(created.id);
    expect(session?.snapshot).toContain(created.id);
    expect(session?.snapshot).toContain(response.body.roomCode);
  });

  it('creates distinct room codes for two games from the same board', async () => {
    
    const created = await boardRepository.create(makeBoardPayload());

    const first = await authRequest().post('/api/games')
      .send({ boardId: created.id })
      .expect(201);
    const second = await authRequest().post('/api/games')
      .send({ boardId: created.id })
      .expect(201);

    expect(first.body.roomCode).not.toBe(second.body.roomCode);
  });

  it('rejects an empty board with no playable clues', async () => {
    
    const created = await boardRepository.create({
      name: 'Empty Board',
      includeDoubleJeopardy: false,
      defaultTimerSeconds: 10,
      finalTimerSeconds: 30,
      rounds: [],
    });

    const response = await authRequest().post('/api/games')
      .send({ boardId: created.id })
      .expect(400);

    expect(response.body.error).toMatch(/no playable clues/i);
  });
});

async function createGame(): Promise<string> {
  const board = await boardRepository.create(makeBoardPayload());
  const response = await authRequest().post('/api/games').send({ boardId: board.id }).expect(201);
  return response.body.roomCode as string;
}

describe('GET /api/games', () => {
  it('rejects a request with no Authorization header', async () => {
    const response = await request(testServer.server).get('/api/games').expect(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('lists created games with summary fields', async () => {
    const roomCode = await createGame();

    const response = await authRequest().get('/api/games').expect(200);
    const game = (response.body.games as Array<Record<string, unknown>>).find((g) => g.roomCode === roomCode);

    expect(game).toBeDefined();
    expect(game?.boardName).toBe('Game Test Board');
    expect(game?.status).toBe('LOBBY');
    expect(game?.archived).toBe(false);
    expect(game?.playerCount).toBe(0);
  });
});

describe('PATCH /api/games/:roomCode', () => {
  it('archives and unarchives a game', async () => {
    const roomCode = await createGame();

    await authRequest().patch(`/api/games/${roomCode}`).send({ archived: true }).expect(200);
    let response = await authRequest().get('/api/games').expect(200);
    let game = (response.body.games as Array<Record<string, unknown>>).find((g) => g.roomCode === roomCode);
    expect(game?.archived).toBe(true);

    await authRequest().patch(`/api/games/${roomCode}`).send({ archived: false }).expect(200);
    response = await authRequest().get('/api/games').expect(200);
    game = (response.body.games as Array<Record<string, unknown>>).find((g) => g.roomCode === roomCode);
    expect(game?.archived).toBe(false);
  });

  it('returns 400 for an invalid body', async () => {
    const roomCode = await createGame();
    const response = await authRequest().patch(`/api/games/${roomCode}`).send({ archived: 'yes' }).expect(400);
    expect(response.body.error).toBe('Invalid request body');
  });

  it('returns 404 for an unknown room code', async () => {
    const response = await authRequest().patch('/api/games/ZZZZ').send({ archived: true }).expect(404);
    expect(response.body.error).toBe('Game not found');
  });
});

describe('DELETE /api/games/:roomCode', () => {
  it('deletes a game so it no longer appears in the list', async () => {
    const roomCode = await createGame();

    await authRequest().delete(`/api/games/${roomCode}`).expect(204);

    const response = await authRequest().get('/api/games').expect(200);
    const game = (response.body.games as Array<Record<string, unknown>>).find((g) => g.roomCode === roomCode);
    expect(game).toBeUndefined();

    const session = await prisma.gameSession.findUnique({ where: { roomCode } });
    expect(session).toBeNull();
  });

  it('returns 404 for an unknown room code', async () => {
    const response = await authRequest().delete('/api/games/ZZZZ').expect(404);
    expect(response.body.error).toBe('Game not found');
  });
});
