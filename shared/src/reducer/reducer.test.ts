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

describe('REMOVE_PLAYER', () => {
  it('removes a player from the lobby and frees the seat', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });

    let result = reduce(state, { type: 'JOIN', player: alice }, { now: NOW });
    result = reduce(result.state, { type: 'JOIN', player: bob }, { now: NOW });
    result = reduce(result.state, { type: 'REMOVE_PLAYER', playerId: alice.id }, { now: NOW });

    expect(result.state.players).toHaveLength(1);
    expect(result.state.players[0].id).toBe(bob.id);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('rejects removing an unknown player', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const joined = reduce(state, { type: 'JOIN', player: alice }, { now: NOW });

    const result = reduce(joined.state, { type: 'REMOVE_PLAYER', playerId: 'nope' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: 'Player not found' });
    expect(result.state.players).toHaveLength(1);
  });

  it('removes a player once the game is underway and clears their control', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });

    let result = reduce(state, { type: 'JOIN', player: alice }, { now: NOW });
    result = reduce(result.state, { type: 'JOIN', player: bob }, { now: NOW });
    result = reduce(result.state, { type: 'START_GAME' }, { now: NOW });

    const controllerId = result.state.controllingPlayerId;
    expect(controllerId).not.toBeNull();

    result = reduce(result.state, { type: 'REMOVE_PLAYER', playerId: controllerId! }, { now: NOW });

    expect(result.state.players).toHaveLength(1);
    expect(result.state.players.some((p) => p.id === controllerId)).toBe(false);
    expect(result.state.controllingPlayerId).toBeNull();
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('clears buzz and lockout references when removing a buzzed-in player mid-game', () => {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'JOIN', player: bob }, { now: NOW }).state;
    state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', hostOverride: true }, { now: NOW }).state;
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;
    expect(state.buzzWinnerId).toBe('p1');

    const result = reduce(state, { type: 'REMOVE_PLAYER', playerId: 'p1' }, { now: NOW + 20 });

    expect(result.state.players.some((p) => p.id === 'p1')).toBe(false);
    expect(result.state.buzzWinnerId).toBeNull();
    expect(result.state.lockedOutPlayerIds).not.toContain('p1');
  });
});

describe('host removal ban', () => {
  it('records a removed player and blocks them from rejoining under the same name', () => {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'REMOVE_PLAYER', playerId: alice.id }, { now: NOW }).state;

    expect(state.removedPlayers).toEqual([{ id: 'p1', name: 'Alice' }]);

    const rejoin = reduce(
      state,
      { type: 'JOIN', player: makePlayer({ id: 'p1b', name: 'alice', reconnectToken: 'token-2' }) },
      { now: NOW },
    );

    expect(rejoin.effects).toContainEqual({
      type: 'INTENT_REJECTED',
      reason: 'The host removed you from this game. Ask the host to let you back in.',
    });
    expect(rejoin.state.players).toHaveLength(0);
  });

  it('lets the host admit a removed player so they can rejoin', () => {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'REMOVE_PLAYER', playerId: alice.id }, { now: NOW }).state;

    const admit = reduce(state, { type: 'ADMIT_PLAYER', playerId: 'p1' }, { now: NOW });
    expect(admit.state.removedPlayers).toHaveLength(0);
    expect(admit.effects).toContainEqual({ type: 'BROADCAST_STATE' });

    const rejoin = reduce(
      admit.state,
      { type: 'JOIN', player: makePlayer({ id: 'p1c', name: 'Alice', reconnectToken: 'token-3' }) },
      { now: NOW },
    );
    expect(rejoin.state.players.some((p) => p.name === 'Alice')).toBe(true);
  });

  it('rejects admitting a player who was not removed', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    const result = reduce(state, { type: 'ADMIT_PLAYER', playerId: 'ghost' }, { now: NOW });
    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: 'Player was not removed' });
  });

  it('clears removed players when the game restarts', () => {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'JOIN', player: bob }, { now: NOW }).state;
    state = reduce(state, { type: 'REMOVE_PLAYER', playerId: alice.id }, { now: NOW }).state;
    expect(state.removedPlayers).toHaveLength(1);

    const restarted = reduce(state, { type: 'RESTART_GAME' }, { now: NOW });
    expect(restarted.state.removedPlayers).toHaveLength(0);
  });
});

