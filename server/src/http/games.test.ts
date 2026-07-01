import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { prisma } from '../repo/prisma.js';
import { mintHostToken } from '../auth/token.js';
import { boardRepository } from '../repo/board.js';
import { GameSessionStatus } from '@prisma/client';

function authHeader(token?: string) {
  return `Bearer ${token ?? mintHostToken()}`;
}

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
  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a request with no Authorization header', async () => {
    const app = createApp();
    const response = await request(app).post('/api/games').send({ boardId: 'any-id' }).expect(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('rejects a request with a forged bearer token', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/games')
      .set('Authorization', 'Bearer forged-token')
      .send({ boardId: 'any-id' })
      .expect(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('rejects an invalid payload with 400', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/games')
      .set('Authorization', authHeader())
      .send({ boardId: 123 })
      .expect(400);
    expect(response.body.error).toBe('Invalid request body');
  });

  it('rejects a non-existent boardId with 404', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/games')
      .set('Authorization', authHeader())
      .send({ boardId: 'non-existent-board-id' })
      .expect(404);
    expect(response.body.error).toBe('Board not found');
  });

  it('creates a GameSession with a unique short room code for a valid host', async () => {
    const app = createApp();
    const created = await boardRepository.create(makeBoardPayload());

    const response = await request(app)
      .post('/api/games')
      .set('Authorization', authHeader())
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
    const app = createApp();
    const created = await boardRepository.create(makeBoardPayload());

    const first = await request(app)
      .post('/api/games')
      .set('Authorization', authHeader())
      .send({ boardId: created.id })
      .expect(201);
    const second = await request(app)
      .post('/api/games')
      .set('Authorization', authHeader())
      .send({ boardId: created.id })
      .expect(201);

    expect(first.body.roomCode).not.toBe(second.body.roomCode);
  });
});
