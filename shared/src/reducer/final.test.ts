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

function setupFinalWager(scores: Record<string, number>): GameState {
  const intro = setupFinalIntro(scores);
  const opened = reduce(intro, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW });
  return opened.state;
}

describe('SUBMIT_FINAL_WAGER', () => {
  it('accepts a wager of 0', () => {
    const state = setupFinalWager({ p1: 200 });

    const result = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: 0 }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.finalWagers['p1']).toBe(0);
  });

  it('accepts a wager equal to the full current score', () => {
    const state = setupFinalWager({ p1: 200 });

    const result = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: 200 }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.finalWagers['p1']).toBe(200);
  });

  it('rejects a negative wager', () => {
    const state = setupFinalWager({ p1: 200 });

    const result = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: -1 }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('between') });
    expect(result.state.finalWagers['p1']).toBeUndefined();
  });

  it('rejects a wager greater than the current score', () => {
    const state = setupFinalWager({ p1: 200 });

    const result = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: 201 }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('between') });
    expect(result.state.finalWagers['p1']).toBeUndefined();
  });

  it('rejects a wager from an ineligible contestant', () => {
    const state = setupFinalWager({ p1: 200, p2: 0 });

    const result = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p2', amount: 0 }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('eligible') });
    expect(result.state.finalWagers['p2']).toBeUndefined();
  });

  it('is rejected outside of FINAL_WAGER', () => {
    const intro = setupFinalIntro({ p1: 200 });

    const result = reduce(intro, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: 100 }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('right now') });
  });

  it('locks the wager so it cannot be changed', () => {
    const state = setupFinalWager({ p1: 200, p2: 100 });
    const first = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: 50 }, { now: NOW });

    const second = reduce(first.state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: 100 }, { now: NOW });

    expect(second.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('already') });
    expect(second.state.finalWagers['p1']).toBe(50);
  });

  it('advances to FINAL_CLUE when all eligible contestants have submitted', () => {
    const state = setupFinalWager({ p1: 200, p2: 100 });

    const first = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: 200 }, { now: NOW });
    expect(first.state.phase).toBe('FINAL_WAGER');

    const second = reduce(first.state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p2', amount: 100 }, { now: NOW });

    expect(second.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(second.state.phase).toBe('FINAL_CLUE');
    expect(second.state.currentClueId).toBe('cl-final');
    expect(second.state.finalWagers).toEqual({ p1: 200, p2: 100 });
  });

  it('does not auto-advance when some eligible contestants have not submitted', () => {
    const state = setupFinalWager({ p1: 200, p2: 100 });

    const result = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: 200 }, { now: NOW });

    expect(result.state.phase).toBe('FINAL_WAGER');
    expect(result.state.finalWagers).toEqual({ p1: 200 });
  });
});

describe('FORCE_FINAL_WAGERS', () => {
  it('advances to FINAL_CLUE and defaults missing wagers to 0', () => {
    const state = setupFinalWager({ p1: 200, p2: 100 });
    const partial = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: 50 }, { now: NOW });

    const result = reduce(partial.state, { type: 'FORCE_FINAL_WAGERS' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('FINAL_CLUE');
    expect(result.state.currentClueId).toBe('cl-final');
    expect(result.state.finalWagers).toEqual({ p1: 50, p2: 0 });
  });

  it('is rejected outside of FINAL_WAGER', () => {
    const intro = setupFinalIntro({ p1: 200 });

    const result = reduce(intro, { type: 'FORCE_FINAL_WAGERS' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('right now') });
  });
});

function setupFinalClue(scores: Record<string, number>): GameState {
  const wager = setupFinalWager(scores);
  const forced = reduce(wager, { type: 'FORCE_FINAL_WAGERS' }, { now: NOW });
  return forced.state;
}

describe('FINAL_CLUE transition', () => {
  it('sets the deadline from the board finalTimerSeconds when entering FINAL_CLUE', () => {
    const state = setupFinalClue({ p1: 200 });

    expect(state.phase).toBe('FINAL_CLUE');
    expect(state.deadline).toBe(NOW + 30_000);
    expect(state.currentClueId).toBe('cl-final');
  });

  it('reflects a non-default finalTimerSeconds in the deadline', () => {
    const board = makeBoard();
    const customBoard = { ...board, finalTimerSeconds: 45 };
    const intro = {
      ...createInitialState('session-1', 'ABCD', customBoard),
      phase: 'FINAL_INTRO' as const,
      roundIndex: 1,
      players: [makePlayer({ id: 'p1', name: 'Alice', score: 200 })],
    };
    const wager = reduce(intro, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW }).state;
    const clue = reduce(wager, { type: 'FORCE_FINAL_WAGERS' }, { now: NOW }).state;

    expect(clue.deadline).toBe(NOW + 45_000);
  });
});

