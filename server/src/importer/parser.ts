import { createBoardSchema, formatZodError } from '../http/validation.js';
import type { CreateBoardInput } from '../repo/board.js';
import type { SheetData, CellValue } from './reader.js';

type RoundType = 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL';

interface ParsedClue {
  value: number | null;
  clueText: string;
  answer: string;
  isDailyDouble: boolean;
  sourceOrder: number;
}

interface ParsedCategory {
  title: string;
  clues: ParsedClue[];
  mergeKey: string;
}

interface ParsedRound {
  type: RoundType;
  categories: ParsedCategory[];
}

interface HeaderMap {
  category?: number;
  value?: number;
  clue?: number;
  answer?: number;
  dailyDouble?: number;
  round?: number;
}

interface HeaderDetection {
  headerIndex: number;
  map: HeaderMap;
  confidence: number;
}

const HEADER_ALIASES: Record<keyof HeaderMap, string[]> = {
  category: ['category', 'topic', 'subject', 'theme', 'cat'],
  value: ['value', 'points', 'amount', 'dollar', 'dollars', 'score', 'worth', 'prize'],
  clue: ['clue', 'question', 'prompt', 'text', 'query'],
  answer: ['answer', 'response', 'solution', 'whatis'],
  dailyDouble: ['daily double', 'dailydouble', 'dd', 'dailyd'],
  round: ['round', 'roundtype', 'round type', 'roundtype'],
};

const DD_MARKER_PATTERN = /\[DD\]/gi;

const TRUTHY_VALUES = new Set(['yes', 'true', '1', 'x', 'dd', 'y']);

const DEFAULT_VALUES = {
  JEOPARDY: 100,
  DOUBLE_JEOPARDY: 200,
  FINAL: null as null,
};

export interface ParsedImport {
  board: CreateBoardInput;
  warnings: string[];
  confidence: number;
}

function cellToString(value: CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

function isWhitespaceOnly(value: string): boolean {
  return value.length > 0 && value.trim().length === 0;
}

function normalizeWhitespace(value: string): string {
  if (isWhitespaceOnly(value)) {
    return '';
  }
  return value;
}

function normalizeHeader(value: string): string {
  return cellToString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => []);
  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

function headerSimilarity(header: string, alias: string): number {
  const h = normalizeHeader(header);
  const a = normalizeHeader(alias);
  if (h.length === 0 || a.length === 0) {
    return 0;
  }
  if (h === a) {
    return 1;
  }
  if (h.includes(a) || a.includes(h)) {
    const shorter = h.length < a.length ? h.length : a.length;
    if (shorter >= 2) {
      return 0.6;
    }
  }
  const maxLength = Math.max(h.length, a.length);
  const distance = levenshteinDistance(h, a);
  if (distance <= 2 && maxLength <= 6) {
    return 0.4;
  }
  return 0;
}

function bestCandidateForHeader(header: string): { candidate: keyof HeaderMap | null; score: number } {
  let bestCandidate: keyof HeaderMap | null = null;
  let bestScore = 0;

  for (const [candidate, aliases] of Object.entries(HEADER_ALIASES) as [keyof HeaderMap, string[]][]) {
    for (const alias of aliases) {
      const score = headerSimilarity(header, alias);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }
  }

  return { candidate: bestCandidate, score: bestScore };
}

function detectHeader(matrix: CellValue[][]): HeaderDetection | null {
  let best: HeaderDetection | null = null;

  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 5); rowIndex += 1) {
    const row = matrix[rowIndex];
    if (!row || row.length === 0) {
      continue;
    }

    const columnScores: Array<{ candidate: keyof HeaderMap | null; score: number }> = [];
    let knownColumnCount = 0;

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = row[columnIndex];
      const result = bestCandidateForHeader(cellToString(cell));
      columnScores[columnIndex] = result;
      if (result.score >= 0.5) {
        knownColumnCount += 1;
      }
    }

    if (knownColumnCount < 2) {
      continue;
    }

    const assigned = new Set<keyof HeaderMap>();
    const map: HeaderMap = {};
    let confidence = 0;

    const sorted = columnScores
      .map((item, index) => ({ ...item, index }))
      .filter((item) => item.candidate !== null && item.score >= 0.5)
      .sort((a, b) => b.score - a.score);

    for (const item of sorted) {
      if (!assigned.has(item.candidate!)) {
        assigned.add(item.candidate!);
        map[item.candidate!] = item.index;
        confidence += item.score;
      }
    }

    if (map.category === undefined && map.clue === undefined) {
      continue;
    }

    if (!best || confidence > best.confidence) {
      best = { headerIndex: rowIndex, map, confidence };
    }
  }

  return best;
}

