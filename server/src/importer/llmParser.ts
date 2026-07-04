import Anthropic from '@anthropic-ai/sdk';
import { createBoardSchema, formatZodError } from '../http/validation.js';
import type { CreateBoardInput, CreateRoundInput } from '../repo/board.js';
import type { CellValue, SheetData } from './reader.js';
import type { ParsedImport } from './parser.js';

type RoundType = CreateRoundInput['type'];

const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_OUTPUT_TOKENS = 16000;
const MAX_INPUT_CHARS = 60000;
const ROUND_ORDER: Record<RoundType, number> = { JEOPARDY: 0, DOUBLE_JEOPARDY: 1, FINAL: 2 };

interface LlmClue {
  value?: number | null;
  clueText?: string;
  answer?: string;
  isDailyDouble?: boolean;
}

interface LlmCategory {
  title?: string;
  clues?: LlmClue[];
}

interface LlmRound {
  type?: string;
  categories?: LlmCategory[];
}

interface LlmBoard {
  name?: string;
  includeDoubleJeopardy?: boolean;
  defaultTimerSeconds?: number;
  finalTimerSeconds?: number;
  rounds?: LlmRound[];
}

const SYSTEM_PROMPT = `You convert arbitrary spreadsheet data into a structured Jeopardy board.

A Jeopardy board has up to three rounds: JEOPARDY, DOUBLE_JEOPARDY, and FINAL.
Each round except FINAL has several categories, and each category has clues.
Each clue has a point value, the clue text (the statement shown to players), and the answer.
In Jeopardy the answer is usually phrased as a question ("What is X?"); keep that phrasing in the answer field.

Spreadsheets vary widely:
- Flat tables: one clue per row with columns such as Category, Value, Clue, Answer.
- Grids: category titles across the top (sometimes merged across multiple columns), point values down the left side, and a Question column plus an Answer column for each category. Pair each category's Question column with its Answer column.
- Category titles may include author names in parentheses; keep the full title.

Detect Daily Doubles from markers such as [DD], "DD", or "Daily Double" and set isDailyDouble to true.
Detect the round from labels, sheet names, or a "Final Jeopardy" section.
For the FINAL round, output exactly one category with exactly one clue and a null value.
Ignore decorative rows, instructions, blank rows, and backup or extra notes that are not real clues.
Only include clues that have real content. Never invent clues, answers, or values.
Return the result by calling the emit_board tool.`;

const BOARD_TOOL: Anthropic.Tool = {
  name: 'emit_board',
  description: 'Return the parsed Jeopardy board as structured data.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'A short name for the board.' },
      includeDoubleJeopardy: { type: 'boolean' },
      rounds: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['JEOPARDY', 'DOUBLE_JEOPARDY', 'FINAL'] },
            categories: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  clues: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        value: { type: ['integer', 'null'] },
                        clueText: { type: 'string' },
                        answer: { type: 'string' },
                        isDailyDouble: { type: 'boolean' },
                      },
                      required: ['clueText', 'answer'],
                    },
                  },
                },
                required: ['title', 'clues'],
              },
            },
          },
          required: ['type', 'categories'],
        },
      },
    },
    required: ['name', 'rounds'],
  },
};

export function isLlmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function serializeSheets(sheets: SheetData[]): string {
  const parts: string[] = [];
  for (const sheet of sheets) {
    parts.push(`### Sheet: ${sheet.name}`);
    const rows = sheet.matrix;
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r] ?? [];
      let last = row.length - 1;
      while (last >= 0 && cellToString(row[last]).trim() === '') last -= 1;
      if (last < 0) continue;
      const cells: string[] = [];
      for (let c = 0; c <= last; c += 1) {
        cells.push(cellToString(row[c]).replace(/[\t\r\n]+/g, ' ').trim());
      }
      parts.push(`R${r}: ${cells.join(' | ')}`);
    }
  }
  const serialized = parts.join('\n');
  return serialized.length > MAX_INPUT_CHARS ? serialized.slice(0, MAX_INPUT_CHARS) : serialized;
}

