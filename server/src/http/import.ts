import { Router } from 'express';
import multer from 'multer';
import { readSpreadsheetBuffer } from '../importer/reader.js';
import { parseSheets } from '../importer/parser.js';
import type { CreateBoardInput } from '../repo/board.js';

const upload = multer({ storage: multer.memoryStorage() });

export const importRouter = Router();

function hasBoardContent(board: CreateBoardInput): boolean {
  return board.rounds.some((round) =>
    round.categories.some((category) =>
      category.clues.some((clue) => clue.clueText.trim() !== '' || clue.answer.trim() !== ''),
    ),
  );
}

importRouter.post('/', upload.single('file'), (req, res, next) => {
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
    const result = parseSheets(sheets, baseName);

    if (!hasBoardContent(result.board)) {
      res.status(400).json({ error: 'No usable spreadsheet content was found.' });
      return;
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});