function parseValue(cell: CellValue): number | null {
  if (cell === null || cell === undefined || cell === '') {
    return null;
  }
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? cell : null;
  }
  if (typeof cell === 'boolean') {
    return null;
  }
  const cleaned = cellToString(cell)
    .replace(/[$,]/g, '')
    .trim()
    .toLowerCase();
  if (cleaned === '') {
    return null;
  }
  const match = cleaned.match(/^-?\d+(?:\.\d+)?$/);
  if (!match) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTruthy(cell: CellValue): boolean {
  const value = cellToString(cell).trim().toLowerCase();
  return TRUTHY_VALUES.has(value) || value === 'true' || value === 'yes' || value === '1';
}

function extractInlineDailyDouble(clueText: string): { text: string; isDailyDouble: boolean } {
  let isDailyDouble = false;
  const text = clueText.replace(DD_MARKER_PATTERN, () => {
    isDailyDouble = true;
    return '';
  });
  return { text: text.trim(), isDailyDouble };
}

function roundTypeFromString(value: CellValue): RoundType | null {
  const normalized = normalizeHeader(cellToString(value));
  if (normalized.includes('final') || normalized === 'fj') {
    return 'FINAL';
  }
  if (normalized.includes('double') || normalized === 'dj') {
    return 'DOUBLE_JEOPARDY';
  }
  if (normalized.includes('jeopardy') || normalized === 'j' || normalized === 'single') {
    return 'JEOPARDY';
  }
  return null;
}

function roundTypeFromSheetName(name: string): RoundType | null {
  const normalized = normalizeHeader(name);
  if (normalized.includes('final') || normalized === 'fj') {
    return 'FINAL';
  }
  if (normalized.includes('double') || normalized === 'dj') {
    return 'DOUBLE_JEOPARDY';
  }
  if (normalized.includes('jeopardy') || normalized === 'j' || normalized === 'single') {
    return 'JEOPARDY';
  }
  return null;
}

function hasOnlyNumericCells(row: CellValue[], columnCount: number): boolean {
  let numericCount = 0;
  for (let i = 0; i < columnCount; i += 1) {
    if (parseValue(row[i]) !== null) {
      numericCount += 1;
    }
  }
  return numericCount >= Math.ceil(columnCount / 2);
}

