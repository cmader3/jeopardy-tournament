export const ClientToServer = {
  JOIN: 'join',
  LEAVE: 'leave',
  START_GAME: 'start_game',
  SELECT_CLUE: 'select_clue',
  ARM_BUZZERS: 'arm_buzzers',
  BUZZ: 'buzz',
  RULE_CORRECT: 'rule_correct',
  RULE_INCORRECT: 'rule_incorrect',
  SUBMIT_DD_WAGER: 'submit_dd_wager',
  SUBMIT_FINAL_WAGER: 'submit_final_wager',
  SUBMIT_FINAL_ANSWER: 'submit_final_answer',
  REVEAL_ANSWER: 'reveal_answer',
  ADVANCE_ROUND: 'advance_round',
  OPEN_FINAL_WAGERS: 'open_final_wagers',
} as const;

export type ClientToServerEvent = (typeof ClientToServer)[keyof typeof ClientToServer];

export const ServerToClient = {
  STATE: 'state',
  ERROR: 'error',
} as const;

export type ServerToClientEvent = (typeof ServerToClient)[keyof typeof ServerToClient];

export interface JoinPayload {
  role: 'host' | 'board' | 'contestant';
  roomCode: string;
  name?: string;
  reconnectToken?: string;
  hostToken?: string;
}

export interface SelectCluePayload {
  clueId: string;
}

export interface BuzzPayload {
  playerId: string;
}

export interface SubmitWagerPayload {
  amount: number;
}

export interface SubmitFinalAnswerPayload {
  answer: string;
}

export interface RevealAnswerPayload {
  playerId?: string;
}
