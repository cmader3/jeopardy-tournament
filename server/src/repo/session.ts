import { prisma } from './prisma.js';
import { GameSessionStatus } from '@prisma/client';

export interface CreateSessionInput {
  boardId: string;
  roomCode: string;
  status: GameSessionStatus;
  snapshot: string;
}

export interface PlayerRecord {
  id: string;
  gameSessionId: string;
  name: string;
  score: number;
  seatOrder: number;
  reconnectToken: string;
  isConnected: boolean;
  joinedAt: Date;
}

export interface GameSessionWithPlayers {
  id: string;
  roomCode: string;
  boardId: string | null;
  status: GameSessionStatus;
  snapshot: string;
  createdAt: Date;
  updatedAt: Date;
  players: PlayerRecord[];
}

export interface GameSessionRepository {
  create(input: CreateSessionInput): Promise<GameSessionWithPlayers>;
  findByRoomCode(roomCode: string): Promise<GameSessionWithPlayers | null>;
  findActive(): Promise<GameSessionWithPlayers[]>;
  updateSnapshot(id: string, snapshot: string): Promise<void>;
  updateStatus(id: string, status: GameSessionStatus): Promise<void>;
}

const includePlayers = {
  players: {
    orderBy: { seatOrder: 'asc' as const },
  },
};

export const gameSessionRepository: GameSessionRepository = {
  async create(input) {
    const session = await prisma.gameSession.create({
      data: {
        boardId: input.boardId,
        roomCode: input.roomCode,
        status: input.status,
        snapshot: input.snapshot,
      },
      include: includePlayers,
    });
    return session as GameSessionWithPlayers;
  },

  async findByRoomCode(roomCode) {
    const session = await prisma.gameSession.findUnique({
      where: { roomCode },
      include: includePlayers,
    });
    return session ? (session as GameSessionWithPlayers) : null;
  },

  async findActive() {
    const sessions = await prisma.gameSession.findMany({
      where: {
        status: {
          in: [GameSessionStatus.LOBBY, GameSessionStatus.IN_PROGRESS, GameSessionStatus.FINAL],
        },
      },
      include: includePlayers,
    });
    return sessions as GameSessionWithPlayers[];
  },

  async updateSnapshot(id, snapshot) {
    await prisma.gameSession.update({
      where: { id },
      data: { snapshot },
    });
  },

  async updateStatus(id, status) {
    await prisma.gameSession.update({
      where: { id },
      data: { status },
    });
  },
};
