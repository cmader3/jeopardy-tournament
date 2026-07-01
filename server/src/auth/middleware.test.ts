import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../http/app.js';
import { mintHostToken } from './token.js';

describe('requireHost middleware', () => {
  it('rejects GET /api/boards with no Authorization header', async () => {
    const app = createApp();
    const response = await request(app).get('/api/boards').expect(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('rejects a malformed Authorization header', async () => {
    const app = createApp();
    const response = await request(app)
      .get('/api/boards')
      .set('Authorization', 'Basic abc123')
      .expect(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('rejects a forged bearer token', async () => {
    const app = createApp();
    const response = await request(app)
      .get('/api/boards')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('allows GET /api/boards with a valid token', async () => {
    const app = createApp();
    const token = mintHostToken();
    const response = await request(app)
      .get('/api/boards')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toEqual([]);
  });
});
