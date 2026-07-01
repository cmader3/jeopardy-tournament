import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { mintHostToken } from '../auth/token.js';

const correctPasscode = process.env.HOST_PASSCODE ?? 'jeopardy-test';

describe('POST /api/auth/host', () => {
  it('returns a server-signed token for the correct passcode', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/auth/host')
      .send({ passcode: correctPasscode })
      .expect(200);

    expect(response.body.token).toBeDefined();
    expect(typeof response.body.token).toBe('string');

    const token = response.body.token as string;
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body).toEqual({ role: 'host' });
  });

  it('returns 401 for an incorrect passcode', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/auth/host')
      .send({ passcode: 'wrong-passcode' })
      .expect(401);

    expect(response.body.error).toBe('Incorrect passcode');
  });

  it('returns 400 for a missing or empty passcode', async () => {
    const app = createApp();

    const missing = await request(app).post('/api/auth/host').send({}).expect(400);
    expect(missing.body.error).toBe('Passcode is required');

    const empty = await request(app).post('/api/auth/host').send({ passcode: '' }).expect(400);
    expect(empty.body.error).toBe('Passcode is required');
  });

  it('never sends the passcode in the URL', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/auth/host')
      .send({ passcode: correctPasscode });

    expect(response.status).toBe(200);
    expect(response.req.path).toBe('/api/auth/host');
  });
});

describe('GET /api/auth/me', () => {
  it('returns 200 for a valid token', async () => {
    const app = createApp();
    const token = mintHostToken();
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({ role: 'host' });
  });

  it('returns 401 for a missing token', async () => {
    const app = createApp();
    const response = await request(app).get('/api/auth/me').expect(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('returns 401 for a forged token', async () => {
    const app = createApp();
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer forged-token')
      .expect(401);

    expect(response.body.error).toBe('Unauthorized');
  });
});
