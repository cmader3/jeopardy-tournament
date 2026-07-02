import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { closeTestServer, createTestServer, TestServer } from './test-server.js';

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer();
});

afterAll(async () => {
  await closeTestServer(testServer.server);
});

describe('GET /api/health', () => {
  it('returns a liveness response', async () => {
    const response = await request(testServer.server).get('/api/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', service: 'jeopardy-server' });
  });
});
