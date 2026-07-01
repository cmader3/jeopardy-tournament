import { createServer } from 'node:http';
import { createApp } from './http/app.js';
import { bootstrapSocketIO } from './sockets/index.js';

const port = process.env.PORT ?? 4000;

const app = createApp();
const httpServer = createServer(app);

bootstrapSocketIO(httpServer);

httpServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
