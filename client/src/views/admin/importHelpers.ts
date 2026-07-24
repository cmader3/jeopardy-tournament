import type { CategoryInput, ClueInput, CreateBoardInput, RoundInput } from '../../api/boards.js';

export type EditableBoard = CreateBoardInput;

function makeBlankFinalClue(): ClueInput {
  return { value: null, row: 0, clueText: '', answer: '', isDailyDouble: false };
}

function makeBlankFinalCategory(): CategoryInput {
  return { title: 'Final Category', order: 0, clues: [makeBlankFinalClue()] };
}

function ensureEditableFinalRound(board: CreateBoardInput): CreateBoardInput {
  const finalIndex = board.rounds.findIndex((round) => round.type === 'FINAL');

  if (finalIndex === -1) {
    const nextOrder = board.rounds.reduce((max, round) => Math.max(max, round.order), -1) + 1;
    return {
      ...board,
      rounds: [...board.rounds, { type: 'FINAL', order: nextOrder, categories: [makeBlankFinalCategory()] }],
    };
  }

  const rounds = board.rounds.map((round, index) => {
    if (index !== finalIndex) return round;
    const category = round.categories[0] ?? makeBlankFinalCategory();
    const clue = category.clues[0] ?? makeBlankFinalClue();
    return {
      ...round,
      categories: [{ ...category, order: 0, clues: [{ ...clue, value: null, row: 0 }] }],
    };
  });

  return { ...board, rounds };
}

export function createEditableBoard(input: CreateBoardInput): EditableBoard {
  return ensureEditableFinalRound(input);
}

export function updateBoardName(board: EditableBoard, name: string): EditableBoard {
  return { ...board, name };
}

export function updateDefaultTimer(board: EditableBoard, seconds: number): EditableBoard {
  return { ...board, defaultTimerSeconds: seconds };
}

export function updateFinalTimer(board: EditableBoard, seconds: number): EditableBoard {
  return { ...board, finalTimerSeconds: seconds };
}

export function setIncludeDoubleJeopardy(board: EditableBoard, enabled: boolean): EditableBoard {
  return { ...board, includeDoubleJeopardy: enabled };
}

export function updateCategoryTitle(
  board: EditableBoard,
  roundType: RoundInput['type'],
  categoryIndex: number,
  title: string,
): EditableBoard {
  const rounds = board.rounds.map((round) => {
    if (round.type !== roundType) return round;

    const categories = round.categories.map((category, index) =>
      index === categoryIndex ? { ...category, title } : category,
    );

    return { ...round, categories };
  });

  return { ...board, rounds };
}

export function setClueDailyDouble(
  board: EditableBoard,
  roundType: RoundInput['type'],
  categoryIndex: number,
  clueIndex: number,
  isDailyDouble: boolean,
): EditableBoard {
  const rounds = board.rounds.map((round) => {
    if (round.type !== roundType) return round;

    const categories = round.categories.map((category, index) => {
      if (index !== categoryIndex) return category;

      return {
        ...category,
        clues: category.clues.map((clue, index) =>
          index === clueIndex ? { ...clue, isDailyDouble } : clue,
        ),
      };
    });

    return { ...round, categories };
  });

  return { ...board, rounds };
}

export function moveClueToCategory(
  board: EditableBoard,
  roundType: RoundInput['type'],
  sourceCategoryIndex: number,
  sourceClueIndex: number,
  targetCategoryIndex: number,
): EditableBoard {
  if (sourceCategoryIndex === targetCategoryIndex) return board;

  const rounds = board.rounds.map((round) => {
    if (round.type !== roundType) return round;

    const categories = round.categories.map((category) => ({
      ...category,
      clues: [...category.clues],
    }));
    const sourceCategory = categories[sourceCategoryIndex];
    const targetCategory = categories[targetCategoryIndex];
    if (!sourceCategory || !targetCategory) return round;

    const [movedClue] = sourceCategory.clues.splice(sourceClueIndex, 1);
    if (!movedClue) return round;

    targetCategory.clues.push(movedClue);

    sourceCategory.clues = sourceCategory.clues.map((clue, index) => ({
      ...clue,
      row: index,
    }));
    targetCategory.clues = targetCategory.clues.map((clue, index) => ({
      ...clue,
      row: index,
    }));

    return { ...round, categories };
  });

  return { ...board, rounds };
}

export function updateClueValue(
  board: EditableBoard,
  roundType: RoundInput['type'],
  categoryIndex: number,
  clueIndex: number,
  value: number | null,
): EditableBoard {
  const rounds = board.rounds.map((round) => {
    if (round.type !== roundType) return round;

    const categories = round.categories.map((category, index) => {
      if (index !== categoryIndex) return category;

      return {
        ...category,
        clues: category.clues.map((clue, index) =>
          index === clueIndex ? { ...clue, value } : clue,
        ),
      };
    });

    return { ...round, categories };
  });

  return { ...board, rounds };
}

export function updateClueText(
  board: EditableBoard,
  roundType: RoundInput['type'],
  categoryIndex: number,
  clueIndex: number,
  clueText: string,
): EditableBoard {
  const rounds = board.rounds.map((round) => {
    if (round.type !== roundType) return round;

    const categories = round.categories.map((category, index) => {
      if (index !== categoryIndex) return category;

      return {
        ...category,
        clues: category.clues.map((clue, index) =>
          index === clueIndex ? { ...clue, clueText } : clue,
        ),
      };
    });

    return { ...round, categories };
  });

  return { ...board, rounds };
}

export function updateClueAnswer(
  board: EditableBoard,
  roundType: RoundInput['type'],
  categoryIndex: number,
  clueIndex: number,
  answer: string,
): EditableBoard {
  const rounds = board.rounds.map((round) => {
    if (round.type !== roundType) return round;

    const categories = round.categories.map((category, index) => {
      if (index !== categoryIndex) return category;

      return {
        ...category,
        clues: category.clues.map((clue, index) =>
          index === clueIndex ? { ...clue, answer } : clue,
        ),
      };
    });

    return { ...round, categories };
  });

  return { ...board, rounds };
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