describe('REOPEN_CLUE', () => {
  function playClueCorrect(): GameState {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'JOIN', player: bob }, { now: NOW }).state;
    state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', hostOverride: true }, { now: NOW }).state;
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;
    return reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 20 }).state;
  }

  it('reopens a used clue without changing scores', () => {
    const state = playClueCorrect();
    expect(state.usedClueIds).toContain('cl1');
    const scoreBefore = state.players.find((p) => p.id === 'p1')!.score;
    expect(scoreBefore).toBeGreaterThan(0);

    const result = reduce(state, { type: 'REOPEN_CLUE', clueId: 'cl1', revertScores: false }, { now: NOW + 30 });

    expect(result.state.usedClueIds).not.toContain('cl1');
    expect(result.state.players.find((p) => p.id === 'p1')!.score).toBe(scoreBefore);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('reopens a used clue and reverts the points it awarded', () => {
    const state = playClueCorrect();
    const result = reduce(state, { type: 'REOPEN_CLUE', clueId: 'cl1', revertScores: true }, { now: NOW + 30 });

    expect(result.state.usedClueIds).not.toContain('cl1');
    expect(result.state.players.find((p) => p.id === 'p1')!.score).toBe(0);
    expect(result.state.auditLog.some((r) => r.clueId === 'cl1')).toBe(false);
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('reverts a deducted incorrect ruling when reopening with revert', () => {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', hostOverride: true }, { now: NOW }).state;
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;
    state = reduce(state, { type: 'RULE_INCORRECT', playerId: 'p1' }, { now: NOW + 20 }).state;
    expect(state.phase).toBe('BOARD_SELECT');
    expect(state.usedClueIds).toContain('cl1');
    expect(state.players.find((p) => p.id === 'p1')!.score).toBeLessThan(0);

    const result = reduce(state, { type: 'REOPEN_CLUE', clueId: 'cl1', revertScores: true }, { now: NOW + 30 });

    expect(result.state.players.find((p) => p.id === 'p1')!.score).toBe(0);
    expect(result.state.usedClueIds).not.toContain('cl1');
  });

  it('rejects reopening a clue while another clue is open', () => {
    let state = setupClueRevealed();
    state = { ...state, usedClueIds: ['cl2'] };

    const result = reduce(state, { type: 'REOPEN_CLUE', clueId: 'cl2', revertScores: false }, { now: NOW });

    expect(result.effects).toContainEqual({
      type: 'INTENT_REJECTED',
      reason: expect.stringContaining('between clues'),
    });
    expect(result.state.usedClueIds).toContain('cl2');
  });

  it('rejects reopening a clue that has not been played', () => {
    const state = playClueCorrect();

    const result = reduce(state, { type: 'REOPEN_CLUE', clueId: 'cl2', revertScores: false }, { now: NOW + 30 });

    expect(result.effects).toContainEqual({
      type: 'INTENT_REJECTED',
      reason: expect.stringContaining('not been played'),
    });
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

  it('rejects a controlling-player selection in host-pick mode', () => {
    const state = setupGame();
    const picker = state.controllingPlayerId ?? undefined;
    const result = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: picker }, { now: NOW });

    expect(result.effects).toContainEqual({
      type: 'INTENT_REJECTED',
      reason: expect.stringContaining('host'),
    });
    expect(result.state.phase).toBe('BOARD_SELECT');
  });

  it('lets the host select an unused clue and reveals it immediately in host-pick mode', () => {
    const state = setupGame();
    const result = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', hostOverride: true }, { now: NOW });

    expect(result.state.phase).toBe('CLUE_REVEALED');
    expect(result.state.currentClueId).toBe('cl1');
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('lets the controlling player pick a clue in player-pick mode without revealing it', () => {
    const playerState = { ...setupGame(), clueSelectionMode: 'PLAYER' as const };
    const picker = playerState.controllingPlayerId ?? undefined;
    const result = reduce(playerState, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: picker }, { now: NOW });

    expect(result.state.phase).toBe('CLUE_SELECTED');
    expect(result.state.pendingClueId).toBe('cl1');
    expect(result.state.currentClueId).toBeNull();
    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
  });

  it('rejects selection by a non-controlling player in player-pick mode', () => {
    const playerState = { ...setupGame(), clueSelectionMode: 'PLAYER' as const };
    const nonController = playerState.players.find((p) => p.id !== playerState.controllingPlayerId);
    const result = reduce(playerState, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: nonController?.id }, { now: NOW });

    expect(result.effects).toContainEqual({
      type: 'INTENT_REJECTED',
      reason: expect.stringContaining('controlling player'),
    });
    expect(result.state.phase).toBe('BOARD_SELECT');
  });

  it('rejects selection outside BOARD_SELECT', () => {
    const state = setupGame();
    const revealed = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', hostOverride: true }, { now: NOW }).state;
    const result = reduce(revealed, { type: 'SELECT_CLUE', clueId: 'cl3', hostOverride: true }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('right now') });
  });

  it('rejects a used clue', () => {
    const state = setupGame();
    const used = { ...state, usedClueIds: ['cl1'] };
    const result = reduce(used, { type: 'SELECT_CLUE', clueId: 'cl1', hostOverride: true }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('already been used') });
  });

  it('transitions to DAILY_DOUBLE_WAGER for a daily double', () => {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;

    const result = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl2', hostOverride: true }, { now: NOW });

    expect(result.state.phase).toBe('DAILY_DOUBLE_WAGER');
    expect(result.state.currentClueId).toBe('cl2');
  });

  it('rejects revealing a selected clue when none is pending', () => {
    const state = setupGame();
    const result = reduce(state, { type: 'REVEAL_SELECTED_CLUE' }, { now: NOW });

    expect(result.effects).toContainEqual({
      type: 'INTENT_REJECTED',
      reason: expect.stringContaining('waiting to be revealed'),
    });
  });

  it('reveals a player-picked clue when the host initiates it', () => {
    const playerState = { ...setupGame(), clueSelectionMode: 'PLAYER' as const };
    const picker = playerState.controllingPlayerId ?? undefined;
    const selected = reduce(playerState, { type: 'SELECT_CLUE', clueId: 'cl1', selectorId: picker }, { now: NOW }).state;
    const result = reduce(selected, { type: 'REVEAL_SELECTED_CLUE' }, { now: NOW + 100 });

    expect(result.state.phase).toBe('CLUE_REVEALED');
    expect(result.state.currentClueId).toBe('cl1');
    expect(result.state.pendingClueId).toBeNull();
  });

  it('reveals a player-picked Daily Double into the wager phase', () => {
    const playerState = { ...setupGame(), clueSelectionMode: 'PLAYER' as const };
    const picker = playerState.controllingPlayerId ?? undefined;
    const selected = reduce(playerState, { type: 'SELECT_CLUE', clueId: 'cl2', selectorId: picker }, { now: NOW }).state;
    const result = reduce(selected, { type: 'REVEAL_SELECTED_CLUE' }, { now: NOW + 100 });

    expect(result.state.phase).toBe('DAILY_DOUBLE_WAGER');
    expect(result.state.currentClueId).toBe('cl2');
  });
});

