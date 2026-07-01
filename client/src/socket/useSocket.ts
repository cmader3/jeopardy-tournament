import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { JoinPayload } from '@jeopardy/shared';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export interface SocketState<T> {
  connected: boolean;
  error: string | null;
  data: T | null;
}

export function useSocket<T>(
  role: JoinPayload['role'],
  roomCode: string,
  onState: (state: T) => void,
  name?: string,
  reconnectToken?: string,
  hostToken?: string,
): SocketState<T> {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  const onStateRef = useRef(onState);

  useEffect(() => {
    onStateRef.current = onState;
  });

  useEffect(() => {
    const payload: JoinPayload = { role, roomCode, name, reconnectToken, hostToken };
    const socket = io(API_BASE_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

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
      onStateRef.current(state);
    });

    socket.on('error', (err: { message?: string }) => {
      setError(err.message ?? 'Socket error');
    });

    socket.on('token', (token: { reconnectToken: string; playerId: string }) => {
      localStorage.setItem('jeopardy-contestant-token', JSON.stringify(token));
    });

    return () => {
      socket.disconnect();
    };
  }, [role, roomCode, name, reconnectToken, hostToken]);

  return { connected, error, data };
}

export function getStoredContestantToken(): { reconnectToken: string; playerId: string } | null {
  const raw = localStorage.getItem('jeopardy-contestant-token');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { reconnectToken: string; playerId: string };
  } catch {
    return null;
  }
}

export function clearStoredContestantToken(): void {
  localStorage.removeItem('jeopardy-contestant-token');
}