describe('SUBMIT_FINAL_ANSWER', () => {
  it('records an eligible contestant written answer', () => {
    const state = setupFinalClue({ p1: 200 });

    const result = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: 'Tolkien' }, { now: NOW + 5_000 });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.finalAnswers['p1']).toBe('Tolkien');
  });

  it('locks the answer so it cannot be changed', () => {
    const state = setupFinalClue({ p1: 200 });
    const first = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: 'Tolkien' }, { now: NOW + 1_000 });

    const second = reduce(first.state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: 'Rowling' }, { now: NOW + 2_000 });

    expect(second.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('already') });
    expect(second.state.finalAnswers['p1']).toBe('Tolkien');
  });

  it('rejects an answer from an ineligible contestant', () => {
    const state = setupFinalClue({ p1: 200, p2: 0 });

    const result = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p2', answer: 'Tolkien' }, { now: NOW + 1_000 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('eligible') });
    expect(result.state.finalAnswers['p2']).toBeUndefined();
  });

  it('is rejected outside of FINAL_CLUE', () => {
    const wager = setupFinalWager({ p1: 200 });

    const result = reduce(wager, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: 'Tolkien' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('right now') });
  });

  it('rejects an answer submitted after the deadline', () => {
    const state = setupFinalClue({ p1: 200 });

    const result = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: 'Tolkien' }, { now: NOW + 31_000 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('closed') });
    expect(result.state.finalAnswers['p1']).toBeUndefined();
  });

  it('accepts a blank answer as a valid submission', () => {
    const state = setupFinalClue({ p1: 200 });

    const result = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: '' }, { now: NOW + 1_000 });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.finalAnswers['p1']).toBe('');
  });
});

describe('TIME_EXPIRE in FINAL_CLUE', () => {
  it('transitions to FINAL_REVEAL when the timer expires', () => {
    const state = setupFinalClue({ p1: 200 });

    const result = reduce(state, { type: 'TIME_EXPIRE' }, { now: NOW + 30_000 });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('FINAL_REVEAL');
    expect(result.state.deadline).toBeNull();
  });

  it('records a blank answer for eligible contestants who did not submit', () => {
    const state = setupFinalClue({ p1: 200, p2: 100 });
    const partial = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: 'Tolkien' }, { now: NOW + 1_000 });

    const result = reduce(partial.state, { type: 'TIME_EXPIRE' }, { now: NOW + 30_000 });

    expect(result.state.finalAnswers['p1']).toBe('Tolkien');
    expect(result.state.finalAnswers['p2']).toBe('');
  });

  it('does not overwrite already-submitted answers', () => {
    const state = setupFinalClue({ p1: 200 });
    const partial = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: 'Tolkien' }, { now: NOW + 1_000 });

    const result = reduce(partial.state, { type: 'TIME_EXPIRE' }, { now: NOW + 30_000 });

    expect(result.state.finalAnswers['p1']).toBe('Tolkien');
  });

  it('keeps ineligible contestants out of finalAnswers', () => {
    const state = setupFinalClue({ p1: 200, p2: 0 });

    const result = reduce(state, { type: 'TIME_EXPIRE' }, { now: NOW + 30_000 });

    expect(result.state.finalAnswers['p1']).toBe('');
    expect(result.state.finalAnswers['p2']).toBeUndefined();
  });
});

describe('Final answer phase disconnect preservation', () => {
  it('preserves a submitted answer when the contestant disconnects', () => {
    const state = setupFinalClue({ p1: 200, p2: 100 });
    const partial = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: 'Tolkien' }, { now: NOW + 1_000 });

    const disconnected = reduce(partial.state, { type: 'DISCONNECT', playerId: 'p1' }, { now: NOW + 2_000 });

    expect(disconnected.state.finalAnswers['p1']).toBe('Tolkien');
    expect(disconnected.state.players.find((p) => p.id === 'p1')?.connected).toBe(false);
  });

  it('preserves a submitted answer on reconnect', () => {
    const state = setupFinalClue({ p1: 200, p2: 100 });
    const partial = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: 'Tolkien' }, { now: NOW + 1_000 });
    const disconnected = reduce(partial.state, { type: 'DISCONNECT', playerId: 'p1' }, { now: NOW + 2_000 });

    const reconnected = reduce(disconnected.state, { type: 'RECONNECT', playerId: 'p1' }, { now: NOW + 3_000 });

    expect(reconnected.state.finalAnswers['p1']).toBe('Tolkien');
    expect(reconnected.state.players.find((p) => p.id === 'p1')?.connected).toBe(true);
  });
});

