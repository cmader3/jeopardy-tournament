import { GameState, Clue } from '../models/index.js';

export interface ProjectedPlayer {
  id: string;
  name: string;
  score: number;
  connected: boolean;
}

export interface ProjectedCluePublic {
  id: string;
  categoryId: string;
  row: number;
  value: number | null;
}

export interface ProjectedClueHost extends ProjectedCluePublic {
  clueText: string;
  answer: string;
  isDailyDouble: boolean;
}

export interface ProjectedCategoryPublic {
  id: string;
  title: string;
  order: number;
  clues: ProjectedCluePublic[];
}

export interface ProjectedCategoryHost {
  id: string;
  title: string;
  order: number;
  clues: ProjectedClueHost[];
}

export interface ProjectedRoundPublic {
  id: string;
  type: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL';
  order: number;
  categories: ProjectedCategoryPublic[];
}

export interface ProjectedRoundHost {
  id: string;
  type: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL';
  order: number;
  categories: ProjectedCategoryHost[];
}

export interface BoardView {
  phase: GameState['phase'];
  roomCode: string;
  roundIndex: number;
  players: ProjectedPlayer[];
  round: ProjectedRoundPublic | null;
  usedClueIds: string[];
  currentClueId: string | null;
  currentClueText: string | null;
  controllingPlayerId: string | null;
  buzzWinnerId: string | null;
  deadline: number | null;
  answer: string | null;
  lastOutcome: { playerId: string; type: 'CORRECT' | 'INCORRECT'; value: number } | null;
  serverNow: number;
}

export interface HostView {
  phase: GameState['phase'];
  roomCode: string;
  roundIndex: number;
  players: ProjectedPlayer[];
  round: ProjectedRoundHost | null;
  usedClueIds: string[];
  currentClueId: string | null;
  currentClueText: string | null;
  controllingPlayerId: string | null;
  buzzWinnerId: string | null;
  deadline: number | null;
  answer: string | null;
  lastOutcome: { playerId: string; type: 'CORRECT' | 'INCORRECT'; value: number } | null;
  lockedOutPlayerIds: string[];
  serverNow: number;
}

export interface ContestantView extends BoardView {
  playerId: string;
  isControllingPlayer: boolean;
  isLockedOut: boolean;
  lockoutUntil: number | null;
  canWager: boolean;
  canAnswer: boolean;
}

const CLUE_TEXT_PHASES = new Set<GameState['phase']>([
  'CLUE_REVEALED',
  'BUZZERS_ARMED',
  'BUZZED',
  'DAILY_DOUBLE_CLUE',
]);

function projectPlayers(state: GameState): ProjectedPlayer[] {
  return state.players.map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
  }));
}

function getCurrentRound(state: GameState): GameState['board']['rounds'][number] | undefined {
  return state.board.rounds[state.roundIndex];
}

function getCurrentClue(state: GameState): Clue | null {
  const round = getCurrentRound(state);
  if (!round || !state.currentClueId) return null;
  return round.clues.find((c) => c.id === state.currentClueId) ?? null;
}

function projectBoardRound(round: GameState['board']['rounds'][number]): ProjectedRoundPublic {
  const cluesByCategory = new Map<string, Clue[]>();
  for (const clue of round.clues) {
    const list = cluesByCategory.get(clue.categoryId) ?? [];
    list.push(clue);
    cluesByCategory.set(clue.categoryId, list);
  }

  return {
    id: round.id,
    type: round.type,
    order: round.order,
    categories: round.categories.map((category) => ({
      id: category.id,
      title: category.title,
      order: category.order,
      clues: (cluesByCategory.get(category.id) ?? [])
        .sort((a, b) => a.row - b.row)
        .map((clue) => ({
          id: clue.id,
          categoryId: clue.categoryId,
          row: clue.row,
          value: clue.value,
        })),
    })),
  };
}

