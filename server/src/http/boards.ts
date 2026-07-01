import { Router } from 'express';
import { boardRepository } from '../repo/board.js';
import { createBoardSchema, formatZodError, updateBoardSchema, validate } from './validation.js';

export const boardRouter = Router();

interface PrismaErrorLike {
  code?: string;
}

function isPrismaError(error: unknown): error is PrismaErrorLike {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function isNotFoundError(error: unknown): boolean {
  return isPrismaError(error) && error.code === 'P2025';
}

function isForeignKeyError(error: unknown): boolean {
  return isPrismaError(error) && error.code === 'P2003';
}

function isUniqueConstraintError(error: unknown): boolean {
  return isPrismaError(error) && error.code === 'P2002';
}

boardRouter.get('/', async (_req, res, next) => {
  try {
    const boards = await boardRepository.findAll();
    res.json(boards);
  } catch (error) {
    next(error);
  }
});

boardRouter.get('/:id', async (req, res, next) => {
  try {
    const board = await boardRepository.findById(req.params.id);

    if (!board) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }

    res.json(board);
  } catch (error) {
    next(error);
  }
});

boardRouter.post('/', async (req, res, next) => {
  try {
    const validation = validate(createBoardSchema, req.body);

    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request body', details: formatZodError(validation.error) });
      return;
    }

    const board = await boardRepository.create(validation.data);
    res.status(201).json(board);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: 'A unique constraint was violated. Duplicate round types are not allowed.' });
      return;
    }
    next(error);
  }
});

boardRouter.put('/:id', async (req, res, next) => {
  try {
    const validation = validate(updateBoardSchema, req.body);

    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request body', details: formatZodError(validation.error) });
      return;
    }

    const board = await boardRepository.update(req.params.id, validation.data);
    res.json(board);
  } catch (error) {
    if (isNotFoundError(error)) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: 'A unique constraint was violated. Duplicate round types are not allowed.' });
      return;
    }
    next(error);
  }
});

boardRouter.delete('/:id', async (req, res, next) => {
  try {
    await boardRepository.delete(req.params.id);
    res.status(200).json({ success: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }
    if (isForeignKeyError(error)) {
      res.status(409).json({ error: 'Board is in use by an active game session and cannot be deleted' });
      return;
    }
    next(error);
  }
});
