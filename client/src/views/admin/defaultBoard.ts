import type { CategoryInput, ClueInput, CreateBoardInput, RoundInput } from '../../api/boards.js';

const DEFAULT_CATEGORY_COUNT = 6;
const JEOPARDY_VALUES = [100, 200, 300, 400, 500];
const DOUBLE_JEOPARDY_VALUES = [200, 400, 600, 800, 1000];

function makeClue(value: number | null, row: number, isDouble: boolean): ClueInput {
  const label = value === null ? 'Final' : `$${value}`;
  const doubleLabel = isDouble ? 'Double ' : '';
  return {
    value,
    row,
    clueText: `${doubleLabel}${label} clue text`,
    answer: `${doubleLabel}${label} answer`,
    isDailyDouble: false,
  };
}

function makeCategory(title: string, order: number, values: (number | null)[], isDouble: boolean): CategoryInput {
  return {
    title,
    order,
    clues: values.map((value, row) => makeClue(value, row, isDouble)),
  };
}

function makeRound(
  type: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL',
  order: number,
  values: (number | null)[],
  isDouble: boolean,
): RoundInput {
  if (type === 'FINAL') {
    return {
      type,
      order,
      categories: [makeCategory('Final Category', 0, [null], false)],
    };
  }

  return {
    type,
    order,
    categories: Array.from({ length: DEFAULT_CATEGORY_COUNT }, (_, index) =>
      makeCategory(`Category ${index + 1}`, index, values, isDouble),
    ),
  };
}

export function createDefaultBoard(name = 'New Board'): CreateBoardInput {
  return {
    name,
    includeDoubleJeopardy: true,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    rounds: [
      makeRound('JEOPARDY', 0, JEOPARDY_VALUES, false),
      makeRound('DOUBLE_JEOPARDY', 1, DOUBLE_JEOPARDY_VALUES, true),
      makeRound('FINAL', 2, [null], false),
    ],
  };
}
