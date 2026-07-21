import { AuditRecord, ClueSelectionMode, GameState, Player, Team } from '../models/index.js';

export interface ReducerCtx {
  now: number;
  random?: () => number;
}

export type Intent =
  | { type: 'JOIN'; player: Player }
  | { type: 'LEAVE'; playerId: string }
  | { type: 'REMOVE_PLAYER'; playerId: string }
  | { type: 'ADMIT_PLAYER'; playerId: string }
  | { type: 'CONFIGURE_TEAMS'; enabled: boolean; teams: { id: string; name: string }[] }
  | { type: 'CHOOSE_TEAM'; playerId: string; teamId: string }
  | { type: 'SET_CAPTAIN'; teamId: string; playerId: string }
  | { type: 'OVERRIDE_CONTROL_TEAM'; teamId: string }
  | { type: 'DISCONNECT'; playerId: string }
  | { type: 'RECONNECT'; playerId: string }
  | { type: 'START_GAME' }
  | { type: 'RESTART_GAME' }
  | { type: 'SELECT_CLUE'; clueId: string; selectorId?: string; hostOverride?: boolean }
  | { type: 'REOPEN_CLUE'; clueId: string; revertScores: boolean }
  | { type: 'SET_CLUE_SELECTION_MODE'; mode: ClueSelectionMode }
  | { type: 'REVEAL_SELECTED_CLUE' }
  | { type: 'ARM_BUZZERS' }
  | { type: 'BUZZ'; playerId: string }
  | { type: 'RULE_CORRECT' }
  | { type: 'RULE_INCORRECT'; playerId: string }
  | { type: 'TIME_EXPIRE' }
  | { type: 'REVEAL_CLUE' }
  | { type: 'REVEAL_ANSWER' }
  | { type: 'RETURN_TO_BOARD' }
  | { type: 'SUBMIT_DD_WAGER'; playerId: string; amount: number }
  | { type: 'SUBMIT_FINAL_WAGER'; playerId: string; amount: number }
  | { type: 'SUBMIT_FINAL_ANSWER'; playerId: string; answer: string }
  | { type: 'SUBMIT_FINAL_ANSWER_DRAFT'; playerId: string; answer: string }
  | { type: 'FORCE_FINAL_WAGERS' }
  | { type: 'START_FINAL_TIMER' }
  | { type: 'CANCEL_DAILY_DOUBLE' }
  | { type: 'ADVANCE_ROUND' }
  | { type: 'OVERRIDE_CONTROL'; playerId: string }
  | { type: 'ADJUST_SCORE'; playerId: string; score: number }
  | { type: 'UNDO_LAST_RULING' }
  | { type: 'OPEN_FINAL_WAGERS' }
  | { type: 'REVEAL_FINAL_ANSWER' }
  | { type: 'RULE_FINAL_CORRECT' }
  | { type: 'RULE_FINAL_INCORRECT' }
  | { type: 'REVEAL_FINAL_WAGER' };

export type Effect =
  | { type: 'NOOP' }
  | { type: 'BROADCAST_STATE' }
  | { type: 'INTENT_REJECTED'; reason: string };

export interface ReducerResult {
  state: GameState;
  effects: Effect[];
}

const MAX_PLAYERS = 5;
const MAX_TEAM_PLAYERS = 48;
const MIN_TEAMS = 2;
const MAX_TEAMS = 6;
export const EARLY_BUZZ_LOCKOUT_MS = 500;
const FINAL_ANSWER_DRAFT_GRACE_MS = 300;

export function isTeamMode(state: GameState): boolean {
  return state.teamMode === true;
}

function getTeams(state: GameState): Team[] {
  return state.teams ?? [];
}

function getTeamById(state: GameState, teamId: string | null | undefined): Team | undefined {
  if (!teamId) return undefined;
  return getTeams(state).find((t) => t.id === teamId);
}

function getPlayerTeam(state: GameState, playerId: string): Team | undefined {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !player.teamId) return undefined;
  return getTeamById(state, player.teamId);
}

export function getTeamMembers(players: Player[], teamId: string): Player[] {
  return players.filter((p) => p.teamId === teamId).sort((a, b) => a.seatOrder - b.seatOrder);
}

// The player who acts for a team right now: the captain when connected,
// otherwise the earliest-seated connected teammate (a temporary captain).
export function getActingCaptainId(state: GameState, teamId: string | null | undefined): string | null {
  const team = getTeamById(state, teamId);
  if (!team) return null;
  const members = getTeamMembers(state.players, team.id);
  if (members.length === 0) return null;
  if (team.captainId) {
    const captain = members.find((m) => m.id === team.captainId);
    if (captain && captain.connected) return captain.id;
  }
  const connected = members.find((m) => m.connected);
  if (connected) return connected.id;
  return team.captainId ?? members[0].id;
}

// Keep each team's persistent captain valid: reassign to the earliest remaining
// member only when the current captain is no longer on the team.
function recomputeCaptains(players: Player[], teams: Team[]): Team[] {
  return teams.map((team) => {
    const members = getTeamMembers(players, team.id);
    const stillMember = team.captainId != null && members.some((m) => m.id === team.captainId);
    const captainId = stillMember ? team.captainId : members[0]?.id ?? null;
    return captainId === team.captainId ? team : { ...team, captainId };
  });
}

function determineTrailingTeamId(state: GameState, teams: Team[]): string | null {
  const withMembers = teams.filter((t) => getTeamMembers(state.players, t.id).length > 0);
  const pool = withMembers.length > 0 ? withMembers : teams;
  if (pool.length === 0) return null;
  let trailing = pool[0];
  for (const team of pool) {
    if (team.score < trailing.score) trailing = team;
  }
  return trailing.id;
}

function isTeamLockedOut(state: GameState, teamId: string | null | undefined): boolean {
  if (!teamId) return false;
  return (state.lockedOutTeamIds ?? []).includes(teamId);
}

// Score holder = the team in team mode, otherwise the individual player.
function holderScoreForPlayer(state: GameState, playerId: string): number {
  if (isTeamMode(state)) return getPlayerTeam(state, playerId)?.score ?? 0;
  return state.players.find((p) => p.id === playerId)?.score ?? 0;
}

function holderScoreById(state: GameState, holderId: string): number {
  if (isTeamMode(state)) return getTeamById(state, holderId)?.score ?? 0;
  return state.players.find((p) => p.id === holderId)?.score ?? 0;
}

function applyHolderDeltaById(
  state: GameState,
  holderId: string,
  delta: number,
): { players: Player[]; teams: Team[] } {
  if (isTeamMode(state)) {
    const teams = getTeams(state).map((t) => (t.id === holderId ? { ...t, score: t.score + delta } : t));
    return { players: state.players, teams };
  }
  const players = state.players.map((p) => (p.id === holderId ? { ...p, score: p.score + delta } : p));
  return { players, teams: getTeams(state) };
}

export function createInitialState(sessionId: string, roomCode: string, board: GameState['board']): GameState {
  return {
    sessionId,
    roomCode,
    boardId: board.id,
    board,
    phase: 'LOBBY',
    roundIndex: 0,
    players: [],
    teamMode: false,
    teams: [],
    controllingPlayerId: null,
    controllingTeamId: null,
    usedClueIds: [],
    clueSelectionMode: 'HOST',
    pendingClueId: null,
    removedPlayers: [],
    archived: false,
    completedAt: null,
    currentClueId: null,
    buzzWinnerId: null,
    armedAt: null,
    deadline: null,
    lockedOutPlayerIds: [],
    lockedOutTeamIds: [],
    lockoutUntil: {},
    auditLog: [],
    dailyDoubleWager: null,
    finalWagers: {},
    finalAnswers: {},
    finalAnswerDrafts: {},
    revealedAnswer: null,
    transitionTarget: null,
    finalNoEligiblePlayers: false,
    finalRevealOrder: [],
    finalRevealIndex: 0,
    finalRevealStep: 'ANSWER',
    lastOutcome: null,
  };
}

