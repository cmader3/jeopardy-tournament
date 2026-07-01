import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine, mapBoardToShared } from './game.js';
import { prisma } from '../repo/prisma.js';
import { boardRepository } from '../repo/board.js';
import { gameSessionRepository } from '../repo/session.js';
import { GameSessionStatus } from '@prisma/client';
import type { BoardWithRounds } from '../repo/board.js';
import type { Player } from '@jeopardy/shared';

function makeBoardPayload() {
  return {
    name: 'Engine Test Board',
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

function makePlayer(id: string, name: string, seatOrder: number): Player {
  return {
    id,
    name,
    score: 0,
    seatOrder,
    connected: true,
    reconnectToken: `token-${id}`,
  };
}

describe('GameEngine', () => {
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

  it('creates a session and persists a LOBBY snapshot', async () => {
    const board = await boardRepository.create(makeBoardPayload());
    const engine = new GameEngine();

    const result = await engine.createSession(board.id);

    expect(result.roomCode).toMatch(/^[A-Z0-9]{4}$/);
    expect(result.state.phase).toBe('LOBBY');
    expect(result.state.players).toEqual([]);

    const persisted = await prisma.gameSession.findUnique({ where: { roomCode: result.roomCode } });
    expect(persisted).not.toBeNull();
    expect(persisted?.status).toBe(GameSessionStatus.LOBBY);
    expect(persisted?.snapshot).toContain(result.roomCode);
  });

  it('applies JOIN and persists an updated snapshot', async () => {
    const board = await boardRepository.create(makeBoardPayload());
    const engine = new GameEngine();
    const { roomCode } = await engine.createSession(board.id);

    const broadcast = vi.fn();
    engine.broadcast = broadcast;

    const result = await engine.addPlayer(roomCode, makePlayer('p1', 'Alice', 0));

    expect(result.state.players).toHaveLength(1);
    expect(result.state.players[0].name).toBe('Alice');
    expect(broadcast).toHaveBeenCalledWith(roomCode, expect.objectContaining({ roomCode }));

    const persisted = await prisma.gameSession.findUnique({ where: { roomCode } });
    expect(persisted?.snapshot).toContain('Alice');
  });

  it('rehydrates active sessions on load', async () => {
    const board = await boardRepository.create(makeBoardPayload());
    const engine = new GameEngine();
    const { roomCode } = await engine.createSession(board.id);
    await engine.addPlayer(roomCode, makePlayer('p1', 'Alice', 0));

    const freshEngine = new GameEngine();
    await freshEngine.loadActiveSessions();

    const state = freshEngine.getState(roomCode);
    expect(state).toBeDefined();
    expect(state?.players).toHaveLength(1);
    expect(state?.players[0].name).toBe('Alice');
  });

  it('does not rehydrate abandoned or complete sessions', async () => {
    const board = await boardRepository.create(makeBoardPayload());
    const engine = new GameEngine();
    const { roomCode } = await engine.createSession(board.id);
    await gameSessionRepository.updateStatus(
      (await prisma.gameSession.findUnique({ where: { roomCode } }))!.id,
      GameSessionStatus.ABANDONED,
    );

    const freshEngine = new GameEngine();
    await freshEngine.loadActiveSessions();

    expect(freshEngine.getState(roomCode)).toBeUndefined();
  });

  it('rejects a board with no playable clues', async () => {
    const board = await boardRepository.create({
      name: 'Empty Board',
      includeDoubleJeopardy: false,
      defaultTimerSeconds: 10,
      finalTimerSeconds: 30,
      rounds: [],
    });
    const engine = new GameEngine();

    await expect(engine.createSession(board.id)).rejects.toThrow('Board has no playable clues');
  });

  it('maps a BoardWithRounds to a shared Board with flat round clues', () => {
    const board = {
      id: 'b1',
      name: 'Map Test',
      includeDoubleJeopardy: false,
      defaultTimerSeconds: 10,
      finalTimerSeconds: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
      isComplete: true,
      rounds: [
        {
          id: 'r1',
          boardId: 'b1',
          type: 'JEOPARDY' as const,
          order: 0,
          categories: [
            {
              id: 'c1',
              roundId: 'r1',
              title: 'Science',
              order: 0,
              clues: [
                {
                  id: 'cl1',
                  categoryId: 'c1',
                  value: 100,
                  row: 0,
                  clueText: 'H2O',
                  answer: 'Water',
                  isDailyDouble: false,
                },
              ],
            },
          ],
        },
      ],
    } satisfies BoardWithRounds;

    const shared = mapBoardToShared(board);
    expect(shared.rounds).toHaveLength(1);
    expect(shared.rounds[0].clues).toHaveLength(1);
    expect(shared.rounds[0].categories[0].clues).toHaveLength(1);
    expect(shared.rounds[0].clues[0].answer).toBe('Water');
  });
});
