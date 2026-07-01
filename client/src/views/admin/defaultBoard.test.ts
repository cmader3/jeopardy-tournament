import { describe, expect, it } from 'vitest';
import { createDefaultBoard } from './defaultBoard.js';

const JEOPARDY_VALUES = [100, 200, 300, 400, 500];
const DOUBLE_JEOPARDY_VALUES = [200, 400, 600, 800, 1000];

describe('createDefaultBoard', () => {
  it('returns a board with empty clue text and answers (no placeholders)', () => {
    const board = createDefaultBoard();

    for (const round of board.rounds) {
      if (round.type === 'FINAL') continue;
      for (const category of round.categories) {
        for (const clue of category.clues) {
          expect(clue.clueText).toBe('');
          expect(clue.answer).toBe('');
        }
      }
    }
  });

  it('has the default 6x5 grid for Jeopardy and Double Jeopardy rounds', () => {
    const board = createDefaultBoard();
    const jeopardy = board.rounds.find((r) => r.type === 'JEOPARDY');
    const double = board.rounds.find((r) => r.type === 'DOUBLE_JEOPARDY');

    expect(jeopardy).toBeDefined();
    expect(jeopardy!.categories).toHaveLength(6);
    expect(jeopardy!.categories[0].clues).toHaveLength(5);

    expect(double).toBeDefined();
    expect(double!.categories).toHaveLength(6);
    expect(double!.categories[0].clues).toHaveLength(5);
  });

  it('keeps the standard row-tier values for each round', () => {
    const board = createDefaultBoard();
    const jeopardy = board.rounds.find((r) => r.type === 'JEOPARDY')!;
    const double = board.rounds.find((r) => r.type === 'DOUBLE_JEOPARDY')!;

    for (let row = 0; row < JEOPARDY_VALUES.length; row += 1) {
      expect(jeopardy.categories[0].clues[row].value).toBe(JEOPARDY_VALUES[row]);
      expect(double.categories[0].clues[row].value).toBe(DOUBLE_JEOPARDY_VALUES[row]);
    }
  });

  it('keeps the default per-clue and Final timers', () => {
    const board = createDefaultBoard();
    expect(board.defaultTimerSeconds).toBe(10);
    expect(board.finalTimerSeconds).toBe(30);
  });

  it('includes Double Jeopardy by default', () => {
    const board = createDefaultBoard();
    expect(board.includeDoubleJeopardy).toBe(true);
  });

  it('creates a Final round with a single valueless empty clue', () => {
    const board = createDefaultBoard();
    const final = board.rounds.find((r) => r.type === 'FINAL');

    expect(final).toBeDefined();
    expect(final!.categories).toHaveLength(1);
    expect(final!.categories[0].clues).toHaveLength(1);
    expect(final!.categories[0].clues[0].value).toBeNull();
    expect(final!.categories[0].clues[0].clueText).toBe('');
    expect(final!.categories[0].clues[0].answer).toBe('');
  });
});
