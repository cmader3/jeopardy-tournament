import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { boardRouter } from './boards.js';
import { healthRouter } from './health.js';
import { authRouter } from './auth.js';
import { requireHost } from '../auth/middleware.js';
import { createGamesRouter } from './games.js';
import { GameEngine } from '../engine/game.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(engine: GameEngine = new GameEngine()) {
  const app = express();

  app.use(express.json());
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/boards', requireHost, boardRouter);
  app.use('/api/games', requireHost, createGamesRouter(engine));

  // Serve static client files in production
  const clientDist = join(__dirname, '../../../client/dist');
  if (process.env.NODE_ENV === 'production' && existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(join(clientDist, 'index.html'));
    });
  }

  return app;
}
