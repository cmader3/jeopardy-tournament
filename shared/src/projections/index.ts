import { GameState, Clue, AuditRecord } from '../models/index.js';

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
  dailyDoubleWager: number | null;
  transitionTarget: 'DOUBLE_JEOPARDY' | 'FINAL' | null;
  finalNoEligiblePlayers: boolean;
  finalEligiblePlayerIds: string[];
  finalWagerSubmissionStatus: Record<string, boolean>;
  finalAnswerSubmissionStatus: Record<string, boolean>;
  finalRevealOrder: string[];
  finalRevealIndex: number;
  finalRevealStep: 'ANSWER' | 'RULE' | 'WAGER';
  finalRevealedAnswers: Record<string, string>;
  finalRevealedWagers: Record<string, number>;
  roundComplete: boolean;
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
  auditLog: AuditRecord[];
  dailyDoubleWager: number | null;
  transitionTarget: 'DOUBLE_JEOPARDY' | 'FINAL' | null;
  finalNoEligiblePlayers: boolean;
  finalEligiblePlayerIds: string[];
  finalWagerSubmissionStatus: Record<string, boolean>;
  finalAnswerSubmissionStatus: Record<string, boolean>;
  finalRevealOrder: string[];
  finalRevealIndex: number;
  finalRevealStep: 'ANSWER' | 'RULE' | 'WAGER';
  finalRevealedAnswers: Record<string, string>;
  finalRevealedWagers: Record<string, number>;
  roundComplete: boolean;
  serverNow: number;
}

export interface ContestantView extends BoardView {
  playerId: string;
  isControllingPlayer: boolean;
  isLockedOut: boolean;
  lockoutUntil: number | null;
  canWager: boolean;
  canAnswer: boolean;
  isEligibleForFinal: boolean;
  finalWagerSubmitted: boolean;
  myFinalWager: number | null;
  finalAnswerSubmitted: boolean;
  myFinalAnswer: string | null;
}

const CLUE_TEXT_PHASES = new Set<GameState['phase']>([
  'CLUE_REVEALED',
  'BUZZERS_ARMED',
  'BUZZED',
  'DAILY_DOUBLE_CLUE',
  'FINAL_CLUE',
]);

const HIDDEN_ANSWER_PHASES = new Set<GameState['phase']>([
  'FINAL_WAGER',
  'FINAL_CLUE',
  'FINAL_REVEAL',
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

export function isRoundComplete(state: GameState): boolean {
  const round = getCurrentRound(state);
  if (!round) return false;
  return round.clues.length > 0 && round.clues.every((clue) => state.usedClueIds.includes(clue.id));
}

function getFinalEligiblePlayerIds(state: GameState): string[] {
  return state.players.filter((p) => p.score > 0).map((p) => p.id);
}

function getFinalWagerSubmissionStatus(state: GameState): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  for (const player of state.players) {
    status[player.id] = state.finalWagers[player.id] !== undefined;
  }
  return status;
}

function getFinalAnswerSubmissionStatus(state: GameState): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  for (const player of state.players) {
    status[player.id] = state.finalAnswers[player.id] !== undefined;
  }
  return status;
}

function getFinalRevealedAnswers(state: GameState): Record<string, string> {
  if (state.phase !== 'FINAL_REVEAL') return {};
  const revealed: Record<string, string> = {};
  for (let i = 0; i < state.finalRevealOrder.length; i++) {
    const playerId = state.finalRevealOrder[i];
    if (i < state.finalRevealIndex) {
      revealed[playerId] = state.finalAnswers[playerId] ?? '';
    } else if (i === state.finalRevealIndex && (state.finalRevealStep === 'RULE' || state.finalRevealStep === 'WAGER')) {
      revealed[playerId] = state.finalAnswers[playerId] ?? '';
    }
  }
  return revealed;
}