describe('SET_CLUE_SELECTION_MODE', () => {
  function setupGame(): GameState {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    return reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
  }

  it('defaults new games to host-pick mode', () => {
    const board = makeBoard();
    const state = createInitialState('session-1', 'ABCD', board);
    expect(state.clueSelectionMode).toBe('HOST');
  });

  it('switches the mode to player-pick and back', () => {
    const state = setupGame();
    const toPlayer = reduce(state, { type: 'SET_CLUE_SELECTION_MODE', mode: 'PLAYER' }, { now: NOW });
    expect(toPlayer.state.clueSelectionMode).toBe('PLAYER');
    expect(toPlayer.effects).toContainEqual({ type: 'BROADCAST_STATE' });

    const toHost = reduce(toPlayer.state, { type: 'SET_CLUE_SELECTION_MODE', mode: 'HOST' }, { now: NOW });
    expect(toHost.state.clueSelectionMode).toBe('HOST');
  });
});

function setupDailyDoubleWager(score = 0): GameState {
  const board = makeBoard();
  let state = createInitialState('session-1', 'ABCD', board);
  const alice = makePlayer({ id: 'p1', name: 'Alice', score });
  const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });
  state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
  state = reduce(state, { type: 'JOIN', player: bob }, { now: NOW }).state;
  state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
  return reduce(state, { type: 'SELECT_CLUE', clueId: 'cl2', hostOverride: true }, { now: NOW }).state;
}

describe('SUBMIT_DD_WAGER', () => {
  it('accepts a valid wager and locks it while staying in DAILY_DOUBLE_WAGER', () => {
    const state = setupDailyDoubleWager(1000);

    const result = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 200 }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('DAILY_DOUBLE_WAGER');
    expect(result.state.dailyDoubleWager).toBe(200);
  });

  it('rejects a wager below the default minimum of 5', () => {
    const state = setupDailyDoubleWager(1000);

    const result = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 4 }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('at least') });
    expect(result.state.phase).toBe('DAILY_DOUBLE_WAGER');
    expect(result.state.dailyDoubleWager).toBeNull();
  });

  it('rejects a wager above the maximum (score vs highest clue value)', () => {
    const state = setupDailyDoubleWager(150);

    const result = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 201 }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('exceed') });
    expect(result.state.phase).toBe('DAILY_DOUBLE_WAGER');
    expect(result.state.dailyDoubleWager).toBeNull();
  });

  it('uses the highest clue value as the maximum when it exceeds the score', () => {
    const state = setupDailyDoubleWager(150);

    const atMax = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 200 }, { now: NOW });
    expect(atMax.state.dailyDoubleWager).toBe(200);
    expect(atMax.state.phase).toBe('DAILY_DOUBLE_WAGER');

    const overMax = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 201 }, { now: NOW });
    expect(overMax.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('exceed') });
  });

  it('uses the current score as the maximum when it exceeds the highest clue value', () => {
    const state = setupDailyDoubleWager(3000);

    const atMax = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 3000 }, { now: NOW });
    expect(atMax.state.dailyDoubleWager).toBe(3000);
    expect(atMax.state.phase).toBe('DAILY_DOUBLE_WAGER');

    const overMax = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 3001 }, { now: NOW });
    expect(overMax.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('exceed') });
  });

  it('allows a zero or negative score to wager at least the minimum', () => {
    const state = setupDailyDoubleWager(-400);

    const result = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 5 }, { now: NOW });

    expect(result.state.dailyDoubleWager).toBe(5);
    expect(result.state.phase).toBe('DAILY_DOUBLE_WAGER');
  });

  it('rejects a wager from a non-controlling player', () => {
    const state = setupDailyDoubleWager(1000);
    const nonController = state.players.find((p) => p.id !== state.controllingPlayerId);

    const result = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: nonController!.id, amount: 100 }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('controlling') });
    expect(result.state.phase).toBe('DAILY_DOUBLE_WAGER');
  });

  it('locks a submitted wager and rejects a second submission', () => {
    let state = setupDailyDoubleWager(1000);
    state = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 200 }, { now: NOW }).state;

    const result = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 300 }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('already') });
    expect(result.state.dailyDoubleWager).toBe(200);
  });
});

