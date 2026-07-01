import { GameState, Player } from '../models/index.js';

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
  | { type: 'REVEAL_ANSWER' };

export type Effect =
  | { type: 'NOOP' }
  | { type: 'BROADCAST_STATE' }
  | { type: 'INTENT_REJECTED'; reason: string };

export interface ReducerResult {
  state: GameState;
  effects: Effect[];
}

const MAX_PLAYERS = 5;

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
    deadline: null,
    dailyDoubleWager: null,
    finalWagers: {},
    finalAnswers: {},
  };
}

export function reduce(state: GameState, intent: Intent, _ctx: ReducerCtx): ReducerResult {
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
    case 'REVEAL_ANSWER':
      return handleRevealAnswer(state);
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
      deadline: null,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}

function handleRevealAnswer(state: GameState): ReducerResult {
  if (state.phase !== 'CLUE_REVEALED') {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No clue is available to reveal' }] };
  }

  if (!state.currentClueId) {
    return { state, effects: [{ type: 'INTENT_REJECTED', reason: 'No current clue' }] };
  }

  return {
    state: {
      ...state,
      phase: 'BOARD_SELECT',
      usedClueIds: [...state.usedClueIds, state.currentClueId],
      currentClueId: null,
      buzzWinnerId: null,
      deadline: null,
    },
    effects: [{ type: 'BROADCAST_STATE' }],
  };
}
