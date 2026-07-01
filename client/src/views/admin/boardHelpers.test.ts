import { describe, expect, it } from 'vitest';
import type { BoardWithRounds, Category, Clue, Round } from '../../api/boards.js';
import {
  applyResize,
  computeBoardResizeImpact,
  deriveSettings,
  getPlayRound,
  isAuthoredClue,
  isAuthoredCategory,
  rowCountForRound,
  setDoubleJeopardyEnabled,
  toUpdateInput,
} from './boardHelpers.js';

function makeClue(overrides: Partial<Clue> = {}): Clue {
  return {
    id: `clue-${overrides.row ?? 0}-${overrides.categoryId ?? 'cat'}`,
    categoryId: overrides.categoryId ?? 'cat',
    value: overrides.value ?? 100,
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

describe('boardHelpers', () => {
  describe('deriveSettings', () => {
    it('reads the Jeopardy grid size and timers from a board', () => {
      const board = makeBoard();
      const settings = deriveSettings(board);

      expect(settings.name).toBe('Test Board');
      expect(settings.categoryCount).toBe('2');
      expect(settings.rowCount).toBe('2');
      expect(settings.defaultTimer).toBe('10');
      expect(settings.finalTimer).toBe('30');
      expect(settings.includeDoubleJeopardy).toBe(true);
    });
  });

  describe('isAuthoredClue / isAuthoredCategory', () => {
    it('treats clues with non-empty text or answer as authored', () => {
      expect(isAuthoredClue(makeClue({ clueText: 'A clue' }))).toBe(true);
      expect(isAuthoredClue(makeClue({ answer: 'An answer' }))).toBe(true);
      expect(isAuthoredClue(makeClue({ clueText: '   ', answer: '' }))).toBe(false);
      expect(isAuthoredClue(makeClue())).toBe(false);
    });

    it('treats a populated category as authored based on its clues', () => {
      expect(isAuthoredCategory(makeCategory('Science', 0, [makeClue({ clueText: 'X' })]))).toBe(true);
      expect(isAuthoredCategory(makeCategory('', 0, [makeClue({ answer: 'Y' })]))).toBe(true);
      expect(isAuthoredCategory(makeCategory('Science', 0, [makeClue()]))).toBe(false);
      expect(isAuthoredCategory(makeCategory('', 0, [makeClue()]))).toBe(false);
    });
  });

  describe('applyResize', () => {
    it('grows the grid by adding blank cells while preserving existing content', () => {
      const board = makeBoard();
      const resized = applyResize(board, 3, 3);

      const jeopardy = getPlayRound(resized, 'JEOPARDY')!;
      expect(jeopardy.categories).toHaveLength(3);
      expect(rowCountForRound(jeopardy)).toBe(3);

      expect(jeopardy.categories[0].title).toBe('Science');
      expect(jeopardy.categories[0].clues[0].clueText).toBe('H2O?');
      expect(jeopardy.categories[0].clues[0].answer).toBe('Water');
      expect(jeopardy.categories[0].clues[2].clueText).toBe('');
      expect(jeopardy.categories[0].clues[2].answer).toBe('');
      expect(jeopardy.categories[0].clues[2].value).toBe(300);

      expect(jeopardy.categories[2].title).toBe('Category 3');
      expect(jeopardy.categories[2].clues).toHaveLength(3);
      expect(jeopardy.categories[2].clues[0].clueText).toBe('');
    });

    it('grows both play rounds when Double Jeopardy is enabled', () => {
      const board = makeBoard();
      const resized = applyResize(board, 3, 3);

      const double = getPlayRound(resized, 'DOUBLE_JEOPARDY')!;
      expect(double.categories).toHaveLength(3);
      expect(rowCountForRound(double)).toBe(3);
      expect(double.categories[0].clues[2].value).toBe(600);
    });

    it('shrinks the grid when no removed cells are authored', () => {
      const board = makeBoard({
        rounds: [
          makeRound('JEOPARDY', [
            makeCategory('Science', 0, [makeClue({ row: 0, value: 100 }), makeClue({ row: 1, value: 200 })]),
            makeCategory('History', 1, [makeClue({ row: 0, value: 100 }), makeClue({ row: 1, value: 200 })]),
          ]),
          makeRound('FINAL', [
            makeCategory('Literature', 0, [makeClue({ row: 0, value: null, clueText: 'Final?', answer: 'Yes' })]),
          ]),
        ],
      });

      const resized = applyResize(board, 1, 1);
      const jeopardy = getPlayRound(resized, 'JEOPARDY')!;
      expect(jeopardy.categories).toHaveLength(1);
      expect(jeopardy.categories[0].clues).toHaveLength(1);
    });

    it('adds a Double Jeopardy round when enabled and missing', () => {
      const board = makeBoard({ includeDoubleJeopardy: true, rounds: [makeRound('JEOPARDY', [makeCategory('Science', 0, [makeClue()])])] });
      const resized = applyResize(board, 1, 1);

      expect(resized.includeDoubleJeopardy).toBe(true);
      const double = getPlayRound(resized, 'DOUBLE_JEOPARDY');
      expect(double).toBeDefined();
      expect(double!.categories).toHaveLength(1);
      expect(double!.categories[0].clues[0].value).toBe(200);
    });

    it('preserves the Final round when reshaping', () => {
      const board = makeBoard();
      const resized = applyResize(board, 1, 1);

      const final = resized.rounds.find((r) => r.type === 'FINAL');
      expect(final).toBeDefined();
      expect(final!.categories[0].clues[0].answer).toBe('Tolkien');
    });
  });

  describe('computeBoardResizeImpact', () => {
    it('detects authored content in removed categories', () => {
      const board = makeBoard();
      const impact = computeBoardResizeImpact(board, 1, 2);
      expect(impact.wouldDelete).toBe(true);
      expect(impact.affectedCells).toBeGreaterThan(0);
    });

    it('detects authored content in removed rows', () => {
      const board = makeBoard();
      const impact = computeBoardResizeImpact(board, 2, 1);
      expect(impact.wouldDelete).toBe(true);
      expect(impact.affectedCells).toBeGreaterThan(0);
    });

    it('reports no impact when removed cells are blank', () => {
      const board = makeBoard({
        rounds: [
          makeRound('JEOPARDY', [
            makeCategory('Science', 0, [makeClue({ row: 0, value: 100 }), makeClue({ row: 1, value: 200 })]),
            makeCategory('History', 1, [makeClue({ row: 0, value: 100 }), makeClue({ row: 1, value: 200 })]),
          ]),
        ],
      });
      const impact = computeBoardResizeImpact(board, 1, 1);
      expect(impact.wouldDelete).toBe(false);
      expect(impact.affectedCells).toBe(0);
    });
  });

  describe('setDoubleJeopardyEnabled', () => {
    it('creates a blank Double Jeopardy round when enabling if none exists', () => {
      const board = makeBoard({ includeDoubleJeopardy: false, rounds: [makeRound('JEOPARDY', [makeCategory('Science', 0, [makeClue()])])] });
      const updated = setDoubleJeopardyEnabled(board, true);

      expect(updated.includeDoubleJeopardy).toBe(true);
      const double = getPlayRound(updated, 'DOUBLE_JEOPARDY');
      expect(double).toBeDefined();
      expect(double!.categories).toHaveLength(1);
      expect(double!.categories[0].clues[0].value).toBe(200);
    });

    it('preserves the existing Double Jeopardy round when disabling', () => {
      const board = makeBoard();
      const updated = setDoubleJeopardyEnabled(board, false);

      expect(updated.includeDoubleJeopardy).toBe(false);
      const double = getPlayRound(updated, 'DOUBLE_JEOPARDY');
      expect(double).toBeDefined();
      expect(double!.categories[0].clues[0].clueText).toBe('Painter?');
    });
  });

  describe('toUpdateInput', () => {
    it('strips ids and dates while keeping structure', () => {
      const board = makeBoard();
      const input = toUpdateInput(board);

      expect(input.name).toBe('Test Board');
      expect(input.rounds).toHaveLength(3);
      expect(input.rounds[0].categories[0].clues[0]).not.toHaveProperty('id');
      expect(input.rounds[0].categories[0]).not.toHaveProperty('id');
      expect(input).not.toHaveProperty('id');
      expect(input).not.toHaveProperty('createdAt');
    });
  });
});