function setupDailyDoubleClue(controllerScore = 1000, wager = 200): GameState {
  let state = setupDailyDoubleWager(controllerScore);
  state = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: wager }, { now: NOW }).state;
  return reduce(state, { type: 'REVEAL_CLUE' }, { now: NOW }).state;
}

describe('REVEAL_CLUE', () => {
  it('reveals the Daily Double clue only after a wager is submitted', () => {
    let state = setupDailyDoubleWager(1000);
    state = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 200 }, { now: NOW }).state;

    const result = reduce(state, { type: 'REVEAL_CLUE' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('DAILY_DOUBLE_CLUE');
    expect(result.state.currentClueId).toBe(state.currentClueId);
    expect(result.state.dailyDoubleWager).toBe(200);
  });

  it('rejects revealing the clue before a wager is submitted', () => {
    const state = setupDailyDoubleWager(1000);

    const result = reduce(state, { type: 'REVEAL_CLUE' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('wager') });
    expect(result.state.phase).toBe('DAILY_DOUBLE_WAGER');
  });

  it('rejects revealing the clue outside the Daily Double', () => {
    const state = setupClueRevealed();

    const result = reduce(state, { type: 'REVEAL_CLUE' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('Daily Double') });
  });
});

describe('CANCEL_DAILY_DOUBLE', () => {
  it('returns the game to BOARD_SELECT with the clue unused and control unchanged when the controller is disconnected', () => {
    let state = setupDailyDoubleWager(1000);
    const controllerId = state.controllingPlayerId;
    const ddClueId = state.currentClueId;
    state = {
      ...state,
      players: state.players.map((p) => (p.id === controllerId ? { ...p, connected: false } : p)),
    };

    const result = reduce(state, { type: 'CANCEL_DAILY_DOUBLE' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.currentClueId).toBeNull();
    expect(result.state.dailyDoubleWager).toBeNull();
    expect(result.state.usedClueIds).not.toContain(ddClueId);
    expect(result.state.controllingPlayerId).toBe(controllerId);
    expect(result.state.revealedAnswer).toBeNull();
  });

  it('rejects cancellation when the controller is still connected', () => {
    const state = setupDailyDoubleWager(1000);

    const result = reduce(state, { type: 'CANCEL_DAILY_DOUBLE' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('connected') });
    expect(result.state.phase).toBe('DAILY_DOUBLE_WAGER');
  });

  it('rejects cancellation when a wager has already been submitted', () => {
    let state = setupDailyDoubleWager(1000);
    state = {
      ...state,
      players: state.players.map((p) => (p.id === state.controllingPlayerId ? { ...p, connected: false } : p)),
    };
    state = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 200 }, { now: NOW }).state;

    const result = reduce(state, { type: 'CANCEL_DAILY_DOUBLE' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('wager') });
    expect(result.state.phase).toBe('DAILY_DOUBLE_WAGER');
  });

  it('rejects cancellation outside the Daily Double wager phase', () => {
    const state = setupClueRevealed();

    const result = reduce(state, { type: 'CANCEL_DAILY_DOUBLE' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('Daily Double') });
    expect(result.state.phase).toBe('CLUE_REVEALED');
  });
});

