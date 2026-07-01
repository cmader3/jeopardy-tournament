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
