import { describe, expect, it } from 'vitest';
import { createInitialState, reduce } from './index.js';
import type { Board, GameState, Player } from '../models/index.js';

const NOW = 1_000_000;

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

function makeBoardWithDoubleJeopardy(): Board {
  return {
    id: 'b2',
    name: 'DJ Board',
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
                clueText: 'H2O is this compound',
                answer: 'Water',
                isDailyDouble: false,
              },
              {
                id: 'cl2',
                categoryId: 'c1',
                row: 1,
                value: 200,
                clueText: 'This planet is known as the Red Planet',
                answer: 'Mars',
                isDailyDouble: true,
              },
            ],
          },
          {
            id: 'c2',
            roundId: 'r1',
            title: 'History',
            order: 1,
            clues: [
              {
                id: 'cl3',
                categoryId: 'c2',
                row: 0,
                value: 100,
                clueText: 'First US president',
                answer: 'Washington',
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
          {
            id: 'cl2',
            categoryId: 'c1',
            row: 1,
            value: 200,
            clueText: 'This planet is known as the Red Planet',
            answer: 'Mars',
            isDailyDouble: true,
          },
          {
            id: 'cl3',
            categoryId: 'c2',
            row: 0,
            value: 100,
            clueText: 'First US president',
            answer: 'Washington',
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
            id: 'c3',
            roundId: 'r2',
            title: 'Arts',
            order: 0,
            clues: [
              {
                id: 'cl4',
                categoryId: 'c3',
                row: 0,
                value: 200,
                clueText: 'A painting tool',
                answer: 'Brush',
                isDailyDouble: false,
              },
            ],
          },
        ],
        clues: [
          {
            id: 'cl4',
            categoryId: 'c3',
            row: 0,
            value: 200,
            clueText: 'A painting tool',
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
            id: 'c4',
            roundId: 'r3',
            title: 'Literature',
            order: 0,
            clues: [
              {
                id: 'cl-final',
                categoryId: 'c4',
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
            categoryId: 'c4',
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

function makeBoardWithoutDoubleJeopardy(): Board {
  return {
    id: 'b1',
    name: 'Single Board',
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
        type: 'DOUBLE_JEOPARDY',
        order: 1,
        categories: [
          {
            id: 'c2',
            roundId: 'r2',
            title: 'Hidden DJ',
            order: 0,
            clues: [
              {
                id: 'cl-dj',
                categoryId: 'c2',
                row: 0,
                value: 200,
                clueText: 'A hidden double',
                answer: 'Double',
                isDailyDouble: false,
              },
            ],
          },
        ],
        clues: [
          {
            id: 'cl-dj',
            categoryId: 'c2',
            row: 0,
            value: 200,
            clueText: 'A hidden double',
            answer: 'Double',
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
            categoryId: 'c3',
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

function setupGame(board: Board): GameState {
  let state = createInitialState('session-1', 'ABCD', board);
  const alice = makePlayer({ id: 'p1', name: 'Alice' });
  const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });
  state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
  state = reduce(state, { type: 'JOIN', player: bob }, { now: NOW }).state;
  return reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
}

function resolveClue(state: GameState, clueId: string): GameState {
  let result = reduce(state, { type: 'SELECT_CLUE', clueId, selectorId: state.controllingPlayerId }, { now: NOW });
  if (result.state.phase === 'DAILY_DOUBLE_WAGER') {
    result = reduce(result.state, { type: 'SUBMIT_DD_WAGER', playerId: result.state.controllingPlayerId!, amount: 5 }, { now: NOW });
    result = reduce(result.state, { type: 'REVEAL_CLUE' }, { now: NOW });
    result = reduce(result.state, { type: 'RULE_CORRECT' }, { now: NOW + 100 });
    return result.state;
  }
  result = reduce(result.state, { type: 'REVEAL_ANSWER' }, { now: NOW + 100 });
  return result.state;
}

describe('round completion detection', () => {
  it('detects the round is complete when all clues are used', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    const result = resolveClue(state, 'cl3');

    expect(result.phase).toBe('BOARD_SELECT');
    expect(result.usedClueIds).toContain('cl1');
    expect(result.usedClueIds).toContain('cl2');
    expect(result.usedClueIds).toContain('cl3');
  });

  it('does not detect completion while any clue remains unused', () => {
    const board = makeBoardWithDoubleJeopardy();
    const state = setupGame(board);

    const result = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('not complete') });
    expect(result.state.phase).toBe('BOARD_SELECT');
  });

  it('resolving a Daily Double as the last clue still completes the round', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl3');

    // The last remaining clue is the Daily Double cl2.
    let selected = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl2', selectorId: state.controllingPlayerId }, { now: NOW }).state;
    selected = reduce(selected, { type: 'SUBMIT_DD_WAGER', playerId: selected.controllingPlayerId!, amount: 200 }, { now: NOW }).state;
    selected = reduce(selected, { type: 'REVEAL_CLUE' }, { now: NOW }).state;
    const result = reduce(selected, { type: 'RULE_CORRECT' }, { now: NOW + 100 });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.usedClueIds).toContain('cl2');
  });
});

describe('ADVANCE_ROUND', () => {
  it('from a complete Jeopardy round with Double Jeopardy enabled enters ROUND_TRANSITION targeting Double Jeopardy', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');

    const result = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('ROUND_TRANSITION');
    expect(result.state.transitionTarget).toBe('DOUBLE_JEOPARDY');
  });

  it('from a complete Jeopardy round with Double Jeopardy disabled enters ROUND_TRANSITION targeting Final', () => {
    const board = makeBoardWithoutDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');

    const result = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('ROUND_TRANSITION');
    expect(result.state.transitionTarget).toBe('FINAL');
  });

  it('from ROUND_TRANSITION targeting Double Jeopardy advances to BOARD_SELECT with the next round index', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');
    state = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW }).state;
    expect(state.transitionTarget).toBe('DOUBLE_JEOPARDY');

    const result = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.roundIndex).toBe(1);
    expect(result.state.transitionTarget).toBeNull();
  });

  it('from ROUND_TRANSITION skips a disabled Double Jeopardy round and lands on Final', () => {
    const board = makeBoardWithoutDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW }).state;

    const result = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('FINAL_INTRO');
    expect(result.state.roundIndex).toBe(2);
    expect(result.state.transitionTarget).toBeNull();
  });

  it('carries scores over into the new round', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    // Give Alice a score by having her answer correctly on cl3.
    let selected = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl3', selectorId: state.controllingPlayerId }, { now: NOW }).state;
    selected = reduce(selected, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    selected = reduce(selected, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;
    selected = reduce(selected, { type: 'RULE_CORRECT' }, { now: NOW + 100 }).state;
    state = resolveClue(selected, 'cl2');

    const scoreBeforeAdvance = state.players.find((p) => p.id === 'p1')?.score;
    expect(scoreBeforeAdvance).toBeGreaterThan(0);

    const transition = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW });
    expect(transition.state.players.find((p) => p.id === 'p1')?.score).toBe(scoreBeforeAdvance);

    const advanced = reduce(transition.state, { type: 'ADVANCE_ROUND' }, { now: NOW });
    expect(advanced.state.players.find((p) => p.id === 'p1')?.score).toBe(scoreBeforeAdvance);
    expect(advanced.state.players.find((p) => p.id === 'p2')?.score).toBe(0);
  });

  it('is rejected outside BOARD_SELECT or ROUND_TRANSITION', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: state.controllingPlayerId }, { now: NOW }).state;

    const result = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('right now') });
    expect(result.state.phase).toBe('CLUE_REVEALED');
  });

  it('is rejected from ROUND_TRANSITION when the target is unknown', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');
    state = { ...reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW }).state, transitionTarget: null };

    const result = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('transition target') });
  });
});

