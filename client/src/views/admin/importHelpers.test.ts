import { describe, expect, it } from 'vitest';
import {
  createEditableBoard,
  moveClueToCategory,
  setIncludeDoubleJeopardy,
  updateBoardName,
  updateClueAnswer,
  updateClueText,
  updateClueValue,
  updateDefaultTimer,
  updateFinalTimer,
} from './importHelpers.js';
import type { CreateBoardInput } from '../../api/boards.js';

function makeBoard(): CreateBoardInput {
  return {
    name: 'Imported Board',
    includeDoubleJeopardy: false,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    rounds: [
      {
        type: 'JEOPARDY',
        order: 0,
        categories: [
          {
            title: 'Science',
            order: 0,
            clues: [
              { value: 100, row: 0, clueText: 'Water symbol?', answer: 'H2O', isDailyDouble: false },
            ],
          },
          {
            title: 'History',
            order: 1,
            clues: [
              { value: 100, row: 0, clueText: 'Berlin Wall year?', answer: '1989', isDailyDouble: false },
            ],
          },
        ],
      },
    ],
  };
}

describe('importHelpers', () => {
  it('updates board name', () => {
    const board = createEditableBoard(makeBoard());
    const updated = updateBoardName(board, 'Edited Board');
    expect(updated.name).toBe('Edited Board');
    expect(updated.rounds).toEqual(board.rounds);
  });

  it('updates default timer', () => {
    const board = createEditableBoard(makeBoard());
    const updated = updateDefaultTimer(board, 15);
    expect(updated.defaultTimerSeconds).toBe(15);
  });

  it('updates final timer', () => {
    const board = createEditableBoard(makeBoard());
    const updated = updateFinalTimer(board, 45);
    expect(updated.finalTimerSeconds).toBe(45);
  });

  it('toggles Double Jeopardy', () => {
    const board = createEditableBoard(makeBoard());
    const updated = setIncludeDoubleJeopardy(board, true);
    expect(updated.includeDoubleJeopardy).toBe(true);
  });

  it('updates a clue value', () => {
    const board = createEditableBoard(makeBoard());
    const updated = updateClueValue(board, 'JEOPARDY', 0, 0, 200);
    expect(updated.rounds[0].categories[0].clues[0].value).toBe(200);
  });

  it('updates a clue answer', () => {
    const board = createEditableBoard(makeBoard());
    const updated = updateClueAnswer(board, 'JEOPARDY', 0, 0, 'Dihydrogen monoxide');
    expect(updated.rounds[0].categories[0].clues[0].answer).toBe('Dihydrogen monoxide');
  });

  it('updates a clue text', () => {
    const board = createEditableBoard(makeBoard());
    const updated = updateClueText(board, 'JEOPARDY', 0, 0, 'H2O is known as?');
    expect(updated.rounds[0].categories[0].clues[0].clueText).toBe('H2O is known as?');
  });

  it('moves a clue to a different category and recomputes row indices', () => {
    const board = createEditableBoard(makeBoard());
    const updated = moveClueToCategory(board, 'JEOPARDY', 0, 0, 1);
    expect(updated.rounds[0].categories[0].clues).toHaveLength(0);
    expect(updated.rounds[0].categories[1].clues).toHaveLength(2);
    expect(updated.rounds[0].categories[1].clues[1].clueText).toBe('Water symbol?');
    expect(updated.rounds[0].categories[1].clues[1].row).toBe(1);
  });

  it('does not mutate the original board', () => {
    const board = createEditableBoard(makeBoard());
    const updated = updateClueAnswer(board, 'JEOPARDY', 0, 0, 'Changed');
    expect(board.rounds[0].categories[0].clues[0].answer).toBe('H2O');
    expect(updated.rounds[0].categories[0].clues[0].answer).toBe('Changed');
  });
});
