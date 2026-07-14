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

const reopenCluePayloadSchema = z.object({
  clueId: z.string().min(1),
  revertScores: z.boolean(),
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

const submitFinalWagerPayloadSchema = z.object({
  amount: z.number().int(),
});

const submitFinalAnswerPayloadSchema = z.object({
  answer: z.string(),
});

const submitFinalAnswerDraftPayloadSchema = z.object({
  answer: z.string(),
});

interface SocketMeta {
  role: 'host' | 'board' | 'contestant';
  roomCode: string;
  playerId?: string;
}

const DEFAULT_DISCONNECT_GRACE_MS = 30000;
const pendingDisconnects = new Map<string, ReturnType<typeof setTimeout>>();

function getDisconnectGraceMs(): number {
  const parsed = Number(process.env.DISCONNECT_GRACE_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DISCONNECT_GRACE_MS;
}

function contestantRoom(roomCode: string, playerId: string): string {
  return `session:${roomCode}:contestant:${playerId}`;
}

// Tell a removed player's client(s) that the removal was intentional (kicked by
// the host or a voluntary leave) so they do not attempt to reconnect, then close
// their sockets as a safety net once the event has been delivered.
function notifyPlayerRemoved(
  io: Server,
  roomCode: string,
  playerId: string,
  reason: 'kicked' | 'left',
): void {
  const room = contestantRoom(roomCode, playerId);
  io.to(room).emit('removed', { reason });
  setTimeout(() => {
    io.in(room).disconnectSockets(true);
  }, 500);
}

function disconnectKey(roomCode: string, playerId: string): string {
  return `${roomCode}:${playerId}`;
}

function cancelPendingDisconnect(roomCode: string, playerId: string): void {
  const key = disconnectKey(roomCode, playerId);
  const timer = pendingDisconnects.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingDisconnects.delete(key);
  }
}

function schedulePlayerDisconnect(engine: GameEngine, roomCode: string, playerId: string): void {
  const key = disconnectKey(roomCode, playerId);
  const existing = pendingDisconnects.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    pendingDisconnects.delete(key);
    engine.disconnectPlayer(roomCode, playerId).catch(() => {
      // Session may already be gone; ignore.
    });
  }, getDisconnectGraceMs());
  pendingDisconnects.set(key, timer);
}

