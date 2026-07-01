import { z } from 'zod';

export const MAX_FIELD_LENGTH = 5000;

export const roundTypeSchema = z.enum(['JEOPARDY', 'DOUBLE_JEOPARDY', 'FINAL']);

function trimmedNonEmptyString(message: string) {
  return z.string().min(1).refine((value) => value.trim().length > 0, { message });
}

export const clueSchema = z
  .object({
    value: z.number().int().nullable().default(null),
    row: z.number().int().min(0),
    clueText: z.string().max(MAX_FIELD_LENGTH).default(''),
    answer: z.string().max(MAX_FIELD_LENGTH).default(''),
    isDailyDouble: z.boolean().optional().default(false),
  })
  .superRefine((clue, ctx) => {
    const text = clue.clueText.trim();
    const answer = clue.answer.trim();
    const hasContent = text.length > 0 || answer.length > 0;

    if (!hasContent) return;

    if (text.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Clue text cannot be blank when an answer is provided',
        path: ['clueText'],
      });
    }
    if (answer.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Answer cannot be blank when clue text is provided',
        path: ['answer'],
      });
    }
  });

export const categorySchema = z.object({
  title: trimmedNonEmptyString('Category title cannot be blank'),
  order: z.number().int().min(0),
  clues: z.array(clueSchema),
});

export const roundSchema = z
  .object({
    type: roundTypeSchema,
    order: z.number().int().min(0),
    categories: z.array(categorySchema),
  })
  .superRefine((round, ctx) => {
    if (round.type !== 'FINAL') return;

    for (const category of round.categories) {
      const clue = category.clues[0];
      if (!clue) continue;

      const title = category.title.trim();
      const text = clue.clueText.trim();
      const answer = clue.answer.trim();
      const hasContent = text.length > 0 || answer.length > 0;

      if (!hasContent) continue;

      if (title.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Final category title cannot be blank when the Final clue is authored',
          path: ['categories', category.order, 'title'],
        });
      }
      if (text.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Final clue text cannot be blank when the Final answer is provided',
          path: ['categories', category.order, 'clues', clue.row, 'clueText'],
        });
      }
      if (answer.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Final answer cannot be blank when the Final clue is provided',
          path: ['categories', category.order, 'clues', clue.row, 'answer'],
        });
      }
    }
  });

export const createBoardSchema = z
  .object({
    name: trimmedNonEmptyString('Board name cannot be blank'),
    includeDoubleJeopardy: z.boolean().optional().default(true),
    defaultTimerSeconds: z.number().int().positive().default(5),
    finalTimerSeconds: z.number().int().positive().default(30),
    rounds: z.array(roundSchema),
  })
  .superRefine((board, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < board.rounds.length; i++) {
      const type = board.rounds[i].type;
      if (seen.has(type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate round type: ${type}. Each round type may appear only once.`,
          path: ['rounds', i, 'type'],
        });
      } else {
        seen.add(type);
      }
    }
  });

export const updateBoardSchema = createBoardSchema;

export function validate<T>(schema: z.ZodType<T>, value: unknown): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

export function formatZodError(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
