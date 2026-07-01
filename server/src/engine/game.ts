import { GameSessionStatus } from '@prisma/client';
import {
  Board,
  Category,
  Clue,
  createInitialState,
  GameState,
  Intent,
  reduce,
  ReducerCtx,
  ReducerResult,
  Round,
} from '@jeopardy/shared';
import { gameSessionRepository, GameSessionRepository } from '../repo/session.js';
import { boardRepository } from '../repo/board.js';
import type { BoardWithRounds } from '../repo/board.js';
import { generateRoomCode, normalizeRoomCode } from '../utils/roomCode.js';

export interface EngineOptions {
  sessionRepo?: GameSessionRepository;
  broadcast?: (roomCode: string, state: GameState) => void;
}

export interface CreateSessionResult {
  sessionId: string;
  roomCode: string;
  state: GameState;
}

export class GameEngine {
  private sessions = new Map<string, GameState>();
  private sessionRepo: GameSessionRepository;
  broadcast: (roomCode: string, state: GameState) => void;

  constructor(options: EngineOptions = {}) {
    this.sessionRepo = options.sessionRepo ?? gameSessionRepository;
    this.broadcast = options.broadcast ?? (() => {});
  }

  async createSession(boardId: string): Promise<CreateSessionResult> {
    const board = await boardRepository.findById(boardId);
    if (!board) {
      throw new BoardNotFoundError();
    }

    const sharedBoard = mapBoardToShared(board);
    let roomCode = generateRoomCode();
    while (await this.sessionRepo.findByRoomCode(roomCode)) {
      roomCode = generateRoomCode();
    }

    const initialState = createInitialState('pending', roomCode, sharedBoard);
    const session = await this.sessionRepo.create({
      boardId,
      roomCode,
      status: GameSessionStatus.LOBBY,
      snapshot: JSON.stringify(initialState),
    });

    const state: GameState = { ...initialState, sessionId: session.id };
    this.sessions.set(roomCode, state);
    this.broadcast(roomCode, state);

    return { sessionId: session.id, roomCode, state };
  }

  async loadActiveSessions(): Promise<void> {
    const activeSessions = await this.sessionRepo.findActive();
    for (const session of activeSessions) {
      try {
        const parsed = JSON.parse(session.snapshot) as GameState;
        const state = { ...parsed, sessionId: session.id };
        this.sessions.set(session.roomCode, state);
      } catch {
        // Ignore corrupted snapshots; the session will be abandoned.
      }
    }
  }

  getState(roomCode: string): GameState | undefined {
    return this.sessions.get(normalizeRoomCode(roomCode));
  }

  async applyIntent(roomCode: string, intent: Intent, ctx: ReducerCtx): Promise<ReducerResult> {
    const normalized = normalizeRoomCode(roomCode);
    const state = this.sessions.get(normalized);
    if (!state) {
      throw new SessionNotFoundError();
    }

    const result = reduce(state, intent, ctx);
    if (result.effects.some((e) => e.type === 'BROADCAST_STATE')) {
      this.sessions.set(normalized, result.state);
      await this.persistSnapshot(result.state);
      this.broadcast(normalized, result.state);
    }
    return result;
  }

  async addPlayer(roomCode: string, player: GameState['players'][number]): Promise<ReducerResult> {
    return this.applyIntent(roomCode, { type: 'JOIN', player }, { now: Date.now() });
  }

  async removePlayer(roomCode: string, playerId: string): Promise<ReducerResult> {
    return this.applyIntent(roomCode, { type: 'LEAVE', playerId }, { now: Date.now() });
  }

  async disconnectPlayer(roomCode: string, playerId: string): Promise<ReducerResult> {
    return this.applyIntent(roomCode, { type: 'DISCONNECT', playerId }, { now: Date.now() });
  }

  async reconnectPlayer(roomCode: string, playerId: string): Promise<ReducerResult> {
    return this.applyIntent(roomCode, { type: 'RECONNECT', playerId }, { now: Date.now() });
  }

  async startGame(roomCode: string): Promise<ReducerResult> {
    return this.applyIntent(roomCode, { type: 'START_GAME' }, { now: Date.now() });
  }

  async persistSnapshot(state: GameState): Promise<void> {
    await this.sessionRepo.updateSnapshot(state.sessionId, JSON.stringify(state));
  }
}

export function mapBoardToShared(board: BoardWithRounds): Board {
  return {
    id: board.id,
    name: board.name,
    includeDoubleJeopardy: board.includeDoubleJeopardy,
    defaultTimerSeconds: board.defaultTimerSeconds,
    finalTimerSeconds: board.finalTimerSeconds,
    rounds: board.rounds.map(mapRoundToShared),
  };
}

function mapRoundToShared(round: BoardWithRounds['rounds'][number]): Round {
  const categories: Category[] = round.categories.map((category) => ({
    id: category.id,
    title: category.title,
    order: category.order,
    clues: category.clues.map((clue) => mapClueToShared(clue)),
  }));

  const clues: Clue[] = round.categories.flatMap((category) =>
    category.clues.map((clue) => mapClueToShared(clue)),
  );

  return {
    id: round.id,
    type: round.type,
    order: round.order,
    categories,
    clues,
  };
}

function mapClueToShared(clue: BoardWithRounds['rounds'][number]['categories'][number]['clues'][number]): Clue {
  return {
    id: clue.id,
    categoryId: clue.categoryId,
    row: clue.row,
    value: clue.value,
    clueText: clue.clueText,
    answer: clue.answer,
    isDailyDouble: clue.isDailyDouble,
  };
}

export class BoardNotFoundError extends Error {
  constructor() {
    super('Board not found');
  }
}

export class SessionNotFoundError extends Error {
  constructor() {
    super('Session not found');
  }
}