describe('new round grid and control', () => {
  function advanceToDoubleJeopardy(state: GameState): GameState {
    let next = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW }).state;
    expect(next.phase).toBe('ROUND_TRANSITION');
    next = reduce(next, { type: 'ADVANCE_ROUND' }, { now: NOW }).state;
    expect(next.phase).toBe('BOARD_SELECT');
    expect(next.roundIndex).toBe(1);
    return next;
  }

  it('assigns control to the lowest-score contestant when entering a new round', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');

    // After resolving cl1 via a correct buzz, Alice (p1) has a positive score.
    const aliceScore = state.players.find((p) => p.id === 'p1')?.score ?? 0;
    expect(aliceScore).toBeGreaterThan(0);
    expect(state.controllingPlayerId).toBe('p1');

    const advanced = advanceToDoubleJeopardy(state);
    const bob = advanced.players.find((p) => p.id === 'p2');
    expect(bob?.score).toBe(0);
    expect(advanced.controllingPlayerId).toBe('p2');
  });

  it('resolves a lowest-score tie deterministically by seat order', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');

    // Reset both scores to zero so there is a tie for lowest score.
    state = reduce(state, { type: 'ADJUST_SCORE', playerId: 'p1', score: 0 }, { now: NOW }).state;
    state = reduce(state, { type: 'ADJUST_SCORE', playerId: 'p2', score: 0 }, { now: NOW }).state;
    const p1 = state.players.find((p) => p.id === 'p1')!;
    const p2 = state.players.find((p) => p.id === 'p2')!;
    expect(p1.seatOrder).toBeLessThan(p2.seatOrder);

    const advanced = advanceToDoubleJeopardy(state);
    expect(advanced.controllingPlayerId).toBe(p1.id);
  });

  it('keeps the new round grid unspent even when the prior round is fully used', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');

    const round1ClueIds = new Set(board.rounds[0].clues.map((c) => c.id));
    const round2ClueIds = new Set(board.rounds[1].clues.map((c) => c.id));
    const used = new Set(state.usedClueIds);
    expect(round1ClueIds.isSubsetOf(used)).toBe(true);
    expect(round2ClueIds.isSubsetOf(used)).toBe(false);

    const advanced = advanceToDoubleJeopardy(state);
    const advancedUsed = new Set(advanced.usedClueIds);
    expect(advancedUsed.isSubsetOf(round1ClueIds)).toBe(true);
    for (const id of round2ClueIds) {
      expect(advancedUsed.has(id)).toBe(false);
    }
  });

  it('rejects a non-controlling contestant selecting the first clue of a new round', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');
    const advanced = advanceToDoubleJeopardy(state);
    const controller = advanced.controllingPlayerId;
    const nonController = advanced.players.find((p) => p.id !== controller)?.id;
    expect(nonController).toBeDefined();

    const result = reduce(advanced, { type: 'SELECT_CLUE', clueId: 'cl4', selectorId: nonController }, { now: NOW });
    expect(result.effects).toContainEqual({
      type: 'INTENT_REJECTED',
      reason: expect.stringContaining('Only the controlling player or host can select a clue'),
    });
  });

  it('prefers a connected contestant over the lowest-score disconnected contestant for new-round control', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');

    // Give Alice a positive score so Bob is trailing; then disconnect Bob.
    expect(state.players.find((p) => p.id === 'p1')?.score).toBeGreaterThan(0);
    state = reduce(state, { type: 'DISCONNECT', playerId: 'p2' }, { now: NOW }).state;
    expect(state.players.find((p) => p.id === 'p2')?.connected).toBe(false);

    const advanced = advanceToDoubleJeopardy(state);
    expect(advanced.controllingPlayerId).toBe('p1');
  });

  it('falls back to the all-contestants selection when no contestant is connected', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');

    // Disconnect both contestants.
    state = reduce(state, { type: 'DISCONNECT', playerId: 'p1' }, { now: NOW }).state;
    state = reduce(state, { type: 'DISCONNECT', playerId: 'p2' }, { now: NOW }).state;
    expect(state.players.every((p) => !p.connected)).toBe(true);

    const advanced = advanceToDoubleJeopardy(state);
    // Fallback to existing deterministic tie-break among all contestants: lowest score, then seat order.
    const trailing = advanced.players.reduce((lowest, p) =>
      p.score < lowest.score || (p.score === lowest.score && p.seatOrder < lowest.seatOrder) ? p : lowest
    );
    expect(advanced.controllingPlayerId).toBe(trailing.id);
  });

  it('allows the host to override the new-round control assignment', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');
    const advanced = advanceToDoubleJeopardy(state);
    const defaultController = advanced.controllingPlayerId;
    const otherPlayer = advanced.players.find((p) => p.id !== defaultController)!;

    const result = reduce(advanced, { type: 'OVERRIDE_CONTROL', playerId: otherPlayer.id }, { now: NOW });
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.controllingPlayerId).toBe(otherPlayer.id);
  });

  it('allows the host to override control to a disconnected contestant', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');
    const advanced = advanceToDoubleJeopardy(state);
    const disconnectedPlayer = advanced.players.find((p) => p.id === 'p2')!;
    state = reduce(advanced, { type: 'DISCONNECT', playerId: disconnectedPlayer.id }, { now: NOW }).state;
    expect(state.players.find((p) => p.id === disconnectedPlayer.id)?.connected).toBe(false);

    const result = reduce(state, { type: 'OVERRIDE_CONTROL', playerId: disconnectedPlayer.id }, { now: NOW });
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.controllingPlayerId).toBe(disconnectedPlayer.id);
  });

  it('rejects override control for an unknown player', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = setupGame(board);
    state = resolveClue(state, 'cl1');
    state = resolveClue(state, 'cl2');
    state = resolveClue(state, 'cl3');
    const advanced = advanceToDoubleJeopardy(state);

    const result = reduce(advanced, { type: 'OVERRIDE_CONTROL', playerId: 'no-such-player' }, { now: NOW });
    expect(result.effects).toContainEqual({
      type: 'INTENT_REJECTED',
      reason: expect.stringContaining('Player not found'),
    });
  });

  it('rejects override control outside BOARD_SELECT', () => {
    const board = makeBoardWithDoubleJeopardy();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    expect(state.phase).toBe('LOBBY');

    const result = reduce(state, { type: 'OVERRIDE_CONTROL', playerId: 'p1' }, { now: NOW });
    expect(result.effects).toContainEqual({
      type: 'INTENT_REJECTED',
      reason: expect.stringContaining('Cannot assign control right now'),
    });
  });
});
