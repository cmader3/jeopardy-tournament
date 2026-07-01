import { loadServerEnv } from './env.js';

loadServerEnv();

import { createServer } from 'node:http';
import { createApp } from './http/app.js';
import { bootstrapSocketIO } from './sockets/index.js';
import { GameEngine } from './engine/game.js';

const port = process.env.PORT ?? 4000;

async function main() {
  const engine = new GameEngine();
  await engine.loadActiveSessions();

  const app = createApp(engine);
  const httpServer = createServer(app);

  bootstrapSocketIO(httpServer, engine);

  httpServer.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
