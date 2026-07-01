import express from 'express';
import { boardRouter } from './boards.js';
import { healthRouter } from './health.js';
import { authRouter } from './auth.js';
import { requireHost } from '../auth/middleware.js';
import { createGamesRouter } from './games.js';
import { GameEngine } from '../engine/game.js';

export function createApp(engine: GameEngine = new GameEngine()) {
  const app = express();

  app.use(express.json());
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/boards', requireHost, boardRouter);
  app.use('/api/games', requireHost, createGamesRouter(engine));

  return app;
}
