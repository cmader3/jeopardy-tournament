import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerEnv } from './env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

loadServerEnv();

if (!process.env.HOST_PASSCODE) {
  process.env.HOST_PASSCODE = 'jeopardy-test';
}

if (!process.env.TOKEN_SECRET) {
  process.env.TOKEN_SECRET = '*************************************';
}

const workerId = process.env.VITEST_WORKER_ID ?? process.pid;
process.env.DATABASE_URL = `file:./test-${workerId}.db`;

const globalState = globalThis as typeof globalThis & {
  __testDbMigrated?: boolean;
};

if (!globalState.__testDbMigrated) {
  const prismaBin = resolve(__dirname, '../../node_modules/.bin/prisma');
  execSync(`${prismaBin} migrate deploy`, {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
  globalState.__testDbMigrated = true;
}
