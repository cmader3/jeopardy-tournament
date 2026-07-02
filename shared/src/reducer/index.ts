import { AuditRecord, GameState, Player } from '../models/index.js';

export interface ReducerCtx {
  now: number;
  random?: () => number;
}

export type Intent =
  | { type: 'JOIN'; player: Player }
  | { type: 'LEAVE'; playerId: string }
  | { type: 'DISCONNECT'; playerId: string }
  | { type: 'RECONNECT'; playerId: string }
  | { type: 'START_GAME' }
  | { type: 'SELECT_CLUE'; clueId: string; selectorId?: string; hostOverride?: boolean }
  | { type: 'ARM_BUZZERS' }
  | { type: 'BUZZ'; playerId: string }
  | { type: 'RULE_CORRECT' }
  | { type: 'RULE_INCORRECT'; playerId: string }
  | { type: 'TIME_EXPIRE' }
  | { type: 'REVEAL_CLUE' }
  | { type: 'REVEAL_ANSWER' }
  | { type: 'SUBMIT_DD_WAGER'; playerId: string; amount: number }
  | { type: 'ADJUST_SCORE'; playerId: string; score: number }
  | { type: 'UNDO_LAST_RULING' };

export type Effect =
  | { type: 'NOOP' }
  | { type: 'BROADCAST_STATE' }
  | { type: 'INTENT_REJECTED'; reason: string };

export interface ReducerResult {
  state: GameState;
  effects: Effect[];
}

const MAX_PLAYERS = 5;
const EARLY_BUZZ_LOCKOUT_MS = 250;

export function createInitialState(sessionId: string, roomCode: string, board: GameState['board']): GameState {
  return {
    sessionId,
    roomCode,
    boardId: board.id,
    board,
    phase: 'LOBBY',
    roundIndex: 0,
    players: [],
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
    revealedAnswer: null,
    lastOutcome: null,
  };
}

export function reduce(state: GameState, intent: Intent, ctx: ReducerCtx): ReducerResult {
  switch (intent.type) {
    case 'JOIN':
      return handleJoin(state, intent.player);
    case 'LEAVE':
      return handleLeave(state, intent.playerId);
    case 'DISCONNECT':
      return handleDisconnect(state, intent.playerId);
    case 'RECONNECT':
      return handleReconnect(state, intent.playerId);
    case 'START_GAME':
      return handleStartGame(state);
    case 'SELECT_CLUE':
      return handleSelectClue(state, intent);
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
    case 'REVEAL_CLUE':
      return handleRevealClue(state);
    case 'REVEAL_ANSWER':
      return handleRevealAnswer(state);
    case 'ADJUST_SCORE':
      return handleAdjustScore(state, intent, ctx);
    case 'UNDO_LAST_RULING':
      return handleUndoLastRuling(state);
    default:
      return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Unknown intent' }] };
  }
}