export function reduce(state: GameState, intent: Intent, ctx: ReducerCtx): ReducerResult {
  switch (intent.type) {
    case 'JOIN':
      return handleJoin(state, intent.player);
    case 'LEAVE':
      return handleLeave(state, intent.playerId);
    case 'REMOVE_PLAYER':
      return handleRemovePlayer(state, intent.playerId);
    case 'ADMIT_PLAYER':
      return handleAdmitPlayer(state, intent.playerId);
    case 'CONFIGURE_TEAMS':
      return handleConfigureTeams(state, intent);
    case 'CHOOSE_TEAM':
      return handleChooseTeam(state, intent);
    case 'SET_CAPTAIN':
      return handleSetCaptain(state, intent);
    case 'OVERRIDE_CONTROL_TEAM':
      return handleOverrideControlTeam(state, intent.teamId);
    case 'DISCONNECT':
      return handleDisconnect(state, intent.playerId);
    case 'RECONNECT':
      return handleReconnect(state, intent.playerId);
    case 'START_GAME':
      return handleStartGame(state);
    case 'RESTART_GAME':
      return handleRestartGame(state);
    case 'SELECT_CLUE':
      return handleSelectClue(state, intent);
    case 'REOPEN_CLUE':
      return handleReopenClue(state, intent.clueId, intent.revertScores);
    case 'SET_CLUE_SELECTION_MODE':
      return handleSetClueSelectionMode(state, intent);
    case 'REVEAL_SELECTED_CLUE':
      return handleRevealSelectedClue(state);
    case 'ARM_BUZZERS':
      return handleArmBuzzers(state, ctx);
    case 'BUZZ':
      return handleBuzz(state, intent.playerId, ctx);
    case 'RULE_CORRECT':
      return handleRuleCorrect(state, ctx);
    case 'RULE_INCORRECT':
      return handleRuleIncorrect(state, intent.playerId, ctx);
    case 'TIME_EXPIRE':
      return handleTimeExpire(state);
    case 'SUBMIT_DD_WAGER':
      return handleSubmitDDWager(state, intent);
    case 'SUBMIT_FINAL_WAGER':
      return handleSubmitFinalWager(state, intent, ctx);
    case 'SUBMIT_FINAL_ANSWER':
      return handleSubmitFinalAnswer(state, intent, ctx);
    case 'SUBMIT_FINAL_ANSWER_DRAFT':
      return handleSubmitFinalAnswerDraft(state, intent, ctx);
    case 'FORCE_FINAL_WAGERS':
      return handleForceFinalWagers(state, ctx);
    case 'START_FINAL_TIMER':
      return handleStartFinalTimer(state, ctx);
    case 'CANCEL_DAILY_DOUBLE':
      return handleCancelDailyDouble(state);
    case 'REVEAL_CLUE':
      return handleRevealClue(state);
    case 'REVEAL_ANSWER':
      return handleRevealAnswer(state);
    case 'RETURN_TO_BOARD':
      return handleReturnToBoard(state);
    case 'ADVANCE_ROUND':
      return handleAdvanceRound(state);
    case 'OVERRIDE_CONTROL':
      return handleOverrideControl(state, intent.playerId);
    case 'ADJUST_SCORE':
      return handleAdjustScore(state, intent, ctx);
    case 'UNDO_LAST_RULING':
      return handleUndoLastRuling(state);
    case 'OPEN_FINAL_WAGERS':
      return handleOpenFinalWagers(state);
    case 'REVEAL_FINAL_ANSWER':
      return handleRevealFinalAnswer(state);
    case 'RULE_FINAL_CORRECT':
      return handleRuleFinalCorrect(state, ctx);
    case 'RULE_FINAL_INCORRECT':
      return handleRuleFinalIncorrect(state, ctx);
    case 'REVEAL_FINAL_WAGER':
      return handleRevealFinalWager(state);
    default:
      return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Unknown intent' }] };
  }
}