function setupFinalClueWithWagers(scores: Record<string, number>, wagers: Record<string, number>): GameState {
  const wager = setupFinalWager(scores);
  let state = wager;
  for (const [playerId, amount] of Object.entries(wagers)) {
    state = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId, amount }, { now: NOW }).state;
  }
  return reduce(state, { type: 'FORCE_FINAL_WAGERS' }, { now: NOW }).state;
}

function setupFinalReveal(
  scores: Record<string, number>,
  answers?: Record<string, string>,
  wagers?: Record<string, number>,
): GameState {
  const clue = wagers ? setupFinalClueWithWagers(scores, wagers) : setupFinalClue(scores);
  const withAnswers = answers
    ? Object.entries(answers).reduce(
        (state, [playerId, answer]) =>
          reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId, answer }, { now: NOW + 1_000 }).state,
        clue,
      )
    : clue;
  return reduce(withAnswers, { type: 'TIME_EXPIRE' }, { now: NOW + 30_000 }).state;
}

describe('TIME_EXPIRE builds Final reveal order', () => {
  it('orders participants by pre-Final score ascending', () => {
    const state = setupFinalReveal({ p1: 300, p2: 100, p3: 200 });

    expect(state.phase).toBe('FINAL_REVEAL');
    expect(state.finalRevealOrder).toEqual(['p2', 'p3', 'p1']);
    expect(state.finalRevealIndex).toBe(0);
    expect(state.finalRevealStep).toBe('ANSWER');
  });

  it('breaks pre-Final score ties by seat order', () => {
    const board = makeBoard();
    const players = [
      makePlayer({ id: 'p1', name: 'Alice', score: 200, seatOrder: 2 }),
      makePlayer({ id: 'p2', name: 'Bob', score: 200, seatOrder: 0 }),
      makePlayer({ id: 'p3', name: 'Carol', score: 200, seatOrder: 1 }),
    ];
    const intro = {
      ...createInitialState('session-1', 'ABCD', board),
      phase: 'FINAL_INTRO' as const,
      roundIndex: 1,
      players,
    };
    const wager = reduce(intro, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW }).state;
    const clue = reduce(wager, { type: 'FORCE_FINAL_WAGERS' }, { now: NOW }).state;
    const result = reduce(clue, { type: 'TIME_EXPIRE' }, { now: NOW + 30_000 });

    expect(result.state.finalRevealOrder).toEqual(['p2', 'p3', 'p1']);
  });

  it('excludes non-participants from the reveal order', () => {
    const state = setupFinalReveal({ p1: 300, p2: 0, p3: -100, p4: 50 });

    expect(state.finalRevealOrder).toEqual(['p4', 'p1']);
  });
});

describe('REVEAL_FINAL_ANSWER', () => {
  it('reveals the current contestant answer and moves to the ruling step', () => {
    const state = setupFinalReveal({ p1: 200, p2: 100 }, { p1: 'Tolkien', p2: 'Rowling' }, { p1: 100, p2: 50 });

    const result = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW + 31_000 });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.finalRevealStep).toBe('RULE');
    expect(result.state.finalRevealIndex).toBe(0);
  });

  it('is rejected outside of FINAL_REVEAL', () => {
    const clue = setupFinalClue({ p1: 200 });

    const result = reduce(clue, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW + 31_000 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('right now') });
  });

  it('is rejected when the answer is already revealed', () => {
    const state = setupFinalReveal({ p1: 200 }, { p1: 'Tolkien' });
    const revealed = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW + 31_000 }).state;

    const result = reduce(revealed, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW + 32_000 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('already') });
  });
});

describe('RULE_FINAL_CORRECT', () => {
  it('adds the wager to the current contestant score and moves to the wager reveal step', () => {
    const state = setupFinalReveal({ p1: 200 }, { p1: 'Tolkien' }, { p1: 200 });
    const revealed = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW + 31_000 }).state;

    const result = reduce(revealed, { type: 'RULE_FINAL_CORRECT' }, { now: NOW + 32_000 });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.finalRevealStep).toBe('WAGER');
    expect(result.state.players.find((p) => p.id === 'p1')?.score).toBe(400);
    expect(result.state.lastOutcome).toEqual({ playerId: 'p1', type: 'CORRECT', value: 200 });
  });

  it('is rejected when the answer has not been revealed', () => {
    const state = setupFinalReveal({ p1: 200 }, { p1: 'Tolkien' });

    const result = reduce(state, { type: 'RULE_FINAL_CORRECT' }, { now: NOW + 31_000 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('answer') });
  });
});

