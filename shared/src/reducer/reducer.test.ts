import { describe, expect, it } from 'vitest';
import { createInitialState, reduce } from './index.js';
import type { Board, GameState, Player } from '../models/index.js';

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
      {
        id: 'r2',
        type: 'FINAL',
        order: 1,
        categories: [
          {
            id: 'c3',
            roundId: 'r2',
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

const NOW = 1_000_000;

describe('createInitialState', () => {
  it('creates a LOBBY state with the provided board and no players', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);

    expect(state.sessionId).toBe('session-1');
    expect(state.roomCode).toBe('ABCD');
    expect(state.boardId).toBe(board.id);
    expect(state.board).toBe(board);
    expect(state.phase).toBe('LOBBY');
    expect(state.roundIndex).toBe(0);
    expect(state.players).toEqual([]);
    expect(state.controllingPlayerId).toBeNull();
    expect(state.usedClueIds).toEqual([]);
    expect(state.currentClueId).toBeNull();
    expect(state.buzzWinnerId).toBeNull();
    expect(state.deadline).toBeNull();
    expect(state.dailyDoubleWager).toBeNull();
    expect(state.finalWagers).toEqual({});
    expect(state.finalAnswers).toEqual({});
    expect(state.revealedAnswer).toBeNull();
    expect(state.lastOutcome).toBeNull();
  });
});

describe('LOBBY intents', () => {
  it('JOIN adds a connected player in the lobby', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const player = makePlayer();

    const result = reduce(state, { type: 'JOIN', player }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.players).toHaveLength(1);
    expect(result.state.players[0]).toEqual(player);
    expect(result.state.phase).toBe('LOBBY');
  });

  it('JOIN assigns the next available seat order', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', seatOrder: 0, name: 'Alice' });
    const bob = makePlayer({ id: 'p2', seatOrder: 1, name: 'Bob' });
    const carol = makePlayer({ id: 'p3', seatOrder: 2, name: 'Carol' });

    let result = reduce(state, { type: 'JOIN', player: alice }, { now: NOW });
    result = reduce(result.state, { type: 'JOIN', player: bob }, { now: NOW });
    result = reduce(result.state, { type: 'JOIN', player: carol }, { now: NOW });

    expect(result.state.players.map((p) => p.seatOrder)).toEqual([0, 1, 2]);
  });

  it('JOIN rejects a sixth player', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const players = Array.from({ length: 5 }, (_, i) =>
      makePlayer({ id: `p${i + 1}`, seatOrder: i, name: `Player ${i + 1}`, reconnectToken: `token-${i}` }),
    );
    let current = state;
    for (const player of players) {
      current = reduce(current, { type: 'JOIN', player }, { now: NOW }).state;
    }

    const sixth = makePlayer({ id: 'p6', seatOrder: 5, name: 'Too Many', reconnectToken: 'token-6' });
    const result = reduce(current, { type: 'JOIN', player: sixth }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('full') });
    expect(result.state.players).toHaveLength(5);
  });

  it('JOIN rejects a duplicate name', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const duplicate = makePlayer({ id: 'p2', name: 'alice', reconnectToken: 'token-bob' });

    let result = reduce(state, { type: 'JOIN', player: alice }, { now: NOW });
    result = reduce(result.state, { type: 'JOIN', player: duplicate }, { now: NOW });

    expect(result.effects).toContainEqual({
      type: 'INTENT_REJECTED',
      reason: expect.stringContaining('name'),
    });
    expect(result.state.players).toHaveLength(1);
  });

  it('LEAVE removes a player from the lobby and frees the seat', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });

    let result = reduce(state, { type: 'JOIN', player: alice }, { now: NOW });
    result = reduce(result.state, { type: 'JOIN', player: bob }, { now: NOW });
    result = reduce(result.state, { type: 'LEAVE', playerId: alice.id }, { now: NOW });

    expect(result.state.players).toHaveLength(1);
    expect(result.state.players[0].id).toBe(bob.id);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('START_GAME transitions from LOBBY to BOARD_SELECT and sets the first player as controller', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });

    let result = reduce(state, { type: 'JOIN', player: alice }, { now: NOW });
    result = reduce(result.state, { type: 'JOIN', player: bob }, { now: NOW });
    result = reduce(result.state, { type: 'START_GAME' }, { now: NOW });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.controllingPlayerId).toBe(alice.id);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('START_GAME is rejected with no players', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);

    const result = reduce(state, { type: 'START_GAME' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('connected contestant') });
    expect(result.state.phase).toBe('LOBBY');
  });

  it('START_GAME is rejected when all players are disconnected', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });

    let result = reduce(state, { type: 'JOIN', player: alice }, { now: NOW });
    result = reduce(result.state, { type: 'JOIN', player: bob }, { now: NOW });
    result = reduce(result.state, { type: 'DISCONNECT', playerId: alice.id }, { now: NOW });
    result = reduce(result.state, { type: 'DISCONNECT', playerId: bob.id }, { now: NOW });
    result = reduce(result.state, { type: 'START_GAME' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('connected contestant') });
    expect(result.state.phase).toBe('LOBBY');
  });

  it('START_GAME succeeds when at least one player is connected', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice', connected: true });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob', connected: false });

    let result = reduce(state, { type: 'JOIN', player: alice }, { now: NOW });
    result = reduce(result.state, { type: 'JOIN', player: bob }, { now: NOW });
    result = reduce(result.state, { type: 'START_GAME' }, { now: NOW });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.controllingPlayerId).toBe(alice.id);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('RECONNECT marks a disconnected player as connected', () => {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'JOIN', player: bob }, { now: NOW }).state;
    state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
    state = reduce(state, { type: 'DISCONNECT', playerId: alice.id }, { now: NOW }).state;

    const result = reduce(state, { type: 'RECONNECT', playerId: alice.id }, { now: NOW });

    expect(result.state.players.find((p) => p.id === alice.id)?.connected).toBe(true);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('DISCONNECT keeps a LOBBY player in the roster but marks them offline', () => {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;

    const result = reduce(state, { type: 'DISCONNECT', playerId: alice.id }, { now: NOW });

    expect(result.state.players).toHaveLength(1);
    expect(result.state.players[0].connected).toBe(false);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });
});