function handleJoin(state: GameState, player: Player): ReducerResult {
  if (state.phase !== 'LOBBY') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Game is not in the lobby' }] };
  }

  const playerCap = isTeamMode(state) ? MAX_TEAM_PLAYERS : MAX_PLAYERS;
  if (state.players.length >= playerCap) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Game is full' }] };
  }

  const existing = state.players.find((p) => p.id === player.id);
  if (existing) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player already joined' }] };
  }

  const normalizedName = player.name.trim().toLowerCase();
  if (normalizedName.length === 0) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Name is required' }] };
  }

  const removedByHost = state.removedPlayers.some((p) => p.name.trim().toLowerCase() === normalizedName);
  if (removedByHost) {
    return {
      state,
      effects: [{ type: 'INTENT_REJECTED', reason: 'The host removed you from this game. Ask the host to let you back in.' }],
    };
  }

  const duplicateName = state.players.find((p) => p.name.trim().toLowerCase() === normalizedName);
  if (duplicateName) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'A contestant with that name already joined' }] };
  }

  const nextSeatOrder = Math.max(0, ...state.players.map((p) => p.seatOrder + 1));
  const joined: Player = { ...player, seatOrder: nextSeatOrder, connected: true };
  return {
    state: { ...state, players: [...state.players, joined] },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleLeave(state: GameState, playerId: string): ReducerResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player not found' }] };
  }

  if (state.phase === 'LOBBY') {
    const remaining = state.players.filter((p) => p.id !== playerId);
    const teams = isTeamMode(state) ? recomputeCaptains(remaining, getTeams(state)) : getTeams(state);
    return {
      state: { ...state, players: remaining, teams },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  const updated = state.players.map((p) => (p.id === playerId ? { ...p, connected: false } : p));
  return {
    state: { ...state, players: updated },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleRemovePlayer(state: GameState, playerId: string): ReducerResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player not found' }] };
  }

  const remaining = state.players.filter((p) => p.id !== playerId);
  const omit = <T,>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([id]) => id !== playerId));
  const finalRevealOrder = state.finalRevealOrder.filter((id) => id !== playerId);

  const normalizedName = player.name.trim().toLowerCase();
  const removedPlayers = state.removedPlayers.some((p) => p.name.trim().toLowerCase() === normalizedName)
    ? state.removedPlayers
    : [...state.removedPlayers, { id: player.id, name: player.name }];

  const teams = isTeamMode(state) ? recomputeCaptains(remaining, getTeams(state)) : getTeams(state);
  return {
    state: {
      ...state,
      players: remaining,
      teams,
      removedPlayers,
      controllingPlayerId: state.controllingPlayerId === playerId ? null : state.controllingPlayerId,
      buzzWinnerId: state.buzzWinnerId === playerId ? null : state.buzzWinnerId,
      lockedOutPlayerIds: state.lockedOutPlayerIds.filter((id) => id !== playerId),
      lockoutUntil: omit(state.lockoutUntil),
      finalWagers: omit(state.finalWagers),
      finalAnswers: omit(state.finalAnswers),
      finalAnswerDrafts: omit(state.finalAnswerDrafts),
      finalRevealOrder,
      finalRevealIndex: Math.min(state.finalRevealIndex, Math.max(0, finalRevealOrder.length - 1)),
      lastOutcome: state.lastOutcome?.playerId === playerId ? null : state.lastOutcome,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleAdmitPlayer(state: GameState, playerId: string): ReducerResult {
  const removedPlayer = state.removedPlayers.find((p) => p.id === playerId);
  if (!removedPlayer) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player was not removed' }] };
  }

  return {
    state: { ...state, removedPlayers: state.removedPlayers.filter((p) => p.id !== playerId) },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleConfigureTeams(
  state: GameState,
  intent: Extract<Intent, { type: 'CONFIGURE_TEAMS' }>,
): ReducerResult {
  if (state.phase !== 'LOBBY') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Teams can only be configured in the lobby' }] };
  }

  if (!intent.enabled) {
    const players = state.players.map((p) => ({ ...p, teamId: null }));
    return {
      state: { ...state, teamMode: false, teams: [], players, controllingTeamId: null },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  if (intent.teams.length < MIN_TEAMS || intent.teams.length > MAX_TEAMS) {
    return {
      state,
      effects: [{ type: 'INTENT_REJECTED', reason: `Team mode requires between ${MIN_TEAMS} and ${MAX_TEAMS} teams` }],
    };
  }

  const seen = new Set<string>();
  for (const team of intent.teams) {
    if (seen.has(team.id)) {
      return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Duplicate team id' }] };
    }
    seen.add(team.id);
  }

  const existing = getTeams(state);
  const teams: Team[] = intent.teams.map((t) => {
    const prev = existing.find((e) => e.id === t.id);
    return { id: t.id, name: t.name, score: prev?.score ?? 0, captainId: prev?.captainId ?? null };
  });
  const validIds = new Set(teams.map((t) => t.id));
  const players = state.players.map((p) => (p.teamId && !validIds.has(p.teamId) ? { ...p, teamId: null } : p));
  const recomputed = recomputeCaptains(players, teams);
  const controllingTeamId =
    state.controllingTeamId && validIds.has(state.controllingTeamId) ? state.controllingTeamId : null;

  return {
    state: { ...state, teamMode: true, teams: recomputed, players, controllingTeamId },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleChooseTeam(
  state: GameState,
  intent: Extract<Intent, { type: 'CHOOSE_TEAM' }>,
): ReducerResult {
  if (!isTeamMode(state)) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Team mode is not enabled' }] };
  }
  if (state.phase !== 'LOBBY') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'You can only choose a team in the lobby' }] };
  }
  const player = state.players.find((p) => p.id === intent.playerId);
  if (!player) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player not found' }] };
  }
  const team = getTeamById(state, intent.teamId);
  if (!team) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Team not found' }] };
  }

  const players = state.players.map((p) => (p.id === intent.playerId ? { ...p, teamId: team.id } : p));
  const recomputed = recomputeCaptains(players, getTeams(state));
  return {
    state: { ...state, players, teams: recomputed },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleSetCaptain(
  state: GameState,
  intent: Extract<Intent, { type: 'SET_CAPTAIN' }>,
): ReducerResult {
  if (!isTeamMode(state)) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Team mode is not enabled' }] };
  }
  const team = getTeamById(state, intent.teamId);
  if (!team) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Team not found' }] };
  }
  const member = state.players.find((p) => p.id === intent.playerId && p.teamId === team.id);
  if (!member) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'That contestant is not on this team' }] };
  }
  const teams = getTeams(state).map((t) => (t.id === team.id ? { ...t, captainId: intent.playerId } : t));
  return { state: { ...state, teams }, effects: [{ type: 'BROADCAST_STATE' }] };
}

function handleOverrideControlTeam(state: GameState, teamId: string): ReducerResult {
  if (!isTeamMode(state)) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Team mode is not enabled' }] };
  }
  if (state.phase !== 'BOARD_SELECT') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Cannot assign control right now' }] };
  }
  const team = getTeamById(state, teamId);
  if (!team) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Team not found' }] };
  }
  return { state: { ...state, controllingTeamId: teamId }, effects: [{ type: 'BROADCAST_STATE' }] };
}