describe('Daily Double ruling', () => {
  it('RULE_CORRECT adds the wager to the controlling player and keeps control', () => {
    const state = setupDailyDoubleClue(1000, 400);
    const controllerId = state.controllingPlayerId;

    const result = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 100 });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.players.find((p) => p.id === controllerId)?.score).toBe(1400);
    expect(result.state.controllingPlayerId).toBe(controllerId);
    expect(result.state.usedClueIds).toContain(state.currentClueId);
    expect(result.state.revealedAnswer).toBe('Mars');
    expect(result.state.lastOutcome).toEqual({ playerId: controllerId, type: 'CORRECT', value: 400 });
    expect(result.state.auditLog).toContainEqual(
      expect.objectContaining({ type: 'CORRECT', playerId: controllerId, value: 400, scoreBefore: 1000, scoreAfter: 1400 }),
    );
  });

  it('RULE_INCORRECT subtracts the wager from the controlling player and keeps control', () => {
    const state = setupDailyDoubleClue(0, 200);
    const controllerId = state.controllingPlayerId;

    const result = reduce(state, { type: 'RULE_INCORRECT', playerId: controllerId! }, { now: NOW + 100 });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.players.find((p) => p.id === controllerId)?.score).toBe(-200);
    expect(result.state.controllingPlayerId).toBe(controllerId);
    expect(result.state.usedClueIds).toContain(state.currentClueId);
    expect(result.state.revealedAnswer).toBe('Mars');
    expect(result.state.lastOutcome).toEqual({ playerId: controllerId, type: 'INCORRECT', value: 200 });
    expect(result.state.auditLog).toContainEqual(
      expect.objectContaining({ type: 'INCORRECT', playerId: controllerId, value: 200, scoreBefore: 0, scoreAfter: -200 }),
    );
  });

  it('RULE_INCORRECT only accepts the controlling player', () => {
    const state = setupDailyDoubleClue(1000, 200);
    const nonController = state.players.find((p) => p.id !== state.controllingPlayerId);

    const result = reduce(state, { type: 'RULE_INCORRECT', playerId: nonController!.id }, { now: NOW + 100 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('controlling') });
    expect(result.state.phase).toBe('DAILY_DOUBLE_CLUE');
  });

  it('rejects a ruling before the clue is revealed', () => {
    let state = setupDailyDoubleWager(1000);
    state = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: state.controllingPlayerId!, amount: 200 }, { now: NOW }).state;

    const correct = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 100 });
    expect(correct.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('Daily Double') });

    const incorrect = reduce(state, { type: 'RULE_INCORRECT', playerId: state.controllingPlayerId! }, { now: NOW + 100 });
    expect(incorrect.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('Daily Double') });
  });

  it('resolves a Daily Double even if the controlling player is disconnected', () => {
    let state = setupDailyDoubleClue(1000, 500);
    const controllerId = state.controllingPlayerId;
    state = {
      ...state,
      players: state.players.map((p) => (p.id === controllerId ? { ...p, connected: false } : p)),
    };

    const result = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 100 });

    expect(result.state.phase).toBe('BOARD_SELECT');
    expect(result.state.players.find((p) => p.id === controllerId)?.score).toBe(1500);
    expect(result.state.controllingPlayerId).toBe(controllerId);
  });

  it('does not change any other player score on a Daily Double ruling', () => {
    const state = setupDailyDoubleClue(1000, 300);
    const otherPlayer = state.players.find((p) => p.id !== state.controllingPlayerId);

    const result = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 100 });

    expect(result.state.players.find((p) => p.id === otherPlayer?.id)?.score).toBe(otherPlayer?.score);
  });
});

describe('REVEAL_ANSWER', () => {
  it('marks the current clue used and returns to BOARD_SELECT', () => {
    const board = makeBoard();
    let state = createInitialState('session-1', 'ABCD', board);
    const alice = makePlayer({ id: 'p1', name: 'Alice' });
    state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
    state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', hostOverride: true }, { now: NOW }).state;

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
  return reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', hostOverride: true }, { now: NOW }).state;
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
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', hostOverride: true }, { now: NOW }).state;

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

  it('an early buzz records a lockout but never makes the player the winner when arming occurs', () => {
    const state = setupClueRevealed();

    const early = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW });
    expect(early.state.phase).toBe('CLUE_REVEALED');
    expect(early.state.buzzWinnerId).toBeNull();
    expect(early.state.lockoutUntil['p1']).toBe(NOW + 250);
    expect(early.effects).toContainEqual({ type: 'BROADCAST_STATE' });

    const armed = reduce(early.state, { type: 'ARM_BUZZERS' }, { now: NOW + 50 });
    expect(armed.state.phase).toBe('BUZZERS_ARMED');

    const rebuzz = reduce(armed.state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 100 });
    expect(rebuzz.state.phase).toBe('BUZZERS_ARMED');
    expect(rebuzz.state.buzzWinnerId).toBeNull();
    expect(rebuzz.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('locked out') });
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

  it('wrong-then-right sequence deducts the first contestant and lets a different contestant win the re-arm', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;
    state = reduce(state, { type: 'RULE_INCORRECT', playerId: 'p1' }, { now: NOW + 100 }).state;

    expect(state.phase).toBe('BUZZERS_ARMED');
    expect(state.players.find((p) => p.id === 'p1')?.score).toBe(-100);
    expect(state.lockedOutPlayerIds).toContain('p1');
    expect(state.buzzWinnerId).toBeNull();
    expect(state.deadline).toBe(NOW + 100 + state.board.defaultTimerSeconds * 1000);

    // The locked-out player cannot buzz again on the re-arm.
    const lockedOutBuzz = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 150 });
    expect(lockedOutBuzz.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('locked out') });
    expect(lockedOutBuzz.state.buzzWinnerId).toBeNull();

    // A different contestant can buzz and win the re-arm.
    const rearmWinner = reduce(state, { type: 'BUZZ', playerId: 'p2' }, { now: NOW + 150 });
    expect(rearmWinner.state.phase).toBe('BUZZED');
    expect(rearmWinner.state.buzzWinnerId).toBe('p2');

    const resolved = reduce(rearmWinner.state, { type: 'RULE_CORRECT' }, { now: NOW + 200 });
    expect(resolved.state.phase).toBe('BOARD_SELECT');
    expect(resolved.state.players.find((p) => p.id === 'p1')?.score).toBe(-100);
    expect(resolved.state.players.find((p) => p.id === 'p2')?.score).toBe(100);
    expect(resolved.state.controllingPlayerId).toBe('p2');
    expect(resolved.state.revealedAnswer).toBe('Water');
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

    const result = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl3', hostOverride: true }, { now: NOW });

    expect(result.state.revealedAnswer).toBeNull();
    expect(result.state.lastOutcome).toBeNull();
    expect(result.state.currentClueId).toBe('cl3');
  });
});