function parseColumnOrientedSheet(
  matrix: CellValue[][],
  sheetName: string,
  sheetRoundType: RoundType | null,
  warnings: string[],
): ParsedRound[] {
  const roundType = sheetRoundType ?? 'JEOPARDY';
  let headerRow = 0;
  while (headerRow < matrix.length && matrix[headerRow]?.every((cell) => cellToString(cell).trim() === '')) {
    headerRow += 1;
  }
  const headerCells = matrix[headerRow];
  if (!headerCells || headerCells.length === 0) {
    warnings.push(`Sheet "${sheetName}" has no usable headers; skipping.`);
    return [];
  }

  const columnCount = headerCells.length;
  const categoryTitles = headerCells.map((cell) => normalizeWhitespace(cellToString(cell)));
  const activeColumns = categoryTitles
    .map((title, index) => ({ title, index }))
    .filter((item) => item.title !== '');

  if (activeColumns.length === 0) {
    warnings.push(`Sheet "${sheetName}" has no category headers; skipping.`);
    return [];
  }

  let valuesRowIndex = -1;
  if (matrix.length > headerRow + 2 && matrix[headerRow + 1] && hasOnlyNumericCells(matrix[headerRow + 1], columnCount)) {
    valuesRowIndex = headerRow + 1;
  }

  const firstClueRow = valuesRowIndex === -1 ? headerRow + 1 : valuesRowIndex + 1;
  const rawClueRows = matrix.slice(firstClueRow);

  let firstNonEmptyOffset = -1;
  let lastNonEmptyOffset = -1;
  for (let rowOffset = 0; rowOffset < rawClueRows.length; rowOffset += 1) {
    const row = rawClueRows[rowOffset];
    const hasContent = activeColumns.some(
      (column) => cellToString(row?.[column.index]).trim() !== '',
    );
    if (!hasContent) {
      continue;
    }
    if (firstNonEmptyOffset === -1) {
      firstNonEmptyOffset = rowOffset;
    }
    lastNonEmptyOffset = rowOffset;
  }

  const clueRows =
    firstNonEmptyOffset >= 0 && lastNonEmptyOffset >= 0
      ? rawClueRows.slice(firstNonEmptyOffset, lastNonEmptyOffset + 1)
      : [];

  const categories: ParsedCategory[] = activeColumns.map((column) => {
    const clues: ParsedClue[] = [];
    for (let rowOffset = 0; rowOffset < clueRows.length; rowOffset += 1) {
      const row = clueRows[rowOffset];
      const rawText = cellToString(row?.[column.index] ?? '');
      const { text, isDailyDouble } = extractInlineDailyDouble(rawText);
      const normalizedText = normalizeWhitespace(text);

      let value: number | null;
      if (valuesRowIndex !== -1) {
        value = parseValue(matrix[valuesRowIndex]?.[column.index]);
      } else if (roundType === 'FINAL') {
        value = null;
      } else {
        value = (rowOffset + 1) * DEFAULT_VALUES[roundType];
      }

      clues.push({
        value,
        clueText: normalizedText,
        answer: '',
        isDailyDouble,
        sourceOrder: rowOffset,
      });
    }
    return {
      title: column.title,
      mergeKey: `${sheetName}-col-${column.index}`,
      clues,
    };
  });

  return [{ type: roundType, categories }];
}