function handleReopenClue(state: GameState, clueId: string, revertScores: boolean): ReducerResult {
  if (state.phase !== 'BOARD_SELECT') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Clues can only be re-done between clues' }] };
  }

  if (!state.usedClueIds.includes(clueId)) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'That clue has not been played yet' }] };
  }

  const usedClueIds = state.usedClueIds.filter((id) => id !== clueId);

  if (!revertScores) {
    return {
      state: { ...state, usedClueIds },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  const players = state.players.map((p) => ({ ...p }));
  const teams = getTeams(state).map((t) => ({ ...t }));
  const remainingAudit: AuditRecord[] = [];
  for (const record of state.auditLog) {
    const isClueRuling =
      record.clueId === clueId && (record.type === 'CORRECT' || record.type === 'INCORRECT');
    if (!isClueRuling) {
      remainingAudit.push(record);
      continue;
    }
    const delta = record.scoreAfter - record.scoreBefore;
    if (record.teamId) {
      const team = teams.find((t) => t.id === record.teamId);
      if (team) team.score -= delta;
    } else {
      const target = players.find((p) => p.id === record.playerId);
      if (target) target.score -= delta;
    }
  }

  return {
    state: {
      ...state,
      usedClueIds,
      players,
      teams,
      auditLog: remainingAudit,
      lastOutcome: null,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleDisconnect(state: GameState, playerId: string): ReducerResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !player.connected) {
    return { state, effects: [{ type: 'BROADCAST_STATE' }] };
  }

  const updated = state.players.map((p) => (p.id === playerId ? { ...p, connected: false } : p));
  return {
    state: { ...state, players: updated },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleReconnect(state: GameState, playerId: string): ReducerResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player not found' }] };
  }

  if (player.connected) {
    return { state, effects: [{ type: 'BROADCAST_STATE' }] };
  }

  const updated = state.players.map((p) => (p.id === playerId ? { ...p, connected: true } : p));
  return {
    state: { ...state, players: updated },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleRestartGame(state: GameState): ReducerResult {
  const fresh = createInitialState(state.sessionId, state.roomCode, state.board);
  const players = state.players.map((player) => ({ ...player, score: 0 }));
  const teams = getTeams(state).map((team) => ({ ...team, score: 0 }));
  return {
    state: {
      ...fresh,
      players,
      teamMode: isTeamMode(state),
      teams,
      clueSelectionMode: state.clueSelectionMode ?? 'HOST',
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleStartGame(state: GameState): ReducerResult {
  if (state.phase !== 'LOBBY') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Game is not in the lobby' }] };
  }

  const connectedPlayers = state.players.filter((p) => p.connected);
  if (connectedPlayers.length === 0) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'At least one connected contestant is required to start' }] };
  }

  if (isTeamMode(state)) {
    const teams = getTeams(state);
    if (teams.length < MIN_TEAMS) {
      return { state, effects: [{ type: 'INTENT_REJECTED', reason: `Team mode requires at least ${MIN_TEAMS} teams` }] };
    }
    for (const team of teams) {
      if (team.name.trim().length === 0) {
        return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Every team needs a name' }] };
      }
      if (getTeamMembers(state.players, team.id).length === 0) {
        return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Every team needs at least one contestant' }] };
      }
    }
    return {
      state: {
        ...state,
        phase: 'BOARD_SELECT',
        controllingPlayerId: null,
        controllingTeamId: determineTrailingTeamId(state, teams),
      },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  const controller = connectedPlayers.reduce((lowest, p) => (p.seatOrder < lowest.seatOrder ? p : lowest));
  return {
    state: {
      ...state,
      phase: 'BOARD_SELECT',
      controllingPlayerId: controller.id,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleSelectClue(
  state: GameState,
  intent: Extract<Intent, { type: 'SELECT_CLUE' }>,
): ReducerResult {
  if (state.phase !== 'BOARD_SELECT') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Cannot select a clue right now' }] };
  }

  const mode = state.clueSelectionMode ?? 'HOST';
  const isHost = intent.hostOverride === true;
  const controllerId = isTeamMode(state)
    ? getActingCaptainId(state, state.controllingTeamId)
    : state.controllingPlayerId;
  const isController = intent.selectorId !== undefined && intent.selectorId === controllerId;

  if (mode === 'HOST' && !isHost) {
    return {
      state,
      effects: [{ type: 'INTENT_REJECTED', reason: 'Only the host can select a clue in host-pick mode' }],
    };
  }

  if (mode === 'PLAYER' && !isHost && !isController) {
    return {
      state,
      effects: [{ type: 'INTENT_REJECTED', reason: 'Only the controlling player or host can select a clue' }],
    };
  }

  const round = state.board.rounds[state.roundIndex];
  if (!round) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No active round' }] };
  }

  const clue = round.clues.find((c) => c.id === intent.clueId);
  if (!clue) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Clue not found' }] };
  }

  if (state.usedClueIds.includes(clue.id)) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Clue has already been used' }] };
  }

  if (mode === 'PLAYER') {
    return {
      state: {
        ...state,
        phase: 'CLUE_SELECTED',
        pendingClueId: clue.id,
        currentClueId: null,
        buzzWinnerId: null,
        armedAt: null,
        deadline: null,
        lockedOutPlayerIds: [],
        lockedOutTeamIds: [],
        lockoutUntil: {},
        revealedAnswer: null,
        lastOutcome: null,
        dailyDoubleWager: null,
      },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  const nextPhase = clue.isDailyDouble ? 'DAILY_DOUBLE_WAGER' : 'CLUE_REVEALED';

  return {
    state: {
      ...state,
      phase: nextPhase,
      currentClueId: clue.id,
      pendingClueId: null,
      buzzWinnerId: null,
      armedAt: null,
      deadline: null,
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      lockoutUntil: {},
      revealedAnswer: null,
      lastOutcome: null,
      dailyDoubleWager: null,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleSetClueSelectionMode(
  state: GameState,
  intent: Extract<Intent, { type: 'SET_CLUE_SELECTION_MODE' }>,
): ReducerResult {
  return {
    state: { ...state, clueSelectionMode: intent.mode },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleRevealSelectedClue(state: GameState): ReducerResult {
  if (state.phase !== 'CLUE_SELECTED') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No selected clue is waiting to be revealed' }] };
  }

  const pendingClueId = state.pendingClueId;
  if (!pendingClueId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No selected clue' }] };
  }

  const round = state.board.rounds[state.roundIndex];
  if (!round) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No active round' }] };
  }

  const clue = round.clues.find((c) => c.id === pendingClueId);
  if (!clue) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Clue not found' }] };
  }

  if (state.usedClueIds.includes(clue.id)) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Clue has already been used' }] };
  }

  const nextPhase = clue.isDailyDouble ? 'DAILY_DOUBLE_WAGER' : 'CLUE_REVEALED';

  return {
    state: {
      ...state,
      phase: nextPhase,
      currentClueId: clue.id,
      pendingClueId: null,
      buzzWinnerId: null,
      armedAt: null,
      deadline: null,
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      lockoutUntil: {},
      revealedAnswer: null,
      lastOutcome: null,
      dailyDoubleWager: null,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleArmBuzzers(state: GameState, ctx: ReducerCtx): ReducerResult {
  if (state.phase !== 'CLUE_REVEALED') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Buzzers can only be armed while a clue is revealed' }] };
  }

  if (!state.currentClueId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No clue is available to arm buzzers for' }] };
  }

  const durationMs = state.board.defaultTimerSeconds * 1000;

  return {
    state: {
      ...state,
      phase: 'BUZZERS_ARMED',
      armedAt: ctx.now,
      deadline: ctx.now + durationMs,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function getCurrentClue(state: GameState): GameState['board']['rounds'][number]['clues'][number] | undefined {
  const round = state.board.rounds[state.roundIndex];
  if (!round || !state.currentClueId) return undefined;
  return round.clues.find((c) => c.id === state.currentClueId);
}

function isRoundComplete(state: GameState): boolean {
  const round = state.board.rounds[state.roundIndex];
  if (!round) return false;
  return round.clues.length > 0 && round.clues.every((clue) => state.usedClueIds.includes(clue.id));
}

function isLockedOut(state: GameState, playerId: string, now: number): boolean {
  if (state.lockedOutPlayerIds.includes(playerId)) return true;
  if (isTeamMode(state)) {
    const player = state.players.find((p) => p.id === playerId);
    if (player && isTeamLockedOut(state, player.teamId)) return true;
  }
  const until = state.lockoutUntil[playerId];
  return until !== undefined && until > now;
}

function hasBuzzWinner(state: GameState): boolean {
  return state.buzzWinnerId !== null;
}

function handleBuzz(state: GameState, playerId: string, ctx: ReducerCtx): ReducerResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player not found' }] };
  }

  if (state.phase === 'CLUE_REVEALED') {
    return {
      state: {
        ...state,
        lockoutUntil: { ...state.lockoutUntil, [playerId]: ctx.now + EARLY_BUZZ_LOCKOUT_MS },
      },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  if (state.phase === 'BUZZED') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Another contestant has already buzzed in' }] };
  }

  if (state.phase !== 'BUZZERS_ARMED') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Buzzers are not armed' }] };
  }

  if (!player.connected) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Contestant is not connected' }] };
  }

  if (isLockedOut(state, playerId, ctx.now)) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Contestant is locked out' }] };
  }

  if (hasBuzzWinner(state)) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Another contestant has already buzzed in' }] };
  }

  return {
    state: {
      ...state,
      phase: 'BUZZED',
      buzzWinnerId: playerId,
      deadline: null,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function createAuditRecord(
  type: AuditRecord['type'],
  playerId: string,
  value: number,
  scoreBefore: number,
  scoreAfter: number,
  controllingPlayerIdBefore: string | null,
  timestamp: number,
  clueId?: string,
  teamId?: string,
  controllingTeamIdBefore?: string | null,
): AuditRecord {
  return {
    id: `${timestamp}-${playerId}`,
    type,
    playerId,
    teamId,
    value,
    scoreBefore,
    scoreAfter,
    controllingPlayerIdBefore,
    controllingTeamIdBefore,
    timestamp,
    clueId,
  };
}

function resolveClueReturnToBoard(state: GameState, clueId: string): GameState {
  return {
    ...state,
    phase: 'BOARD_SELECT',
    usedClueIds: [...state.usedClueIds, clueId],
    currentClueId: null,
    buzzWinnerId: null,
    armedAt: null,
    deadline: null,
    lockedOutPlayerIds: [],
    lockedOutTeamIds: [],
    lockoutUntil: {},
    dailyDoubleWager: null,
  };
}

function handleDailyDoubleRuling(
  state: GameState,
  ctx: ReducerCtx,
  type: 'CORRECT' | 'INCORRECT',
  playerId?: string,
): ReducerResult {
  if (state.phase !== 'DAILY_DOUBLE_CLUE') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No Daily Double is available to rule right now' }] };
  }

  const teamMode = isTeamMode(state);
  const hasController = teamMode ? state.controllingTeamId != null : state.controllingPlayerId != null;
  if (state.dailyDoubleWager == null || state.currentClueId == null || !hasController) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Daily Double is not ready to be ruled' }] };
  }

  const clue = getCurrentClue(state);
  if (!clue) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Current clue not found' }] };
  }

  const controllerId = teamMode ? getActingCaptainId(state, state.controllingTeamId) : state.controllingPlayerId;
  if (!controllerId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Controlling contestant not found' }] };
  }

  if (type === 'INCORRECT' && playerId !== controllerId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Only the controlling contestant can be ruled on a Daily Double' }] };
  }

  const holderId = teamMode ? (state.controllingTeamId as string) : controllerId;
  const value = state.dailyDoubleWager;
  const scoreBefore = holderScoreById(state, holderId);
  const delta = type === 'CORRECT' ? value : -value;
  const { players, teams } = applyHolderDeltaById(state, holderId, delta);
  const scoreAfter = scoreBefore + delta;

  const auditEntry = createAuditRecord(
    type,
    controllerId,
    value,
    scoreBefore,
    scoreAfter,
    state.controllingPlayerId,
    ctx.now,
    clue.id,
    teamMode ? holderId : undefined,
    state.controllingTeamId,
  );

  const controlUpdate = teamMode
    ? { controllingTeamId: state.controllingTeamId }
    : { controllingPlayerId: controllerId };

  return {
    state: {
      ...resolveClueReturnToBoard(state, clue.id),
      players,
      teams,
      ...controlUpdate,
      auditLog: [...state.auditLog, auditEntry],
      revealedAnswer: clue.answer,
      lastOutcome: { playerId: controllerId, type, value },
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleRuleCorrect(state: GameState, ctx: ReducerCtx): ReducerResult {
  if (state.phase === 'DAILY_DOUBLE_CLUE') {
    return handleDailyDoubleRuling(state, ctx, 'CORRECT');
  }

  if (state.phase === 'DAILY_DOUBLE_WAGER') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The Daily Double clue must be revealed before it can be ruled' }] };
  }

  if (state.phase !== 'BUZZED') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No contestant is buzzed in' }] };
  }

  if (!state.buzzWinnerId || !state.currentClueId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No contestant is buzzed in' }] };
  }

  const clue = getCurrentClue(state);
  if (!clue) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Current clue not found' }] };
  }

  const value = clue.value ?? 0;
  const winner = state.players.find((p) => p.id === state.buzzWinnerId);
  if (!winner) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Buzzed contestant not found' }] };
  }

  const teamMode = isTeamMode(state);
  const holderId = teamMode ? winner.teamId ?? null : winner.id;
  if (teamMode && !holderId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Buzzed contestant is not on a team' }] };
  }

  const scoreBefore = holderScoreById(state, holderId as string);
  const { players, teams } = applyHolderDeltaById(state, holderId as string, value);
  const scoreAfter = scoreBefore + value;

  const auditEntry = createAuditRecord(
    'CORRECT',
    winner.id,
    value,
    scoreBefore,
    scoreAfter,
    state.controllingPlayerId,
    ctx.now,
    clue.id,
    teamMode ? (holderId as string) : undefined,
    state.controllingTeamId,
  );

  const controlUpdate = teamMode
    ? { controllingTeamId: winner.teamId ?? state.controllingTeamId }
    : { controllingPlayerId: winner.id };

  return {
    state: {
      ...resolveClueReturnToBoard(state, clue.id),
      players,
      teams,
      ...controlUpdate,
      auditLog: [...state.auditLog, auditEntry],
      revealedAnswer: clue.answer,
      lastOutcome: { playerId: winner.id, type: 'CORRECT', value },
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleRuleIncorrect(state: GameState, playerId: string, ctx: ReducerCtx): ReducerResult {
  if (state.phase === 'DAILY_DOUBLE_CLUE') {
    return handleDailyDoubleRuling(state, ctx, 'INCORRECT', playerId);
  }

  if (state.phase === 'DAILY_DOUBLE_WAGER') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The Daily Double clue must be revealed before it can be ruled' }] };
  }

  if (state.phase !== 'BUZZED') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No contestant is buzzed in' }] };
  }

  if (state.buzzWinnerId !== playerId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Only the buzzed-in contestant can be ruled' }] };
  }

  if (!state.currentClueId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No current clue' }] };
  }

  const clue = getCurrentClue(state);
  if (!clue) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Current clue not found' }] };
  }

  const value = clue.value ?? 0;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Buzzed contestant not found' }] };
  }

  const teamMode = isTeamMode(state);
  const holderId = teamMode ? player.teamId ?? null : player.id;
  if (teamMode && !holderId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Buzzed contestant is not on a team' }] };
  }

  const scoreBefore = holderScoreById(state, holderId as string);
  const { players: updatedPlayers, teams } = applyHolderDeltaById(state, holderId as string, -value);
  const scoreAfter = scoreBefore - value;

  const updatedLockedOutPlayerIds = [...state.lockedOutPlayerIds, playerId];
  const updatedLockedOutTeamIds =
    teamMode && player.teamId ? [...(state.lockedOutTeamIds ?? []), player.teamId] : state.lockedOutTeamIds ?? [];
  const auditEntry = createAuditRecord(
    'INCORRECT',
    player.id,
    value,
    scoreBefore,
    scoreAfter,
    state.controllingPlayerId,
    ctx.now,
    clue.id,
    teamMode ? (holderId as string) : undefined,
    state.controllingTeamId,
  );

  const remainingEligible = updatedPlayers.filter(
    (p) =>
      p.id !== playerId &&
      p.connected &&
      !updatedLockedOutPlayerIds.includes(p.id) &&
      !(teamMode && p.teamId != null && updatedLockedOutTeamIds.includes(p.teamId)),
  );

  if (remainingEligible.length === 0) {
    return {
      state: {
        ...resolveClueReturnToBoard(state, clue.id),
        players: updatedPlayers,
        teams,
        auditLog: [...state.auditLog, auditEntry],
        revealedAnswer: clue.answer,
        lastOutcome: { playerId: player.id, type: 'INCORRECT', value },
      },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  const durationMs = state.board.defaultTimerSeconds * 1000;
  return {
    state: {
      ...state,
      phase: 'BUZZERS_ARMED',
      players: updatedPlayers,
      teams,
      buzzWinnerId: null,
      armedAt: ctx.now,
      deadline: ctx.now + durationMs,
      lockedOutPlayerIds: updatedLockedOutPlayerIds,
      lockedOutTeamIds: updatedLockedOutTeamIds,
      auditLog: [...state.auditLog, auditEntry],
      lastOutcome: { playerId: player.id, type: 'INCORRECT', value },
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function buildFinalRevealOrder(state: GameState, finalWagers: Record<string, number>): string[] {
  if (isTeamMode(state)) {
    return getTeams(state)
      .map((team, index) => ({ team, index }))
      .filter(({ team }) => finalWagers[team.id] !== undefined)
      .sort((a, b) => {
        if (a.team.score !== b.team.score) return a.team.score - b.team.score;
        return a.index - b.index;
      })
      .map(({ team }) => team.id);
  }
  return state.players
    .filter((p) => finalWagers[p.id] !== undefined)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.seatOrder - b.seatOrder;
    })
    .map((p) => p.id);
}

function handleTimeExpire(state: GameState): ReducerResult {
  if (state.phase === 'BUZZERS_ARMED') {
    if (!state.currentClueId) {
      return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No current clue' }] };
    }

    const clue = getCurrentClue(state);
    return {
      state: {
        ...resolveClueReturnToBoard(state, state.currentClueId),
        revealedAnswer: clue?.answer ?? null,
        lastOutcome: null,
      },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  if (state.phase === 'FINAL_CLUE') {
    const eligible = getFinalEligibleHolderIds(state);
    const finalAnswers = { ...state.finalAnswers };
    for (const holderId of eligible) {
      if (finalAnswers[holderId] === undefined) {
        finalAnswers[holderId] = state.finalAnswerDrafts[holderId] ?? '';
      }
    }
    const finalRevealOrder = buildFinalRevealOrder(state, state.finalWagers);
    if (finalRevealOrder.length === 0) {
      return {
        state: { ...state, phase: 'COMPLETE', finalAnswers, finalAnswerDrafts: {}, deadline: null },
        effects: [{ type: 'BROADCAST_STATE' }],
      };
    }
    return {
      state: {
        ...state,
        phase: 'FINAL_REVEAL',
        finalAnswers,
        finalAnswerDrafts: {},
        deadline: null,
        finalRevealOrder,
        finalRevealIndex: 0,
        finalRevealStep: 'ANSWER',
      },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Timer can only expire while buzzers are armed or during Final Jeopardy' }] };
}

const DEFAULT_MIN_WAGER = 5;

function getHighestClueValueInRound(state: GameState): number {
  const round = state.board.rounds[state.roundIndex];
  if (!round) return 0;
  return round.clues.reduce((max, clue) => (clue.value != null && clue.value > max ? clue.value : max), 0);
}

function handleSubmitDDWager(
  state: GameState,
  intent: Extract<Intent, { type: 'SUBMIT_DD_WAGER' }>,
): ReducerResult {
  if (state.dailyDoubleWager != null) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'A wager has already been submitted for this Daily Double' }] };
  }

  if (state.phase !== 'DAILY_DOUBLE_WAGER') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No Daily Double wager is being accepted right now' }] };
  }

  const controllerId = isTeamMode(state)
    ? getActingCaptainId(state, state.controllingTeamId)
    : state.controllingPlayerId;
  if (controllerId !== intent.playerId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Only the controlling contestant can wager' }] };
  }

  const player = state.players.find((p) => p.id === intent.playerId);
  if (!player) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player not found' }] };
  }

  const maxWager = Math.max(holderScoreForPlayer(state, intent.playerId), getHighestClueValueInRound(state));
  if (intent.amount < DEFAULT_MIN_WAGER) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: `Wager must be at least the minimum of $${DEFAULT_MIN_WAGER}` }] };
  }

  if (intent.amount > maxWager) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: `Wager cannot exceed the maximum of $${maxWager}` }] };
  }

  return {
    state: {
      ...state,
      dailyDoubleWager: intent.amount,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleCancelDailyDouble(state: GameState): ReducerResult {
  if (state.phase !== 'DAILY_DOUBLE_WAGER') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No Daily Double is available to cancel right now' }] };
  }

  if (state.dailyDoubleWager != null) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'A wager has already been submitted for this Daily Double' }] };
  }

  if (isTeamMode(state)) {
    if (state.controllingTeamId == null) {
      return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No controlling team is assigned' }] };
    }
    const actingId = getActingCaptainId(state, state.controllingTeamId);
    const acting = actingId ? state.players.find((p) => p.id === actingId) : undefined;
    if (acting && acting.connected) {
      return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The controlling team still has a connected contestant' }] };
    }
  } else {
    if (state.controllingPlayerId == null) {
      return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No controlling contestant is assigned' }] };
    }
    const controller = state.players.find((p) => p.id === state.controllingPlayerId);
    if (!controller) {
      return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Controlling contestant not found' }] };
    }
    if (controller.connected) {
      return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The controlling contestant is still connected' }] };
    }
  }

  return {
    state: {
      ...state,
      phase: 'BOARD_SELECT',
      currentClueId: null,
      buzzWinnerId: null,
      armedAt: null,
      deadline: null,
      lockedOutPlayerIds: [],
      lockedOutTeamIds: [],
      lockoutUntil: {},
      revealedAnswer: null,
      lastOutcome: null,
      dailyDoubleWager: null,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleRevealClue(state: GameState): ReducerResult {
  if (state.phase !== 'DAILY_DOUBLE_WAGER') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No Daily Double clue is waiting to be revealed' }] };
  }

  if (state.dailyDoubleWager == null) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The Daily Double wager must be submitted before the clue is revealed' }] };
  }

  return {
    state: { ...state, phase: 'DAILY_DOUBLE_CLUE' },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleRevealAnswer(state: GameState): ReducerResult {
  const canReveal = state.phase === 'CLUE_REVEALED' || (state.phase === 'BUZZERS_ARMED' && state.buzzWinnerId === null);
  if (!canReveal) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No clue is available to reveal right now' }] };
  }

  if (!state.currentClueId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No current clue' }] };
  }

  const clue = getCurrentClue(state);
  return {
    state: {
      ...resolveClueReturnToBoard(state, state.currentClueId),
      revealedAnswer: clue?.answer ?? null,
      lastOutcome: null,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleReturnToBoard(state: GameState): ReducerResult {
  const canReturn = state.phase === 'CLUE_REVEALED' || (state.phase === 'BUZZERS_ARMED' && state.buzzWinnerId === null);
  if (!canReturn) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No clue is available to close right now' }] };
  }

  if (!state.currentClueId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No current clue' }] };
  }

  return {
    state: {
      ...resolveClueReturnToBoard(state, state.currentClueId),
      revealedAnswer: null,
      lastOutcome: null,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function pickTrailingPlayer(players: Player[]): Player | null {
  if (players.length === 0) return null;
  let trailing = players[0];
  for (const player of players) {
    if (player.score < trailing.score || (player.score === trailing.score && player.seatOrder < trailing.seatOrder)) {
      trailing = player;
    }
  }
  return trailing;
}

function determineTrailingController(players: Player[]): string | null {
  const connected = players.filter((p) => p.connected);
  const candidatePool = connected.length > 0 ? connected : players;
  return pickTrailingPlayer(candidatePool)?.id ?? null;
}

function handleAdvanceRound(state: GameState): ReducerResult {
  if (state.phase !== 'BOARD_SELECT' && state.phase !== 'ROUND_TRANSITION') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Cannot advance round right now' }] };
  }

  if (state.phase === 'BOARD_SELECT') {
    if (!isRoundComplete(state)) {
      return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Round is not complete' }] };
    }

    const target = determineTransitionTarget(state);
    return {
      state: {
        ...state,
        phase: 'ROUND_TRANSITION',
        transitionTarget: target,
      },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  // ROUND_TRANSITION -> proceed to the target round.
  if (state.transitionTarget == null) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No transition target is set' }] };
  }

  const nextRoundIndex = findNextPlayableRoundIndex(state);
  const resetClueState = {
    currentClueId: null,
    buzzWinnerId: null,
    armedAt: null,
    deadline: null,
    lockedOutPlayerIds: [],
    lockedOutTeamIds: [],
    lockoutUntil: {},
    revealedAnswer: null,
    lastOutcome: null,
  };

  if (state.transitionTarget === 'DOUBLE_JEOPARDY') {
    const controlUpdate = isTeamMode(state)
      ? { controllingPlayerId: null, controllingTeamId: determineTrailingTeamId(state, getTeams(state)) }
      : { controllingPlayerId: determineTrailingController(state.players) };
    return {
      state: {
        ...state,
        phase: 'BOARD_SELECT',
        roundIndex: nextRoundIndex ?? state.roundIndex + 1,
        transitionTarget: null,
        ...controlUpdate,
        ...resetClueState,
      },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  // FINAL
  return {
    state: {
      ...state,
      phase: 'FINAL_INTRO',
      roundIndex: nextRoundIndex ?? state.roundIndex + 1,
      transitionTarget: null,
      ...resetClueState,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleOverrideControl(state: GameState, playerId: string): ReducerResult {
  if (state.phase !== 'BOARD_SELECT') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Cannot assign control right now' }] };
  }

  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player not found' }] };
  }

  return {
    state: { ...state, controllingPlayerId: playerId },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

// Final-eligible score holders: teams with a positive score and at least one
// member in team mode, otherwise individual players with a positive score.
function getFinalEligibleHolderIds(state: GameState): string[] {
  if (isTeamMode(state)) {
    return getTeams(state)
      .filter((t) => t.score > 0 && getTeamMembers(state.players, t.id).length > 0)
      .map((t) => t.id);
  }
  return state.players.filter((p) => p.score > 0).map((p) => p.id);
}

// Resolve the score holder a submitting player represents in Final Jeopardy.
// In team mode only the acting captain of an eligible team may submit.
function resolveFinalSubmission(
  state: GameState,
  playerId: string,
): { holderId: string; score: number } | { error: string } {
  if (isTeamMode(state)) {
    const team = getPlayerTeam(state, playerId);
    if (!team) return { error: 'You are not on a team' };
    if (team.score <= 0) return { error: 'Only eligible teams can submit in Final Jeopardy' };
    if (getActingCaptainId(state, team.id) !== playerId) {
      return { error: 'Only the team captain can submit for the team' };
    }
    return { holderId: team.id, score: team.score };
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { error: 'Player not found' };
  if (player.score <= 0) return { error: 'Only eligible contestants can submit in Final Jeopardy' };
  return { holderId: player.id, score: player.score };
}

function getFinalRoundClueId(state: GameState): string | null {
  const round = state.board.rounds[state.roundIndex];
  if (!round || round.type !== 'FINAL') return null;
  return round.clues[0]?.id ?? null;
}

function closeFinalWagerPhase(state: GameState, _ctx: ReducerCtx): GameState {
  const eligible = getFinalEligibleHolderIds(state);
  const finalWagers = { ...state.finalWagers };
  for (const holderId of eligible) {
    if (finalWagers[holderId] === undefined) {
      finalWagers[holderId] = 0;
    }
  }
  return {
    ...state,
    phase: 'FINAL_CLUE',
    finalWagers,
    currentClueId: getFinalRoundClueId(state),
    // The clue is revealed so the host can read it aloud; the answer timer does
    // not start until the host explicitly starts it (START_FINAL_TIMER).
    deadline: null,
  };
}

function handleSubmitFinalWager(
  state: GameState,
  intent: Extract<Intent, { type: 'SUBMIT_FINAL_WAGER' }>,
  _ctx: ReducerCtx,
): ReducerResult {
  if (state.phase !== 'FINAL_WAGER') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No Final wager is being accepted right now' }] };
  }

  const resolved = resolveFinalSubmission(state, intent.playerId);
  if ('error' in resolved) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: resolved.error }] };
  }
  const { holderId, score } = resolved;

  if (state.finalWagers[holderId] !== undefined) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'A Final wager has already been submitted' }] };
  }

  if (!Number.isInteger(intent.amount)) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Wager must be a whole number' }] };
  }

  if (intent.amount < 0 || intent.amount > score) {
    return {
      state,
      effects: [{ type: 'INTENT_REJECTED', reason: `Wager must be between 0 and $${score}` }],
    };
  }

  const updated = { ...state, finalWagers: { ...state.finalWagers, [holderId]: intent.amount } };
  return { state: updated, effects: [{ type: 'BROADCAST_STATE' }] };
}

function handleSubmitFinalAnswer(
  state: GameState,
  intent: Extract<Intent, { type: 'SUBMIT_FINAL_ANSWER' }>,
  ctx: ReducerCtx,
): ReducerResult {
  if (state.phase !== 'FINAL_CLUE') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No Final answer is being accepted right now' }] };
  }

  if (state.deadline == null) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The Final Jeopardy timer has not started yet' }] };
  }

  if (ctx.now > state.deadline) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The Final answer window has closed' }] };
  }

  const resolved = resolveFinalSubmission(state, intent.playerId);
  if ('error' in resolved) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: resolved.error }] };
  }
  const { holderId } = resolved;

  if (state.finalAnswers[holderId] !== undefined) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'A Final answer has already been submitted' }] };
  }

  const remainingDrafts = { ...state.finalAnswerDrafts };
  delete remainingDrafts[holderId];
  return {
    state: {
      ...state,
      finalAnswers: { ...state.finalAnswers, [holderId]: intent.answer },
      finalAnswerDrafts: remainingDrafts,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleSubmitFinalAnswerDraft(
  state: GameState,
  intent: Extract<Intent, { type: 'SUBMIT_FINAL_ANSWER_DRAFT' }>,
  ctx: ReducerCtx,
): ReducerResult {
  if (state.phase !== 'FINAL_CLUE') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No Final answer is being accepted right now' }] };
  }

  if (state.deadline == null) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The Final Jeopardy timer has not started yet' }] };
  }

  if (ctx.now > state.deadline + FINAL_ANSWER_DRAFT_GRACE_MS) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The Final answer window has closed' }] };
  }

  const resolved = resolveFinalSubmission(state, intent.playerId);
  if ('error' in resolved) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: resolved.error }] };
  }
  const { holderId } = resolved;

  if (state.finalAnswers[holderId] !== undefined) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'A Final answer has already been submitted' }] };
  }

  return {
    state: {
      ...state,
      finalAnswerDrafts: { ...state.finalAnswerDrafts, [holderId]: intent.answer },
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleForceFinalWagers(
  state: GameState,
  ctx: ReducerCtx,
): ReducerResult {
  if (state.phase !== 'FINAL_WAGER') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Final wagers cannot be forced right now' }] };
  }

  return { state: closeFinalWagerPhase(state, ctx), effects: [{ type: 'BROADCAST_STATE' }] };
}

function handleStartFinalTimer(state: GameState, ctx: ReducerCtx): ReducerResult {
  if (state.phase !== 'FINAL_CLUE') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The Final timer cannot be started right now' }] };
  }

  if (state.deadline != null) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The Final timer has already started' }] };
  }

  return {
    state: { ...state, deadline: ctx.now + state.board.finalTimerSeconds * 1000 },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleOpenFinalWagers(state: GameState): ReducerResult {
  if (state.phase !== 'FINAL_INTRO') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Cannot open Final wagers right now' }] };
  }

  const eligible = getFinalEligibleHolderIds(state);
  if (eligible.length === 0) {
    return {
      state: { ...state, phase: 'COMPLETE', finalNoEligiblePlayers: true },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  return {
    state: { ...state, phase: 'FINAL_WAGER', finalNoEligiblePlayers: false },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function findNextPlayableRoundIndex(state: GameState): number | null {
  const rounds = state.board.rounds;
  for (let i = state.roundIndex + 1; i < rounds.length; i++) {
    const round = rounds[i];
    if (round.type === 'DOUBLE_JEOPARDY' && !state.board.includeDoubleJeopardy) continue;
    return i;
  }
  return null;
}

function determineTransitionTarget(state: GameState): 'DOUBLE_JEOPARDY' | 'FINAL' {
  const nextIndex = findNextPlayableRoundIndex(state);
  if (nextIndex == null) return 'FINAL';
  const round = state.board.rounds[nextIndex];
  return round.type === 'DOUBLE_JEOPARDY' ? 'DOUBLE_JEOPARDY' : 'FINAL';
}

function handleAdjustScore(
  state: GameState,
  intent: Extract<Intent, { type: 'ADJUST_SCORE' }>,
  ctx: ReducerCtx,
): ReducerResult {
  const playerIndex = state.players.findIndex((p) => p.id === intent.playerId);
  if (playerIndex === -1) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player not found' }] };
  }

  const player = state.players[playerIndex];
  const scoreBefore = player.score;
  const scoreAfter = intent.score;
  const updatedPlayers = [...state.players];
  updatedPlayers[playerIndex] = { ...player, score: scoreAfter };

  const auditEntry = createAuditRecord(
    'MANUAL',
    player.id,
    scoreAfter,
    scoreBefore,
    scoreAfter,
    state.controllingPlayerId,
    ctx.now,
  );

  return {
    state: {
      ...state,
      players: updatedPlayers,
      auditLog: [...state.auditLog, auditEntry],
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleUndoLastRuling(state: GameState): ReducerResult {
  // Locate the most recent ruling (CORRECT/INCORRECT), skipping any manual
  // score adjustments that were recorded after it. Manual adjustments are
  // intentionally not undoable via this control.
  let rulingIndex = -1;
  for (let i = state.auditLog.length - 1; i >= 0; i--) {
    const record = state.auditLog[i];
    if (record.type === 'CORRECT' || record.type === 'INCORRECT') {
      rulingIndex = i;
      break;
    }
  }

  if (rulingIndex === -1) {
    return { state, effects: [] };
  }

  const record = state.auditLog[rulingIndex];
  // Revert only the ruling's delta, preserving any later manual adjustments
  // that may have been applied to the same score holder.
  const rulingDelta = record.scoreAfter - record.scoreBefore;
  let updatedPlayers = state.players;
  let updatedTeams = getTeams(state);

  if (record.teamId) {
    if (!updatedTeams.some((t) => t.id === record.teamId)) {
      // The affected team no longer exists; treat as a safe no-op.
      return { state, effects: [] };
    }
    updatedTeams = updatedTeams.map((t) =>
      t.id === record.teamId ? { ...t, score: t.score - rulingDelta } : t,
    );
  } else {
    const playerIndex = state.players.findIndex((p) => p.id === record.playerId);
    if (playerIndex === -1) {
      // The affected player no longer exists; treat as a safe no-op.
      return { state, effects: [] };
    }
    const player = state.players[playerIndex];
    updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = { ...player, score: player.score - rulingDelta };
  }

  let updatedState: GameState = {
    ...state,
    players: updatedPlayers,
    teams: updatedTeams,
    auditLog: state.auditLog.filter((_, i) => i !== rulingIndex),
  };

  if (record.type === 'CORRECT') {
    updatedState = isTeamMode(state)
      ? { ...updatedState, controllingTeamId: record.controllingTeamIdBefore ?? updatedState.controllingTeamId }
      : { ...updatedState, controllingPlayerId: record.controllingPlayerIdBefore };
  }

  if (record.type === 'INCORRECT') {
    updatedState = {
      ...updatedState,
      lockedOutPlayerIds: state.lockedOutPlayerIds.filter((id) => id !== record.playerId),
      lockedOutTeamIds: record.teamId
        ? (state.lockedOutTeamIds ?? []).filter((id) => id !== record.teamId)
        : state.lockedOutTeamIds ?? [],
    };
  }

  return { state: updatedState, effects: [{ type: 'BROADCAST_STATE' }] };
}

function getCurrentFinalPlayerId(state: GameState): string | null {
  return state.finalRevealOrder[state.finalRevealIndex] ?? null;
}

function handleRevealFinalAnswer(state: GameState): ReducerResult {
  if (state.phase !== 'FINAL_REVEAL') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Cannot reveal a Final answer right now' }] };
  }

  if (state.finalRevealStep !== 'ANSWER') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The answer has already been revealed' }] };
  }

  if (getCurrentFinalPlayerId(state) == null) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No contestant is queued for reveal' }] };
  }

  return {
    state: { ...state, finalRevealStep: 'RULE' },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleRuleFinalCorrect(state: GameState, ctx: ReducerCtx): ReducerResult {
  if (state.phase !== 'FINAL_REVEAL') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Cannot rule a Final answer right now' }] };
  }

  if (state.finalRevealStep !== 'RULE') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The answer must be revealed before ruling' }] };
  }

  const holderId = getCurrentFinalPlayerId(state);
  if (holderId == null) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No contestant is queued for reveal' }] };
  }

  const teamMode = isTeamMode(state);
  if (!teamMode && !state.players.some((p) => p.id === holderId)) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player not found' }] };
  }

  const wager = state.finalWagers[holderId] ?? 0;
  const scoreBefore = holderScoreById(state, holderId);
  const { players: updatedPlayers, teams } = applyHolderDeltaById(state, holderId, wager);
  const scoreAfter = scoreBefore + wager;
  const auditPlayerId = teamMode ? getActingCaptainId(state, holderId) ?? holderId : holderId;

  const auditEntry = createAuditRecord(
    'CORRECT',
    auditPlayerId,
    wager,
    scoreBefore,
    scoreAfter,
    state.controllingPlayerId,
    ctx.now,
    undefined,
    teamMode ? holderId : undefined,
    state.controllingTeamId,
  );

  return {
    state: {
      ...state,
      teams,
      players: updatedPlayers,
      auditLog: [...state.auditLog, auditEntry],
      finalRevealStep: 'WAGER',
      lastOutcome: { playerId: auditPlayerId, type: 'CORRECT', value: wager },
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleRuleFinalIncorrect(state: GameState, ctx: ReducerCtx): ReducerResult {
  if (state.phase !== 'FINAL_REVEAL') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Cannot rule a Final answer right now' }] };
  }

  if (state.finalRevealStep !== 'RULE') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The answer must be revealed before ruling' }] };
  }

  const holderId = getCurrentFinalPlayerId(state);
  if (holderId == null) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No contestant is queued for reveal' }] };
  }

  const teamMode = isTeamMode(state);
  if (!teamMode && !state.players.some((p) => p.id === holderId)) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player not found' }] };
  }

  const wager = state.finalWagers[holderId] ?? 0;
  const scoreBefore = holderScoreById(state, holderId);
  const { players: updatedPlayers, teams } = applyHolderDeltaById(state, holderId, -wager);
  const scoreAfter = scoreBefore - wager;
  const auditPlayerId = teamMode ? getActingCaptainId(state, holderId) ?? holderId : holderId;

  const auditEntry = createAuditRecord(
    'INCORRECT',
    auditPlayerId,
    wager,
    scoreBefore,
    scoreAfter,
    state.controllingPlayerId,
    ctx.now,
    undefined,
    teamMode ? holderId : undefined,
    state.controllingTeamId,
  );

  return {
    state: {
      ...state,
      teams,
      players: updatedPlayers,
      auditLog: [...state.auditLog, auditEntry],
      finalRevealStep: 'WAGER',
      lastOutcome: { playerId: auditPlayerId, type: 'INCORRECT', value: wager },
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleRevealFinalWager(state: GameState): ReducerResult {
  if (state.phase !== 'FINAL_REVEAL') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Cannot reveal a Final wager right now' }] };
  }

  if (state.finalRevealStep !== 'WAGER') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'The wager can only be revealed after ruling' }] };
  }

  const nextIndex = state.finalRevealIndex + 1;
  if (nextIndex >= state.finalRevealOrder.length) {
    return {
      state: {
        ...state,
        phase: 'COMPLETE',
        finalRevealStep: 'ANSWER',
      },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  return {
    state: {
      ...state,
      finalRevealIndex: nextIndex,
      finalRevealStep: 'ANSWER',
      lastOutcome: null,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}
