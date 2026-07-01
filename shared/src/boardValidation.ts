import type { Board } from './models/index.js';

export function isBoardPlayable(board: Board): boolean {
  return board.rounds.some((round) => {
    if (round.type === 'FINAL') return false;
    return round.clues.some(
      (clue) => clue.clueText.trim().length > 0 && clue.answer.trim().length > 0,
    );
  });
}
