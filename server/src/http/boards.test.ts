import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { prisma } from '../repo/prisma.js';
import { mintHostToken } from '../auth/token.js';

function authHeader() {
  return `Bearer ${mintHostToken()}`;
}

function authRequest(app: Parameters<typeof request>[0]) {
  return request.agent(app).set('Authorization', authHeader());
}

function makeBoardPayload() {
  return {
    name: 'Test Board',
    includeDoubleJeopardy: true,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 45,
    rounds: [
      {
        type: 'JEOPARDY',
        order: 0,
        categories: [
          {
            title: 'Science',
            order: 0,
            clues: [
              { value: 100, row: 0, clueText: 'The chemical symbol for water', answer: 'H2O', isDailyDouble: false },
              { value: 200, row: 1, clueText: 'The speed of light in a vacuum', answer: '299,792,458 m/s', isDailyDouble: false },
            ],
          },
          {
            title: 'History',
            order: 1,
            clues: [
              { value: 100, row: 0, clueText: 'The year the Berlin Wall fell', answer: '1989', isDailyDouble: true },
              { value: 200, row: 1, clueText: 'The first US president', answer: 'George Washington', isDailyDouble: false },
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
              { value: null, row: 0, clueText: 'He wrote "The Hobbit"', answer: 'J.R.R. Tolkien', isDailyDouble: false },
            ],
          },
        ],
      },
    ],
  };
}

