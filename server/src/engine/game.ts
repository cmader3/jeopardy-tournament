import { GameSessionStatus } from '@prisma/client';
import {
  Board,
  Category,
  Clue,
  createInitialState,
  GamePhase,
  GameState,
  Intent,
  isBoardPlayable,
  reduce,
  ReducerCtx,
  ReducerResult,
  Round,
} from '@jeopardy/shared';
import { gameSessionRepository, GameSessionRepository, GameSessionRow } from '../repo/session.js';
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

export type GameSessionSummaryStatus = 'LOBBY' | 'IN_PROGRESS' | 'FINAL' | 'COMPLETE';

export interface GameSessionSummary {
  roomCode: string;
  boardName: string;
  status: GameSessionSummaryStatus;
  phase: GamePhase;
  playerCount: number;
  connectedCount: number;
  archived: boolean;
  completedAt: number | null;
  createdAt: string;
  updatedAt: string;
}

export const AUTO_ARCHIVE_AFTER_MS = 60 * 60 * 1000;

function deriveSummaryStatus(phase: GamePhase): GameSessionSummaryStatus {
  if (phase === 'LOBBY') return 'LOBBY';
  if (phase === 'COMPLETE') return 'COMPLETE';
  if (phase.startsWith('FINAL')) return 'FINAL';
  return 'IN_PROGRESS';
}

export class GameEngine {
  private sessions = new Map<string, GameState>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
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
    if (!isBoardPlayable(sharedBoard)) {
      throw new BoardEmptyError();
    }

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

  private hydrate(session: { id: string; roomCode: string; snapshot: string }): GameState | null {
    try {
      const parsed = JSON.parse(session.snapshot) as GameState;
      // Sockets are gone after a restart; mark every player as disconnected
      // so reconnections can cleanly restore their slot and connection status.
      const players = parsed.players.map((player) => ({ ...player, connected: false }));
      return {
        ...parsed,
        sessionId: session.id,
        players,
        clueSelectionMode: parsed.clueSelectionMode ?? 'HOST',
        pendingClueId: parsed.pendingClueId ?? null,
        removedPlayers: parsed.removedPlayers ?? [],
        archived: parsed.archived ?? false,
        completedAt: parsed.completedAt ?? null,
      };
    } catch {
      return null;
    }
  }

  async loadActiveSessions(): Promise<void> {
    const activeSessions = await this.sessionRepo.findActive();
    for (const session of activeSessions) {
      const state = this.hydrate(session);
      if (!state) continue;
      this.sessions.set(session.roomCode, state);
      this.scheduleTimer(session.roomCode, state);
    }
  }

