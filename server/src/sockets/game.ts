import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { JoinPayload } from '@jeopardy/shared';
import { GameEngine } from '../engine/game.js';
import { verifyHostToken } from '../auth/token.js';
import { constantTimeCompare } from '../auth/passcode.js';
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

const selectCluePayloadSchema = z.object({
  clueId: z.string().min(1),
});

const buzzPayloadSchema = z.object({
  playerId: z.string().min(1),
});

const rulePayloadSchema = z.object({
  playerId: z.string().min(1),
});

const adjustScorePayloadSchema = z.object({
  playerId: z.string().min(1),
  score: z.number().int(),
});

const submitDdWagerPayloadSchema = z.object({
  amount: z.number().int(),
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

    socket.on('select_clue', async (payload: { clueId: string }) => {
      const meta = getSocketMeta(socket);
      if (!meta) {
        socket.emit('error', { message: 'Not joined to a session' });
        return;
      }

      const validation = selectCluePayloadSchema.safeParse(payload);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid clue selection' });
        return;
      }

      const state = engine.getState(meta.roomCode);
      if (!state) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }

      const isHost = meta.role === 'host';
      const isController =
        meta.role === 'contestant' && meta.playerId === state.controllingPlayerId;

      if (!isHost && !isController) {
        socket.emit('error', { message: 'Only the controlling player or host can select a clue' });
        return;
      }

      try {
        const result = await engine.applyIntent(
          meta.roomCode,
          {
            type: 'SELECT_CLUE',
            clueId: validation.data.clueId,
            selectorId: isController ? meta.playerId : undefined,
            hostOverride: isHost,
          },
          { now: Date.now() },
        );
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Select clue failed';
        socket.emit('error', { message });
      }
    });

    socket.on('reveal_clue', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can reveal the Daily Double clue' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'REVEAL_CLUE' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Reveal clue failed';
        socket.emit('error', { message });
      }
    });

    socket.on('reveal_answer', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can reveal the answer' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'REVEAL_ANSWER' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Reveal answer failed';
        socket.emit('error', { message });
      }
    });

    socket.on('arm_buzzers', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can arm the buzzers' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'ARM_BUZZERS' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Arm buzzers failed';
        socket.emit('error', { message });
      }
    });

    socket.on('cancel_daily_double', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can cancel the Daily Double' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'CANCEL_DAILY_DOUBLE' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Cancel Daily Double failed';
        socket.emit('error', { message });
      }
    });

    socket.on('submit_dd_wager', async (payload: { amount: number }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'contestant' || !meta.playerId) {
        socket.emit('error', { message: 'Only the controlling contestant can submit a Daily Double wager' });
        return;
      }

      const validation = submitDdWagerPayloadSchema.safeParse(payload);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid wager payload' });
        return;
      }

      const state = engine.getState(meta.roomCode);
      if (!state) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }

      if (state.controllingPlayerId !== meta.playerId) {
        socket.emit('error', { message: 'Only the controlling contestant can submit a Daily Double wager' });
        return;
      }

      try {
        const result = await engine.applyIntent(
          meta.roomCode,
          { type: 'SUBMIT_DD_WAGER', playerId: meta.playerId, amount: validation.data.amount },
          { now: Date.now() },
        );
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Submit wager failed';
        socket.emit('error', { message });
      }
    });

    socket.on('buzz', async (payload: { playerId: string }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'contestant' || !meta.playerId) {
        socket.emit('error', { message: 'Only a contestant can buzz in' });
        return;
      }

      const validation = buzzPayloadSchema.safeParse(payload);
      if (!validation.success || validation.data.playerId !== meta.playerId) {
        socket.emit('error', { message: 'Invalid buzz payload' });
        return;
      }

      try {
        const result = await engine.applyIntent(
          meta.roomCode,
          { type: 'BUZZ', playerId: meta.playerId },
          { now: Date.now() },
        );
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Buzz failed';
        socket.emit('error', { message });
      }
    });

    socket.on('rule_correct', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can rule an answer correct' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'RULE_CORRECT' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Rule correct failed';
        socket.emit('error', { message });
      }
    });

    socket.on('rule_incorrect', async (payload: { playerId: string }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can rule an answer incorrect' });
        return;
      }

      const validation = rulePayloadSchema.safeParse(payload);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid ruling payload' });
        return;
      }

      try {
        const result = await engine.applyIntent(
          meta.roomCode,
          { type: 'RULE_INCORRECT', playerId: validation.data.playerId },
          { now: Date.now() },
        );
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Rule incorrect failed';
        socket.emit('error', { message });
      }
    });

    socket.on('advance_round', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can advance the round' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'ADVANCE_ROUND' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Advance round failed';
        socket.emit('error', { message });
      }
    });

    socket.on('open_final_wagers', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can open Final wagers' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'OPEN_FINAL_WAGERS' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Open Final wagers failed';
        socket.emit('error', { message });
      }
    });

    socket.on('override_control', async (payload: { playerId: string }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can assign control' });
        return;
      }

      const validation = z.object({ playerId: z.string().min(1) }).safeParse(payload);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid control assignment' });
        return;
      }

      try {
        const result = await engine.applyIntent(
          meta.roomCode,
          { type: 'OVERRIDE_CONTROL', playerId: validation.data.playerId },
          { now: Date.now() },
        );
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Override control failed';
        socket.emit('error', { message });
      }
    });

    socket.on('adjust_score', async (payload: { playerId: string; score: number }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can adjust scores' });
        return;
      }

      const validation = adjustScorePayloadSchema.safeParse(payload);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid score adjustment' });
        return;
      }

      try {
        const result = await engine.applyIntent(
          meta.roomCode,
          {
            type: 'ADJUST_SCORE',
            playerId: validation.data.playerId,
            score: validation.data.score,
          },
          { now: Date.now() },
        );
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Adjust score failed';
        socket.emit('error', { message });
      }
    });

    socket.on('undo_last_ruling', async (ack?: (response: { ok: true }) => void) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can undo the last ruling' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'UNDO_LAST_RULING' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
          return;
        }
        if (typeof ack === 'function') {
          ack({ ok: true });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Undo failed';
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
  socket.emit('state', projectHost(state, Date.now()));
}

