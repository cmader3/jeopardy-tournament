import type {
  BoardWithRounds,
  Category,
  Clue,
  CreateBoardInput,
  Round,
  UpdateBoardInput,
} from '../../api/boards.js';

let tempIdCounter = 0;
export function makeTempId(): string {
  tempIdCounter += 1;
  return `temp-${tempIdCounter}`;
}

export function getPlayRound(
  board: BoardWithRounds,
  type: 'JEOPARDY' | 'DOUBLE_JEOPARDY',
): Round | undefined {
  return board.rounds.find((round) => round.type === type);
}

export function getFinalRound(board: BoardWithRounds): Round | undefined {
  return board.rounds.find((round) => round.type === 'FINAL');
}

export function rowCountForRound(round: Round): number {
  return round.categories.reduce((max, category) => Math.max(max, category.clues.length), 0);
}

export function isAuthoredClue(clue: Clue): boolean {
  return clue.clueText.trim().length > 0 || clue.answer.trim().length > 0;
}

export function isAuthoredCategory(category: Category): boolean {
  return category.clues.some(isAuthoredClue);
}

export function defaultValueForRow(row: number, isDouble: boolean): number {
  return (row + 1) * (isDouble ? 200 : 100);
}

export function makeBlankClue(row: number, value: number): Clue {
  return {
    id: makeTempId(),
    categoryId: '',
    value,
    row,
    clueText: '',
    answer: '',
    isDailyDouble: false,
  };
}

export function makeBlankCategory(
  title: string,
  order: number,
  rowCount: number,
  isDouble: boolean,
): Category {
  return {
    id: makeTempId(),
    roundId: '',
    title,
    order,
    clues: Array.from({ length: rowCount }, (_, row) =>
      makeBlankClue(row, defaultValueForRow(row, isDouble)),
    ),
  };
}

export function createBlankDoubleRound(jeopardyRound: Round): Round {
  const rowCount = rowCountForRound(jeopardyRound);
  return {
    id: makeTempId(),
    boardId: jeopardyRound.boardId,
    type: 'DOUBLE_JEOPARDY',
    order: 1,
    categories: Array.from({ length: jeopardyRound.categories.length }, (_, index) =>
      makeBlankCategory(`Category ${index + 1}`, index, rowCount, true),
    ),
  };
}

export function ensureFinalRound(board: BoardWithRounds): Round {
  const existing = getFinalRound(board);
  if (existing) {
    return existing;
  }

  return {
    id: makeTempId(),
    boardId: board.id,
    type: 'FINAL',
    order: 2,
    categories: [
      {
        id: makeTempId(),
        roundId: '',
        title: 'Final Category',
        order: 0,
        clues: [
          {
            id: makeTempId(),
            categoryId: '',
            value: null,
            row: 0,
            clueText: '',
            answer: '',
            isDailyDouble: false,
          },
        ],
      },
    ],
  };
}

export interface ResizeImpact {
  wouldDelete: boolean;
  affectedCells: number;
}

export function computeResizeImpact(
  round: Round,
  desiredCategories: number,
  desiredRows: number,
): ResizeImpact {
  let affectedCells = 0;
  let wouldDelete = false;

  for (let i = desiredCategories; i < round.categories.length; i += 1) {
    if (isAuthoredCategory(round.categories[i])) {
      wouldDelete = true;
      affectedCells += round.categories[i].clues.length;
    }
  }

  for (let i = 0; i < Math.min(desiredCategories, round.categories.length); i += 1) {
    const category = round.categories[i];
    for (let row = desiredRows; row < category.clues.length; row += 1) {
      if (isAuthoredClue(category.clues[row])) {
        wouldDelete = true;
        affectedCells += 1;
      }
    }
  }

  return { wouldDelete, affectedCells };
}

export function reshapeRound(
  round: Round,
  desiredCategories: number,
  desiredRows: number,
  isDouble: boolean,
): Round {
  const currentRowCount = rowCountForRound(round);
  const roundId = round.id || makeTempId();

  let categories = round.categories
    .slice(0, desiredCategories)
    .map((category) => ({
      ...category,
      clues: category.clues.slice(0, desiredRows).map((clue, row) => ({ ...clue, row })),
    }));

  if (desiredCategories > round.categories.length) {
    for (let order = round.categories.length; order < desiredCategories; order += 1) {
      categories.push(makeBlankCategory(`Category ${order + 1}`, order, desiredRows, isDouble));
    }
  }

  if (desiredRows > currentRowCount) {
    categories = categories.map((category) => {
      const existingClues = category.clues;
      const newClues: Clue[] = [];
      for (let row = existingClues.length; row < desiredRows; row += 1) {
        newClues.push(makeBlankClue(row, defaultValueForRow(row, isDouble)));
      }
      return { ...category, clues: [...existingClues, ...newClues] };
    });
  }

  categories = categories.map((category) => {
    const categoryId = category.id || makeTempId();
    return {
      ...category,
      id: categoryId,
      roundId,
      clues: category.clues.map((clue) => ({
        ...clue,
        id: clue.id || makeTempId(),
        categoryId,
      })),
    };
  });

  return { ...round, id: roundId, categories };
}

