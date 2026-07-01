import { describe, expect, it } from 'vitest';
import { createInitialState } from '../reducer/index.js';
import { projectBoard, projectHost, projectContestant } from './index.js';
import type { Board, Player } from '../models/index.js';

function makeBoard(): Board {
  return {
    id: 'b1',
    name: 'Test Board',
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

describe('projections', () => {
  it('projectBoard exposes public state without answers or secrets', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);
    const view = projectBoard(state);

    expect(view.roomCode).toBe('ABCD');
    expect(view.phase).toBe('LOBBY');
    expect(view.players).toEqual([]);
    expect(view.currentClueId).toBeNull();
    expect(view.buzzWinnerId).toBeNull();
    expect(view.deadline).toBeNull();
    expect(view).not.toHaveProperty('answer');
    expect(view).not.toHaveProperty('finalWagers');
    expect(view).not.toHaveProperty('finalAnswers');
  });

  it('projectBoard includes player connection status', () => {
    const board = makeBoard();
    let state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice', connected: true });
    const bob = makePlayer({ id: 'p2', name: 'Bob', connected: false, reconnectToken: 'token-bob' });
    state = {
      ...state,
      players: [alice, bob],
    };

    const view = projectBoard(state);

    expect(view.players).toEqual([
      { id: 'p1', name: 'Alice', score: 0, connected: true },
      { id: 'p2', name: 'Bob', score: 0, connected: false },
    ]);
  });

  it('projectHost includes the current clue answer but never leaks future clues', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);
    const view = projectHost(state);

    expect(view.answer).toBeNull();

    const withClue = { ...state, currentClueId: 'cl1' };
    const hostView = projectHost(withClue);

    expect(hostView.answer).toBe('Water');
    expect(hostView).not.toHaveProperty('finalWagers');
    expect(hostView).not.toHaveProperty('finalAnswers');
  });

  it('projectContestant never includes answers or other secrets', () => {
    const board = makeBoard();
    let state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = { ...state, players: [alice], currentClueId: 'cl1' };

    const view = projectContestant(state, alice.id);

    expect(view.playerId).toBe(alice.id);
    expect(view.isControllingPlayer).toBe(false);
    expect(view).not.toHaveProperty('answer');
    expect(view).not.toHaveProperty('finalWagers');
    expect(view).not.toHaveProperty('finalAnswers');
  });
});
