import { describe, expect, it } from 'vitest';
import {
  Board,
  GamePhase,
  GameState,
  Player,
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
      deadline: null,
      dailyDoubleWager: null,
      finalWagers: {},
      finalAnswers: {},
    };

    expect(reduce(state, { type: 'noop' }, { now: 0 })).toBe(state);
    expect(projectBoard(state).roomCode).toBe('TEST');
    expect(projectHost(state).answer).toBeNull();
    expect(projectContestant(state, player.id).playerId).toBe(player.id);
    expect(ClientToServer.JOIN).toBe('join');
    expect(ServerToClient.STATE).toBe('state');
  });
});
