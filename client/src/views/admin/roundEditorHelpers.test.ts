import { describe, expect, it } from 'vitest';
import type { BoardWithRounds, Category, Clue, Round } from '../../api/boards.js';
import {
  addCategory,
  moveCategory,
  moveRow,
  removeCategory,
  renameCategory,
  updateClue,
  updateFinal,
} from './roundEditorHelpers.js';

function makeClue(overrides: Partial<Clue> = {}): Clue {
  return {
    id: `clue-${overrides.row ?? 0}-${overrides.categoryId ?? 'cat'}`,
    categoryId: overrides.categoryId ?? 'cat',
    value: overrides.value !== undefined ? overrides.value : 100,
    row: overrides.row ?? 0,
    clueText: overrides.clueText ?? '',
    answer: overrides.answer ?? '',
    isDailyDouble: overrides.isDailyDouble ?? false,
  };
}

function makeCategory(title: string, order: number, clues: Clue[]): Category {
  return {
    id: `cat-${order}`,
    roundId: 'round-1',
    title,
    order,
    clues,
  };
}

function makeRound(type: Round['type'], categories: Category[]): Round {
  return {
    id: `round-${type}`,
    boardId: 'board-1',
    type,
    order: type === 'JEOPARDY' ? 0 : type === 'DOUBLE_JEOPARDY' ? 1 : 2,
    categories,
  };
}

function makeBoard(overrides: Partial<BoardWithRounds> = {}): BoardWithRounds {
  return {
    id: 'board-1',
    name: 'Test Board',
    includeDoubleJeopardy: overrides.includeDoubleJeopardy ?? true,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    createdAt: '2026-06-30T12:00:00.000Z',
    updatedAt: '2026-06-30T12:30:00.000Z',
    rounds: overrides.rounds ?? [
      makeRound('JEOPARDY', [
        makeCategory('Science', 0, [
          makeClue({ row: 0, value: 100, clueText: 'H2O?', answer: 'Water' }),
          makeClue({ row: 1, value: 200, clueText: 'Planet?', answer: 'Mars' }),
        ]),
        makeCategory('History', 1, [
          makeClue({ row: 0, value: 100, clueText: '1776?', answer: 'Independence' }),
          makeClue({ row: 1, value: 200, clueText: 'Wall?', answer: 'Berlin' }),
        ]),
      ]),
      makeRound('DOUBLE_JEOPARDY', [
        makeCategory('Arts', 0, [
          makeClue({ row: 0, value: 200, clueText: 'Painter?', answer: 'Monet' }),
          makeClue({ row: 1, value: 400, clueText: 'Composer?', answer: 'Bach' }),
        ]),
      ]),
      makeRound('FINAL', [
        makeCategory('Literature', 0, [makeClue({ row: 0, value: null, clueText: 'Hobbit?', answer: 'Tolkien' })]),
      ]),
    ],
  };
}

