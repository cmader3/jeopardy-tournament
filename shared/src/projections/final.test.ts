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

describe('Final wager projections', () => {
  it('projectBoard tracks submission status but never exposes wager amounts during FINAL_WAGER', () => {
    const state = { ...setupFinalIntro({ p1: 200, p2: 100 }), phase: 'FINAL_WAGER' as const, finalWagers: { p1: 150 } };

    const view = projectBoard(state, NOW);

    expect(view.finalWagerSubmissionStatus).toEqual({ p1: true, p2: false });
    expect(view).not.toHaveProperty('finalWagers');
  });

  it('projectHost tracks submission status but never exposes wager amounts during FINAL_WAGER', () => {
    const state = { ...setupFinalIntro({ p1: 200, p2: 100 }), phase: 'FINAL_WAGER' as const, finalWagers: { p1: 150 } };

    const view = projectHost(state, NOW);

    expect(view.finalWagerSubmissionStatus).toEqual({ p1: true, p2: false });
    expect(view).not.toHaveProperty('finalWagers');
  });

  it('projectContestant exposes only the submitting contestant own wager amount', () => {
    const state = { ...setupFinalIntro({ p1: 200, p2: 100 }), phase: 'FINAL_WAGER' as const, finalWagers: { p1: 150 } };

    const p1 = projectContestant(state, 'p1', NOW);
    const p2 = projectContestant(state, 'p2', NOW);

    expect(p1.myFinalWager).toBe(150);
    expect(p1.finalWagerSubmitted).toBe(true);
    expect(p2.myFinalWager).toBeNull();
    expect(p2.finalWagerSubmitted).toBe(false);
    expect(p2).not.toHaveProperty('finalWagers');
  });

  it('eligible contestants can wager until they submit, then canWager becomes false', () => {
    const state = { ...setupFinalIntro({ p1: 200 }), phase: 'FINAL_WAGER' as const, finalWagers: {} };

    const before = projectContestant(state, 'p1', NOW);
    expect(before.canWager).toBe(true);

    const afterState = { ...state, finalWagers: { p1: 50 } };
    const after = projectContestant(afterState, 'p1', NOW);
    expect(after.canWager).toBe(false);
    expect(after.finalWagerSubmitted).toBe(true);
  });

  it('ineligible contestants cannot wager during FINAL_WAGER', () => {
    const state = { ...setupFinalIntro({ p1: 200, p2: 0 }), phase: 'FINAL_WAGER' as const, finalWagers: {} };

    const p2 = projectContestant(state, 'p2', NOW);
    expect(p2.canWager).toBe(false);
    expect(p2.isEligibleForFinal).toBe(false);
  });

  it('the Final clue text is visible on the board during FINAL_CLUE', () => {
    const state = {
      ...setupFinalIntro({ p1: 200 }),
      phase: 'FINAL_CLUE' as const,
      currentClueId: 'cl-final',
      finalWagers: { p1: 50 },
    };

    const view = projectBoard(state, NOW);

    expect(view.currentClueText).toBe('He wrote The Hobbit');
    expect(view.finalWagerSubmissionStatus).toEqual({ p1: true });
  });
});
