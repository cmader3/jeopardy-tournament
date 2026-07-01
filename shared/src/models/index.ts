export type GamePhase =
  | 'LOBBY'
  | 'BOARD_SELECT'
  | 'CLUE_REVEALED'
  | 'BUZZERS_ARMED'
  | 'BUZZED'
  | 'DAILY_DOUBLE_WAGER'
  | 'DAILY_DOUBLE_CLUE'
  | 'FINAL_INTRO'
  | 'FINAL_WAGER'
  | 'FINAL_CLUE'
  | 'FINAL_REVEAL'
  | 'COMPLETE';

export interface Player {
  id: string;
  name: string;
  score: number;
  seatOrder: number;
  connected: boolean;
}

export interface Category {
  id: string;
  title: string;
  order: number;
}

export interface Clue {
  id: string;
  categoryId: string;
  row: number;
  value: number | null;
  clueText: string;
  answer: string;
  isDailyDouble: boolean;
}

export interface Round {
  id: string;
  type: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL';
  order: number;
  categories: Category[];
  clues: Clue[];
}

export interface Board {
  id: string;
  name: string;
  includeDoubleJeopardy: boolean;
  defaultTimerSeconds: number;
  finalTimerSeconds: number;
  rounds: Round[];
}

export interface GameState {
  sessionId: string;
  roomCode: string;
  boardId: string;
  board: Board;
  phase: GamePhase;
  roundIndex: number;
  players: Player[];
  controllingPlayerId: string | null;
  usedClueIds: string[];
  currentClueId: string | null;
  buzzWinnerId: string | null;
  deadline: number | null;
  dailyDoubleWager: number | null;
  finalWagers: Record<string, number>;
  finalAnswers: Record<string, string>;
}