export function reshapeVisibleRounds(
  board: BoardWithRounds,
  desiredCategories: number,
  desiredRows: number,
): BoardWithRounds {
  const rounds = board.rounds.map((round) => {
    if (round.type === 'JEOPARDY') {
      return reshapeRound(round, desiredCategories, desiredRows, false);
    }
    if (board.includeDoubleJeopardy && round.type === 'DOUBLE_JEOPARDY') {
      return reshapeRound(round, desiredCategories, desiredRows, true);
    }
    return round;
  });

  if (board.includeDoubleJeopardy && !rounds.some((round) => round.type === 'DOUBLE_JEOPARDY')) {
    const jeopardyRound = rounds.find((round) => round.type === 'JEOPARDY');
    if (jeopardyRound) {
      rounds.push(createBlankDoubleRound(jeopardyRound));
    }
  }

  const finalRound = ensureFinalRound({ ...board, rounds });
  if (!rounds.some((round) => round.type === 'FINAL')) {
    rounds.push(finalRound);
  }

  return { ...board, rounds };
}

export function computeBoardResizeImpact(
  board: BoardWithRounds,
  desiredCategories: number,
  desiredRows: number,
): ResizeImpact {
  const impacts = [getPlayRound(board, 'JEOPARDY')]
    .filter((round): round is Round => round !== undefined)
    .map((round) => computeResizeImpact(round, desiredCategories, desiredRows));

  if (board.includeDoubleJeopardy) {
    const doubleRound = getPlayRound(board, 'DOUBLE_JEOPARDY');
    if (doubleRound) {
      impacts.push(computeResizeImpact(doubleRound, desiredCategories, desiredRows));
    }
  }

  return impacts.reduce(
    (total, impact) => ({
      wouldDelete: total.wouldDelete || impact.wouldDelete,
      affectedCells: total.affectedCells + impact.affectedCells,
    }),
    { wouldDelete: false, affectedCells: 0 },
  );
}

export function applyResize(
  board: BoardWithRounds,
  desiredCategories: number,
  desiredRows: number,
): BoardWithRounds {
  return reshapeVisibleRounds(board, desiredCategories, desiredRows);
}

export function setDoubleJeopardyEnabled(
  board: BoardWithRounds,
  enabled: boolean,
): BoardWithRounds {
  let rounds = board.rounds;

  if (enabled) {
    const hasDouble = rounds.some((round) => round.type === 'DOUBLE_JEOPARDY');
    if (!hasDouble) {
      const jeopardyRound = getPlayRound(board, 'JEOPARDY');
      if (jeopardyRound) {
        rounds = [...rounds, createBlankDoubleRound(jeopardyRound)];
      }
    }
  }

  return { ...board, includeDoubleJeopardy: enabled, rounds };
}

export function toUpdateInput(board: BoardWithRounds): UpdateBoardInput {
  return {
    name: board.name,
    includeDoubleJeopardy: board.includeDoubleJeopardy,
    defaultTimerSeconds: board.defaultTimerSeconds,
    finalTimerSeconds: board.finalTimerSeconds,
    rounds: board.rounds.map((round) => ({
      type: round.type,
      order: round.order,
      categories: round.categories.map((category) => ({
        title: category.title,
        order: category.order,
        clues: category.clues.map((clue) => ({
          value: clue.value,
          row: clue.row,
          clueText: clue.clueText,
          answer: clue.answer,
          isDailyDouble: clue.isDailyDouble,
        })),
      })),
    })),
  };
}

export function createBoardInputFromUpdate(board: BoardWithRounds): CreateBoardInput {
  return toUpdateInput(board);
}

export function deriveSettings(board: BoardWithRounds) {
  const jeopardyRound = getPlayRound(board, 'JEOPARDY');
  const categoryCount = jeopardyRound?.categories.length ?? 0;
  const rowCount = jeopardyRound ? rowCountForRound(jeopardyRound) : 0;

  return {
    name: board.name,
    categoryCount: String(categoryCount),
    rowCount: String(rowCount),
    defaultTimer: String(board.defaultTimerSeconds),
    finalTimer: String(board.finalTimerSeconds),
    includeDoubleJeopardy: board.includeDoubleJeopardy,
  };
}

