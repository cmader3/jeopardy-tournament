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

  it('projectBoard exposes all contestants at their unchanged pre-Final scores after the all-ineligible skip', () => {
    const state = { ...setupFinalIntro({ p1: 0, p2: -100, p3: -50 }), phase: 'COMPLETE' as const, finalNoEligiblePlayers: true };

    const view = projectBoard(state, NOW);

    expect(view.finalNoEligiblePlayers).toBe(true);
    expect(view.players.map((p) => ({ id: p.id, score: p.score }))).toEqual([
      { id: 'p1', score: 0 },
      { id: 'p2', score: -100 },
      { id: 'p3', score: -50 },
    ]);
    expect(view.finalRevealedAnswers).toEqual({});
    expect(view.finalRevealedWagers).toEqual({});
    expect(view.answer).toBeNull();
  });

  it('projectHost exposes all contestants at their unchanged pre-Final scores after the all-ineligible skip', () => {
    const state = { ...setupFinalIntro({ p1: 0, p2: -100 }), phase: 'COMPLETE' as const, finalNoEligiblePlayers: true };

    const view = projectHost(state, NOW);

    expect(view.finalNoEligiblePlayers).toBe(true);
    expect(view.players.map((p) => ({ id: p.id, score: p.score }))).toEqual([
      { id: 'p1', score: 0 },
      { id: 'p2', score: -100 },
    ]);
    expect(view.finalRevealedAnswers).toEqual({});
    expect(view.finalRevealedWagers).toEqual({});
    expect(view.answer).toBeNull();
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

describe('Final answer projections', () => {
  it('the board shows the Final clue and a deadline during FINAL_CLUE', () => {
    const state = {
      ...setupFinalIntro({ p1: 200 }),
      phase: 'FINAL_CLUE' as const,
      currentClueId: 'cl-final',
      finalWagers: { p1: 50 },
      deadline: NOW + 30_000,
    };

    const view = projectBoard(state, NOW);

    expect(view.currentClueText).toBe('He wrote The Hobbit');
    expect(view.deadline).toBe(NOW + 30_000);
  });

  it('the board tracks answer submission status without exposing answer text', () => {
    const state = {
      ...setupFinalIntro({ p1: 200, p2: 100 }),
      phase: 'FINAL_CLUE' as const,
      currentClueId: 'cl-final',
      finalWagers: { p1: 50, p2: 25 },
      finalAnswers: { p1: 'Tolkien' },
    };

    const view = projectBoard(state, NOW);

    expect(view.finalAnswerSubmissionStatus).toEqual({ p1: true, p2: false });
    expect(view).not.toHaveProperty('finalAnswers');
  });

  it('the host tracks answer submission status but does not see answer text before reveal', () => {
    const state = {
      ...setupFinalIntro({ p1: 200, p2: 100 }),
      phase: 'FINAL_CLUE' as const,
      currentClueId: 'cl-final',
      finalWagers: { p1: 50, p2: 25 },
      finalAnswers: { p1: 'Tolkien', p2: 'Rowling' },
    };

    const view = projectHost(state, NOW);

    expect(view.finalAnswerSubmissionStatus).toEqual({ p1: true, p2: true });
    expect(view.answer).toBeNull();
    expect(view).not.toHaveProperty('finalAnswers');
  });

  it('the host does not see the Final answer during FINAL_WAGER either', () => {
    const state = {
      ...setupFinalIntro({ p1: 200 }),
      phase: 'FINAL_WAGER' as const,
      currentClueId: 'cl-final',
      finalWagers: { p1: 50 },
    };

    const view = projectHost(state, NOW);

    expect(view.answer).toBeNull();
  });

  it('a contestant sees their own answer after submitting', () => {
    const state = {
      ...setupFinalIntro({ p1: 200, p2: 100 }),
      phase: 'FINAL_CLUE' as const,
      currentClueId: 'cl-final',
      finalWagers: { p1: 50, p2: 25 },
      finalAnswers: { p1: 'Tolkien' },
    };

    const p1 = projectContestant(state, 'p1', NOW);
    expect(p1.myFinalAnswer).toBe('Tolkien');
    expect(p1.finalAnswerSubmitted).toBe(true);
    expect(p1.canAnswer).toBe(false);
  });

  it('a contestant cannot see another contestant answer', () => {
    const state = {
      ...setupFinalIntro({ p1: 200, p2: 100 }),
      phase: 'FINAL_CLUE' as const,
      currentClueId: 'cl-final',
      finalWagers: { p1: 50, p2: 25 },
      finalAnswers: { p1: 'Tolkien' },
    };

    const p2 = projectContestant(state, 'p2', NOW);
    expect(p2.myFinalAnswer).toBeNull();
    expect(p2.finalAnswerSubmitted).toBe(false);
    expect(p2).not.toHaveProperty('finalAnswers');
  });

  it('eligible contestants can answer until they submit, then canAnswer locks', () => {
    const state = {
      ...setupFinalIntro({ p1: 200 }),
      phase: 'FINAL_CLUE' as const,
      currentClueId: 'cl-final',
      finalWagers: { p1: 50 },
      finalAnswers: {},
    };

    const before = projectContestant(state, 'p1', NOW);
    expect(before.canAnswer).toBe(true);

    const afterState = { ...state, finalAnswers: { p1: 'Tolkien' } };
    const after = projectContestant(afterState, 'p1', NOW);
    expect(after.canAnswer).toBe(false);
    expect(after.finalAnswerSubmitted).toBe(true);
  });

  it('ineligible contestants cannot answer during FINAL_CLUE', () => {
    const state = {
      ...setupFinalIntro({ p1: 200, p2: 0 }),
      phase: 'FINAL_CLUE' as const,
      currentClueId: 'cl-final',
      finalWagers: { p1: 50 },
      finalAnswers: {},
    };

    const p2 = projectContestant(state, 'p2', NOW);
    expect(p2.canAnswer).toBe(false);
    expect(p2.isEligibleForFinal).toBe(false);
  });

  it('the board does not leak Final answers after timer expiry', () => {
    const state = {
      ...setupFinalIntro({ p1: 200, p2: 100 }),
      phase: 'FINAL_REVEAL' as const,
      currentClueId: 'cl-final',
      finalWagers: { p1: 50, p2: 25 },
      finalAnswers: { p1: 'Tolkien', p2: 'Rowling' },
      deadline: null,
    };

    const view = projectBoard(state, NOW);

    expect(view.currentClueText).toBeNull();
    expect(view.answer).toBeNull();
    expect(view).not.toHaveProperty('finalAnswers');
  });
});

function setupFinalRevealState(
  step: 'ANSWER' | 'RULE' | 'WAGER',
  index = 0,
): GameState {
  return {
    ...setupFinalIntro({ p1: 300, p2: 100, p3: 200 }),
    phase: 'FINAL_REVEAL' as const,
    currentClueId: 'cl-final',
    finalWagers: { p1: 300, p2: 100, p3: 200 },
    finalAnswers: { p1: 'Tolkien', p2: 'Rowling', p3: 'Lewis' },
    finalRevealOrder: ['p2', 'p3', 'p1'],
    finalRevealIndex: index,
    finalRevealStep: step,
    deadline: null,
  };
}

describe('Final reveal projections', () => {
  it('board projection hides every answer and wager in the ANSWER step', () => {
    const state = setupFinalRevealState('ANSWER', 0);

    const view = projectBoard(state, NOW);

    expect(view.finalRevealOrder).toEqual(['p2', 'p3', 'p1']);
    expect(view.finalRevealIndex).toBe(0);
    expect(view.finalRevealStep).toBe('ANSWER');
    expect(view.finalRevealedAnswers).toEqual({});
    expect(view.finalRevealedWagers).toEqual({});
  });

  it('board projection reveals the current answer after REVEAL_FINAL_ANSWER', () => {
    const state = setupFinalRevealState('RULE', 0);

    const view = projectBoard(state, NOW);

    expect(view.finalRevealedAnswers).toEqual({ p2: 'Rowling' });
    expect(view.finalRevealedWagers).toEqual({});
  });

  it('board projection hides the current wager until REVEAL_FINAL_WAGER', () => {
    const state = setupFinalRevealState('RULE', 0);

    const view = projectBoard(state, NOW);

    expect(view.finalRevealedWagers).not.toHaveProperty('p2');
  });

  it('board projection reveals the current wager after a ruling', () => {
    const state = setupFinalRevealState('WAGER', 0);

    const view = projectBoard(state, NOW);

    expect(view.finalRevealedAnswers).toEqual({ p2: 'Rowling' });
    expect(view.finalRevealedWagers).toEqual({ p2: 100 });
  });

  it('board projection reveals previous contestants answers and wagers', () => {
    const state = setupFinalRevealState('ANSWER', 1);

    const view = projectBoard(state, NOW);

    expect(view.finalRevealedAnswers).toEqual({ p2: 'Rowling' });
    expect(view.finalRevealedWagers).toEqual({ p2: 100 });
  });

  it('board projection keeps future contestants answers and wagers hidden', () => {
    const state = setupFinalRevealState('ANSWER', 1);

    const view = projectBoard(state, NOW);

    expect(view.finalRevealedAnswers).not.toHaveProperty('p3');
    expect(view.finalRevealedAnswers).not.toHaveProperty('p1');
    expect(view.finalRevealedWagers).not.toHaveProperty('p3');
    expect(view.finalRevealedWagers).not.toHaveProperty('p1');
  });

  it('host projection follows the same reveal rules as the board', () => {
    const state = setupFinalRevealState('RULE', 1);

    const view = projectHost(state, NOW);

    expect(view.finalRevealedAnswers).toEqual({ p2: 'Rowling', p3: 'Lewis' });
    expect(view.finalRevealedWagers).toEqual({ p2: 100 });
    expect(view.finalRevealedWagers).not.toHaveProperty('p3');
    expect(view.finalRevealedAnswers).not.toHaveProperty('p1');
  });

  it('contestant projection follows the same reveal rules as the board', () => {
    const state = setupFinalRevealState('WAGER', 1);

    const p1 = projectContestant(state, 'p1', NOW);

    expect(p1.finalRevealedAnswers).toEqual({ p2: 'Rowling', p3: 'Lewis' });
    expect(p1.finalRevealedWagers).toEqual({ p2: 100, p3: 200 });
    expect(p1.finalRevealedAnswers).not.toHaveProperty('p1');
    expect(p1.finalRevealedWagers).not.toHaveProperty('p1');
  });
});