describe('SELECT_CLUE', () => {
  function setupGame(): GameState {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'JOIN', player: bob }, { now: NOW }).state;
    return reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
  }

  it('lets the controlling player select an unused clue and reveals it', () => {
    const state = setupGame();
    const result = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: state.controllingPlayerId }, { now: NOW });

    expect(result.state.phase).toBe('CLUE_REVEALED');
    expect(result.state.currentClueId).toBe('cl1');
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('lets the host override select any unused clue', () => {
    const state = setupGame();
    const result = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', hostOverride: true }, { now: NOW });

    expect(result.state.phase).toBe('CLUE_REVEALED');
    expect(result.state.currentClueId).toBe('cl1');
  });

  it('rejects selection by a non-controlling player', () => {
    const state = setupGame();
    const nonController = state.players.find((p) => p.id !== state.controllingPlayerId);
    const result = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: nonController?.id }, { now: NOW });

    expect(result.effects).toContainEqual({
      type: 'INTENT_REJECTED',
      reason: expect.stringContaining('controlling player'),
    });
    expect(result.state.phase).toBe('BOARD_SELECT');
  });

  it('rejects selection outside BOARD_SELECT', () => {
    const state = setupGame();
    const revealed = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: state.controllingPlayerId }, { now: NOW }).state;
    const result = reduce(revealed, { type: 'SELECT_CLUE', clueId: 'cl3', selectorId: state.controllingPlayerId }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('right now') });
  });

  it('rejects a used clue', () => {
    const state = setupGame();
    const used = { ...state, usedClueIds: ['cl1'] };
    const result = reduce(used, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: state.controllingPlayerId }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('already been used') });
  });

  it('transitions to DAILY_DOUBLE_WAGER for a daily double', () => {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;

    const result = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl2', selectorId: state.controllingPlayerId }, { now: NOW });

    expect(result.state.phase).toBe('DAILY_DOUBLE_WAGER');
    expect(result.state.currentClueId).toBe('cl2');
  });
});

describe('REVEAL_ANSWER', () => {
  it('marks the current clue used and returns to BOARD_SELECT', () => {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: state.controllingPlayerId }, { now: NOW }).state;

    const result = reduce(state, { type: 'REVEAL_ANSWER' }, { now: NOW });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.currentClueId).toBeNull();
    expect(result.state.usedClueIds).toContain('cl1');
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('is rejected when no clue is revealed', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);

    const result = reduce(state, { type: 'REVEAL_ANSWER' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('No clue') });
  });

  it('resolves the clue and reveals the answer when no one has buzzed', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;

    const result = reduce(state, { type: 'REVEAL_ANSWER' }, { now: NOW + 1000 });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.usedClueIds).toContain('cl1');
    expect(result.state.revealedAnswer).toBe('Water');
    expect(result.state.players.every((p) => p.score === 0)).toBe(true);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('is rejected when a contestant has already buzzed in', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;

    const result = reduce(state, { type: 'REVEAL_ANSWER' }, { now: NOW + 100 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('right now') });
    expect(result.state.phase).toBe('BUZZED');
  });
});