export function registerGameSockets(io: Server, engine: GameEngine) {
  engine.broadcast = (roomCode: string, state: GameState) => {
    broadcastToRoles(io, roomCode, state);
  };

  io.on('connection', (socket) => {
    // Lightweight liveness probe the client uses to detect a zombie socket
    // after the tab/app resumes; simply acknowledge it.
    socket.on('health_check', (ack?: () => void) => {
      if (typeof ack === 'function') ack();
    });

    socket.on('join', async (payload: JoinPayload) => {
      try {
        const result = joinPayloadSchema.safeParse(payload);
        if (!result.success) {
          socket.emit('error', { message: 'Invalid join payload' });
          return;
        }

        const data = result.data;
        const roomCode = normalizeRoomCode(data.roomCode);
        let state = engine.getState(roomCode);
        if (!state) {
          await engine.ensureSessionLoaded(roomCode);
          state = engine.getState(roomCode);
        }
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

    socket.on('restart_game', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can restart the game' });
        return;
      }

      try {
        const result = await engine.restartGame(meta.roomCode);
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Restart game failed';
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

    socket.on('reopen_clue', async (payload: { clueId: string; revertScores: boolean }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can re-do a clue' });
        return;
      }

      const validation = reopenCluePayloadSchema.safeParse(payload);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid clue' });
        return;
      }

      try {
        const result = await engine.applyIntent(
          meta.roomCode,
          { type: 'REOPEN_CLUE', clueId: validation.data.clueId, revertScores: validation.data.revertScores },
          { now: Date.now() },
        );
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Re-do clue failed';
        socket.emit('error', { message });
      }
    });

    socket.on('remove_player', async (payload: { playerId: string }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can remove a player' });
        return;
      }

      const validation = rulePayloadSchema.safeParse(payload);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid player' });
        return;
      }

      try {
        const result = await engine.kickPlayer(meta.roomCode, validation.data.playerId);
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
          return;
        }
        cancelPendingDisconnect(meta.roomCode, validation.data.playerId);
        notifyPlayerRemoved(io, meta.roomCode, validation.data.playerId, 'kicked');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Remove player failed';
        socket.emit('error', { message });
      }
    });

    socket.on('admit_player', async (payload: { playerId: string }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can admit a player' });
        return;
      }

      const validation = rulePayloadSchema.safeParse(payload);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid player' });
        return;
      }

      try {
        const result = await engine.admitPlayer(meta.roomCode, validation.data.playerId);
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Admit player failed';
        socket.emit('error', { message });
      }
    });

    socket.on('set_clue_selection_mode', async (payload: { mode: 'HOST' | 'PLAYER' }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can change the clue selection mode' });
        return;
      }

      const mode = payload?.mode === 'PLAYER' ? 'PLAYER' : payload?.mode === 'HOST' ? 'HOST' : null;
      if (!mode) {
        socket.emit('error', { message: 'Invalid clue selection mode' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'SET_CLUE_SELECTION_MODE', mode }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Set clue selection mode failed';
        socket.emit('error', { message });
      }
    });

    socket.on('reveal_selected_clue', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can reveal the selected clue' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'REVEAL_SELECTED_CLUE' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Reveal selected clue failed';
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

    socket.on('submit_final_wager', async (payload: { amount: number }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'contestant' || !meta.playerId) {
        socket.emit('error', { message: 'Only a contestant can submit a Final wager' });
        return;
      }

      const validation = submitFinalWagerPayloadSchema.safeParse(payload);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid wager payload' });
        return;
      }

      try {
        const result = await engine.applyIntent(
          meta.roomCode,
          { type: 'SUBMIT_FINAL_WAGER', playerId: meta.playerId, amount: validation.data.amount },
          { now: Date.now() },
        );
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Submit Final wager failed';
        socket.emit('error', { message });
      }
    });

    socket.on('submit_final_answer', async (payload: { answer: string }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'contestant' || !meta.playerId) {
        socket.emit('error', { message: 'Only a contestant can submit a Final answer' });
        return;
      }

      const validation = submitFinalAnswerPayloadSchema.safeParse(payload);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid answer payload' });
        return;
      }

      try {
        const result = await engine.applyIntent(
          meta.roomCode,
          { type: 'SUBMIT_FINAL_ANSWER', playerId: meta.playerId, answer: validation.data.answer },
          { now: Date.now() },
        );
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Submit Final answer failed';
        socket.emit('error', { message });
      }
    });

    socket.on('submit_final_answer_draft', async (payload: { answer: string }) => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'contestant' || !meta.playerId) {
        socket.emit('error', { message: 'Only a contestant can submit a Final answer draft' });
        return;
      }

      const validation = submitFinalAnswerDraftPayloadSchema.safeParse(payload);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid answer draft payload' });
        return;
      }

      try {
        const result = await engine.applyIntent(
          meta.roomCode,
          { type: 'SUBMIT_FINAL_ANSWER_DRAFT', playerId: meta.playerId, answer: validation.data.answer },
          { now: Date.now() },
        );
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Submit Final answer draft failed';
        socket.emit('error', { message });
      }
    });

    socket.on('force_final_wagers', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can force Final wagers' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'FORCE_FINAL_WAGERS' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Force Final wagers failed';
        socket.emit('error', { message });
      }
    });

    socket.on('reveal_final_answer', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can reveal a Final answer' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'REVEAL_FINAL_ANSWER' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Reveal Final answer failed';
        socket.emit('error', { message });
      }
    });

    socket.on('rule_final_correct', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can rule a Final answer correct' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'RULE_FINAL_CORRECT' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Rule Final correct failed';
        socket.emit('error', { message });
      }
    });

    socket.on('rule_final_incorrect', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can rule a Final answer incorrect' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'RULE_FINAL_INCORRECT' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Rule Final incorrect failed';
        socket.emit('error', { message });
      }
    });

    socket.on('reveal_final_wager', async () => {
      const meta = getSocketMeta(socket);
      if (!meta || meta.role !== 'host') {
        socket.emit('error', { message: 'Only the host can reveal a Final wager' });
        return;
      }

      try {
        const result = await engine.applyIntent(meta.roomCode, { type: 'REVEAL_FINAL_WAGER' }, { now: Date.now() });
        const rejected = result.effects.find((e) => e.type === 'INTENT_REJECTED');
        if (rejected) {
          socket.emit('error', { message: rejected.reason });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Reveal Final wager failed';
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
        const { roomCode, playerId } = meta;
        await engine.removePlayer(roomCode, playerId);
        setSocketMeta(socket, undefined);
        cancelPendingDisconnect(roomCode, playerId);
        notifyPlayerRemoved(io, roomCode, playerId, 'left');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Leave failed';
        socket.emit('error', { message });
      }
    });

    socket.on('disconnect', () => {
      const meta = getSocketMeta(socket);
      if (!meta) return;

      if (meta.role === 'contestant' && meta.playerId) {
        schedulePlayerDisconnect(engine, meta.roomCode, meta.playerId);
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

    cancelPendingDisconnect(roomCode, player.id);
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
