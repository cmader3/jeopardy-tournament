import { describe, expect, it } from 'vitest';
import { createInitialState, reduce } from './index.js';
import type { Board, GameState, Player } from '../models/index.js';

const NOW = 1_000_000;

function makeBoard(): Board {
  return {
    id: 'b1',
    name: 'Final Test Board',
    includeDoubleJeopardy: false,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    rounds: [
      {
        id: 'r1',
        type: 'JEOPARDY',
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
                row: 0,
                value: 100,
                clueText: 'H2O is this compound',
                answer: 'Water',
                isDailyDouble: false,
              },
            ],
          },
        ],
        clues: [
          {
            id: 'cl1',
            categoryId: 'c1',
            row: 0,
            value: 100,
            clueText: 'H2O is this compound',
            answer: 'Water',
            isDailyDouble: false,
          },
        ],
      },
      {
        id: 'r2',
        type: 'FINAL',
        order: 1,
        categories: [
          {
            id: 'c2',
            roundId: 'r2',
            title: 'Literature',
            order: 0,
            clues: [
              {
                id: 'cl-final',
                categoryId: 'c2',
                row: 0,
                value: null,
                clueText: 'He wrote The Hobbit',
                answer: 'J.R.R. Tolkien',
                isDailyDouble: false,
              },
            ],
          },
        ],
        clues: [
          {
            id: 'cl-final',
            categoryId: 'c2',
            row: 0,
            value: null,
            clueText: 'He wrote The Hobbit',
            answer: 'J.R.R. Tolkien',
            isDailyDouble: false,
          },
        ],
      },
    ],
  };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    score: 0,
    seatOrder: 0,
    connected: true,
    reconnectToken: 'token-alice',
    ...overrides,
  };
}

function setupFinalIntro(scores: Record<string, number>): GameState {
  const board = makeBoard();
  const players = Object.entries(scores).map(([id, score], index) =>
    makePlayer({ id, name: id === 'p1' ? 'Alice' : id === 'p2' ? 'Bob' : 'Carol', score, seatOrder: index }),
  );
  return {
    ...createInitialState('session-1', 'ABCD', board),
    phase: 'FINAL_INTRO',
    roundIndex: 1,
    players,
  };
}

describe('OPEN_FINAL_WAGERS', () => {
  it('transitions from FINAL_INTRO to FINAL_WAGER when at least one contestant has a positive score', () => {
    const state = setupFinalIntro({ p1: 100, p2: 0, p3: -50 });

    const result = reduce(state, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('FINAL_WAGER');
    expect(result.state.finalNoEligiblePlayers).toBe(false);
  });

  it('transitions to COMPLETE when every contestant has a score of zero or below', () => {
    const state = setupFinalIntro({ p1: 0, p2: -100 });

    const result = reduce(state, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('COMPLETE');
    expect(result.state.finalNoEligiblePlayers).toBe(true);
  });

  it('still plays Final when exactly one contestant is eligible', () => {
    const state = setupFinalIntro({ p1: 200, p2: 0, p3: -100 });

    const result = reduce(state, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW });

    expect(result.state.phase).toBe('FINAL_WAGER');
    expect(result.state.finalNoEligiblePlayers).toBe(false);
  });

  it('is rejected outside of FINAL_INTRO', () => {
    const board = makeBoard();
    const state = { ...createInitialState('session-1', 'ABCD', board), phase: 'BOARD_SELECT' as const };

    const result = reduce(state, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('right now') });
    expect(result.state.phase).toBe('BOARD_SELECT');
  });

  it('carries existing scores into the Final phase unchanged', () => {
    const state = setupFinalIntro({ p1: 300, p2: 100, p3: -50 });

    const result = reduce(state, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW });

    expect(result.state.players.map((p) => ({ id: p.id, score: p.score }))).toEqual([
      { id: 'p1', score: 300 },
      { id: 'p2', score: 100 },
      { id: 'p3', score: -50 },
    ]);
  });
});
