import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mintHostToken } from '../auth/token.js';
import { closeTestServer, createTestServer, TestServer } from './test-server.js';

const correctPasscode = process.env.HOST_PASSCODE ?? 'jeopardy-test';

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer();
});

afterAll(async () => {
  await closeTestServer(testServer.server);
});

describe('POST /api/auth/host', () => {
  it('returns a server-signed token for the correct passcode', async () => {
    const response = await request(testServer.server)
      .post('/api/auth/host')
      .send({ passcode: correctPasscode })
      .expect(200);

    expect(response.body.token).toBeDefined();
    expect(typeof response.body.token).toBe('string');

    const token = response.body.token as string;
    const me = await request(testServer.server).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body).toEqual({ role: 'host' });
  });

  it('returns 401 for an incorrect passcode', async () => {
    const response = await request(testServer.server)
      .post('/api/auth/host')
      .send({ passcode: 'wrong-passcode' })
      .expect(401);

    expect(response.body.error).toBe('Incorrect passcode');
  });

  it('returns 400 for a missing or empty passcode', async () => {
    const missing = await request(testServer.server).post('/api/auth/host').send({}).expect(400);
    expect(missing.body.error).toBe('Passcode is required');

    const empty = await request(testServer.server).post('/api/auth/host').send({ passcode: '' }).expect(400);
    expect(empty.body.error).toBe('Passcode is required');
  });

  it('never sends the passcode in the URL', async () => {
    const response = await request(testServer.server)
      .post('/api/auth/host')
      .send({ passcode: correctPasscode });

    expect(response.status).toBe(200);
    expect(response.req.path).toBe('/api/auth/host');
  });
});

describe('GET /api/auth/me', () => {
  it('returns 200 for a valid token', async () => {
    const token = mintHostToken();
    const response = await request(testServer.server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({ role: 'host' });
  });

  it('returns 401 for a missing token', async () => {
    const response = await request(testServer.server).get('/api/auth/me').expect(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('returns 401 for a forged token', async () => {
    const response = await request(testServer.server)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer forged-token')
      .expect(401);

    expect(response.body.error).toBe('Unauthorized');
  });
});
