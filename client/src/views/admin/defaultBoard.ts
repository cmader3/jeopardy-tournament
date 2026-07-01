import type { CategoryInput, ClueInput, CreateBoardInput, RoundInput } from '../../api/boards.js';

const DEFAULT_CATEGORY_COUNT = 6;
const JEOPARDY_VALUES = [100, 200, 300, 400, 500];
const DOUBLE_JEOPARDY_VALUES = [200, 400, 600, 800, 1000];

function makeClue(value: number | null, row: number): ClueInput {
  return {
    value,
    row,
    clueText: '',
    answer: '',
    isDailyDouble: false,
  };
}

function makeCategory(title: string, order: number, values: (number | null)[]): CategoryInput {
  return {
    title,
    order,
    clues: values.map((value, row) => makeClue(value, row)),
  };
}

function makeRound(
  type: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL',
  order: number,
  values: (number | null)[],
): RoundInput {
  if (type === 'FINAL') {
    return {
      type,
      order,
      categories: [makeCategory('Final Category', 0, [null])],
    };
  }

  return {
    type,
    order,
    categories: Array.from({ length: DEFAULT_CATEGORY_COUNT }, (_, index) =>
      makeCategory(`Category ${index + 1}`, index, values),
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
      makeRound('JEOPARDY', 0, JEOPARDY_VALUES),
      makeRound('DOUBLE_JEOPARDY', 1, DOUBLE_JEOPARDY_VALUES),
      makeRound('FINAL', 2, [null]),
    ],
  };
}
