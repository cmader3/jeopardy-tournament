import { describe, expect, it } from 'vitest';
import { createInitialState } from '../reducer/index.js';
import { projectBoard, projectHost, projectContestant } from './index.js';
import type { Board, GameState, Player } from '../models/index.js';

const NOW = 1_000_000;

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    score: 100,
    seatOrder: 0,
    connected: true,
    reconnectToken: 'token-alice',
    ...overrides,
  };
}

function makeBoard(): Board {
  return {
    id: 'b1',
    name: 'Test Board',
    includeDoubleJeopardy: true,
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
                clueText: 'H2O',
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
            clueText: 'H2O',
            answer: 'Water',
            isDailyDouble: false,
          },
        ],
      },
      {
        id: 'r2',
        type: 'DOUBLE_JEOPARDY',
        order: 1,
        categories: [
          {
            id: 'c2',
            roundId: 'r2',
            title: 'Arts',
            order: 0,
            clues: [
              {
                id: 'cl2',
                categoryId: 'c2',
                row: 0,
                value: 200,
                clueText: 'Brush',
                answer: 'Brush',
                isDailyDouble: false,
              },
            ],
          },
        ],
        clues: [
          {
            id: 'cl2',
            categoryId: 'c2',
            row: 0,
            value: 200,
            clueText: 'Brush',
            answer: 'Brush',
            isDailyDouble: false,
          },
        ],
      },
      {
        id: 'r3',
        type: 'FINAL',
        order: 2,
        categories: [
          {
            id: 'c3',
            roundId: 'r3',
            title: 'Literature',
            order: 0,
            clues: [
              {
                id: 'cl-final',
                categoryId: 'c3',
                row: 0,
                value: null,
                clueText: 'Hobbit',
                answer: 'Tolkien',
                isDailyDouble: false,
              },
            ],
          },
        ],
        clues: [
          {
            id: 'cl-final',
            categoryId: 'c3',
            row: 0,
            value: null,
            clueText: 'Hobbit',
            answer: 'Tolkien',
            isDailyDouble: false,
          },
        ],
      },
    ],
  };
}

describe('round transition projections', () => {
  it('roundComplete is false while clues remain in the current round', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);

    const boardView = projectBoard({ ...state, phase: 'BOARD_SELECT' }, NOW);
    const hostView = projectHost({ ...state, phase: 'BOARD_SELECT' }, NOW);
    const contestantView = projectContestant({ ...state, phase: 'BOARD_SELECT' }, NOW, 'p1');

    expect(boardView.roundComplete).toBe(false);
    expect(hostView.roundComplete).toBe(false);
    expect(contestantView.roundComplete).toBe(false);
  });

  it('roundComplete is true when all current round clues are used', () => {
    const board = makeBoard();
    const state: GameState = {
      ...createInitialState('s1', 'ABCD', board),
      phase: 'BOARD_SELECT',
      usedClueIds: ['cl1'],
    };

    const boardView = projectBoard(state, NOW);
    const hostView = projectHost(state, NOW);
    const contestantView = projectContestant(state, NOW, 'p1');

    expect(boardView.roundComplete).toBe(true);
    expect(hostView.roundComplete).toBe(true);
    expect(contestantView.roundComplete).toBe(true);
  });

  it('projection includes transitionTarget during ROUND_TRANSITION', () => {
    const board = makeBoard();
    const state: GameState = {
      ...createInitialState('s1', 'ABCD', board),
      phase: 'ROUND_TRANSITION',
      transitionTarget: 'DOUBLE_JEOPARDY',
      usedClueIds: ['cl1'],
    };

    const boardView = projectBoard(state, NOW);
    const hostView = projectHost(state, NOW);
    const contestantView = projectContestant(state, NOW, 'p1');

    expect(boardView.transitionTarget).toBe('DOUBLE_JEOPARDY');
    expect(hostView.transitionTarget).toBe('DOUBLE_JEOPARDY');
    expect(contestantView.transitionTarget).toBe('DOUBLE_JEOPARDY');
  });

  it('projection keeps transitionTarget null outside ROUND_TRANSITION', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);

    const boardView = projectBoard(state, NOW);
    const hostView = projectHost(state, NOW);
    const contestantView = projectContestant(state, NOW, 'p1');

    expect(boardView.transitionTarget).toBeNull();
    expect(hostView.transitionTarget).toBeNull();
    expect(contestantView.transitionTarget).toBeNull();
  });

  it('ROUND_TRANSITION projection carries current scores without leaking answers', () => {
    const board = makeBoard();
    const state: GameState = {
      ...createInitialState('s1', 'ABCD', board),
      phase: 'ROUND_TRANSITION',
      transitionTarget: 'FINAL',
      usedClueIds: ['cl1'],
      players: [makePlayer({ id: 'p1', name: 'Alice', score: 250 }), makePlayer({ id: 'p2', name: 'Bob', score: -100 })],
    };

    const boardView = projectBoard(state, NOW);
    expect(boardView.players).toEqual([
      { id: 'p1', name: 'Alice', score: 250, connected: true },
      { id: 'p2', name: 'Bob', score: -100, connected: true },
    ]);
    expect(boardView.transitionTarget).toBe('FINAL');
  });

  it('projecting the next round shows its own categories, doubled values, and unspent cells', () => {
    const board = makeBoard();
    const state: GameState = {
      ...createInitialState('s1', 'ABCD', board),
      phase: 'BOARD_SELECT',
      roundIndex: 1,
      usedClueIds: ['cl1'],
      players: [makePlayer({ id: 'p1', name: 'Alice', score: 100 }), makePlayer({ id: 'p2', name: 'Bob', score: 200 })],
    };

    const boardView = projectBoard(state, NOW);
    expect(boardView.round?.type).toBe('DOUBLE_JEOPARDY');
    expect(boardView.round?.categories).toHaveLength(1);
    expect(boardView.round?.categories[0].title).toBe('Arts');
    expect(boardView.round?.categories[0].clues[0].value).toBe(200);
    expect(boardView.roundComplete).toBe(false);
  });
});
