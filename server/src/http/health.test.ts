import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

describe('GET /api/health', () => {
  it('returns a liveness response', async () => {
    const app = createApp();
    const response = await request(app).get('/api/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', service: 'jeopardy-server' });
  });
});
