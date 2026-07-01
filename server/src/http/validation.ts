import { z } from 'zod';

export const roundTypeSchema = z.enum(['JEOPARDY', 'DOUBLE_JEOPARDY', 'FINAL']);

export const clueSchema = z.object({
  value: z.number().int().nullable().default(null),
  row: z.number().int().min(0),
  clueText: z.string().min(1),
  answer: z.string().min(1),
  isDailyDouble: z.boolean().optional().default(false),
});

export const categorySchema = z.object({
  title: z.string().min(1),
  order: z.number().int().min(0),
  clues: z.array(clueSchema),
});

export const roundSchema = z.object({
  type: roundTypeSchema,
  order: z.number().int().min(0),
  categories: z.array(categorySchema),
});

export const createBoardSchema = z.object({
  name: z.string().min(1),
  includeDoubleJeopardy: z.boolean().optional().default(true),
  defaultTimerSeconds: z.number().int().positive().default(5),
  finalTimerSeconds: z.number().int().positive().default(30),
  rounds: z.array(roundSchema),
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