describe('roundEditorHelpers', () => {
  describe('addCategory', () => {
    it('adds a titled blank category to the Jeopardy round', () => {
      const board = makeBoard({ includeDoubleJeopardy: false });
      const updated = addCategory(board, 'JEOPARDY');

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories).toHaveLength(3);
      expect(jeopardy.categories[2].title).toBe('New Category');
      expect(jeopardy.categories[2].clues).toHaveLength(2);
      expect(jeopardy.categories[2].clues[0].value).toBe(100);
      expect(jeopardy.categories[2].clues[1].value).toBe(200);
    });

    it('adds a category to the Double Jeopardy round without affecting Jeopardy', () => {
      const board = makeBoard();
      const updated = addCategory(board, 'DOUBLE_JEOPARDY');

      const double = updated.rounds.find((r) => r.type === 'DOUBLE_JEOPARDY')!;
      expect(double.categories).toHaveLength(2);
      expect(double.categories[1].title).toBe('New Category');
      expect(double.categories[1].clues[0].value).toBe(200);

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories).toHaveLength(2);
    });
  });

  describe('renameCategory', () => {
    it('updates the category title in the specified round', () => {
      const board = makeBoard();
      const updated = renameCategory(board, 'JEOPARDY', 0, 'Natural Science');

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories[0].title).toBe('Natural Science');
      expect(jeopardy.categories[1].title).toBe('History');
    });
  });

  describe('moveCategory', () => {
    it('moves a category to the right and keeps its clues attached', () => {
      const board = makeBoard();
      const updated = moveCategory(board, 'JEOPARDY', 0, 'right');

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories[0].title).toBe('History');
      expect(jeopardy.categories[1].title).toBe('Science');
      expect(jeopardy.categories[0].order).toBe(0);
      expect(jeopardy.categories[1].order).toBe(1);
      expect(jeopardy.categories[1].clues[0].clueText).toBe('H2O?');
    });

    it('moves a category to the left', () => {
      const board = makeBoard();
      const updated = moveCategory(board, 'JEOPARDY', 1, 'left');

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories[0].title).toBe('History');
      expect(jeopardy.categories[1].title).toBe('Science');
    });

    it('is a no-op at the left boundary', () => {
      const board = makeBoard();
      const updated = moveCategory(board, 'JEOPARDY', 0, 'left');

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories[0].title).toBe('Science');
      expect(jeopardy.categories[1].title).toBe('History');
    });

    it('is a no-op at the right boundary', () => {
      const board = makeBoard();
      const updated = moveCategory(board, 'JEOPARDY', 1, 'right');

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories[0].title).toBe('Science');
      expect(jeopardy.categories[1].title).toBe('History');
    });
  });

  describe('removeCategory', () => {
    it('removes the category and its clues from the specified round', () => {
      const board = makeBoard();
      const updated = removeCategory(board, 'JEOPARDY', 0);

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories).toHaveLength(1);
      expect(jeopardy.categories[0].title).toBe('History');
      expect(jeopardy.categories[0].order).toBe(0);
    });

    it('does not affect the Double Jeopardy round when removing from Jeopardy', () => {
      const board = makeBoard();
      const updated = removeCategory(board, 'JEOPARDY', 0);

      const double = updated.rounds.find((r) => r.type === 'DOUBLE_JEOPARDY')!;
      expect(double.categories).toHaveLength(1);
    });
  });

  describe('updateClue', () => {
    it('updates a clue value, text, answer, and daily double flag distinctly', () => {
      const board = makeBoard();
      const updated = updateClue(board, 'JEOPARDY', 0, 0, {
        value: 150,
        clueText: 'What is H2O?',
        answer: 'Water is H2O',
        isDailyDouble: true,
      });

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      const clue = jeopardy.categories[0].clues[0];
      expect(clue.value).toBe(150);
      expect(clue.clueText).toBe('What is H2O?');
      expect(clue.answer).toBe('Water is H2O');
      expect(clue.isDailyDouble).toBe(true);
    });

    it('leaves other clues unchanged', () => {
      const board = makeBoard();
      const updated = updateClue(board, 'JEOPARDY', 0, 0, { clueText: 'Updated' });

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories[0].clues[1].clueText).toBe('Planet?');
      expect(jeopardy.categories[1].clues[0].clueText).toBe('1776?');
    });

    it('does not affect the Double Jeopardy round', () => {
      const board = makeBoard();
      const updated = updateClue(board, 'JEOPARDY', 0, 0, { clueText: 'Updated' });

      const double = updated.rounds.find((r) => r.type === 'DOUBLE_JEOPARDY')!;
      expect(double.categories[0].clues[0].clueText).toBe('Painter?');
    });
  });

  describe('moveRow', () => {
    it('moves a row down across all categories and reassigns tier values', () => {
      const board = makeBoard();
      const updated = moveRow(board, 'JEOPARDY', 0, 'down');

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      // Row 0 now contains the clues that were in row 1, with $100 tier value
      expect(jeopardy.categories[0].clues[0].clueText).toBe('Planet?');
      expect(jeopardy.categories[0].clues[0].value).toBe(100);
      expect(jeopardy.categories[0].clues[0].row).toBe(0);
      // Row 1 now contains the clues that were in row 0, with $200 tier value
      expect(jeopardy.categories[0].clues[1].clueText).toBe('H2O?');
      expect(jeopardy.categories[0].clues[1].value).toBe(200);
      expect(jeopardy.categories[0].clues[1].row).toBe(1);

      expect(jeopardy.categories[1].clues[0].clueText).toBe('Wall?');
      expect(jeopardy.categories[1].clues[0].value).toBe(100);
      expect(jeopardy.categories[1].clues[1].clueText).toBe('1776?');
      expect(jeopardy.categories[1].clues[1].value).toBe(200);
    });

    it('moves a row up across all categories', () => {
      const board = makeBoard();
      const updated = moveRow(board, 'JEOPARDY', 1, 'up');

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories[0].clues[0].clueText).toBe('Planet?');
      expect(jeopardy.categories[0].clues[1].clueText).toBe('H2O?');
    });

    it('is a no-op at the top boundary', () => {
      const board = makeBoard();
      const updated = moveRow(board, 'JEOPARDY', 0, 'up');

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories[0].clues[0].clueText).toBe('H2O?');
      expect(jeopardy.categories[0].clues[1].clueText).toBe('Planet?');
    });

    it('is a no-op at the bottom boundary', () => {
      const board = makeBoard();
      const updated = moveRow(board, 'JEOPARDY', 1, 'down');

      const jeopardy = updated.rounds.find((r) => r.type === 'JEOPARDY')!;
      expect(jeopardy.categories[0].clues[0].clueText).toBe('H2O?');
      expect(jeopardy.categories[0].clues[1].clueText).toBe('Planet?');
    });

    it('uses doubled values for the Double Jeopardy round', () => {
      const board = makeBoard();
      const updated = moveRow(board, 'DOUBLE_JEOPARDY', 0, 'down');

      const double = updated.rounds.find((r) => r.type === 'DOUBLE_JEOPARDY')!;
      expect(double.categories[0].clues[0].clueText).toBe('Composer?');
      expect(double.categories[0].clues[0].value).toBe(200);
      expect(double.categories[0].clues[1].clueText).toBe('Painter?');
      expect(double.categories[0].clues[1].value).toBe(400);
    });
  });

  describe('updateFinal', () => {
    it('updates the Final category, clue text, and answer while keeping value null', () => {
      const board = makeBoard();
      const updated = updateFinal(board, {
        title: 'Famous Authors',
        clueText: 'He wrote Moby-Dick',
        answer: 'Herman Melville',
      });

      const final = updated.rounds.find((r) => r.type === 'FINAL')!;
      expect(final.categories[0].title).toBe('Famous Authors');
      expect(final.categories[0].clues[0].clueText).toBe('He wrote Moby-Dick');
      expect(final.categories[0].clues[0].answer).toBe('Herman Melville');
      expect(final.categories[0].clues[0].value).toBeNull();
    });
  });
});