function handleJoin(state: GameState, player: Player): ReducerResult {
  if (state.phase !== 'LOBBY') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Game is not in the lobby' }] };
  }

  if (state.players.length >= MAX_PLAYERS) {
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
    return {
      state: { ...state, players: remaining },
      effects: [{ type: 'BROADCAST_STATE' }],
    };
  }

  const updated = state.players.map((p) => (p.id === playerId ? { ...p, connected: false } : p));
  return {
    state: { ...state, players: updated },
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

function handleStartGame(state: GameState): ReducerResult {
  if (state.phase !== 'LOBBY') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Game is not in the lobby' }] };
  }

  const connectedPlayers = state.players.filter((p) => p.connected);
  if (connectedPlayers.length === 0) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'At least one connected contestant is required to start' }] };
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

  const canSelect =
    intent.hostOverride === true ||
    (intent.selectorId !== undefined && intent.selectorId === state.controllingPlayerId);

  if (!canSelect) {
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

  const nextPhase = clue.isDailyDouble ? 'DAILY_DOUBLE_WAGER' : 'CLUE_REVEALED';

  return {
    state: {
      ...state,
      phase: nextPhase,
      currentClueId: clue.id,
      buzzWinnerId: null,
      armedAt: null,
      deadline: null,
      lockedOutPlayerIds: [],
      lockoutUntil: {},
      revealedAnswer: null,
      lastOutcome: null,
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

function isLockedOut(state: GameState, playerId: string, now: number): boolean {
  if (state.lockedOutPlayerIds.includes(playerId)) return true;
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
): AuditRecord {
  return {
    id: `${timestamp}-${playerId}`,
    type,
    playerId,
    value,
    scoreBefore,
    scoreAfter,
    controllingPlayerIdBefore,
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
    lockoutUntil: {},
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

  if (state.dailyDoubleWager == null || state.currentClueId == null || state.controllingPlayerId == null) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Daily Double is not ready to be ruled' }] };
  }

  const clue = getCurrentClue(state);
  if (!clue) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Current clue not found' }] };
  }

  if (type === 'INCORRECT' && playerId !== state.controllingPlayerId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Only the controlling contestant can be ruled on a Daily Double' }] };
  }

  const controllerId = state.controllingPlayerId;
  const playerIndex = state.players.findIndex((p) => p.id === controllerId);
  if (playerIndex === -1) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Controlling contestant not found' }] };
  }

  const player = state.players[playerIndex];
  const value = state.dailyDoubleWager;
  const scoreBefore = player.score;
  const scoreAfter = type === 'CORRECT' ? scoreBefore + value : scoreBefore - value;
  const updatedPlayers = [...state.players];
  updatedPlayers[playerIndex] = { ...player, score: scoreAfter };

  const auditEntry = createAuditRecord(
    type,
    controllerId,
    value,
    scoreBefore,
    scoreAfter,
    state.controllingPlayerId,
    ctx.now,
    clue.id,
  );

  return {
    state: {
      ...resolveClueReturnToBoard(state, clue.id),
      players: updatedPlayers,
      controllingPlayerId: controllerId,
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
  const winnerIndex = state.players.findIndex((p) => p.id === state.buzzWinnerId);
  if (winnerIndex === -1) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Buzzed contestant not found' }] };
  }

  const winner = state.players[winnerIndex];
  const scoreBefore = winner.score;
  const scoreAfter = scoreBefore + value;
  const updatedPlayers = [...state.players];
  updatedPlayers[winnerIndex] = { ...winner, score: scoreAfter };

  const auditEntry = createAuditRecord(
    'CORRECT',
    winner.id,
    value,
    scoreBefore,
    scoreAfter,
    state.controllingPlayerId,
    ctx.now,
    clue.id,
  );

  return {
    state: {
      ...resolveClueReturnToBoard(state, clue.id),
      players: updatedPlayers,
      controllingPlayerId: winner.id,
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
  const playerIndex = state.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Buzzed contestant not found' }] };
  }

  const player = state.players[playerIndex];
  const scoreBefore = player.score;
  const scoreAfter = scoreBefore - value;
  const updatedPlayers = [...state.players];
  updatedPlayers[playerIndex] = { ...player, score: scoreAfter };

  const updatedLockedOutPlayerIds = [...state.lockedOutPlayerIds, playerId];
  const auditEntry = createAuditRecord(
    'INCORRECT',
    player.id,
    value,
    scoreBefore,
    scoreAfter,
    state.controllingPlayerId,
    ctx.now,
  );

  const remainingEligible = updatedPlayers.filter(
    (p) => p.id !== playerId && p.connected && !updatedLockedOutPlayerIds.includes(p.id),
  );

  if (remainingEligible.length === 0) {
    return {
      state: {
        ...resolveClueReturnToBoard(state, clue.id),
        players: updatedPlayers,
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
      buzzWinnerId: null,
      armedAt: ctx.now,
      deadline: ctx.now + durationMs,
      lockedOutPlayerIds: updatedLockedOutPlayerIds,
      auditLog: [...state.auditLog, auditEntry],
      lastOutcome: { playerId: player.id, type: 'INCORRECT', value },
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleTimeExpire(state: GameState): ReducerResult {
  if (state.phase !== 'BUZZERS_ARMED') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Timer can only expire while buzzers are armed' }] };
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

  if (state.controllingPlayerId !== intent.playerId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Only the controlling contestant can wager' }] };
  }

  const player = state.players.find((p) => p.id === intent.playerId);
  if (!player) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'Player not found' }] };
  }

  const maxWager = Math.max(player.score, getHighestClueValueInRound(state));
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
  const playerIndex = state.players.findIndex((p) => p.id === record.playerId);
  if (playerIndex === -1) {
    // The affected player no longer exists; treat as a safe no-op.
    return { state, effects: [] };
  }

  const player = state.players[playerIndex];
  // Revert only the ruling's delta, preserving any later manual adjustments
  // that may have been applied to the same contestant.
  const rulingDelta = record.scoreAfter - record.scoreBefore;
  const updatedPlayers = [...state.players];
  updatedPlayers[playerIndex] = { ...player, score: player.score - rulingDelta };

  let updatedState: GameState = {
    ...state,
    players: updatedPlayers,
    auditLog: state.auditLog.filter((_, i) => i !== rulingIndex),
  };

  if (record.type === 'CORRECT') {
    updatedState = {
      ...updatedState,
      controllingPlayerId: record.controllingPlayerIdBefore,
    };
  }

  if (record.type === 'INCORRECT') {
    updatedState = {
      ...updatedState,
      lockedOutPlayerIds: state.lockedOutPlayerIds.filter((id) => id !== record.playerId),
    };
  }

  return { state: updatedState, effects: [{ type: 'BROADCAST_STATE' }] };
}
