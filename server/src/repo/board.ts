import { prisma } from './prisma.js';

export interface CreateClueInput {
  value: number | null;
  row: number;
  clueText: string;
  answer: string;
  isDailyDouble?: boolean;
}

export interface CreateCategoryInput {
  title: string;
  order: number;
  clues: CreateClueInput[];
}

export interface CreateRoundInput {
  type: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL';
  order: number;
  categories: CreateCategoryInput[];
}

export interface CreateBoardInput {
  name: string;
  includeDoubleJeopardy?: boolean;
  defaultTimerSeconds?: number;
  finalTimerSeconds?: number;
  rounds: CreateRoundInput[];
}

export type UpdateBoardInput = CreateBoardInput;

export interface ClueDto {
  id: string;
  categoryId: string;
  value: number | null;
  row: number;
  clueText: string;
  answer: string;
  isDailyDouble: boolean;
}

export interface CategoryWithClues {
  id: string;
  roundId: string;
  title: string;
  order: number;
  clues: ClueDto[];
}

export interface RoundWithCategories {
  id: string;
  boardId: string;
  type: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL';
  order: number;
  categories: CategoryWithClues[];
}

export interface BoardWithRounds {
  id: string;
  name: string;
  includeDoubleJeopardy: boolean;
  defaultTimerSeconds: number;
  finalTimerSeconds: number;
  createdAt: Date;
  updatedAt: Date;
  rounds: RoundWithCategories[];
}

export interface BoardSummary {
  id: string;
  name: string;
  includeDoubleJeopardy: boolean;
  defaultTimerSeconds: number;
  finalTimerSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BoardRepository {
  create(input: CreateBoardInput): Promise<BoardWithRounds>;
  findAll(): Promise<BoardSummary[]>;
  findById(id: string): Promise<BoardWithRounds | null>;
  update(id: string, input: UpdateBoardInput): Promise<BoardWithRounds>;
  delete(id: string): Promise<void>;
}

const includeRounds = {
  rounds: {
    orderBy: { order: 'asc' as const },
    include: {
      categories: {
        orderBy: { order: 'asc' as const },
        include: {
          clues: {
            orderBy: { row: 'asc' as const },
          },
        },
      },
    },
  },
};

function mapClue(clue: {
  id: string;
  categoryId: string;
  value: number | null;
  row: number;
  clueText: string;
  answer: string;
  isDailyDouble: boolean;
}): ClueDto {
  return {
    id: clue.id,
    categoryId: clue.categoryId,
    value: clue.value,
    row: clue.row,
    clueText: clue.clueText,
    answer: clue.answer,
    isDailyDouble: clue.isDailyDouble,
  };
}

function mapCategory(category: {
  id: string;
  roundId: string;
  title: string;
  order: number;
  clues: { id: string; categoryId: string; value: number | null; row: number; clueText: string; answer: string; isDailyDouble: boolean }[];
}): CategoryWithClues {
  return {
    id: category.id,
    roundId: category.roundId,
    title: category.title,
    order: category.order,
    clues: category.clues.map(mapClue),
  };
}

function mapRound(round: {
  id: string;
  boardId: string;
  type: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL';
  order: number;
  categories: { id: string; roundId: string; title: string; order: number; clues: { id: string; categoryId: string; value: number | null; row: number; clueText: string; answer: string; isDailyDouble: boolean }[] }[];
}): RoundWithCategories {
  return {
    id: round.id,
    boardId: round.boardId,
    type: round.type,
    order: round.order,
    categories: round.categories.map(mapCategory),
  };
}

function mapBoardWithRounds(board: {
  id: string;
  name: string;
  includeDoubleJeopardy: boolean;
  defaultTimerSeconds: number;
  finalTimerSeconds: number;
  createdAt: Date;
  updatedAt: Date;
  rounds: {
    id: string;
    boardId: string;
    type: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL';
    order: number;
    categories: { id: string; roundId: string; title: string; order: number; clues: { id: string; categoryId: string; value: number | null; row: number; clueText: string; answer: string; isDailyDouble: boolean }[] }[];
  }[];
}): BoardWithRounds {
  return {
    id: board.id,
    name: board.name,
    includeDoubleJeopardy: board.includeDoubleJeopardy,
    defaultTimerSeconds: board.defaultTimerSeconds,
    finalTimerSeconds: board.finalTimerSeconds,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    rounds: board.rounds.map(mapRound),
  };
}

export const boardRepository: BoardRepository = {
  async create(input) {
    const board = await prisma.board.create({
      data: {
        name: input.name,
        includeDoubleJeopardy: input.includeDoubleJeopardy ?? true,
        defaultTimerSeconds: input.defaultTimerSeconds ?? 5,
        finalTimerSeconds: input.finalTimerSeconds ?? 30,
        rounds: {
          create: input.rounds.map((round) => ({
            type: round.type,
            order: round.order,
            categories: {
              create: round.categories.map((category) => ({
                title: category.title,
                order: category.order,
                clues: {
                  create: category.clues.map((clue) => ({
                    value: clue.value,
                    row: clue.row,
                    clueText: clue.clueText,
                    answer: clue.answer,
                    isDailyDouble: clue.isDailyDouble ?? false,
                  })),
                },
              })),
            },
          })),
        },
      },
      include: includeRounds,
    });

    return mapBoardWithRounds(board);
  },

  async findAll() {
    return prisma.board.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        includeDoubleJeopardy: true,
        defaultTimerSeconds: true,
        finalTimerSeconds: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  async findById(id) {
    const board = await prisma.board.findUnique({
      where: { id },
      include: includeRounds,
    });

    return board ? mapBoardWithRounds(board) : null;
  },

  async update(id, input) {
    await prisma.$transaction(async (tx) => {
      await tx.clue.deleteMany({
        where: { category: { round: { boardId: id } } },
      });
      await tx.category.deleteMany({
        where: { round: { boardId: id } },
      });
      await tx.round.deleteMany({
        where: { boardId: id },
      });

      await tx.board.update({
        where: { id },
        data: {
          name: input.name,
          includeDoubleJeopardy: input.includeDoubleJeopardy ?? true,
          defaultTimerSeconds: input.defaultTimerSeconds ?? 5,
          finalTimerSeconds: input.finalTimerSeconds ?? 30,
          rounds: {
            create: input.rounds.map((round) => ({
              type: round.type,
              order: round.order,
              categories: {
                create: round.categories.map((category) => ({
                  title: category.title,
                  order: category.order,
                  clues: {
                    create: category.clues.map((clue) => ({
                      value: clue.value,
                      row: clue.row,
                      clueText: clue.clueText,
                      answer: clue.answer,
                      isDailyDouble: clue.isDailyDouble ?? false,
                    })),
                  },
                })),
              },
            })),
          },
        },
      });
    });

    const board = await prisma.board.findUniqueOrThrow({
      where: { id },
      include: includeRounds,
    });

    return mapBoardWithRounds(board);
  },

  async delete(id) {
    await prisma.board.delete({
      where: { id },
    });
  },
};