function normalizeRoundType(value: string | undefined): RoundType | null {
  const normalized = (value ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (normalized.includes('FINAL')) return 'FINAL';
  if (normalized.includes('DOUBLE')) return 'DOUBLE_JEOPARDY';
  if (normalized.includes('JEOPARDY') || normalized === 'J' || normalized === 'SINGLE') return 'JEOPARDY';
  return null;
}

function toInteger(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function positiveIntOr(value: number | undefined, fallback: number): number {
  const rounded = toInteger(value ?? null);
  return rounded !== null && rounded > 0 ? rounded : fallback;
}

export function assembleBoard(llm: LlmBoard, fallbackName: string): CreateBoardInput {
  const byType = new Map<RoundType, CreateRoundInput>();

  for (const rawRound of llm.rounds ?? []) {
    const type = normalizeRoundType(rawRound.type);
    if (!type) continue;

    const categories = (rawRound.categories ?? [])
      .map((rawCategory) => {
        const title = (rawCategory.title ?? '').trim();
        const clues = (rawCategory.clues ?? [])
          .map((rawClue) => ({
            value: type === 'FINAL' ? null : toInteger(rawClue.value),
            clueText: (rawClue.clueText ?? '').trim(),
            answer: (rawClue.answer ?? '').trim(),
            isDailyDouble: Boolean(rawClue.isDailyDouble),
          }))
          .filter((clue) => clue.clueText !== '' || clue.answer !== '');
        return { title, clues };
      })
      .filter((category) => category.title !== '' && category.clues.length > 0);

    if (categories.length === 0) continue;

    const normalizedCategories =
      type === 'FINAL' ? [{ title: categories[0].title, clues: categories[0].clues.slice(0, 1) }] : categories;

    const existing = byType.get(type);
    if (existing) {
      existing.categories.push(...normalizedCategories.map((category, index) => ({
        title: category.title,
        order: existing.categories.length + index,
        clues: category.clues.map((clue, row) => ({ ...clue, row })),
      })));
    } else {
      byType.set(type, {
        type,
        order: ROUND_ORDER[type],
        categories: normalizedCategories.map((category, index) => ({
          title: category.title,
          order: index,
          clues: category.clues.map((clue, row) => ({ ...clue, row })),
        })),
      });
    }
  }

  const rounds = Array.from(byType.values()).sort((a, b) => a.order - b.order);
  const includeDoubleJeopardy =
    llm.includeDoubleJeopardy ?? rounds.some((round) => round.type === 'DOUBLE_JEOPARDY');

  return {
    name: (llm.name ?? '').trim() || fallbackName,
    includeDoubleJeopardy,
    defaultTimerSeconds: positiveIntOr(llm.defaultTimerSeconds, 10),
    finalTimerSeconds: positiveIntOr(llm.finalTimerSeconds, 30),
    rounds,
  };
}

function hasBoardContent(board: CreateBoardInput): boolean {
  return board.rounds.some((round) =>
    round.categories.some((category) =>
      category.clues.some((clue) => clue.clueText.trim() !== '' || clue.answer.trim() !== ''),
    ),
  );
}

export async function parseSheetsWithLlm(sheets: SheetData[], name: string): Promise<ParsedImport> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const serialized = serializeSheets(sheets);

  const message = await client.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [BOARD_TOOL],
    tool_choice: { type: 'tool', name: BOARD_TOOL.name },
    messages: [
      {
        role: 'user',
        content: `Convert this spreadsheet into a Jeopardy board using the emit_board tool.\n\n${serialized}`,
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error('The model did not return a structured board.');
  }

  const board = assembleBoard(toolUse.input as LlmBoard, name);
  if (!hasBoardContent(board)) {
    throw new Error('The model did not extract any usable clues.');
  }

  const warnings: string[] = ['Parsed with AI. Review each clue in the preview before saving.'];
  const validation = createBoardSchema.safeParse(board);
  if (!validation.success) {
    warnings.push('Some fields need attention before saving:');
    warnings.push(...formatZodError(validation.error).map((issue) => `${issue.path}: ${issue.message}`));
  }

  return { board, warnings, confidence: validation.success ? 0.95 : 0.75 };
}
