import { describe, expect, it } from 'vitest';
import { createBoardSchema, formatZodError, updateBoardSchema } from './validation.js';

function makeClue(overrides: { clueText?: string; answer?: string; value?: number | null; row?: number } = {}) {
  return {
    value: overrides.value ?? 100,
    row: overrides.row ?? 0,
    clueText: overrides.clueText ?? 'Clue text',
    answer: overrides.answer ?? 'Answer',
    isDailyDouble: false,
  };
}

function makeCategory(overrides: { title?: string; clues?: unknown[] } = {}) {
  return {
    title: overrides.title ?? 'Category',
    order: 0,
    clues: overrides.clues ?? [makeClue()],
  };
}

function makeBoard(overrides: { rounds?: unknown[]; name?: string } = {}) {
  return {
    name: overrides.name ?? 'Test Board',
    includeDoubleJeopardy: true,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    rounds: overrides.rounds ?? [
      {
        type: 'JEOPARDY',
        order: 0,
        categories: [makeCategory()],
      },
      {
        type: 'FINAL',
        order: 1,
        categories: [
          {
            title: 'Final Category',
            order: 0,
            clues: [makeClue({ value: null, clueText: 'Final clue', answer: 'Final answer' })],
          },
        ],
      },
    ],
  };
}

describe('board validation schemas', () => {
  describe('half-filled clues', () => {
    it('rejects a clue with text but no answer', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [makeCategory({ clues: [makeClue({ clueText: 'Has text', answer: '' })], })],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: 'Final clue', answer: 'Final answer' })],
              },
            ],
          },
        ],
      });

      const result = createBoardSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const details = formatZodError(result.error);
        expect(details.some((d) => d.path.includes('answer'))).toBe(true);
      }
    });

    it('rejects a clue with answer but no text', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [makeCategory({ clues: [makeClue({ clueText: '', answer: 'Has answer' })], })],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: 'Final clue', answer: 'Final answer' })],
              },
            ],
          },
        ],
      });

      const result = createBoardSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const details = formatZodError(result.error);
        expect(details.some((d) => d.path.includes('clueText'))).toBe(true);
      }
    });

    it('allows a fully empty clue cell as a hole', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [
              makeCategory({
                clues: [
                  makeClue({ clueText: '', answer: '' }),
                  makeClue({ clueText: 'Filled', answer: 'Answer' }),
                ],
              }),
            ],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: 'Final clue', answer: 'Final answer' })],
              },
            ],
          },
        ],
      });

      const result = createBoardSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects whitespace-only clue text paired with an answer', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [makeCategory({ clues: [makeClue({ clueText: '   ', answer: 'Answer' })], })],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: 'Final clue', answer: 'Final answer' })],
              },
            ],
          },
        ],
      });

      const result = createBoardSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const details = formatZodError(result.error);
        expect(details.some((d) => d.path.includes('clueText'))).toBe(true);
      }
    });

    it('rejects whitespace-only answer paired with clue text', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [makeCategory({ clues: [makeClue({ clueText: 'Clue', answer: '  \t' })], })],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: 'Final clue', answer: 'Final answer' })],
              },
            ],
          },
        ],
      });

      const result = createBoardSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const details = formatZodError(result.error);
        expect(details.some((d) => d.path.includes('answer'))).toBe(true);
      }
    });
  });

  describe('category titles', () => {
    it('rejects a whitespace-only category title', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [makeCategory({ title: '   ' })],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: 'Final clue', answer: 'Final answer' })],
              },
            ],
          },
        ],
      });

      const result = createBoardSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const details = formatZodError(result.error);
        expect(details.some((d) => d.path.includes('title'))).toBe(true);
      }
    });
  });

  describe('Final Jeopardy', () => {
    it('allows a default Final round with empty clue and answer as a hole', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [makeCategory()],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: '', answer: '' })],
              },
            ],
          },
        ],
      });

      const result = createBoardSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects a Final with clue text but no answer', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [makeCategory()],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: 'Final clue', answer: '' })],
              },
            ],
          },
        ],
      });

      const result = createBoardSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const details = formatZodError(result.error);
        expect(details.some((d) => d.path.includes('answer'))).toBe(true);
      }
    });

    it('rejects a Final with answer but no clue text', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [makeCategory()],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: '', answer: 'Final answer' })],
              },
            ],
          },
        ],
      });

      const result = createBoardSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const details = formatZodError(result.error);
        expect(details.some((d) => d.path.includes('clueText'))).toBe(true);
      }
    });
  });

  describe('field length limits', () => {
    it('rejects a clue text exceeding the maximum length', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [makeCategory({ clues: [makeClue({ clueText: 'x'.repeat(5001), answer: 'Answer' })] })],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: 'Final clue', answer: 'Final answer' })],
              },
            ],
          },
        ],
      });

      const result = createBoardSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const details = formatZodError(result.error);
        expect(details.some((d) => d.path.includes('clueText'))).toBe(true);
      }
    });

    it('rejects an answer exceeding the maximum length', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [makeCategory({ clues: [makeClue({ clueText: 'Clue', answer: 'x'.repeat(5001) })] })],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: 'Final clue', answer: 'Final answer' })],
              },
            ],
          },
        ],
      });

      const result = createBoardSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const details = formatZodError(result.error);
        expect(details.some((d) => d.path.includes('answer'))).toBe(true);
      }
    });
  });

  describe('updateBoardSchema', () => {
    it('is the same as createBoardSchema for validation purposes', () => {
      const payload = makeBoard({
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [makeCategory({ clues: [makeClue({ clueText: 'Only text', answer: '' })], })],
          },
          {
            type: 'FINAL',
            order: 1,
            categories: [
              {
                title: 'Final Category',
                order: 0,
                clues: [makeClue({ value: null, clueText: 'Final clue', answer: 'Final answer' })],
              },
            ],
          },
        ],
      });

      const createResult = createBoardSchema.safeParse(payload);
      const updateResult = updateBoardSchema.safeParse(payload);
      expect(createResult.success).toBe(false);
      expect(updateResult.success).toBe(false);
    });
  });
});