function setupCorrectRuling(): GameState {
  let state = setupClueRevealed();
  state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
  state = reduce(state, { type: 'BUZZ', playerId: 'p2' }, { now: NOW + 10 }).state;
  return reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 100 }).state;
}

function setupIncorrectRuling(): GameState {
  let state = setupClueRevealed();
  state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
  state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;
  return reduce(state, { type: 'RULE_INCORRECT', playerId: 'p1' }, { now: NOW + 100 }).state;
}

function makeBoardWithTwoDailyDoubles(): Board {
  const board = makeBoard();
  const round = board.rounds[0];
  round.clues = round.clues.map((clue) =>
    clue.id === 'cl3' ? { ...clue, isDailyDouble: true } : clue,
  );
  for (const category of round.categories) {
    category.clues = category.clues.map((clue) =>
      clue.id === 'cl3' ? { ...clue, isDailyDouble: true } : clue,
    );
  }
  return board;
}

function setupGameWithTwoDailyDoubles(): GameState {
  const board = makeBoardWithTwoDailyDoubles();
  let state = createInitialState('session-1', 'ABCD', board);
  const alice = makePlayer({ id: 'p1', name: 'Alice', score: 1000 });
  const bob = makePlayer({ id: 'p2', name: 'Bob', reconnectToken: 'token-bob' });
  state = reduce(state, { type: 'JOIN', player: alice }, { now: NOW }).state;
  state = reduce(state, { type: 'JOIN', player: bob }, { now: NOW }).state;
  return reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
}

describe('ADJUST_SCORE', () => {
  it('sets a contestant score to the requested value and records a manual audit entry', () => {
    const state = setupCorrectRuling();
    expect(state.players.find((p) => p.id === 'p1')?.score).toBe(0);

    const result = reduce(state, { type: 'ADJUST_SCORE', playerId: 'p1', score: 500 }, { now: NOW + 200 });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.players.find((p) => p.id === 'p1')?.score).toBe(500);
    expect(result.state.auditLog).toHaveLength(2);
    const manual = result.state.auditLog[1];
    expect(manual.type).toBe('MANUAL');
    expect(manual.playerId).toBe('p1');
    expect(manual.scoreBefore).toBe(0);
    expect(manual.scoreAfter).toBe(500);
    expect(manual.value).toBe(500);
    expect(manual.controllingPlayerIdBefore).toBe('p2');
  });

  it('rejects an adjustment for a non-existent player', () => {
    const state = setupCorrectRuling();

    const result = reduce(state, { type: 'ADJUST_SCORE', playerId: 'ghost', score: 100 }, { now: NOW + 200 });

    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('Player not found') });
    expect(result.state.auditLog).toHaveLength(1);
  });

  it('accepts negative scores', () => {
    const state = setupCorrectRuling();

    const result = reduce(state, { type: 'ADJUST_SCORE', playerId: 'p2', score: -300 }, { now: NOW + 200 });

    expect(result.state.players.find((p) => p.id === 'p2')?.score).toBe(-300);
  });
});

