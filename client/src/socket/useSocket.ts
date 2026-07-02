import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { JoinPayload } from '@jeopardy/shared';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export interface SocketState<T> {
  connected: boolean;
  error: string | null;
  data: T | null;
  startGame?: () => void;
  leaveGame?: () => void;
  selectClue?: (clueId: string) => void;
  revealAnswer?: () => void;
  armBuzzers?: () => void;
  buzz?: (playerId: string) => void;
  ruleCorrect?: () => void;
  ruleIncorrect?: (playerId: string) => void;
  adjustScore?: (playerId: string, score: number) => void;
  undoLastRuling?: () => void;
  submitDDWager?: (amount: number) => void;
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
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  const onStateRef = useRef(onState);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    onStateRef.current = onState;
  });

  useEffect(() => {
    if (!roomCode) {
      return;
    }

    const payload: JoinPayload = { role, roomCode, name, reconnectToken, hostToken };
    const socket = io(API_BASE_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setError(null);
      socket.emit('join', payload);
    });

    socket.on('disconnect', () => {
      setConnected(false);
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
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [role, roomCode, name, reconnectToken, hostToken]);

  const startGame = useCallback(() => {
    socketRef.current?.emit('start_game');
  }, []);

  const leaveGame = useCallback(() => {
    socketRef.current?.emit('leave');
  }, []);

  const selectClue = useCallback((clueId: string) => {
    socketRef.current?.emit('select_clue', { clueId });
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

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { connected, error, data, startGame, leaveGame, selectClue, revealAnswer, armBuzzers, buzz, ruleCorrect, ruleIncorrect, adjustScore, undoLastRuling, submitDDWager, clearError };
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
