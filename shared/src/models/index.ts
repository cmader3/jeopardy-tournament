export type GameSessionStatus =
  | 'LOBBY'
  | 'IN_PROGRESS'
  | 'FINAL'
  | 'COMPLETE'
  | 'ABANDONED';

export type ClueSelectionMode = 'HOST' | 'PLAYER';

export type GamePhase =
  | 'LOBBY'
  | 'BOARD_SELECT'
  | 'CLUE_SELECTED'
  | 'CLUE_REVEALED'
  | 'BUZZERS_ARMED'
  | 'BUZZED'
  | 'DAILY_DOUBLE_WAGER'
  | 'DAILY_DOUBLE_CLUE'
  | 'ROUND_TRANSITION'
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
  reconnectToken: string;
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

export interface AuditRecord {
  id: string;
  type: 'CORRECT' | 'INCORRECT' | 'MANUAL';
  playerId: string;
  clueId?: string;
  value: number;
  scoreBefore: number;
  scoreAfter: number;
  controllingPlayerIdBefore: string | null;
  timestamp: number;
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
  clueSelectionMode: ClueSelectionMode;
  pendingClueId: string | null;
  archived: boolean;
  completedAt: number | null;
  currentClueId: string | null;
  buzzWinnerId: string | null;
  armedAt: number | null;
  deadline: number | null;
  lockedOutPlayerIds: string[];
  lockoutUntil: Record<string, number>;
  auditLog: AuditRecord[];
  dailyDoubleWager: number | null;
  finalWagers: Record<string, number>;
  finalAnswers: Record<string, string>;
  finalAnswerDrafts: Record<string, string>;
  revealedAnswer: string | null;
  transitionTarget: 'DOUBLE_JEOPARDY' | 'FINAL' | null;
  finalNoEligiblePlayers: boolean;
  finalRevealOrder: string[];
  finalRevealIndex: number;
  finalRevealStep: 'ANSWER' | 'RULE' | 'WAGER';
  lastOutcome: {
    playerId: string;
    type: 'CORRECT' | 'INCORRECT';
    value: number;
  } | null;
}