describe('UNDO_LAST_RULING', () => {
  it('reverts the score change from the most recent correct ruling and restores prior control', () => {
    const state = setupCorrectRuling();
    expect(state.controllingPlayerId).toBe('p2');
    expect(state.players.find((p) => p.id === 'p2')?.score).toBe(100);

    const result = reduce(state, { type: 'UNDO_LAST_RULING' }, { now: NOW + 200 });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.players.find((p) => p.id === 'p2')?.score).toBe(0);
    expect(result.state.controllingPlayerId).toBe('p1');
    expect(result.state.auditLog).toHaveLength(0);
  });

  it('reverts the score change from the most recent incorrect ruling', () => {
    const state = setupIncorrectRuling();
    expect(state.players.find((p) => p.id === 'p1')?.score).toBe(-100);
    expect(state.lockedOutPlayerIds).toContain('p1');

    const result = reduce(state, { type: 'UNDO_LAST_RULING' }, { now: NOW + 200 });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.players.find((p) => p.id === 'p1')?.score).toBe(0);
    expect(result.state.lockedOutPlayerIds).not.toContain('p1');
    expect(result.state.auditLog).toHaveLength(0);
  });

  it('does not undo a manual score adjustment', () => {
    let state = setupCorrectRuling();
    state = reduce(state, { type: 'ADJUST_SCORE', playerId: 'p1', score: 250 }, { now: NOW + 200 }).state;
    expect(state.players.find((p) => p.id === 'p1')?.score).toBe(250);
    expect(state.players.find((p) => p.id === 'p2')?.score).toBe(100);

    const result = reduce(state, { type: 'UNDO_LAST_RULING' }, { now: NOW + 300 });

    // The most recent ruling (CORRECT for p2) is reverted, not the manual adjustment.
    expect(result.state.players.find((p) => p.id === 'p2')?.score).toBe(0);
    expect(result.state.players.find((p) => p.id === 'p1')?.score).toBe(250);
    expect(result.state.controllingPlayerId).toBe('p1');
    expect(result.state.auditLog).toHaveLength(1);
    expect(result.state.auditLog[0].type).toBe('MANUAL');
  });

  it('is a safe no-op when the audit log is empty', () => {
    const state = setupClueRevealed();

    const result = reduce(state, { type: 'UNDO_LAST_RULING' }, { now: NOW + 100 });

    expect(result.state).toBe(result.state);
    expect(result.state.auditLog).toHaveLength(0);
    expect(result.effects).toEqual([]);
  });

  it('is a safe no-op when the audit log contains only manual adjustments', () => {
    const state = setupClueRevealed();
    const adjusted = reduce(state, { type: 'ADJUST_SCORE', playerId: 'p1', score: 250 }, { now: NOW + 100 }).state;
    expect(adjusted.auditLog).toHaveLength(1);

    const result = reduce(adjusted, { type: 'UNDO_LAST_RULING' }, { now: NOW + 200 });

    expect(result.state.players.find((p) => p.id === 'p1')?.score).toBe(250);
    expect(result.state.auditLog).toHaveLength(1);
    expect(result.effects).toEqual([]);
  });

  it('undoes the most recent ruling even when a later manual adjustment exists', () => {
    let state = setupCorrectRuling();
    state = reduce(state, { type: 'ADJUST_SCORE', playerId: 'p2', score: 300 }, { now: NOW + 200 }).state;
    expect(state.players.find((p) => p.id === 'p2')?.score).toBe(300);

    const result = reduce(state, { type: 'UNDO_LAST_RULING' }, { now: NOW + 300 });

    // The ruling delta is reverted while the later manual adjustment remains.
    expect(result.state.players.find((p) => p.id === 'p2')?.score).toBe(200);
    expect(result.state.controllingPlayerId).toBe('p1');
    expect(result.state.auditLog).toHaveLength(1);
    expect(result.state.auditLog[0].type).toBe('MANUAL');
  });

  it('undoes only the last ruling, leaving earlier rulings intact', () => {
    let state = setupClueRevealed();
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 10 }).state;
    state = reduce(state, { type: 'RULE_INCORRECT', playerId: 'p1' }, { now: NOW + 100 }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p2' }, { now: NOW + 120 }).state;
    state = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 200 }).state;
    expect(state.players.find((p) => p.id === 'p1')?.score).toBe(-100);
    expect(state.players.find((p) => p.id === 'p2')?.score).toBe(100);
    expect(state.auditLog).toHaveLength(2);

    const result = reduce(state, { type: 'UNDO_LAST_RULING' }, { now: NOW + 300 });

    expect(result.state.players.find((p) => p.id === 'p2')?.score).toBe(0);
    expect(result.state.players.find((p) => p.id === 'p1')?.score).toBe(-100);
    expect(result.state.auditLog).toHaveLength(1);
    expect(result.state.auditLog[0].type).toBe('INCORRECT');
  });
});

