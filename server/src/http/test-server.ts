import { createServer, Server } from 'node:http';
import request from 'supertest';
import { createApp } from './app.js';
import { mintHostToken } from '../auth/token.js';

export interface TestServer {
  server: Server;
  agent: request.Agent;
}

export async function createTestServer(): Promise<TestServer> {
  const app = createApp();
  const server = createServer(app);

  // Ensure the server is fully bound and listening before any request is
  // issued. This eliminates the race where a supertest request is sent before
  // the HTTP server can accept connections.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Server did not bind to a network port');
  }

  // Force a fresh TCP connection for every request. Without this, Node's default
  // keep-alive behaviour can reuse a socket that was closed by a previous
  // per-file server teardown, which produces the intermittent supertest
  // "Parse Error: Expected HTTP/" failure on the first full-suite run.
  const agent = request
    .agent(server)
    .set('Authorization', `Bearer ${mintHostToken()}`)
    .set('Connection', 'close');

  return { server, agent };
}

export function closeTestServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    // Forcibly close any open connections so the server teardown completes
    // promptly and no stale keep-alive sockets are left for the next test file.
    server.closeAllConnections();
  });
}
