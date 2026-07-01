import { Router } from 'express';
import { z } from 'zod';
import { GameEngine } from '../engine/game.js';
import { formatZodError, validate } from './validation.js';

const createGameSchema = z.object({
  boardId: z.string().min(1, 'Board ID is required'),
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
      if (error instanceof Error && error.message === 'Board not found') {
        res.status(404).json({ error: 'Board not found' });
        return;
      }
      next(error);
    }
  });

  return router;
}
