import type { BoardWithRounds, Category, Clue, Round } from '../../api/boards.js';
import {
  defaultValueForRow,
  makeBlankCategory,
  makeTempId,
  rowCountForRound,
} from './boardHelpers.js';

function updateRound(
  board: BoardWithRounds,
  roundType: Round['type'],
  updater: (round: Round) => Round,
): BoardWithRounds {
  const rounds = board.rounds.map((round) =>
    round.type === roundType ? updater(round) : round,
  );
  return { ...board, rounds };
}

function fixCategoryIds(category: Category, roundId: string): Category {
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
}

export function addCategory(
  board: BoardWithRounds,
  roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY',
  title = 'New Category',
): BoardWithRounds {
  return updateRound(board, roundType, (round) => {
    const isDouble = roundType === 'DOUBLE_JEOPARDY';
    const rowCount = rowCountForRound(round);
    const newCategory = makeBlankCategory(title, round.categories.length, rowCount, isDouble);
    return {
      ...round,
      categories: [
        ...round.categories,
        fixCategoryIds(newCategory, round.id || makeTempId()),
      ],
    };
  });
}

export function removeCategory(
  board: BoardWithRounds,
  roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY',
  categoryIndex: number,
): BoardWithRounds {
  return updateRound(board, roundType, (round) => {
    const categories = round.categories
      .filter((_, index) => index !== categoryIndex)
      .map((category, index) => ({ ...category, order: index }));
    return { ...round, categories };
  });
}

export function renameCategory(
  board: BoardWithRounds,
  roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY',
  categoryIndex: number,
  title: string,
): BoardWithRounds {
  return updateRound(board, roundType, (round) => {
    const categories = round.categories.map((category, index) =>
      index === categoryIndex ? { ...category, title } : category,
    );
    return { ...round, categories };
  });
}

export function moveCategory(
  board: BoardWithRounds,
  roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY',
  categoryIndex: number,
  direction: 'left' | 'right',
): BoardWithRounds {
  return updateRound(board, roundType, (round) => {
    const categories = [...round.categories];
    const newIndex = direction === 'left' ? categoryIndex - 1 : categoryIndex + 1;
    if (newIndex < 0 || newIndex >= categories.length) {
      return round;
    }
    [categories[categoryIndex], categories[newIndex]] = [
      categories[newIndex],
      categories[categoryIndex],
    ];
    return {
      ...round,
      categories: categories.map((category, index) => ({ ...category, order: index })),
    };
  });
}

export function updateClue(
  board: BoardWithRounds,
  roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY',
  categoryIndex: number,
  row: number,
  patch: Partial<Clue>,
): BoardWithRounds {
  return updateRound(board, roundType, (round) => {
    const categories = round.categories.map((category, index) => {
      if (index !== categoryIndex) {
        return category;
      }
      return {
        ...category,
        clues: category.clues.map((clue) =>
          clue.row === row ? { ...clue, ...patch } : clue,
        ),
      };
    });
    return { ...round, categories };
  });
}

export function moveRow(
  board: BoardWithRounds,
  roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY',
  rowIndex: number,
  direction: 'up' | 'down',
): BoardWithRounds {
  return updateRound(board, roundType, (round) => {
    const rowCount = rowCountForRound(round);
    const newIndex = direction === 'up' ? rowIndex - 1 : rowIndex + 1;
    if (newIndex < 0 || newIndex >= rowCount) {
      return round;
    }

    const isDouble = roundType === 'DOUBLE_JEOPARDY';
    const categories = round.categories.map((category) => {
      const clues = [...category.clues];
      [clues[rowIndex], clues[newIndex]] = [clues[newIndex], clues[rowIndex]];
      return {
        ...category,
        clues: clues.map((clue, index) => ({
          ...clue,
          row: index,
          value: defaultValueForRow(index, isDouble),
        })),
      };
    });

    return { ...round, categories };
  });
}

export function updateFinal(
  board: BoardWithRounds,
  patch: { title?: string; clueText?: string; answer?: string },
): BoardWithRounds {
  return updateRound(board, 'FINAL', (round) => {
    const category = round.categories[0];
    if (!category) {
      return round;
    }
    return {
      ...round,
      categories: [
        {
          ...category,
          title: patch.title ?? category.title,
          clues: category.clues.map((clue, index) =>
            index === 0
              ? {
                  ...clue,
                  clueText: patch.clueText ?? clue.clueText,
                  answer: patch.answer ?? clue.answer,
                }
              : clue,
          ),
        },
      ],
    };
  });
}
