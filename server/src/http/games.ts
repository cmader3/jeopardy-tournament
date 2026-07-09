import { Router } from 'express';
import { z } from 'zod';
import { GameEngine, BoardEmptyError, SessionNotFoundError } from '../engine/game.js';
import { formatZodError, validate } from './validation.js';

const createGameSchema = z.object({
  boardId: z.string().min(1, 'Board ID is required'),
});

const archiveGameSchema = z.object({
  archived: z.boolean(),
});

export function createGamesRouter(engine: GameEngine): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const validation = validate(createGameSchema, req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Invalid request body', details: formatZodError(validation.error) });
        return;
      }

      const result = await engine.createSession(validation.data.boardId);
      res.status(201).json({ roomCode: result.roomCode });
    } catch (error) {
      if (error instanceof BoardEmptyError) {
        res.status(400).json({ error: 'Board has no playable clues' });
        return;
      }
      if (error instanceof Error && error.message === 'Board not found') {
        res.status(404).json({ error: 'Board not found' });
        return;
      }
      next(error);
    }
  });

  router.get('/', async (_req, res, next) => {
    try {
      const games = await engine.listSessions();
      res.json({ games });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:roomCode', async (req, res, next) => {
    try {
      const validation = validate(archiveGameSchema, req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Invalid request body', details: formatZodError(validation.error) });
        return;
      }

      await engine.setArchived(req.params.roomCode, validation.data.archived);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }
      next(error);
    }
  });

  router.delete('/:roomCode', async (req, res, next) => {
    try {
      await engine.deleteSession(req.params.roomCode);
      res.status(204).end();
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }
      next(error);
    }
  });

  return router;
}
