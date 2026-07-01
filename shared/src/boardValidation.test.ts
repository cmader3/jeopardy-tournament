import { describe, expect, it } from 'vitest';
import { isBoardPlayable } from './boardValidation.js';
import type { Board } from './models/index.js';

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: 'b1',
    name: 'Test Board',
    includeDoubleJeopardy: false,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    rounds: [],
    ...overrides,
  };
}

function makePlayRound(type: 'JEOPARDY' | 'DOUBLE_JEOPARDY', clues: { clueText: string; answer: string }[]): Board['rounds'][number] {
  const mappedClues = clues.map((clue, row) => ({
    id: `${type}-cl-${row}`,
    categoryId: `${type}-c`,
    row,
    value: (row + 1) * 100,
    clueText: clue.clueText,
    answer: clue.answer,
    isDailyDouble: false,
  }));

  return {
    id: `${type}-r`,
    type,
    order: type === 'JEOPARDY' ? 0 : 1,
    categories: [
      {
        id: `${type}-c`,
        roundId: `${type}-r`,
        title: 'Category',
        order: 0,
        clues: mappedClues,
      },
    ],
    clues: mappedClues,
  };
}

describe('isBoardPlayable', () => {
  it('returns false for a board with no rounds', () => {
    const board = makeBoard();
    expect(isBoardPlayable(board)).toBe(false);
  });

  it('returns false for a board with only a Final round', () => {
    const board = makeBoard({
      rounds: [
        {
          id: 'r-final',
          type: 'FINAL',
          order: 0,
          categories: [
            {
              id: 'c-final',
              roundId: 'r-final',
              title: 'Final Category',
              order: 0,
              clues: [
                {
                  id: 'cl-final',
                  categoryId: 'c-final',
                  row: 0,
                  value: null,
                  clueText: 'A final clue',
                  answer: 'Answer',
                  isDailyDouble: false,
                },
              ],
            },
          ],
          clues: [],
        },
      ],
    });
    expect(isBoardPlayable(board)).toBe(false);
  });

  it('returns false when all play-round clues are empty', () => {
    const board = makeBoard({
      rounds: [makePlayRound('JEOPARDY', [{ clueText: '', answer: '' }])],
    });
    expect(isBoardPlayable(board)).toBe(false);
  });

  it('returns true when a Jeopardy round has a non-empty clue', () => {
    const board = makeBoard({
      rounds: [makePlayRound('JEOPARDY', [{ clueText: 'H2O', answer: 'Water' }])],
    });
    expect(isBoardPlayable(board)).toBe(true);
  });

  it('returns true when a Double Jeopardy round has a non-empty clue', () => {
    const board = makeBoard({
      includeDoubleJeopardy: true,
      rounds: [
        makePlayRound('JEOPARDY', [{ clueText: 'H2O', answer: 'Water' }]),
        makePlayRound('DOUBLE_JEOPARDY', [{ clueText: '2H2O', answer: 'Two waters' }]),
      ],
    });
    expect(isBoardPlayable(board)).toBe(true);
  });
});
