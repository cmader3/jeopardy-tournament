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
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const agent = request.agent(server).set('Authorization', `Bearer ${mintHostToken()}`);
  return { server, agent };
}

export function closeTestServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
