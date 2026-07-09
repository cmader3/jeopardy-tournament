import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine, mapBoardToShared, AUTO_ARCHIVE_AFTER_MS } from './game.js';
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

  it('rehydrates active sessions on load and marks players disconnected', async () => {
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
    expect(state?.players[0].connected).toBe(false);
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

  it('lists sessions with summary fields', async () => {
    const board = await boardRepository.create(makeBoardPayload());
    const engine = new GameEngine();
    const { roomCode } = await engine.createSession(board.id);

    const summaries = await engine.listSessions();
    const summary = summaries.find((s) => s.roomCode === roomCode);

    expect(summary).toBeDefined();
    expect(summary?.boardName).toBe('Engine Test Board');
    expect(summary?.status).toBe('LOBBY');
    expect(summary?.archived).toBe(false);
    expect(summary?.playerCount).toBe(0);
  });

  it('auto-archives a game that completed over an hour ago', async () => {
    const board = await boardRepository.create(makeBoardPayload());
    const engine = new GameEngine();
    const { roomCode, state } = await engine.createSession(board.id);

    const now = Date.now();
    const completed = { ...state, phase: 'COMPLETE', completedAt: now - AUTO_ARCHIVE_AFTER_MS - 1000 };
    await gameSessionRepository.updateSnapshot(state.sessionId, JSON.stringify(completed));

    const summaries = await engine.listSessions(now);
    const summary = summaries.find((s) => s.roomCode === roomCode);
    expect(summary?.status).toBe('COMPLETE');
    expect(summary?.archived).toBe(true);
  });

  it('does not auto-archive a game that completed recently', async () => {
    const board = await boardRepository.create(makeBoardPayload());
    const engine = new GameEngine();
    const { roomCode, state } = await engine.createSession(board.id);

    const now = Date.now();
    const completed = { ...state, phase: 'COMPLETE', completedAt: now - 1000 };
    await gameSessionRepository.updateSnapshot(state.sessionId, JSON.stringify(completed));

    const summaries = await engine.listSessions(now);
    expect(summaries.find((s) => s.roomCode === roomCode)?.archived).toBe(false);
  });

  it('archives then unarchives a session, clearing completion on unarchive', async () => {
    const board = await boardRepository.create(makeBoardPayload());
    const engine = new GameEngine();
    const { roomCode } = await engine.createSession(board.id);

    await engine.setArchived(roomCode, true);
    let summaries = await engine.listSessions();
    expect(summaries.find((s) => s.roomCode === roomCode)?.archived).toBe(true);

    await engine.setArchived(roomCode, false);
    summaries = await engine.listSessions();
    const summary = summaries.find((s) => s.roomCode === roomCode);
    expect(summary?.archived).toBe(false);
    expect(summary?.completedAt).toBeNull();
  });

  it('deletes a session from memory and storage', async () => {
    const board = await boardRepository.create(makeBoardPayload());
    const engine = new GameEngine();
    const { roomCode } = await engine.createSession(board.id);

    await engine.deleteSession(roomCode);

    expect(engine.getState(roomCode)).toBeUndefined();
    const summaries = await engine.listSessions();
    expect(summaries.find((s) => s.roomCode === roomCode)).toBeUndefined();
  });

  it('loads a session on demand into a fresh engine', async () => {
    const board = await boardRepository.create(makeBoardPayload());
    const engine = new GameEngine();
    const { roomCode } = await engine.createSession(board.id);

    const freshEngine = new GameEngine();
    expect(freshEngine.getState(roomCode)).toBeUndefined();
    await freshEngine.ensureSessionLoaded(roomCode);
    expect(freshEngine.getState(roomCode)).toBeDefined();
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
