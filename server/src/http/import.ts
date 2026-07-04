import { Router } from 'express';
import multer from 'multer';
import { readSpreadsheetBuffer } from '../importer/reader.js';
import type { SheetData } from '../importer/reader.js';
import { parseSheets } from '../importer/parser.js';
import type { ParsedImport } from '../importer/parser.js';
import { isLlmConfigured, parseSheetsWithLlm } from '../importer/llmParser.js';
import type { CreateBoardInput } from '../repo/board.js';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
});

export const importRouter = Router();

function hasBoardContent(board: CreateBoardInput): boolean {
  return board.rounds.some((round) =>
    round.categories.some((category) =>
      category.clues.some((clue) => clue.clueText.trim() !== '' || clue.answer.trim() !== ''),
    ),
  );
}

async function parseImport(sheets: SheetData[], name: string): Promise<ParsedImport> {
  if (isLlmConfigured()) {
    try {
      return await parseSheetsWithLlm(sheets, name);
    } catch (err) {
      console.warn(
        '[import] LLM parse failed; falling back to heuristic parser:',
        err instanceof Error ? err.message : err,
      );
    }
  }
  return parseSheets(sheets, name);
}

function multerErrorResponse(error: unknown): { status: number; message: string } | null {
  if (typeof error !== 'object' || error === null) return null;
  const err = error as { code?: string };

  if (err.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, message: 'File too large. Maximum size is 5MB.' };
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return { status: 400, message: 'Only one file may be uploaded at a time.' };
  }
  return null;
}

importRouter.post('/', (req, res, next) => {
  upload.single('file')(req, res, async (error) => {
    if (error) {
      const multerError = multerErrorResponse(error);
      if (multerError) {
        res.status(multerError.status).json({ error: multerError.message });
        return;
      }
      next(error);
      return;
    }

    try {
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      let sheets;
      try {
        sheets = readSpreadsheetBuffer(file.buffer);
      } catch {
        res.status(400).json({ error: 'Unable to read the uploaded file. Please upload a CSV or XLSX spreadsheet.' });
        return;
      }

      const baseName = file.originalname.replace(/\.[^.]+$/, '') || 'Imported Board';
      const result = await parseImport(sheets, baseName);

      if (!hasBoardContent(result.board)) {
        res.status(400).json({ error: 'No usable spreadsheet content was found.' });
        return;
      }

      res.json(result);
    } catch (handlerError) {
      next(handlerError);
    }
  });
});