function projectHostRound(round: GameState['board']['rounds'][number]): ProjectedRoundHost {
  const cluesByCategory = new Map<string, Clue[]>();
  for (const clue of round.clues) {
    const list = cluesByCategory.get(clue.categoryId) ?? [];
    list.push(clue);
    cluesByCategory.set(clue.categoryId, list);
  }

  return {
    id: round.id,
    type: round.type,
    order: round.order,
    categories: round.categories.map((category) => ({
      id: category.id,
      title: category.title,
      order: category.order,
      clues: (cluesByCategory.get(category.id) ?? [])
        .sort((a, b) => a.row - b.row)
        .map((clue) => ({
          id: clue.id,
          categoryId: clue.categoryId,
          row: clue.row,
          value: clue.value,
          clueText: clue.clueText,
          answer: clue.answer,
          isDailyDouble: clue.isDailyDouble,
        })),
    })),
  };
}

function isLockedOut(state: GameState, playerId: string, now: number): boolean {
  if (state.lockedOutPlayerIds.includes(playerId)) return true;
  const until = state.lockoutUntil[playerId];
  return until !== undefined && until > now;
}

export function projectBoard(state: GameState, now: number): BoardView {
  const round = getCurrentRound(state);
  const currentClue = getCurrentClue(state);
  const showClueText = currentClue ? CLUE_TEXT_PHASES.has(state.phase) : false;

  return {
    phase: state.phase,
    roomCode: state.roomCode,
    roundIndex: state.roundIndex,
    players: projectPlayers(state),
    round: round ? projectBoardRound(round) : null,
    usedClueIds: state.usedClueIds,
    currentClueId: state.currentClueId,
    currentClueText: showClueText ? currentClue?.clueText ?? null : null,
    controllingPlayerId: state.controllingPlayerId,
    buzzWinnerId: state.buzzWinnerId,
    deadline: state.deadline,
    answer: state.revealedAnswer,
    lastOutcome: state.lastOutcome
      ? { playerId: state.lastOutcome.playerId, type: state.lastOutcome.type, value: state.lastOutcome.value }
      : null,
    serverNow: now,
  };
}

export function projectHost(state: GameState, now: number): HostView {
  const round = getCurrentRound(state);
  const currentClue = getCurrentClue(state);
  const showClueText = currentClue ? CLUE_TEXT_PHASES.has(state.phase) : false;

  return {
    phase: state.phase,
    roomCode: state.roomCode,
    roundIndex: state.roundIndex,
    players: projectPlayers(state),
    round: round ? projectHostRound(round) : null,
    usedClueIds: state.usedClueIds,
    currentClueId: state.currentClueId,
    currentClueText: showClueText ? currentClue?.clueText ?? null : null,
    controllingPlayerId: state.controllingPlayerId,
    buzzWinnerId: state.buzzWinnerId,
    deadline: state.deadline,
    answer: state.revealedAnswer ?? currentClue?.answer ?? null,
    lastOutcome: state.lastOutcome
      ? { playerId: state.lastOutcome.playerId, type: state.lastOutcome.type, value: state.lastOutcome.value }
      : null,
    lockedOutPlayerIds: state.lockedOutPlayerIds,
    serverNow: now,
  };
}

export function projectContestant(state: GameState, playerId: string, now: number): ContestantView {
  const board = projectBoard(state, now);
  const isControllingPlayer = state.controllingPlayerId === playerId;
  const lockoutUntil = state.lockoutUntil[playerId] ?? null;
  return {
    ...board,
    playerId,
    isControllingPlayer,
    isLockedOut: isLockedOut(state, playerId, now),
    lockoutUntil,
    canWager:
      state.phase === 'DAILY_DOUBLE_WAGER'
        ? isControllingPlayer
        : state.phase === 'FINAL_WAGER' && state.players.some((p) => p.id === playerId),
    canAnswer: state.phase === 'DAILY_DOUBLE_CLUE' ? isControllingPlayer : false,
  };
}
