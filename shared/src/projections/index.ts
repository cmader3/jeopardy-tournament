import { GameState } from '../models/index.js';

export interface BoardView {
  phase: GameState['phase'];
  roomCode: string;
  roundIndex: number;
  players: { id: string; name: string; score: number }[];
  currentClueId: string | null;
  buzzWinnerId: string | null;
  deadline: number | null;
}

export interface HostView extends BoardView {
  answer: string | null;
  finalWagers: Record<string, number> | null;
  finalAnswers: Record<string, string> | null;
}

export interface ContestantView extends BoardView {
  playerId: string;
  isControllingPlayer: boolean;
  canWager: boolean;
  canAnswer: boolean;
}

export function projectBoard(state: GameState): BoardView {
  return {
    phase: state.phase,
    roomCode: state.roomCode,
    roundIndex: state.roundIndex,
    players: state.players.map((p) => ({ id: p.id, name: p.name, score: p.score })),
    currentClueId: state.currentClueId,
    buzzWinnerId: state.buzzWinnerId,
    deadline: state.deadline,
  };
}

export function projectHost(state: GameState): HostView {
  const currentClue = state.currentClueId
    ? state.board.rounds[state.roundIndex]?.clues.find((c) => c.id === state.currentClueId) ??
      null
    : null;

  return {
    ...projectBoard(state),
    answer: currentClue?.answer ?? null,
    finalWagers: state.phase.startsWith('FINAL') ? state.finalWagers : null,
    finalAnswers: state.phase === 'FINAL_REVEAL' ? state.finalAnswers : null,
  };
}

export function projectContestant(state: GameState, playerId: string): ContestantView {
  const board = projectBoard(state);
  const isControllingPlayer = state.controllingPlayerId === playerId;
  return {
    ...board,
    playerId,
    isControllingPlayer,
    canWager:
      state.phase === 'DAILY_DOUBLE_WAGER'
        ? isControllingPlayer
        : state.phase === 'FINAL_WAGER' && state.players.some((p) => p.id === playerId),
    canAnswer: state.phase === 'DAILY_DOUBLE_CLUE' ? isControllingPlayer : false,
  };
}
