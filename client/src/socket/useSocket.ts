import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { JoinPayload } from '@jeopardy/shared';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:4000');

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'removed';

export type RemovedReason = 'kicked' | 'left';

export interface SocketState<T> {
  connected: boolean;
  status: SocketStatus;
  removedReason: RemovedReason | null;
  error: string | null;
  data: T | null;
  startGame?: () => void;
  restartGame?: () => void;
  leaveGame?: () => void;
  removePlayer?: (playerId: string) => void;
  selectClue?: (clueId: string) => void;
  reopenClue?: (clueId: string, revertScores: boolean) => void;
  setClueSelectionMode?: (mode: 'HOST' | 'PLAYER') => void;
  revealSelectedClue?: () => void;
  revealClue?: () => void;
  revealAnswer?: () => void;
  armBuzzers?: () => void;
  buzz?: (playerId: string) => void;
  ruleCorrect?: () => void;
  ruleIncorrect?: (playerId: string) => void;
  adjustScore?: (playerId: string, score: number) => void;
  undoLastRuling?: () => void;
  submitDDWager?: (amount: number) => void;
  submitFinalWager?: (amount: number) => void;
  submitFinalAnswer?: (answer: string) => void;
  submitFinalAnswerDraft?: (answer: string) => void;
  forceFinalWagers?: () => void;
  cancelDailyDouble?: () => void;
  advanceRound?: () => void;
  openFinalWagers?: () => void;
  overrideControl?: (playerId: string) => void;
  revealFinalAnswer?: () => void;
  ruleFinalCorrect?: () => void;
  ruleFinalIncorrect?: () => void;
  revealFinalWager?: () => void;
  clearError?: () => void;
}

