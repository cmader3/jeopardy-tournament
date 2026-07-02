import { describe, expect, it } from 'vitest';
import { createInitialState } from '../reducer/index.js';
import { projectBoard, projectHost, projectContestant } from './index.js';
import type { Board, Player } from '../models/index.js';

const NOW = 1_000_000;

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
    const view = projectBoard(state, NOW);

    expect(view.roomCode).toBe('ABCD');
    expect(view.phase).toBe('LOBBY');
    expect(view.players).toEqual([]);
    expect(view.currentClueId).toBeNull();
    expect(view.currentClueText).toBeNull();
    expect(view.buzzWinnerId).toBeNull();
    expect(view.deadline).toBeNull();
    expect(view.usedClueIds).toEqual([]);
    expect(view.controllingPlayerId).toBeNull();
    expect(view.answer).toBeNull();
    expect(view.lastOutcome).toBeNull();
    expect(view).not.toHaveProperty('finalWagers');
    expect(view).not.toHaveProperty('finalAnswers');
  });

  it('projectBoard includes the current round categories and public clues', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);
    const view = projectBoard(state, NOW);

    expect(view.round).not.toBeNull();
    expect(view.round?.categories).toHaveLength(2);
    expect(view.round?.categories[0].title).toBe('Science');
    expect(view.round?.categories[1].title).toBe('History');
    expect(view.round?.categories[0].clues).toHaveLength(2);
    expect(view.round?.categories[0].clues[0]).toEqual({
      id: 'cl1',
      categoryId: 'c1',
      row: 0,
      value: 100,
    });
    expect(view.round?.categories[0].clues[1]).toEqual({
      id: 'cl2',
      categoryId: 'c1',
      row: 1,
      value: 200,
    });
  });

  it('projectBoard never exposes clue answers or daily double flags on the public clues', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);
    const view = projectBoard(state, NOW);

    const allClues = view.round?.categories.flatMap((c) => c.clues) ?? [];
    for (const clue of allClues) {
      expect(clue).not.toHaveProperty('answer');
      expect(clue).not.toHaveProperty('clueText');
      expect(clue).not.toHaveProperty('isDailyDouble');
    }
  });

  it('projectBoard includes the current clue text only when a clue is revealed', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);

    const select = { ...state, phase: 'CLUE_REVEALED' as const, currentClueId: 'cl1' };
    expect(projectBoard(select, NOW).currentClueText).toBe('H2O is this compound');

    const ddWager = { ...state, phase: 'DAILY_DOUBLE_WAGER' as const, currentClueId: 'cl2' };
    expect(projectBoard(ddWager, NOW).currentClueText).toBeNull();

    const noClue = { ...state, phase: 'BOARD_SELECT' as const };
    expect(projectBoard(noClue, NOW).currentClueText).toBeNull();
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

    const view = projectBoard(state, NOW);

    expect(view.players).toEqual([
      { id: 'p1', name: 'Alice', score: 0, connected: true },
      { id: 'p2', name: 'Bob', score: 0, connected: false },
    ]);
  });

  it('projectBoard exposes the controlling player id', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const withPlayer = { ...state, players: [alice], controllingPlayerId: alice.id };

    expect(projectBoard(withPlayer, NOW).controllingPlayerId).toBe(alice.id);
  });

  it('projectHost includes the current clue answer and full round details', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);
    const view = projectHost(state, NOW);

    expect(view.answer).toBeNull();
    expect(view.round?.categories[0].clues[0]).toEqual(
      expect.objectContaining({
        id: 'cl1',
        answer: 'Water',
        clueText: 'H2O is this compound',
        isDailyDouble: false,
      }),
    );

    const withClue = { ...state, currentClueId: 'cl1' };
    const hostView = projectHost(withClue, NOW);

    expect(hostView.answer).toBe('Water');
    expect(hostView.round?.categories[0].clues[1].isDailyDouble).toBe(true);
    expect(hostView).not.toHaveProperty('finalWagers');
    expect(hostView).not.toHaveProperty('finalAnswers');
  });

  it('projectContestant never includes answers or other secrets', () => {
    const board = makeBoard();
    let state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = { ...state, players: [alice], currentClueId: 'cl1' };

    const view = projectContestant(state, alice.id, NOW);

    expect(view.playerId).toBe(alice.id);
    expect(view.isControllingPlayer).toBe(false);
    expect(view.answer).toBeNull();
    expect(view).not.toHaveProperty('finalWagers');
    expect(view).not.toHaveProperty('finalAnswers');
    expect(view.round?.categories[0].clues[0]).not.toHaveProperty('answer');
  });

  it('projectBoard reveals the answer only after a ruling or timeout', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);
    const revealed = { ...state, phase: 'BOARD_SELECT' as const, revealedAnswer: 'Water' };
    const view = projectBoard(revealed, NOW);
    expect(view.answer).toBe('Water');
  });

  it('projectBoard does not reveal the answer while a clue is active', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);
    const active = { ...state, phase: 'CLUE_REVEALED' as const, currentClueId: 'cl1' };
    expect(projectBoard(active, NOW).answer).toBeNull();
  });

  it('projectContestant reveals the answer only after it is revealed to the board', () => {
    const board = makeBoard();
    let state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = { ...state, players: [alice], revealedAnswer: 'Water' };
    const view = projectContestant(state, alice.id, NOW);
    expect(view.answer).toBe('Water');
  });

  it('projectBoard exposes the deadline and serverNow for a server-authoritative countdown', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);
    const armed = { ...state, phase: 'BUZZERS_ARMED' as const, deadline: NOW + 25_000 };

    const view = projectBoard(armed, NOW);

    expect(view.deadline).toBe(NOW + 25_000);
    expect(view.serverNow).toBe(NOW);
    expect(view.answer).toBeNull();
  });

  it('projectContestant exposes the deadline and serverNow for a server-authoritative countdown', () => {
    const board = makeBoard();
    const state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const armed = { ...state, players: [alice], phase: 'BUZZERS_ARMED' as const, deadline: NOW + 25_000 };

    const view = projectContestant(armed, alice.id, NOW);

    expect(view.deadline).toBe(NOW + 25_000);
    expect(view.serverNow).toBe(NOW);
    expect(view.answer).toBeNull();
  });

  it('projectContestant reflects the early-buzz lockout for the affected player', () => {
    const board = makeBoard();
    let state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = {
      ...state,
      players: [alice],
      phase: 'CLUE_REVEALED' as const,
      currentClueId: 'cl1',
      lockoutUntil: { p1: NOW + 250 },
    };

    const view = projectContestant(state, alice.id, NOW);

    expect(view.isLockedOut).toBe(true);
    expect(view.lockoutUntil).toBe(NOW + 250);
  });

  it('all role projections agree on scores, phase, control, and revealed answer after a correct ruling', () => {
    const board = makeBoard();
    let state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice', score: 0 });
    const bob = makePlayer({ id: 'p2', name: 'Bob', score: 0 });
    state = { ...state, players: [alice, bob], controllingPlayerId: alice.id };

    state = {
      ...state,
      phase: 'BOARD_SELECT' as const,
      currentClueId: null,
      revealedAnswer: 'Water',
      lastOutcome: { playerId: bob.id, type: 'CORRECT', value: 100 },
      usedClueIds: ['cl1'],
      players: [
        { ...alice, score: 0 },
        { ...bob, score: 100 },
      ],
      controllingPlayerId: bob.id,
    };

    const boardView = projectBoard(state, NOW);
    const hostView = projectHost(state, NOW);
    const contestantView = projectContestant(state, alice.id, NOW);

    expect(boardView.phase).toBe('BOARD_SELECT');
    expect(hostView.phase).toBe('BOARD_SELECT');
    expect(contestantView.phase).toBe('BOARD_SELECT');

    expect(boardView.controllingPlayerId).toBe(bob.id);
    expect(hostView.controllingPlayerId).toBe(bob.id);
    expect(contestantView.controllingPlayerId).toBe(bob.id);

    expect(boardView.answer).toBe('Water');
    expect(hostView.answer).toBe('Water');
    expect(contestantView.answer).toBe('Water');

    expect(boardView.players).toEqual([
      { id: alice.id, name: 'Alice', score: 0, connected: true },
      { id: bob.id, name: 'Bob', score: 100, connected: true },
    ]);
    expect(hostView.players).toEqual(boardView.players);
    expect(contestantView.players).toEqual(boardView.players);

    expect(boardView.lastOutcome).toEqual({ playerId: bob.id, type: 'CORRECT', value: 100 });
    expect(hostView.lastOutcome).toEqual(boardView.lastOutcome);
    expect(contestantView.lastOutcome).toEqual(boardView.lastOutcome);
  });

  it('all role projections expose the incorrect outcome on re-arm without revealing the answer to board or contestants', () => {
    const board = makeBoard();
    let state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice', score: -100 });
    const bob = makePlayer({ id: 'p2', name: 'Bob', score: 0 });
    state = {
      ...state,
      players: [alice, bob],
      controllingPlayerId: alice.id,
    };

    state = {
      ...state,
      phase: 'BUZZERS_ARMED' as const,
      currentClueId: 'cl1',
      revealedAnswer: null,
      lastOutcome: { playerId: alice.id, type: 'INCORRECT', value: 100 },
      lockedOutPlayerIds: [alice.id],
      deadline: NOW + 10_000,
    };

    const boardView = projectBoard(state, NOW);
    const hostView = projectHost(state, NOW);
    const contestantView = projectContestant(state, bob.id, NOW);

    expect(boardView.phase).toBe('BUZZERS_ARMED');
    expect(hostView.phase).toBe('BUZZERS_ARMED');
    expect(contestantView.phase).toBe('BUZZERS_ARMED');

    expect(boardView.lastOutcome).toEqual({ playerId: alice.id, type: 'INCORRECT', value: 100 });
    expect(hostView.lastOutcome).toEqual(boardView.lastOutcome);
    expect(contestantView.lastOutcome).toEqual(boardView.lastOutcome);

    expect(boardView.answer).toBeNull();
    expect(contestantView.answer).toBeNull();
    // The host always sees the answer for the current clue.
    expect(hostView.answer).toBe('Water');

    expect(boardView.players).toEqual([
      { id: alice.id, name: 'Alice', score: -100, connected: true },
      { id: bob.id, name: 'Bob', score: 0, connected: true },
    ]);
    expect(hostView.players).toEqual(boardView.players);
    expect(contestantView.players).toEqual(boardView.players);
  });
});