describe('Daily Double wager state reset', () => {
  it('clears the wager after a Daily Double is ruled correct and returns to BOARD_SELECT', () => {
    let state = setupGameWithTwoDailyDoubles();
    const controllerId = state.controllingPlayerId;

    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl2', hostOverride: true }, { now: NOW }).state;
    state = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: controllerId!, amount: 200 }, { now: NOW }).state;
    state = reduce(state, { type: 'REVEAL_CLUE' }, { now: NOW }).state;
    state = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 100 }).state;

    expect(state.phase).toBe('BOARD_SELECT');
    expect(state.dailyDoubleWager).toBeNull();
    expect(state.usedClueIds).toContain('cl2');
  });

  it('clears the wager after a Daily Double is ruled incorrect and returns to BOARD_SELECT', () => {
    let state = setupGameWithTwoDailyDoubles();
    const controllerId = state.controllingPlayerId;

    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl2', hostOverride: true }, { now: NOW }).state;
    state = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: controllerId!, amount: 200 }, { now: NOW }).state;
    state = reduce(state, { type: 'REVEAL_CLUE' }, { now: NOW }).state;
    state = reduce(state, { type: 'RULE_INCORRECT', playerId: controllerId! }, { now: NOW + 100 }).state;

    expect(state.phase).toBe('BOARD_SELECT');
    expect(state.dailyDoubleWager).toBeNull();
    expect(state.usedClueIds).toContain('cl2');
  });

  it('allows a fresh wager on a second Daily Double and does not leak the first wager', () => {
    let state = setupGameWithTwoDailyDoubles();
    const controllerId = state.controllingPlayerId;

    // First Daily Double: wager 200 and rule correct.
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl2', hostOverride: true }, { now: NOW }).state;
    state = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: controllerId!, amount: 200 }, { now: NOW }).state;
    state = reduce(state, { type: 'REVEAL_CLUE' }, { now: NOW }).state;
    state = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 100 }).state;

    expect(state.dailyDoubleWager).toBeNull();

    // Second Daily Double: a fresh wager must be accepted.
    const secondSelect = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl3', hostOverride: true }, { now: NOW + 200 });
    expect(secondSelect.state.phase).toBe('DAILY_DOUBLE_WAGER');
    expect(secondSelect.state.currentClueId).toBe('cl3');
    expect(secondSelect.state.dailyDoubleWager).toBeNull();

    const secondWager = reduce(secondSelect.state, { type: 'SUBMIT_DD_WAGER', playerId: controllerId!, amount: 500 }, { now: NOW + 300 });
    expect(secondWager.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(secondWager.state.dailyDoubleWager).toBe(500);
    expect(secondWager.state.phase).toBe('DAILY_DOUBLE_WAGER');

    const secondReveal = reduce(secondWager.state, { type: 'REVEAL_CLUE' }, { now: NOW + 400 });
    expect(secondReveal.state.phase).toBe('DAILY_DOUBLE_CLUE');
    expect(secondReveal.state.dailyDoubleWager).toBe(500);
  });

  it('rejects a second wager submission on the same Daily Double after one is locked', () => {
    let state = setupGameWithTwoDailyDoubles();
    const controllerId = state.controllingPlayerId;

    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl2', hostOverride: true }, { now: NOW }).state;
    state = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: controllerId!, amount: 200 }, { now: NOW }).state;

    const secondSubmit = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: controllerId!, amount: 300 }, { now: NOW + 100 });
    expect(secondSubmit.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('already') });
    expect(secondSubmit.state.dailyDoubleWager).toBe(200);
  });
});

describe('RESTART_GAME', () => {
  it('resets an in-progress game to the lobby, preserving players with cleared scores', () => {
    const board = makeBoard();
    const base = createInitialState('session-1', 'ABCD', board);
    const state: GameState = {
      ...base,
      phase: 'BOARD_SELECT',
      players: [
        makePlayer({ id: 'p1', name: 'Alice', score: 800, seatOrder: 0, reconnectToken: 'token-alice' }),
        makePlayer({ id: 'p2', name: 'Bob', score: -200, seatOrder: 1, reconnectToken: 'token-bob' }),
      ],
      controllingPlayerId: 'p1',
      usedClueIds: ['cl1', 'cl3'],
      currentClueId: 'cl2',
    };

    const result = reduce(state, { type: 'RESTART_GAME' }, { now: NOW });

    expect(result.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    expect(result.state.phase).toBe('LOBBY');
    expect(result.state.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(result.state.players.map((p) => p.score)).toEqual([0, 0]);
    expect(result.state.players.map((p) => p.reconnectToken)).toEqual(['token-alice', 'token-bob']);
    expect(result.state.controllingPlayerId).toBeNull();
    expect(result.state.usedClueIds).toEqual([]);
    expect(result.state.currentClueId).toBeNull();
    expect(result.state.roundIndex).toBe(0);
    expect(result.state.board).toBe(board);
  });

  it('preserves player connection status on restart', () => {
    const board = makeBoard();
    const base = createInitialState('session-1', 'ABCD', board);
    const state: GameState = {
      ...base,
      phase: 'BUZZED',
      players: [
        makePlayer({ id: 'p1', name: 'Alice', score: 400, connected: true }),
        makePlayer({ id: 'p2', name: 'Bob', score: 100, connected: false, reconnectToken: 'token-bob' }),
      ],
    };

    const result = reduce(state, { type: 'RESTART_GAME' }, { now: NOW });

    expect(result.state.players.map((p) => p.connected)).toEqual([true, false]);
    expect(result.state.phase).toBe('LOBBY');
  });
});
