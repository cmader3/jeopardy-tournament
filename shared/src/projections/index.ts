import { GameState, Clue, AuditRecord, ClueSelectionMode, RemovedPlayer } from '../models/index.js';
import { getActingCaptainId, getTeamMembers, isTeamMode } from '../reducer/index.js';

export interface ProjectedPlayer {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  teamId?: string | null;
}

export interface ProjectedTeam {
  id: string;
  name: string;
  score: number;
  captainId: string | null;
  actingCaptainId: string | null;
  memberIds: string[];
  connectedMemberIds: string[];
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
  teamMode: boolean;
  teams: ProjectedTeam[];
  round: ProjectedRoundPublic | null;
  usedClueIds: string[];
  clueSelectionMode: ClueSelectionMode;
  finalAllowNonPositive: boolean;
  pendingClueId: string | null;
  currentClueId: string | null;
  currentClueText: string | null;
  controllingPlayerId: string | null;
  controllingTeamId: string | null;
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
  teamMode: boolean;
  teams: ProjectedTeam[];
  round: ProjectedRoundHost | null;
  usedClueIds: string[];
  clueSelectionMode: ClueSelectionMode;
  finalAllowNonPositive: boolean;
  pendingClueId: string | null;
  currentClueId: string | null;
  currentClueText: string | null;
  controllingPlayerId: string | null;
  controllingTeamId: string | null;
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
  nextRoundTarget: 'DOUBLE_JEOPARDY' | 'FINAL';
  removedPlayers: RemovedPlayer[];
  serverNow: number;
}

export interface ContestantView extends BoardView {
  playerId: string;
  teamId: string | null;
  teamName: string | null;
  teamScore: number | null;
  isCaptain: boolean;
  isActingCaptain: boolean;
  isTemporaryCaptain: boolean;
  isTeamLockedOut: boolean;
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
  const teamMode = isTeamMode(state);
  return state.players.map((p) => {
    const projected: ProjectedPlayer = {
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
    };
    if (teamMode) projected.teamId = p.teamId ?? null;
    return projected;
  });
}

function projectTeams(state: GameState): ProjectedTeam[] {
  if (!isTeamMode(state)) return [];
  return (state.teams ?? []).map((team) => {
    const members = getTeamMembers(state.players, team.id);
    return {
      id: team.id,
      name: team.name,
      score: team.score,
      captainId: team.captainId,
      actingCaptainId: getActingCaptainId(state, team.id),
      memberIds: members.map((m) => m.id),
      connectedMemberIds: members.filter((m) => m.connected).map((m) => m.id),
    };
  });
}

function holderIdForPlayer(state: GameState, playerId: string): string | null {
  if (isTeamMode(state)) {
    return state.players.find((p) => p.id === playerId)?.teamId ?? null;
  }
  return playerId;
}

function getCurrentRound(state: GameState): GameState['board']['rounds'][number] | undefined {
  return state.board.rounds[state.roundIndex];
}

function getCurrentClue(state: GameState): Clue | null {
  const round = getCurrentRound(state);
  if (!round || !state.currentClueId) return null;
  return round.clues.find((c) => c.id === state.currentClueId) ?? null;
}

function getNextRoundTarget(state: GameState): 'DOUBLE_JEOPARDY' | 'FINAL' {
  for (let i = state.roundIndex + 1; i < state.board.rounds.length; i++) {
    const round = state.board.rounds[i];
    if (round.type === 'DOUBLE_JEOPARDY' && !state.board.includeDoubleJeopardy) continue;
    return round.type === 'DOUBLE_JEOPARDY' ? 'DOUBLE_JEOPARDY' : 'FINAL';
  }
  return 'FINAL';
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

function isLockedOut(state: GameState, playerId: string): boolean {
  if (state.lockedOutPlayerIds.includes(playerId)) return true;
  if (isTeamMode(state)) {
    const player = state.players.find((p) => p.id === playerId);
    if (player && player.teamId && (state.lockedOutTeamIds ?? []).includes(player.teamId)) return true;
  }
  return false;
}

export function isRoundComplete(state: GameState): boolean {
  const round = getCurrentRound(state);
  if (!round) return false;
  return round.clues.length > 0 && round.clues.every((clue) => state.usedClueIds.includes(clue.id));
}

// Final-eligible score holders: team ids in team mode, otherwise player ids.
// When finalAllowNonPositive is set, holders with $0 or less are eligible too.
function getFinalEligiblePlayerIds(state: GameState): string[] {
  const allowNonPositive = state.finalAllowNonPositive === true;
  if (isTeamMode(state)) {
    return (state.teams ?? [])
      .filter((t) => (allowNonPositive || t.score > 0) && getTeamMembers(state.players, t.id).length > 0)
      .map((t) => t.id);
  }
  return state.players.filter((p) => allowNonPositive || p.score > 0).map((p) => p.id);
}

function getFinalWagerSubmissionStatus(state: GameState): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  const ids = isTeamMode(state) ? (state.teams ?? []).map((t) => t.id) : state.players.map((p) => p.id);
  for (const id of ids) {
    status[id] = state.finalWagers[id] !== undefined;
  }
  return status;
}