function setupClueRevealed(): GameState {
  const board = makeBoard();
  let state = createInitialState('session-1', 'ABCD', board);
  const alice = makePlayer({ id: 'p1', name: 'Alice' });
  const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });
  state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
  state = reduce(state, { type: 'JOIN', player: bob }, { now: NOW }).state;
  state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
  return reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: state.controllingPlayerId }, { now: NOW }).state;
}

describe('ARM_BUZZERS', () => {
  it('arms buzzers from CLUE_REVEALED and sets a deadline', () => {
    const state = setupClueRevealed();

    const result = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW });

    expect(result.state.phase).toBe('BUZZERS_ARMED');
    expect(result.state.armedAt).toBe(NOW);
    expect(result.state.deadline).toBe(NOW + state.board.defaultTimerSeconds * 1000);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('uses the board-configured per-clue timer duration', () => {
    const board = makeBoard();
    board.defaultTimerSeconds = 25;
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'JOIN', player: bob }, { now: NOW }).state;
    state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: state.controllingPlayerId }, { now: NOW }).state;

    const result = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW });

    expect(result.state.deadline).toBe(NOW + 25_000);
  });

  it('is rejected outside CLUE_REVEALED', () => {
    const state = setupClueRevealed();
    const armed = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;

    const result = reduce(armed, { type: 'ARM_BUZZERS' }, { now: NOW + 1 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('arm') });
    expect(result.state.phase).toBe('BUZZERS_ARMED');
  });
});

describe('BUZZ', () => {
  it('rejects a buzz before arming and applies a 250ms lockout', () => {
    const state = setupClueRevealed();

    const result = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW });

    expect(result.state.phase).toBe('CLUE_REVEALED');
    expect(result.state.lockoutUntil['p1']).toBe(NOW + 250);
    expect(result.state.buzzWinnerId).toBeNull();
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('accepts the first buzz after arming and locks out later buzzers', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;

    const first = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 });
    expect(first.state.phase).toBe('BUZZED');
    expect(first.state.buzzWinnerId).toBe('p1');
    expect(first.state.deadline).toBeNull();
    expect(first.effects).toContainEqual({ type: 'BROADCAST_STATE' });

    const second = reduce(first.state, { type: 'BUZZ', playerId: 'p2' }, { now: NOW + 20 });
    expect(second.state.phase).toBe('BUZZED');
    expect(second.state.buzzWinnerId).toBe('p1');
    expect(second.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('already buzzed') });
  });

  it('rejects a buzz from a player locked out by an early press', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW }).state;
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW + 50 }).state;

    const result = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 100 });

    expect(result.state.phase).toBe('BUZZERS_ARMED');
    expect(result.state.buzzWinnerId).toBeNull();
    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('locked out') });
  });

  it('allows a player to buzz after their early-buzz lockout expires', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW }).state;
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW + 300 }).state;

    const result = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 550 });

    expect(result.state.phase).toBe('BUZZED');
    expect(result.state.buzzWinnerId).toBe('p1');
  });

  it('rejects a buzz from a disconnected player', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'DISCONNECT', playerId: 'p1' }, { now: NOW }).state;
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;

    const result = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('connected') });
    expect(result.state.buzzWinnerId).toBeNull();
  });

  it('rejects a buzz from a non-existent player', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;

    const result = reduce(state, { type: 'BUZZ', playerId: 'ghost' }, { now: NOW + 10 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('Player not found') });
    expect(result.state.buzzWinnerId).toBeNull();
  });
});

describe('RULE_CORRECT', () => {
  it('adds the clue value, passes control, and returns to BOARD_SELECT', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p2' }, { now: NOW + 10 }).state;

    const result = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 100 });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.players.find((p) => p.id === 'p2')?.score).toBe(100);
    expect(result.state.controllingPlayerId).toBe('p2');
    expect(result.state.usedClueIds).toContain('cl1');
    expect(result.state.currentClueId).toBeNull();
    expect(result.state.buzzWinnerId).toBeNull();
    expect(result.state.armedAt).toBeNull();
    expect(result.state.deadline).toBeNull();
    expect(result.state.lockedOutPlayerIds).toEqual([]);
    expect(result.state.auditLog).toHaveLength(1);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('is rejected when no one has buzzed in', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;

    const result = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 10 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('buzzed') });
  });
});