function parseFlatSheet(
  matrix: CellValue[][],
  sheetName: string,
  header: HeaderDetection,
  sheetRoundType: RoundType | null,
  warnings: string[],
): ParsedRound[] {
  const { map, headerIndex } = header;
  const rowRecords: Array<{
    roundType: RoundType;
    categoryTitle: string;
    clueText: string;
    answer: string;
    value: number | null;
    isDailyDouble: boolean;
    sourceOrder: number;
  }> = [];

  let skippedRows = 0;

  for (let rowIndex = headerIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex];
    if (!row) {
      continue;
    }

    const categoryCell = map.category !== undefined ? cellToString(row[map.category]) : '';
    const categoryTitle = normalizeWhitespace(categoryCell);
    const rawClue = map.clue !== undefined ? cellToString(row[map.clue]) : '';
    const rawAnswer = map.answer !== undefined ? cellToString(row[map.answer]) : '';
    const value = map.value !== undefined ? parseValue(row[map.value]) : null;
    const ddColumn = map.dailyDouble !== undefined ? isTruthy(row[map.dailyDouble]) : false;

    const { text: clueText, isDailyDouble: inlineDd } = extractInlineDailyDouble(rawClue);
    const isDailyDouble = ddColumn || inlineDd;

    const clueTextNormalized = normalizeWhitespace(clueText);
    const answerNormalized = normalizeWhitespace(rawAnswer);

    if (categoryTitle === '' && clueTextNormalized === '' && answerNormalized === '') {
      continue;
    }

    let rowRoundType: RoundType | null = null;
    if (map.round !== undefined) {
      rowRoundType = roundTypeFromString(row[map.round]);
    }
    const roundType = rowRoundType ?? sheetRoundType ?? 'JEOPARDY';

    if (categoryTitle === '' && (clueTextNormalized !== '' || answerNormalized !== '')) {
      skippedRows += 1;
      continue;
    }

    rowRecords.push({
      roundType,
      categoryTitle,
      clueText: clueTextNormalized,
      answer: answerNormalized,
      value,
      isDailyDouble,
      sourceOrder: rowIndex,
    });
  }

  if (skippedRows > 0) {
    warnings.push(`${skippedRows} row(s) missing category were skipped.`);
  }

  if (map.clue === undefined) {
    warnings.push('No clue/question column detected; clue text left blank.');
  }
  if (map.answer === undefined) {
    warnings.push('No answer column detected; answers left blank.');
  }
  if (map.value === undefined) {
    warnings.push('No value column detected; values inferred from row position.');
  }

  const roundsMap = new Map<RoundType, Map<string, ParsedCategory>>();
  for (const record of rowRecords) {
    if (!roundsMap.has(record.roundType)) {
      roundsMap.set(record.roundType, new Map());
    }
    const categoryMap = roundsMap.get(record.roundType)!;
    const mergeKey = `${sheetName}:${record.categoryTitle}`;
    let category = categoryMap.get(mergeKey);
    if (!category) {
      category = { title: record.categoryTitle, mergeKey, clues: [] };
      categoryMap.set(mergeKey, category);
    }
    category.clues.push({
      value: record.value,
      clueText: record.clueText,
      answer: record.answer,
      isDailyDouble: record.isDailyDouble,
      sourceOrder: record.sourceOrder,
    });
  }

  const rounds: ParsedRound[] = [];
  for (const [type, categoryMap] of roundsMap) {
    const categories = Array.from(categoryMap.values()).map((category) => {
      const sortedClues = category.clues.sort((a, b) => {
        if (a.value !== null && b.value !== null && a.value !== b.value) {
          return a.value - b.value;
        }
        return a.sourceOrder - b.sourceOrder;
      });

      const finalClues = sortedClues.map((clue, index) => {
        let value = clue.value;
        if (value === null && type !== 'FINAL') {
          value = (index + 1) * DEFAULT_VALUES[type];
        }
        return { ...clue, value, sourceOrder: index };
      });

      return { title: category.title, mergeKey: category.mergeKey, clues: finalClues };
    });

    if (type === 'FINAL') {
      for (const category of categories) {
        const firstClue = category.clues[0];
        if (firstClue) {
          category.clues = [{ ...firstClue, value: null }];
        }
      }
      const trimmedCategories = categories.filter((category) => category.clues.length > 0);
      if (trimmedCategories.length < categories.length) {
        warnings.push('Extra rows in a Final category were ignored; only the first clue is used.');
      }
      rounds.push({ type, categories: trimmedCategories });
    } else {
      rounds.push({ type, categories });
    }
  }

  return rounds;
}

function parseSheet(sheet: SheetData, warnings: string[]): ParsedRound[] {
  const matrix = sheet.matrix;
  const sheetRoundType = roundTypeFromSheetName(sheet.name);
  const header = detectHeader(matrix);

  if (header) {
    return parseFlatSheet(matrix, sheet.name, header, sheetRoundType, warnings);
  }

  return parseColumnOrientedSheet(matrix, sheet.name, sheetRoundType, warnings);
}

function mergeRounds(rounds: ParsedRound[]): ParsedRound[] {
  const grouped = new Map<RoundType, Map<string, ParsedCategory>>();

  for (const round of rounds) {
    if (!grouped.has(round.type)) {
      grouped.set(round.type, new Map());
    }
    const categoryMap = grouped.get(round.type)!;
    for (const category of round.categories) {
      const existing = categoryMap.get(category.mergeKey);
      if (!existing) {
        categoryMap.set(category.mergeKey, {
          title: category.title,
          mergeKey: category.mergeKey,
          clues: [...category.clues],
        });
      } else {
        existing.clues.push(...category.clues);
      }
    }
  }

  const result: ParsedRound[] = [];
  for (const [type, categoryMap] of grouped) {
    const categories = Array.from(categoryMap.values()).map((category) => {
      const sortedClues = category.clues.sort((a, b) => {
        if (a.value !== null && b.value !== null && a.value !== b.value) {
          return a.value - b.value;
        }
        return a.sourceOrder - b.sourceOrder;
      });

      return {
        title: category.title,
        mergeKey: category.mergeKey,
        clues: sortedClues.map((clue, index) => ({
          ...clue,
          value: type === 'FINAL' ? null : (clue.value ?? (index + 1) * DEFAULT_VALUES[type]),
          sourceOrder: index,
        })),
      };
    });
    result.push({ type, categories });
  }

  return result;
}