  async ensureSessionLoaded(roomCode: string): Promise<void> {
    const normalized = normalizeRoomCode(roomCode);
    if (this.sessions.has(normalized)) return;
    const session = await this.sessionRepo.findByRoomCode(normalized);
    if (!session) return;
    const state = this.hydrate(session);
    if (!state) return;
    this.sessions.set(normalized, state);
    this.scheduleTimer(normalized, state);
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
      if (result.state.phase === 'COMPLETE' && result.state.completedAt == null) {
        result.state = { ...result.state, completedAt: ctx.now };
      }
      this.sessions.set(normalized, result.state);
      await this.persistSnapshot(result.state);
      this.broadcast(normalized, result.state);
      this.scheduleTimer(normalized, result.state);
    }
    return result;
  }

  private scheduleTimer(roomCode: string, state: GameState): void {
    const existing = this.timers.get(roomCode);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(roomCode);
    }

    if (state.deadline == null) return;

    const delay = Math.max(0, state.deadline - Date.now());
    const timer = setTimeout(() => {
      this.applyIntent(roomCode, { type: 'TIME_EXPIRE' }, { now: Date.now() }).catch(() => {
        // Session may have ended; ignore.
      });
    }, delay);
    this.timers.set(roomCode, timer);
  }

  clearTimers(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  async addPlayer(roomCode: string, player: GameState['players'][number]): Promise<ReducerResult> {
    return this.applyIntent(roomCode, { type: 'JOIN', player }, { now: Date.now() });
  }

  async removePlayer(roomCode: string, playerId: string): Promise<ReducerResult> {
    return this.applyIntent(roomCode, { type: 'LEAVE', playerId }, { now: Date.now() });
  }

  async kickPlayer(roomCode: string, playerId: string): Promise<ReducerResult> {
    return this.applyIntent(roomCode, { type: 'REMOVE_PLAYER', playerId }, { now: Date.now() });
  }

  async admitPlayer(roomCode: string, playerId: string): Promise<ReducerResult> {
    return this.applyIntent(roomCode, { type: 'ADMIT_PLAYER', playerId }, { now: Date.now() });
  }

  async disconnectPlayer(roomCode: string, playerId: string): Promise<ReducerResult> {
    return this.applyIntent(roomCode, { type: 'DISCONNECT', playerId }, { now: Date.now() });
  }

  async reconnectPlayer(roomCode: string, playerId: string): Promise<ReducerResult> {
    return this.applyIntent(roomCode, { type: 'RECONNECT', playerId }, { now: Date.now() });
  }

  async startGame(roomCode: string): Promise<ReducerResult> {
    const result = await this.applyIntent(roomCode, { type: 'START_GAME' }, { now: Date.now() });
    if (result.state.phase !== 'LOBBY') {
      await this.sessionRepo.updateStatus(result.state.sessionId, GameSessionStatus.IN_PROGRESS);
    }
    return result;
  }

  async restartGame(roomCode: string): Promise<ReducerResult> {
    const result = await this.applyIntent(roomCode, { type: 'RESTART_GAME' }, { now: Date.now() });
    await this.sessionRepo.updateStatus(result.state.sessionId, GameSessionStatus.LOBBY);
    return result;
  }

  async persistSnapshot(state: GameState): Promise<void> {
    await this.sessionRepo.updateSnapshot(state.sessionId, JSON.stringify(state));
  }

  async listSessions(now: number = Date.now()): Promise<GameSessionSummary[]> {
    const rows = await this.sessionRepo.findAll();
    const summaries: GameSessionSummary[] = [];
    for (const row of rows) {
      const summary = await this.summarizeRow(row, now);
      if (summary) summaries.push(summary);
    }
    return summaries;
  }

  private async summarizeRow(row: GameSessionRow, now: number): Promise<GameSessionSummary | null> {
    let parsed: GameState;
    try {
      parsed = JSON.parse(row.snapshot) as GameState;
    } catch {
      return null;
    }

    let archived = parsed.archived ?? false;
    let completedAt = parsed.completedAt ?? null;
    let changed = false;

    if (parsed.phase === 'COMPLETE' && completedAt == null) {
      completedAt = now;
      changed = true;
    }
    if (!archived && completedAt != null && now - completedAt >= AUTO_ARCHIVE_AFTER_MS) {
      archived = true;
      changed = true;
    }

    if (changed) {
      const normalized = normalizeRoomCode(row.roomCode);
      const loaded = this.sessions.get(normalized);
      if (loaded) {
        this.sessions.set(normalized, { ...loaded, archived, completedAt });
      }
      await this.sessionRepo
        .updateSnapshot(row.id, JSON.stringify({ ...parsed, archived, completedAt }))
        .catch(() => {});
    }

    return {
      roomCode: parsed.roomCode ?? row.roomCode,
      boardName: parsed.board?.name ?? 'Unknown board',
      status: deriveSummaryStatus(parsed.phase),
      phase: parsed.phase,
      playerCount: parsed.players?.length ?? 0,
      connectedCount: parsed.players?.filter((p) => p.connected).length ?? 0,
      archived,
      completedAt,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async setArchived(roomCode: string, archived: boolean): Promise<void> {
    const normalized = normalizeRoomCode(roomCode);
    await this.ensureSessionLoaded(normalized);
    const state = this.sessions.get(normalized);
    if (!state) {
      throw new SessionNotFoundError();
    }
    const nextState: GameState = {
      ...state,
      archived,
      completedAt: archived ? state.completedAt : null,
    };
    this.sessions.set(normalized, nextState);
    await this.persistSnapshot(nextState);
  }

  async deleteSession(roomCode: string): Promise<void> {
    const normalized = normalizeRoomCode(roomCode);
    const session = await this.sessionRepo.findByRoomCode(normalized);
    if (!session) {
      throw new SessionNotFoundError();
    }
    const timer = this.timers.get(normalized);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(normalized);
    }
    this.sessions.delete(normalized);
    await this.sessionRepo.deleteByRoomCode(normalized);
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

export class BoardEmptyError extends Error {
  constructor() {
    super('Board has no playable clues');
  }
}
