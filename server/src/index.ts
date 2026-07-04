import { loadServerEnv } from './env.js';

loadServerEnv();

import { createServer } from 'node:http';
import { createApp } from './http/app.js';
import { bootstrapSocketIO } from './sockets/index.js';
import { GameEngine } from './engine/game.js';

const port = process.env.PORT ?? 4000;

async function main() {
  const engine = new GameEngine();

  const app = createApp(engine);
  const httpServer = createServer(app);

  bootstrapSocketIO(httpServer, engine);

  httpServer.listen(Number(port), '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
  });

  await engine.loadActiveSessions().catch((error) => {
    console.error('Failed to load active sessions:', error);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
