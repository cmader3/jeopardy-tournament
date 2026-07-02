import { loadServerEnv } from './env.js';

loadServerEnv();

if (!process.env.HOST_PASSCODE) {
  process.env.HOST_PASSCODE = 'jeopardy-test';
}

if (!process.env.TOKEN_SECRET) {
  process.env.TOKEN_SECRET = '*************************************';
}

const workerId = process.env.VITEST_WORKER_ID ?? process.pid;
process.env.DATABASE_URL = `file:./test-${workerId}.db`;