function getFinalRevealedWagers(state: GameState): Record<string, number> {
  if (state.phase !== 'FINAL_REVEAL') return {};
  const revealed: Record<string, number> = {};
  for (let i = 0; i < state.finalRevealOrder.length; i++) {
    const playerId = state.finalRevealOrder[i];
    if (i < state.finalRevealIndex) {
      revealed[playerId] = state.finalWagers[playerId] ?? 0;
    } else if (i === state.finalRevealIndex && state.finalRevealStep === 'WAGER') {
      revealed[playerId] = state.finalWagers[playerId] ?? 0;
    }
  }
  return revealed;
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
    dailyDoubleWager: null,
    transitionTarget: state.transitionTarget,
    finalNoEligiblePlayers: state.finalNoEligiblePlayers,
    finalEligiblePlayerIds: getFinalEligiblePlayerIds(state),
    finalWagerSubmissionStatus: getFinalWagerSubmissionStatus(state),
    finalAnswerSubmissionStatus: getFinalAnswerSubmissionStatus(state),
    finalRevealOrder: state.finalRevealOrder,
    finalRevealIndex: state.finalRevealIndex,
    finalRevealStep: state.finalRevealStep,
    finalRevealedAnswers: getFinalRevealedAnswers(state),
    finalRevealedWagers: getFinalRevealedWagers(state),
    roundComplete: isRoundComplete(state),
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
    answer: state.revealedAnswer ?? (HIDDEN_ANSWER_PHASES.has(state.phase) ? null : currentClue?.answer ?? null),
    lastOutcome: state.lastOutcome
      ? { playerId: state.lastOutcome.playerId, type: state.lastOutcome.type, value: state.lastOutcome.value }
      : null,
    lockedOutPlayerIds: state.lockedOutPlayerIds,
    auditLog: state.auditLog,
    dailyDoubleWager: state.dailyDoubleWager,
    transitionTarget: state.transitionTarget,
    finalNoEligiblePlayers: state.finalNoEligiblePlayers,
    finalEligiblePlayerIds: getFinalEligiblePlayerIds(state),
    finalWagerSubmissionStatus: getFinalWagerSubmissionStatus(state),
    finalAnswerSubmissionStatus: getFinalAnswerSubmissionStatus(state),
    finalRevealOrder: state.finalRevealOrder,
    finalRevealIndex: state.finalRevealIndex,
    finalRevealStep: state.finalRevealStep,
    finalRevealedAnswers: getFinalRevealedAnswers(state),
    finalRevealedWagers: getFinalRevealedWagers(state),
    roundComplete: isRoundComplete(state),
    serverNow: now,
  };
}

export function projectContestant(state: GameState, playerId: string, now: number): ContestantView {
  const board = projectBoard(state, now);
  const isControllingPlayer = state.controllingPlayerId === playerId;
  const lockoutUntil = state.lockoutUntil[playerId] ?? null;
  const canSeeDailyDoubleWager = isControllingPlayer && (state.phase === 'DAILY_DOUBLE_WAGER' || state.phase === 'DAILY_DOUBLE_CLUE');
  const me = state.players.find((p) => p.id === playerId);
  const isEligibleForFinal = me ? me.score > 0 : false;
  const myFinalWager = state.finalWagers[playerId] ?? null;
  const myFinalAnswer = state.finalAnswers[playerId] ?? null;
  const canAnswerFinal = state.phase === 'FINAL_CLUE' && isEligibleForFinal && myFinalAnswer === null;
  return {
    ...board,
    playerId,
    isControllingPlayer,
    isLockedOut: isLockedOut(state, playerId, now),
    lockoutUntil,
    canWager:
      state.phase === 'DAILY_DOUBLE_WAGER'
        ? isControllingPlayer
        : state.phase === 'FINAL_WAGER' && isEligibleForFinal && myFinalWager === null,
    canAnswer: state.phase === 'DAILY_DOUBLE_CLUE' ? isControllingPlayer : canAnswerFinal,
    dailyDoubleWager: canSeeDailyDoubleWager ? state.dailyDoubleWager : null,
    isEligibleForFinal,
    finalWagerSubmitted: myFinalWager !== null,
    myFinalWager: myFinalWager,
    finalAnswerSubmitted: myFinalAnswer !== null,
    myFinalAnswer: myFinalAnswer,
  };
}