async function handleBoardJoin(
  socket: Socket,
  payload: z.infer<typeof joinPayloadSchema>,
  state: GameState,
) {
  const roomCode = normalizeRoomCode(payload.roomCode);
  await joinSessionRoom(socket, roomCode, 'board');
  setSocketMeta(socket, { role: 'board', roomCode });
  socket.emit('state', projectBoard(state, Date.now()));
}

async function handleContestantJoin(
  socket: Socket,
  engine: GameEngine,
  payload: z.infer<typeof joinPayloadSchema>,
  state: GameState,
) {
  const roomCode = normalizeRoomCode(payload.roomCode);

  if (payload.reconnectToken) {
    const providedToken = payload.reconnectToken;
    const player = state.players.find((p) => constantTimeCompare(providedToken, p.reconnectToken));
    if (!player) {
      socket.emit('error', { message: 'Invalid reconnect token' });
      return;
    }

    await joinSessionRoom(socket, roomCode, `contestant:${player.id}`);
    setSocketMeta(socket, { role: 'contestant', roomCode, playerId: player.id });
    const result = await engine.reconnectPlayer(roomCode, player.id);
    // Always emit the current projection to the reconnected socket so it
    // immediately sees the latest state, even if the player was already marked
    // connected (e.g., a second tab or recovery after a server restart).
    socket.emit('state', projectContestant(result.state, player.id, Date.now()));
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
  socket.emit('state', projectContestant(result.state, playerId, Date.now()));
}

async function joinSessionRoom(socket: Socket, roomCode: string, role: string) {
  await socket.join(`session:${roomCode}`);
  await socket.join(`session:${roomCode}:${role}`);
}

function broadcastToRoles(io: Server, roomCode: string, state: GameState) {
  const now = Date.now();
  const baseRoom = `session:${roomCode}`;
  io.to(`${baseRoom}:host`).emit('state', projectHost(state, now));
  io.to(`${baseRoom}:board`).emit('state', projectBoard(state, now));
  for (const player of state.players) {
    io.to(`${baseRoom}:contestant:${player.id}`).emit('state', projectContestant(state, player.id, now));
  }
}

function setSocketMeta(socket: Socket, meta: SocketMeta | undefined) {
  socket.data = socket.data ?? {};
  (socket.data as { meta?: SocketMeta }).meta = meta;
}

function getSocketMeta(socket: Socket): SocketMeta | undefined {
  return (socket.data as { meta?: SocketMeta }).meta;
}