describe('RULE_FINAL_INCORRECT', () => {
  it('subtracts the wager from the current contestant score and moves to the wager reveal step', () => {
    const state = setupFinalReveal({ p1: 200 }, { p1: 'Tolkien' }, { p1: 200 });
    const revealed = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW + 31_000 }).state;

    const result = reduce(revealed, { type: 'RULE_FINAL_INCORRECT' }, { now: NOW + 32_000 });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.finalRevealStep).toBe('WAGER');
    expect(result.state.players.find((p) => p.id === 'p1')?.score).toBe(0);
    expect(result.state.lastOutcome).toEqual({ playerId: 'p1', type: 'INCORRECT', value: 200 });
  });
});

describe('REVEAL_FINAL_WAGER', () => {
  it('advances to the next contestant after the wager is revealed', () => {
    const state = setupFinalReveal({ p1: 200, p2: 100 }, { p1: 'Tolkien', p2: 'Rowling' }, { p1: 200, p2: 100 });
    const revealed = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW + 31_000 }).state;
    const ruled = reduce(revealed, { type: 'RULE_FINAL_CORRECT' }, { now: NOW + 32_000 }).state;

    const result = reduce(ruled, { type: 'REVEAL_FINAL_WAGER' }, { now: NOW + 33_000 });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.finalRevealIndex).toBe(1);
    expect(result.state.finalRevealStep).toBe('ANSWER');
    expect(result.state.lastOutcome).toBeNull();
  });

  it('transitions to COMPLETE after the last contestant wager is revealed', () => {
    const state = setupFinalReveal({ p1: 200 }, { p1: 'Tolkien' }, { p1: 200 });
    const revealed = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW + 31_000 }).state;
    const ruled = reduce(revealed, { type: 'RULE_FINAL_INCORRECT' }, { now: NOW + 32_000 }).state;

    const result = reduce(ruled, { type: 'REVEAL_FINAL_WAGER' }, { now: NOW + 33_000 });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('COMPLETE');
    expect(result.state.players.find((p) => p.id === 'p1')?.score).toBe(0);
  });

  it('is rejected when the wager has not been ruled on', () => {
    const state = setupFinalReveal({ p1: 200 }, { p1: 'Tolkien' });
    const revealed = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW + 31_000 }).state;

    const result = reduce(revealed, { type: 'REVEAL_FINAL_WAGER' }, { now: NOW + 32_000 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('ruling') });
  });
});

describe('Final reveal full sequence', () => {
  it('visits every participant exactly once in ascending score order', () => {
    const state = setupFinalReveal(
      { p1: 300, p2: 100, p3: 200 },
      { p1: 'Tolkien', p2: 'Rowling', p3: 'Lewis' },
      { p1: 300, p2: 100, p3: 200 },
    );
    expect(state.finalRevealOrder).toEqual(['p2', 'p3', 'p1']);

    const visited: string[] = [];
    let current = state;
    for (let i = 0; i < 3; i++) {
      const revealed = reduce(current, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW + 31_000 + i * 3 }).state;
      const ruled = reduce(revealed, { type: 'RULE_FINAL_CORRECT' }, { now: NOW + 32_000 + i * 3 }).state;
      visited.push(ruled.finalRevealOrder[ruled.finalRevealIndex]);
      current = reduce(ruled, { type: 'REVEAL_FINAL_WAGER' }, { now: NOW + 33_000 + i * 3 }).state;
    }

    expect(visited).toEqual(['p2', 'p3', 'p1']);
    expect(current.phase).toBe('COMPLETE');
  });

  it('preserves already-revealed answers, wagers, and scores while advancing', () => {
    const state = setupFinalReveal(
      { p1: 300, p2: 100 },
      { p1: 'Tolkien', p2: 'Rowling' },
      { p1: 300, p2: 100 },
    );

    const revealed = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW + 31_000 }).state;
    const ruled = reduce(revealed, { type: 'RULE_FINAL_CORRECT' }, { now: NOW + 32_000 }).state;
    const afterFirst = reduce(ruled, { type: 'REVEAL_FINAL_WAGER' }, { now: NOW + 33_000 }).state;

    expect(afterFirst.finalRevealIndex).toBe(1);
    expect(afterFirst.finalAnswers['p2']).toBe('Rowling');
    expect(afterFirst.finalWagers['p2']).toBe(100);
    expect(afterFirst.players.find((p) => p.id === 'p2')?.score).toBe(200);
    expect(afterFirst.finalAnswers['p1']).toBe('Tolkien');
    expect(afterFirst.finalWagers['p1']).toBe(300);
  });
});