function buildBoardInput(name: string, parsedRounds: ParsedRound[]): CreateBoardInput {
  const roundOrder: Record<RoundType, number> = { JEOPARDY: 0, DOUBLE_JEOPARDY: 1, FINAL: 2 };
  const sortedRounds = parsedRounds.sort((a, b) => roundOrder[a.type] - roundOrder[b.type]);

  const includeDoubleJeopardy = sortedRounds.some((round) => round.type === 'DOUBLE_JEOPARDY');

  return {
    name,
    includeDoubleJeopardy,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    rounds: sortedRounds.map((round) => ({
      type: round.type,
      order: roundOrder[round.type],
      categories: round.categories.map((category, index) => ({
        title: category.title,
        order: index,
        clues: category.clues.map((clue) => ({
          value: clue.value,
          row: clue.sourceOrder,
          clueText: clue.clueText,
          answer: clue.answer,
          isDailyDouble: clue.isDailyDouble,
        })),
      })),
    })),
  };
}

function validateBoard(board: CreateBoardInput): string[] {
  const result = createBoardSchema.safeParse(board);
  if (result.success) {
    return [];
  }
  return formatZodError(result.error).map((issue) => `${issue.path}: ${issue.message}`);
}

function hasAnyContent(rounds: ParsedRound[]): boolean {
  return rounds.some((round) =>
    round.categories.some(
      (category) =>
        category.title.trim() !== '' ||
        category.clues.some((clue) => clue.clueText.trim() !== '' || clue.answer.trim() !== ''),
    ),
  );
}

export function parseSheets(sheets: SheetData[], name = 'Imported Board'): ParsedImport {
  const warnings: string[] = [];

  if (sheets.length === 0) {
    warnings.push('No sheets found in the uploaded file.');
    return {
      board: buildBoardInput(name, []),
      warnings,
      confidence: 0,
    };
  }

  let allRounds: ParsedRound[] = [];
  for (const sheet of sheets) {
    const sheetRounds = parseSheet(sheet, warnings);
    allRounds = allRounds.concat(sheetRounds);
  }

  const mergedRounds = mergeRounds(allRounds);

  if (!hasAnyContent(mergedRounds)) {
    warnings.push('No usable content was found in the uploaded file.');
  }

  const hasRoundColumn = sheets.some((sheet) => {
    const header = detectHeader(sheet.matrix);
    return header?.map.round !== undefined;
  });
  const hasKnownSheetNames = sheets.some((sheet) => roundTypeFromSheetName(sheet.name) !== null);

  if (!hasRoundColumn && !hasKnownSheetNames) {
    warnings.push('No round information detected; all content assumed to be the Jeopardy round.');
  }

  const validationIssues = validateBoard(buildBoardInput(name, mergedRounds));
  if (validationIssues.length > 0) {
    warnings.push('Parsed board has structural issues that should be fixed before saving:');
    warnings.push(...validationIssues);
  }

  const confidence = computeConfidence(mergedRounds, hasRoundColumn || hasKnownSheetNames, warnings);

  return {
    board: buildBoardInput(name, mergedRounds),
    warnings,
    confidence,
  };
}

function computeConfidence(rounds: ParsedRound[], hasRoundInfo: boolean, warnings: string[]): number {
  let score = 0.5;
  if (rounds.some((round) => round.type === 'JEOPARDY' && round.categories.length > 0)) {
    score += 0.2;
  }
  if (hasRoundInfo) {
    score += 0.2;
  }
  if (rounds.some((round) => round.type === 'FINAL' && round.categories.length > 0)) {
    score += 0.1;
  }

  const warningPenalty = Math.min(warnings.length * 0.05, 0.3);
  return Math.max(0, Math.min(1, score - warningPenalty));
}