describe('Boards REST API', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/boards', () => {
    it('creates a board with nested rounds, categories, and clues', async () => {
      const app = createApp();
      const payload = makeBoardPayload();

      const response = await authRequest(app).post('/api/boards').send(payload).expect(201);

      expect(response.body).toMatchObject({
        name: payload.name,
        includeDoubleJeopardy: payload.includeDoubleJeopardy,
        defaultTimerSeconds: payload.defaultTimerSeconds,
        finalTimerSeconds: payload.finalTimerSeconds,
      });
      expect(response.body.id).toBeDefined();
      expect(response.body.rounds).toHaveLength(2);

      const jeopardyRound = response.body.rounds.find((r: { type: string }) => r.type === 'JEOPARDY');
      expect(jeopardyRound.categories).toHaveLength(2);
      expect(jeopardyRound.categories[0].clues).toHaveLength(2);
      expect(jeopardyRound.categories[0].clues[0].answer).toBe('H2O');
      expect(jeopardyRound.categories[1].clues[0].isDailyDouble).toBe(true);

      const finalRound = response.body.rounds.find((r: { type: string }) => r.type === 'FINAL');
      expect(finalRound.categories).toHaveLength(1);
      expect(finalRound.categories[0].clues[0].value).toBeNull();
    });

    it('rejects an invalid payload with a 400 error', async () => {
      const app = createApp();
      const response = await authRequest(app).post('/api/boards').send({ name: '' }).expect(400);

      expect(response.body.error).toBe('Invalid request body');
      expect(response.body.details).toBeDefined();
      expect(response.body.details.length).toBeGreaterThan(0);
    });

    it('rejects a clue with a negative row number', async () => {
      const app = createApp();
      const payload = makeBoardPayload();
      payload.rounds[0].categories[0].clues[0].row = -1;

      const response = await authRequest(app).post('/api/boards').send(payload).expect(400);

      expect(response.body.error).toBe('Invalid request body');
      expect(response.body.details.some((d: { path: string }) => d.path.includes('row'))).toBe(true);
    });
  });

  describe('GET /api/boards', () => {
    it('returns an empty list when no boards exist', async () => {
      const app = createApp();
      const response = await authRequest(app).get('/api/boards').expect(200);

      expect(response.body).toEqual([]);
    });

    it('lists all saved boards without nested content', async () => {
      const app = createApp();
      const payload = makeBoardPayload();
      await authRequest(app).post('/api/boards').send(payload).expect(201);

      const response = await authRequest(app).get('/api/boards').expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe(payload.name);
      expect(response.body[0].rounds).toBeUndefined();
    });
  });

  describe('GET /api/boards/:id', () => {
    it('returns a board with nested rounds, categories, and clues', async () => {
      const app = createApp();
      const created = await authRequest(app).post('/api/boards').send(makeBoardPayload()).expect(201);

      const response = await authRequest(app).get(`/api/boards/${created.body.id}`).expect(200);

      expect(response.body.id).toBe(created.body.id);
      expect(response.body.rounds).toHaveLength(2);
      expect(response.body.rounds[0].categories[0].clues[0].clueText).toBe(
        'The chemical symbol for water'
      );
    });

    it('returns 404 for an unknown board id', async () => {
      const app = createApp();
      const response = await authRequest(app).get('/api/boards/unknown-id').expect(404);

      expect(response.body.error).toBe('Board not found');
    });
  });

  describe('PUT /api/boards/:id', () => {
    it('updates a board, replacing nested content', async () => {
      const app = createApp();
      const created = await authRequest(app).post('/api/boards').send(makeBoardPayload()).expect(201);
      const originalClueId = created.body.rounds[0].categories[0].clues[0].id;

      const updatePayload = {
        name: 'Updated Board',
        includeDoubleJeopardy: false,
        defaultTimerSeconds: 15,
        finalTimerSeconds: 60,
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [
              {
                title: 'Updated Category',
                order: 0,
                clues: [
                  { value: 300, row: 0, clueText: 'Updated clue', answer: 'Updated answer', isDailyDouble: false },
                ],
              },
            ],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Updated Final',
                order: 0,
                clues: [
                  { value: null, row: 0, clueText: 'Updated final clue', answer: 'Updated final answer', isDailyDouble: false },
                ],
              },
            ],
          },
        ],
      };

      const response = await authRequest(app).put(`/api/boards/${created.body.id}`).send(updatePayload).expect(200);

      expect(response.body.name).toBe('Updated Board');
      expect(response.body.includeDoubleJeopardy).toBe(false);
      expect(response.body.defaultTimerSeconds).toBe(15);
      expect(response.body.finalTimerSeconds).toBe(60);
      expect(response.body.rounds).toHaveLength(2);

      const jeopardyRound = response.body.rounds.find((r: { type: string }) => r.type === 'JEOPARDY');
      expect(jeopardyRound.categories).toHaveLength(1);
      expect(jeopardyRound.categories[0].title).toBe('Updated Category');
      expect(jeopardyRound.categories[0].clues[0].clueText).toBe('Updated clue');
      expect(jeopardyRound.categories[0].clues[0].id).not.toBe(originalClueId);
    });

    it('returns 404 when updating a non-existent board', async () => {
      const app = createApp();
      const response = await authRequest(app).put('/api/boards/non-existent').send(makeBoardPayload()).expect(404);

      expect(response.body.error).toBe('Board not found');
    });

    it('rejects an invalid payload with a 400 error', async () => {
      const app = createApp();
      const created = await authRequest(app).post('/api/boards').send(makeBoardPayload()).expect(201);

      const response = await authRequest(app)
        .put(`/api/boards/${created.body.id}`)
        .send({ name: 'Bad', rounds: [{ type: 'JEOPARDY', order: 0, categories: [{ title: '', order: 0, clues: [] }] }] })
        .expect(400);

      expect(response.body.error).toBe('Invalid request body');
    });

    it('rejects non-positive timer values with a 400 error', async () => {
      const app = createApp();
      const created = await authRequest(app).post('/api/boards').send(makeBoardPayload()).expect(201);

      const payload = makeBoardPayload();
      payload.defaultTimerSeconds = 0;

      const response = await authRequest(app).put(`/api/boards/${created.body.id}`).send(payload).expect(400);

      expect(response.body.error).toBe('Invalid request body');
      expect(response.body.details.some((d: { path: string }) => d.path.includes('defaultTimerSeconds'))).toBe(true);
    });

    it('allows clues with empty text and answer to represent blank cells', async () => {
      const app = createApp();
      const created = await authRequest(app).post('/api/boards').send(makeBoardPayload()).expect(201);

      const payload = makeBoardPayload();
      payload.rounds[0].categories[0].clues[0].clueText = '';
      payload.rounds[0].categories[0].clues[0].answer = '';

      const response = await authRequest(app).put(`/api/boards/${created.body.id}`).send(payload).expect(200);

      expect(response.body.rounds[0].categories[0].clues[0].clueText).toBe('');
      expect(response.body.rounds[0].categories[0].clues[0].answer).toBe('');
    });
  });

  describe('DELETE /api/boards/:id', () => {
    it('deletes a board and its nested content', async () => {
      const app = createApp();
      const created = await authRequest(app).post('/api/boards').send(makeBoardPayload()).expect(201);

      await authRequest(app).delete(`/api/boards/${created.body.id}`).expect(200);

      const response = await authRequest(app).get(`/api/boards/${created.body.id}`).expect(404);
      expect(response.body.error).toBe('Board not found');

      const rounds = await prisma.round.findMany({ where: { boardId: created.body.id } });
      expect(rounds).toHaveLength(0);
    });

    it('does not cascade-delete an active game session when the board is deleted', async () => {
      const app = createApp();
      const created = await authRequest(app).post('/api/boards').send(makeBoardPayload()).expect(201);

      await prisma.gameSession.create({
        data: {
          roomCode: 'TEST01',
          boardId: created.body.id,
          status: 'LOBBY',
          snapshot: '{}',
          players: {
            create: [
              {
                name: 'Alice',
                score: 0,
                seatOrder: 0,
                reconnectToken: 'token-1',
              },
            ],
          },
        },
      });

      const response = await authRequest(app).delete(`/api/boards/${created.body.id}`).expect(409);
      expect(response.body.error).toMatch(/active game session/);

      const session = await prisma.gameSession.findUnique({ where: { roomCode: 'TEST01' } });
      expect(session).not.toBeNull();

      const players = await prisma.player.findMany({ where: { gameSessionId: session!.id } });
      expect(players).toHaveLength(1);
    });
  });
});
