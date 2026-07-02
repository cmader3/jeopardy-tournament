import { describe, expect, it } from 'vitest';
import { createInitialState } from '../reducer/index.js';
import { projectBoard, projectContestant, projectHost } from './index.js';
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

describe('Final intro projections', () => {
  it('projectBoard exposes the Final category title during FINAL_INTRO', () => {
    const state = setupFinalIntro({ p1: 100, p2: 0 });

    const view = projectBoard(state, NOW);

    expect(view.round).not.toBeNull();
    expect(view.round?.type).toBe('FINAL');
    expect(view.round?.categories).toHaveLength(1);
    expect(view.round?.categories[0].title).toBe('Literature');
  });

  it('projectBoard hides the Final clue text and answer during FINAL_INTRO', () => {
    const state = setupFinalIntro({ p1: 100, p2: 0 });

    const view = projectBoard(state, NOW);

    expect(view.currentClueText).toBeNull();
    expect(view.answer).toBeNull();
    const allClues = view.round?.categories.flatMap((c) => c.clues) ?? [];
    for (const clue of allClues) {
      expect(clue).not.toHaveProperty('clueText');
      expect(clue).not.toHaveProperty('answer');
    }
  });

  it('projectBoard exposes the eligible contestant set as those with score > 0', () => {
    const state = setupFinalIntro({ p1: 100, p2: 0, p3: -50 });

    const view = projectBoard(state, NOW);

    expect(view.finalEligiblePlayerIds).toEqual(['p1']);
  });

  it('projectHost exposes the eligible set and hides the Final answer during FINAL_INTRO', () => {
    const state = setupFinalIntro({ p1: 100, p2: 0 });

    const view = projectHost(state, NOW);

    expect(view.finalEligiblePlayerIds).toEqual(['p1']);
    expect(view.currentClueText).toBeNull();
    expect(view.answer).toBeNull();
  });

  it('projectContestant marks eligible players as eligible for Final', () => {
    const state = setupFinalIntro({ p1: 100, p2: 0, p3: -50 });

    const eligible = projectContestant(state, 'p1', NOW);
    const ineligibleZero = projectContestant(state, 'p2', NOW);
    const ineligibleNegative = projectContestant(state, 'p3', NOW);

    expect(eligible.isEligibleForFinal).toBe(true);
    expect(ineligibleZero.isEligibleForFinal).toBe(false);
    expect(ineligibleNegative.isEligibleForFinal).toBe(false);
  });

  it('projectContestant hides the Final clue and answer during FINAL_INTRO', () => {
    const state = setupFinalIntro({ p1: 100, p2: 0 });

    const view = projectContestant(state, 'p1', NOW);

    expect(view.currentClueText).toBeNull();
    expect(view.answer).toBeNull();
  });

  it('projectBoard exposes the no-eligible-players flag when the Final was skipped', () => {
    const state = { ...setupFinalIntro({ p1: 0, p2: -100 }), phase: 'COMPLETE' as const, finalNoEligiblePlayers: true };

    const view = projectBoard(state, NOW);

    expect(view.finalNoEligiblePlayers).toBe(true);
    expect(view.finalEligiblePlayerIds).toEqual([]);
  });
});
