import express from 'express';
import { boardRouter } from './boards.js';
import { healthRouter } from './health.js';
import { authRouter } from './auth.js';
import { requireHost } from '../auth/middleware.js';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/boards', requireHost, boardRouter);

  return app;
}