export function useSocket<T>(
  role: JoinPayload['role'],
  roomCode: string,
  onState?: (state: T) => void,
  name?: string,
  reconnectToken?: string,
  hostToken?: string,
): SocketState<T> {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [removedReason, setRemovedReason] = useState<RemovedReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  const onStateRef = useRef(onState);
  const socketRef = useRef<Socket | null>(null);
  const reconnectTokenRef = useRef<string | undefined>(reconnectToken);
  const intentionalRef = useRef(false);

  useEffect(() => {
    onStateRef.current = onState;
  });

  useEffect(() => {
    reconnectTokenRef.current = reconnectToken;
  }, [reconnectToken]);

  useEffect(() => {
    if (!roomCode) {
      return;
    }

    intentionalRef.current = false;
    setStatus('connecting');
    setRemovedReason(null);

    const socket = io(API_BASE_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      randomizationFactor: 0.5,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setStatus('connected');
      setError(null);
      const payload: JoinPayload = {
        role,
        roomCode,
        name,
        reconnectToken: reconnectTokenRef.current,
        hostToken,
      };
      socket.emit('join', payload);
    });

    socket.on('disconnect', (reason: string) => {
      setConnected(false);
      if (intentionalRef.current || reason === 'io client disconnect') {
        return;
      }
      setStatus('reconnecting');
      // Socket.IO does not auto-reconnect when the server initiates the
      // disconnect (e.g. a deploy or restart), so trigger it manually.
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });

    socket.on('removed', (payload: { reason?: RemovedReason }) => {
      intentionalRef.current = true;
      setRemovedReason(payload?.reason === 'kicked' ? 'kicked' : 'left');
      setStatus('removed');
      setConnected(false);
      clearStoredContestantToken();
      socket.disconnect();
    });

    socket.on('state', (state: T) => {
      setData(state);
      onStateRef.current?.(state);
    });

    socket.on('error', (err: { message?: string }) => {
      setError(err.message ?? 'Socket error');
    });

    socket.on('token', (token: { reconnectToken: string; playerId: string }) => {
      localStorage.setItem('jeopardy-contestant-token', JSON.stringify({ ...token, roomCode }));
      reconnectTokenRef.current = token.reconnectToken;
    });

    // Proactively recover the connection when the device comes back online or
    // the tab becomes visible again (covers mobile lock-screen / backgrounding,
    // where the socket often dies silently and would otherwise sit as a zombie).
    const attemptResume = () => {
      const current = socketRef.current;
      if (!current || intentionalRef.current) return;
      if (!current.connected) {
        current.connect();
        return;
      }
      current.timeout(3000).emit('health_check', (err: unknown) => {
        if (err && !intentionalRef.current) {
          current.disconnect();
          current.connect();
        }
      });
    };

    const handleOnline = () => attemptResume();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') attemptResume();
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      intentionalRef.current = true;
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [role, roomCode, name, reconnectToken, hostToken]);

  const startGame = useCallback(() => {
    socketRef.current?.emit('start_game');
  }, []);

  const restartGame = useCallback(() => {
    socketRef.current?.emit('restart_game');
  }, []);

  const leaveGame = useCallback(() => {
    intentionalRef.current = true;
    socketRef.current?.emit('leave');
  }, []);

  const removePlayer = useCallback((playerId: string) => {
    socketRef.current?.emit('remove_player', { playerId });
  }, []);

  const selectClue = useCallback((clueId: string) => {
    socketRef.current?.emit('select_clue', { clueId });
  }, []);

  const reopenClue = useCallback((clueId: string, revertScores: boolean) => {
    socketRef.current?.emit('reopen_clue', { clueId, revertScores });
  }, []);

  const setClueSelectionMode = useCallback((mode: 'HOST' | 'PLAYER') => {
    socketRef.current?.emit('set_clue_selection_mode', { mode });
  }, []);

  const revealSelectedClue = useCallback(() => {
    socketRef.current?.emit('reveal_selected_clue');
  }, []);

  const revealClue = useCallback(() => {
    socketRef.current?.emit('reveal_clue');
  }, []);

  const revealAnswer = useCallback(() => {
    socketRef.current?.emit('reveal_answer');
  }, []);

  const armBuzzers = useCallback(() => {
    socketRef.current?.emit('arm_buzzers');
  }, []);

  const buzz = useCallback((playerId: string) => {
    socketRef.current?.emit('buzz', { playerId });
  }, []);

  const ruleCorrect = useCallback(() => {
    socketRef.current?.emit('rule_correct');
  }, []);

  const ruleIncorrect = useCallback((playerId: string) => {
    socketRef.current?.emit('rule_incorrect', { playerId });
  }, []);

  const adjustScore = useCallback((playerId: string, score: number) => {
    socketRef.current?.emit('adjust_score', { playerId, score });
  }, []);

  const undoLastRuling = useCallback(() => {
    socketRef.current?.emit('undo_last_ruling');
  }, []);

  const submitDDWager = useCallback((amount: number) => {
    socketRef.current?.emit('submit_dd_wager', { amount });
  }, []);

  const submitFinalWager = useCallback((amount: number) => {
    socketRef.current?.emit('submit_final_wager', { amount });
  }, []);

  const submitFinalAnswer = useCallback((answer: string) => {
    socketRef.current?.emit('submit_final_answer', { answer });
  }, []);

  const submitFinalAnswerDraft = useCallback((answer: string) => {
    socketRef.current?.emit('submit_final_answer_draft', { answer });
  }, []);

  const forceFinalWagers = useCallback(() => {
    socketRef.current?.emit('force_final_wagers');
  }, []);

  const cancelDailyDouble = useCallback(() => {
    socketRef.current?.emit('cancel_daily_double');
  }, []);

  const advanceRound = useCallback(() => {
    socketRef.current?.emit('advance_round');
  }, []);

  const openFinalWagers = useCallback(() => {
    socketRef.current?.emit('open_final_wagers');
  }, []);

  const overrideControl = useCallback((playerId: string) => {
    socketRef.current?.emit('override_control', { playerId });
  }, []);

  const revealFinalAnswer = useCallback(() => {
    socketRef.current?.emit('reveal_final_answer');
  }, []);

  const ruleFinalCorrect = useCallback(() => {
    socketRef.current?.emit('rule_final_correct');
  }, []);

  const ruleFinalIncorrect = useCallback(() => {
    socketRef.current?.emit('rule_final_incorrect');
  }, []);

  const revealFinalWager = useCallback(() => {
    socketRef.current?.emit('reveal_final_wager');
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { connected, status, removedReason, error, data, startGame, restartGame, leaveGame, removePlayer, selectClue, reopenClue, setClueSelectionMode, revealSelectedClue, revealClue, revealAnswer, armBuzzers, buzz, ruleCorrect, ruleIncorrect, adjustScore, undoLastRuling, submitDDWager, submitFinalWager, submitFinalAnswer, submitFinalAnswerDraft, forceFinalWagers, cancelDailyDouble, advanceRound, openFinalWagers, overrideControl, revealFinalAnswer, ruleFinalCorrect, ruleFinalIncorrect, revealFinalWager, clearError };
}

export function getStoredContestantToken(): {
  reconnectToken: string;
  playerId: string;
  roomCode?: string;
} | null {
  const raw = localStorage.getItem('jeopardy-contestant-token');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { reconnectToken: string; playerId: string; roomCode?: string };
  } catch {
    return null;
  }
}

export function clearStoredContestantToken(): void {
  localStorage.removeItem('jeopardy-contestant-token');
}
