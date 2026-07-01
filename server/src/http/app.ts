import express from 'express';
import { boardRouter } from './boards.js';
import { healthRouter } from './health.js';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use('/api/health', healthRouter);
  app.use('/api/boards', boardRouter);

  return app;
}
