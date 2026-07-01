import { loadServerEnv } from './env.js';

loadServerEnv();

if (!process.env.HOST_PASSCODE) {
  process.env.HOST_PASSCODE = 'jeopardy-test';
}

if (!process.env.TOKEN_SECRET) {
  process.env.TOKEN_SECRET = 'test-token-secret-32-bytes-long-12345';
}

import { beforeEach } from 'vitest';
import { prisma } from './repo/prisma.js';

beforeEach(async () => {
  await prisma.$transaction([
    prisma.clue.deleteMany(),
    prisma.category.deleteMany(),
    prisma.round.deleteMany(),
    prisma.player.deleteMany(),
    prisma.gameSession.deleteMany(),
    prisma.board.deleteMany(),
  ]);
});
