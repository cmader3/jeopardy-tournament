import { describe, expect, it } from 'vitest';
import { createInitialState, reduce } from './index.js';
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
                id: 'cl2',
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
            id: 'cl2',
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

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('player') });
    expect(result.state.phase).toBe('LOBBY');
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