export function isPositiveInteger(value: string): boolean {
  const num = Number(value);
  return value.trim().length > 0 && Number.isInteger(num) && num > 0;
}

export function parsePositiveInteger(value: string): number | null {
  const num = Number(value);
  if (value.trim().length === 0 || !Number.isInteger(num) || num <= 0) {
    return null;
  }
  return num;
}

export const MAX_FIELD_LENGTH = 5000;

export interface ValidationError {
  path: string;
  message: string;
}

export function isClueComplete(clue: Clue): boolean {
  return clue.clueText.trim().length > 0 && clue.answer.trim().length > 0;
}

export function isClueHalfFilled(clue: Clue): boolean {
  const text = clue.clueText.trim();
  const answer = clue.answer.trim();
  const hasContent = text.length > 0 || answer.length > 0;
  return hasContent && !(text.length > 0 && answer.length > 0);
}

export function isCategoryTitleInvalid(title: string): boolean {
  return title.trim().length === 0;
}

export function isCategoryComplete(category: Category): boolean {
  if (isCategoryTitleInvalid(category.title)) return false;
  return category.clues.every(isClueComplete);
}

export function isPlayRoundComplete(round: Round, includeDouble: boolean): boolean {
  if (round.type === 'DOUBLE_JEOPARDY' && !includeDouble) return true;
  if (round.type === 'FINAL') return true;
  if (round.categories.length === 0) return false;
  return round.categories.every(isCategoryComplete);
}

export function isFinalRoundComplete(round: Round): boolean {
  if (round.categories.length === 0) return false;
  return round.categories.every((category) => {
    if (isCategoryTitleInvalid(category.title)) return false;
    const clue = category.clues[0];
    if (!clue) return false;
    return isClueComplete(clue);
  });
}

export function isBoardComplete(board: BoardWithRounds): boolean {
  return board.rounds.every((round) => {
    if (round.type === 'FINAL') return isFinalRoundComplete(round);
    return isPlayRoundComplete(round, board.includeDoubleJeopardy);
  });
}

export function findBoardValidationErrors(board: BoardWithRounds): ValidationError[] {
  const errors: ValidationError[] = [];

  if (board.name.trim().length === 0) {
    errors.push({ path: 'name', message: 'Board name cannot be blank' });
  }

  for (const round of board.rounds) {
    if (round.type === 'DOUBLE_JEOPARDY' && !board.includeDoubleJeopardy) continue;

    for (const category of round.categories) {
      if (isCategoryTitleInvalid(category.title)) {
        errors.push({
          path: `${round.type}.category.${category.order}.title`,
          message: 'Category title cannot be blank',
        });
      }

      for (const clue of category.clues) {
        if (isClueHalfFilled(clue)) {
          const missing = clue.clueText.trim().length === 0 ? 'clue text' : 'answer';
          errors.push({
            path: `${round.type}.category.${category.order}.clue.${clue.row}`,
            message: `Clue is missing ${missing}`,
          });
        }
        if (clue.clueText.length > MAX_FIELD_LENGTH) {
          errors.push({
            path: `${round.type}.category.${category.order}.clue.${clue.row}.clueText`,
            message: `Clue text exceeds ${MAX_FIELD_LENGTH} characters`,
          });
        }
        if (clue.answer.length > MAX_FIELD_LENGTH) {
          errors.push({
            path: `${round.type}.category.${category.order}.clue.${clue.row}.answer`,
            message: `Answer exceeds ${MAX_FIELD_LENGTH} characters`,
          });
        }
      }
    }

    if (round.type === 'FINAL') {
      const category = round.categories[0];
      const clue = category?.clues[0];
      if (category && clue) {
        const title = category.title.trim();
        const text = clue.clueText.trim();
        const answer = clue.answer.trim();
        const hasContent = text.length > 0 || answer.length > 0;
        if (hasContent) {
          if (title.length === 0) {
            errors.push({ path: 'FINAL.category.title', message: 'Final category title cannot be blank' });
          }
          if (text.length === 0) {
            errors.push({ path: 'FINAL.clue.clueText', message: 'Final clue text cannot be blank' });
          }
          if (answer.length === 0) {
            errors.push({ path: 'FINAL.clue.answer', message: 'Final answer cannot be blank' });
          }
        }
      }
    }
  }

  return errors;
}
