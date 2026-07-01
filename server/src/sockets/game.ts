import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { JoinPayload } from '@jeopardy/shared';
import { GameEngine } from '../engine/game.js';
import { verifyHostToken } from '../auth/token.js';
import { generateReconnectToken } from '../utils/reconnectToken.js';
import { normalizeRoomCode } from '../utils/roomCode.js';
import { projectBoard, projectHost, projectContestant } from '@jeopardy/shared';
import type { GameState } from '@jeopardy/shared';

const joinPayloadSchema = z.object({
  role: z.enum(['host', 'board', 'contestant']),
  roomCode: z.string().min(1),
  name: z.string().optional(),
  reconnectToken: z.string().optional(),
  hostToken: z.string().optional(),
});

interface SocketMeta {
  role: 'host' | 'board' | 'contestant';
  roomCode: string;
  playerId?: string;
}

export function registerGameSockets(io: Server, engine: GameEngine) {
  engine.broadcast = (roomCode: string, state: GameState) => {
    broadcastToRoles(io, roomCode, state);
  };

  io.on('connection', (socket) => {
    socket.on('join', async (payload: JoinPayload) => {
      try {
        const result = joinPayloadSchema.safeParse(payload);
        if (!result.success) {
          socket.emit('error', { message: 'Invalid join payload' });
          return;
        }

        const data = result.data;
        const roomCode = normalizeRoomCode(data.roomCode);
        const state = engine.getState(roomCode);
        if (!state) {
          socket.emit('error', { message: 'Unknown room code' });
          return;
        }

        if (data.role === 'host') {
          await handleHostJoin(socket, data, state);
          return;
        }

        if (data.role === 'board') {
          await handleBoardJoin(socket, data, state);
          return;
        }

        await handleContestantJoin(socket, engine, data, state);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Join failed';
        socket.emit('error', { message });
      }
    });

    socket.on('start_game', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can start the game' });
        return;
      }

      try {
        const result = await engine.startGame(meta.roomCode);
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Start game failed';
        socket.emit('error', { message });
      }
    });

    socket.on('leave', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'contestant' || !meta.playerId) {
        socket.emit('error', { message: 'Only a contestant can leave' });
        return;
      }

      try {
        await engine.removePlayer(meta.roomCode, meta.playerId);
        setSocketMeta(socket, undefined);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Leave failed';
        socket.emit('error', { message });
      }
    });

    socket.on('disconnect', async () => {
      const meta = getSocketMeta(socket);
      if (!meta) return;

      if (meta.role === 'contestant' && meta.playerId) {
        try {
          await engine.disconnectPlayer(meta.roomCode, meta.playerId);
        } catch {
          // Session may already be gone; ignore.
        }
      }
    });
  });
}

async function handleHostJoin(
  socket: Socket,
  payload: z.infer<typeof joinPayloadSchema>,
  state: GameState,
) {
  if (!payload.hostToken || !verifyHostToken(payload.hostToken)) {
    socket.emit('error', { message: 'Invalid host token' });
    return;
  }

  const roomCode = normalizeRoomCode(payload.roomCode);
  await joinSessionRoom(socket, roomCode, 'host');
  setSocketMeta(socket, { role: 'host', roomCode });
  socket.emit('state', projectHost(state));
}

async function handleBoardJoin(
  socket: Socket,
  payload: z.infer<typeof joinPayloadSchema>,
  state: GameState,
) {
  const roomCode = normalizeRoomCode(payload.roomCode);
  await joinSessionRoom(socket, roomCode, 'board');
  setSocketMeta(socket, { role: 'board', roomCode });
  socket.emit('state', projectBoard(state));
}

async function handleContestantJoin(
  socket: Socket,
  engine: GameEngine,
  payload: z.infer<typeof joinPayloadSchema>,
  state: GameState,
) {
  const roomCode = normalizeRoomCode(payload.roomCode);

  if (payload.reconnectToken) {
    const player = state.players.find((p) => p.reconnectToken === payload.reconnectToken);
    if (!player) {
      socket.emit('error', { message: 'Invalid reconnect token' });
      return;
    }

    await joinSessionRoom(socket, roomCode, `contestant:${player.id}`);
    setSocketMeta(socket, { role: 'contestant', roomCode, playerId: player.id });
    await engine.reconnectPlayer(roomCode, player.id);
    return;
  }

  const name = payload.name?.trim();
  if (!name) {
    socket.emit('error', { message: 'Name is required' });
    return;
  }

  const playerId = `player-${crypto.randomUUID()}`;
  const reconnectToken = generateReconnectToken();
  const newPlayer = {
    id: playerId,
    name,
    score: 0,
    seatOrder: 0,
    connected: true,
    reconnectToken,
  };

  const result = await engine.addPlayer(roomCode, newPlayer);
  const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
  if (rejected) {
    socket.emit('error', { message: rejected.reason });
    return;
  }

  await joinSessionRoom(socket, roomCode, `contestant:${playerId}`);
  setSocketMeta(socket, { role: 'contestant', roomCode, playerId });
  socket.emit('token', { reconnectToken, playerId });
  socket.emit('state', projectContestant(result.state, playerId));
}

async function joinSessionRoom(socket: Socket, roomCode: string, role: string) {
  await socket.join(`session:${roomCode}`);
  await socket.join(`session:${roomCode}:${role}`);
}

function broadcastToRoles(io: Server, roomCode: string, state: GameState) {
  const baseRoom = `session:${roomCode}`;
  io.to(`${baseRoom}:host`).emit('state', projectHost(state));
  io.to(`${baseRoom}:board`).emit('state', projectBoard(state));
  for (const player of state.players) {
    io.to(`${baseRoom}:contestant:${player.id}`).emit('state', projectContestant(state, player.id));
  }
}

function setSocketMeta(socket: Socket, meta: SocketMeta | undefined) {
  socket.data = socket.data ?? {};
  (socket.data as { meta?: SocketMeta }).meta = meta;
}

function getSocketMeta(socket: Socket): SocketMeta | undefined {
  return (socket.data as { meta?: SocketMeta }).meta;
}