function getFinalAnswerSubmissionStatus(state: GameState): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  const ids = isTeamMode(state) ? (state.teams ?? []).map((t) => t.id) : state.players.map((p) => p.id);
  for (const id of ids) {
    status[id] = state.finalAnswers[id] !== undefined;
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
    teamMode: isTeamMode(state),
    teams: projectTeams(state),
    round: round ? projectBoardRound(round) : null,
    usedClueIds: state.usedClueIds,
    clueSelectionMode: state.clueSelectionMode ?? 'HOST',
    finalAllowNonPositive: state.finalAllowNonPositive ?? false,
    pendingClueId: state.pendingClueId ?? null,
    currentClueId: state.currentClueId,
    currentClueText: showClueText ? currentClue?.clueText ?? null : null,
    controllingPlayerId: state.controllingPlayerId,
    controllingTeamId: state.controllingTeamId ?? null,
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
    teamMode: isTeamMode(state),
    teams: projectTeams(state),
    round: round ? projectHostRound(round) : null,
    usedClueIds: state.usedClueIds,
    clueSelectionMode: state.clueSelectionMode ?? 'HOST',
    finalAllowNonPositive: state.finalAllowNonPositive ?? false,
    pendingClueId: state.pendingClueId ?? null,
    currentClueId: state.currentClueId,
    currentClueText: showClueText ? currentClue?.clueText ?? null : null,
    controllingPlayerId: state.controllingPlayerId,
    controllingTeamId: state.controllingTeamId ?? null,
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
    nextRoundTarget: getNextRoundTarget(state),
    removedPlayers: state.removedPlayers,
    serverNow: now,
  };
}

export function projectContestant(state: GameState, playerId: string, now: number): ContestantView {
  const board = projectBoard(state, now);
  const teamMode = isTeamMode(state);
  const me = state.players.find((p) => p.id === playerId);
  const team = teamMode && me?.teamId ? (state.teams ?? []).find((t) => t.id === me.teamId) ?? null : null;
  const actingCaptainId = team ? getActingCaptainId(state, team.id) : null;
  const isCaptain = team != null && team.captainId === playerId;
  const isActingCaptain = team != null && actingCaptainId === playerId;
  const isTemporaryCaptain = isActingCaptain && !isCaptain;

  // Who acts as the board controller for this player's perspective.
  const isControllingPlayer = teamMode
    ? team != null && state.controllingTeamId === team.id && isActingCaptain
    : state.controllingPlayerId === playerId;

  const lockoutUntil = state.lockoutUntil[playerId] ?? null;
  const canSeeDailyDoubleWager =
    isControllingPlayer && (state.phase === 'DAILY_DOUBLE_WAGER' || state.phase === 'DAILY_DOUBLE_CLUE');

  const holderId = holderIdForPlayer(state, playerId);
  const holderScore = teamMode ? team?.score ?? 0 : me?.score ?? 0;
  const allowNonPositiveFinal = state.finalAllowNonPositive === true;
  const isEligibleForFinal = teamMode
    ? team != null && (allowNonPositiveFinal || holderScore > 0)
    : allowNonPositiveFinal || holderScore > 0;
  // In team mode only the acting captain submits on the team's behalf.
  const canActForFinal = teamMode ? isActingCaptain : true;
  const myFinalWager = holderId ? state.finalWagers[holderId] ?? null : null;
  const myFinalAnswer = holderId ? state.finalAnswers[holderId] ?? null : null;
  const canAnswerFinal =
    state.phase === 'FINAL_CLUE' && isEligibleForFinal && canActForFinal && myFinalAnswer === null;

  return {
    ...board,
    playerId,
    teamId: team?.id ?? null,
    teamName: team?.name ?? null,
    teamScore: team ? team.score : null,
    isCaptain,
    isActingCaptain,
    isTemporaryCaptain,
    isTeamLockedOut: team != null && (state.lockedOutTeamIds ?? []).includes(team.id),
    isControllingPlayer,
    isLockedOut: isLockedOut(state, playerId),
    lockoutUntil,
    canWager:
      state.phase === 'DAILY_DOUBLE_WAGER'
        ? isControllingPlayer
        : state.phase === 'FINAL_WAGER' && isEligibleForFinal && canActForFinal && myFinalWager === null,
    canAnswer: state.phase === 'DAILY_DOUBLE_CLUE' ? isControllingPlayer : canAnswerFinal,
    dailyDoubleWager: canSeeDailyDoubleWager ? state.dailyDoubleWager : null,
    isEligibleForFinal,
    finalWagerSubmitted: myFinalWager !== null,
    myFinalWager: myFinalWager,
    finalAnswerSubmitted: myFinalAnswer !== null,
    myFinalAnswer: myFinalAnswer,
  };
}
