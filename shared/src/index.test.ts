import { describe, expect, it } from 'vitest';
import {
  Board,
  GamePhase,
  GameState,
  Player,
  createInitialState,
  reduce,
  projectBoard,
  projectHost,
  projectContestant,
  ClientToServer,
  ServerToClient,
} from './index.js';

describe('shared package index', () => {
  it('exports domain types, projections, and event contracts', () => {
    const board: Board = {
      id: 'b1',
      name: 'Test Board',
      includeDoubleJeopardy: false,
      defaultTimerSeconds: 10,
      finalTimerSeconds: 30,
      rounds: [],
    };

    const player: Player = {
      id: 'p1',
      name: 'Alice',
      score: 0,
      seatOrder: 0,
      connected: true,
      reconnectToken: 'token-alice',
    };

    const phase: GamePhase = 'LOBBY';

    const state: GameState = {
      sessionId: 's1',
      roomCode: 'TEST',
      boardId: board.id,
      board,
      phase,
      roundIndex: 0,
      players: [player],
      controllingPlayerId: null,
      usedClueIds: [],
      currentClueId: null,
      buzzWinnerId: null,
      armedAt: null,
      deadline: null,
      lockedOutPlayerIds: [],
      lockoutUntil: {},
      auditLog: [],
      dailyDoubleWager: null,
      finalWagers: {},
      finalAnswers: {},
    };

    const result = reduce(state, { type: 'JOIN', player: { ...player, id: 'p2', name: 'Bob', reconnectToken: 'token-bob' } }, { now: 0 });
    expect(result.state.players).toHaveLength(2);
    expect(projectBoard(state, 0).roomCode).toBe('TEST');
    expect(projectHost(state, 0).answer).toBeNull();
    expect(projectContestant(state, player.id, 0).playerId).toBe(player.id);
    expect(createInitialState('s2', 'ROOM', board).phase).toBe('LOBBY');
    expect(ClientToServer.JOIN).toBe('join');
    expect(ServerToClient.STATE).toBe('state');
  });
});