describe('RULE_INCORRECT', () => {
  it('deducts the value, locks the player, and re-arms the remaining contestants', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;

    const result = reduce(state, { type: 'RULE_INCORRECT', playerId: 'p1' }, { now: NOW + 100 });

    expect(result.state.phase).toBe('BUZZERS_ARMED');
    expect(result.state.players.find((p) => p.id === 'p1')?.score).toBe(-100);
    expect(result.state.lockedOutPlayerIds).toContain('p1');
    expect(result.state.buzzWinnerId).toBeNull();
    expect(result.state.armedAt).toBe(NOW + 100);
    expect(result.state.deadline).toBe(NOW + 100 + state.board.defaultTimerSeconds * 1000);
    expect(result.state.auditLog).toHaveLength(1);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('restarts the countdown to the full duration after an incorrect ruling', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 5000 }).state;

    const result = reduce(state, { type: 'RULE_INCORRECT', playerId: 'p1' }, { now: NOW + 7000 });

    expect(result.state.phase).toBe('BUZZERS_ARMED');
    expect(result.state.deadline).toBe(NOW + 7000 + state.board.defaultTimerSeconds * 1000);
  });

  it('resolves the clue when everyone is locked out after a wrong answer', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;
    state = reduce(state, { type: 'RULE_INCORRECT', playerId: 'p1' }, { now: NOW + 100 }).state;

    const result = reduce(state, { type: 'BUZZ', playerId: 'p2' }, { now: NOW + 120 });
    expect(result.state.phase).toBe('BUZZED');

    const resolved = reduce(result.state, { type: 'RULE_INCORRECT', playerId: 'p2' }, { now: NOW + 200 });
    expect(resolved.state.phase).toBe('BOARD_SELECT');
    expect(resolved.state.usedClueIds).toContain('cl1');
    expect(resolved.state.currentClueId).toBeNull();
    expect(resolved.state.controllingPlayerId).toBe('p1');
  });
});

describe('TIME_EXPIRE', () => {
  it('returns to BOARD_SELECT and marks the clue used when no one buzzes', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;

    const result = reduce(state, { type: 'TIME_EXPIRE' }, { now: NOW + state.board.defaultTimerSeconds * 1000 });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.usedClueIds).toContain('cl1');
    expect(result.state.currentClueId).toBeNull();
    expect(result.state.buzzWinnerId).toBeNull();
    expect(result.state.deadline).toBeNull();
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });
});

describe('answer reveal and outcome feedback', () => {
  it('RULE_CORRECT reveals the answer and records the outcome', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p2' }, { now: NOW + 10 }).state;

    const result = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 100 });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.revealedAnswer).toBe('Water');
    expect(result.state.lastOutcome).toEqual({ playerId: 'p2', type: 'CORRECT', value: 100 });
    expect(result.state.controllingPlayerId).toBe('p2');
  });

  it('RULE_INCORRECT on re-arm records the outcome without revealing the answer', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;

    const result = reduce(state, { type: 'RULE_INCORRECT', playerId: 'p1' }, { now: NOW + 100 });

    expect(result.state.phase).toBe('BUZZERS_ARMED');
    expect(result.state.revealedAnswer).toBeNull();
    expect(result.state.lastOutcome).toEqual({ playerId: 'p1', type: 'INCORRECT', value: 100 });
  });

  it('RULE_INCORRECT with full lockout reveals the answer and records the outcome', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;
    state = reduce(state, { type: 'RULE_INCORRECT', playerId: 'p1' }, { now: NOW + 100 }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p2' }, { now: NOW + 120 }).state;

    const result = reduce(state, { type: 'RULE_INCORRECT', playerId: 'p2' }, { now: NOW + 200 });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.revealedAnswer).toBe('Water');
    expect(result.state.lastOutcome).toEqual({ playerId: 'p2', type: 'INCORRECT', value: 100 });
    expect(result.state.controllingPlayerId).toBe('p1');
  });

  it('TIME_EXPIRE reveals the answer with no score change', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;

    const result = reduce(state, { type: 'TIME_EXPIRE' }, { now: NOW + state.board.defaultTimerSeconds * 1000 });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.revealedAnswer).toBe('Water');
    expect(result.state.lastOutcome).toBeNull();
    expect(result.state.players.every((p) => p.score === 0)).toBe(true);
  });

  it('REVEAL_ANSWER reveals the answer and resolves the clue', () => {
    const state = setupClueRevealed();

    const result = reduce(state, { type: 'REVEAL_ANSWER' }, { now: NOW });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.revealedAnswer).toBe('Water');
    expect(result.state.lastOutcome).toBeNull();
    expect(result.state.usedClueIds).toContain('cl1');
  });

  it('SELECT_CLUE clears the previous revealed answer and outcome', () => {
    let state = setupClueRevealed();
    state = {
      ...state,
      phase: 'BOARD_SELECT' as const,
      revealedAnswer: 'Water',
      lastOutcome: { playerId: 'p1', type: 'CORRECT', value: 100 },
    };

    const result = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl3', selectorId: state.controllingPlayerId }, { now: NOW });

    expect(result.state.revealedAnswer).toBeNull();
    expect(result.state.lastOutcome).toBeNull();
    expect(result.state.currentClueId).toBe('cl3');
  });
});