describe('Daily Double secrecy', () => {
  it('projectBoard never exposes the Daily Double wager', () => {
    const board = makeBoard();
    let state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = { ...state, players: [alice], controllingPlayerId: alice.id, currentClueId: 'cl2', dailyDoubleWager: 500 };

    const wagerView = projectBoard({ ...state, phase: 'DAILY_DOUBLE_WAGER' }, NOW);
    const clueView = projectBoard({ ...state, phase: 'DAILY_DOUBLE_CLUE' }, NOW);

    expect(wagerView.dailyDoubleWager).toBeNull();
    expect(clueView.dailyDoubleWager).toBeNull();
  });

  it('projectBoard hides the clue text and answer during the Daily Double phases', () => {
    const board = makeBoard();
    let state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = { ...state, players: [alice], controllingPlayerId: alice.id, currentClueId: 'cl2', dailyDoubleWager: 500 };

    const wagerView = projectBoard({ ...state, phase: 'DAILY_DOUBLE_WAGER' }, NOW);
    const clueView = projectBoard({ ...state, phase: 'DAILY_DOUBLE_CLUE' }, NOW);

    expect(wagerView.currentClueText).toBeNull();
    expect(wagerView.answer).toBeNull();
    expect(clueView.currentClueText).toBe('This planet is known as the Red Planet');
    expect(clueView.answer).toBeNull();
  });

  it('projectHost exposes the Daily Double wager to the host', () => {
    const board = makeBoard();
    let state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = { ...state, players: [alice], controllingPlayerId: alice.id, currentClueId: 'cl2', dailyDoubleWager: 500 };

    const hostView = projectHost({ ...state, phase: 'DAILY_DOUBLE_WAGER' }, NOW);

    expect(hostView.dailyDoubleWager).toBe(500);
  });

  it('projectContestant exposes the wager only to the controlling contestant', () => {
    const board = makeBoard();
    let state = createInitialState('s1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });
    state = { ...state, players: [alice, bob], controllingPlayerId: alice.id, currentClueId: 'cl2', dailyDoubleWager: 500 };

    const controllerView = projectContestant({ ...state, phase: 'DAILY_DOUBLE_WAGER' }, alice.id, NOW);
    const otherView = projectContestant({ ...state, phase: 'DAILY_DOUBLE_WAGER' }, bob.id, NOW);

    expect(controllerView.dailyDoubleWager).toBe(500);
    expect(controllerView.canWager).toBe(true);
    expect(otherView.dailyDoubleWager).toBeNull();
    expect(otherView.canWager).toBe(false);
  });
});
