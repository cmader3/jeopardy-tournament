import './test-db.js';

import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach } from 'vitest';
import { prisma } from './repo/prisma.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prismaBin = resolve(__dirname, '../../node_modules/.bin/prisma');

async function resetDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.clue.deleteMany(),
    prisma.category.deleteMany(),
    prisma.round.deleteMany(),
    prisma.player.deleteMany(),
    prisma.gameSession.deleteMany(),
    prisma.board.deleteMany(),
  ]);
}

beforeAll(() => {
  // Ensure this worker's isolated test database is migrated before any test in
  // the file runs. Running migrate deploy is idempotent against an existing db.
  execSync(`${prismaBin} migrate deploy`, {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
});

beforeEach(async () => {
  await resetDatabase();
});
