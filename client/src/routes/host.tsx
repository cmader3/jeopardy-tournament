import { useCallback, useEffect, useState } from 'react';
import { PasscodeGate } from '../components/PasscodeGate.js';
import { useHostAuth } from '../auth/useHostAuth.js';
import { boardApi, BoardSummary } from '../api/boards.js';
import { createGame } from '../api/games.js';
import { useSocket } from '../socket/useSocket.js';
import type { HostView } from '@jeopardy/shared';

export interface HostLobbyProps {
  roomCode: string;
  state: HostView | null;
  onStartGame: () => void;
  onCreateNewGame?: () => void;
  startError: string | null;
}

export function HostLobby({ roomCode, state, onStartGame, onCreateNewGame, startError }: HostLobbyProps) {
  const playerCount = state?.players.length ?? 0;
  const connectedCount = state?.players.filter((p) => p.connected).length ?? 0;
  const inLobby = !state || state.phase === 'LOBBY';
  const canStart = connectedCount > 0 && inLobby;

  return (
    <main className="host-lobby route-stub">
      <h1>Host Lobby</h1>
      <p className="room-code" data-testid="room-code">
        Room Code: {roomCode}
      </p>
      {startError && (
        <p className="error" role="alert">
          {startError}
        </p>
      )}
      <h2>Players</h2>
      {playerCount === 0 ? (
        <p>Waiting for players...</p>
      ) : (
        <ul className="player-list">
          {state?.players.map((player) => (
            <li key={player.id} className={player.connected ? 'connected' : 'disconnected'}>
              <span className="player-name">{player.name}</span>{' '}
              <span
                className={`player-status ${player.connected ? 'status-connected' : 'status-disconnected'}`}
                data-testid={`player-status-${player.id}`}
              >
                {player.connected ? 'connected' : 'disconnected'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!inLobby ? (
        <p className="game-started">Game started!</p>
      ) : (
        <div className="start-controls">
          <button
            type="button"
            onClick={onStartGame}
            disabled={!canStart}
            aria-disabled={!canStart}
            data-testid="start-game-button"
          >
            Start Game
          </button>
          {onCreateNewGame && (
            <button type="button" onClick={onCreateNewGame}>
              New Game
            </button>
          )}
          {connectedCount === 0 && inLobby && (
            <p className="minimum-players">At least one connected contestant is required to start.</p>
          )}
        </div>
      )}
    </main>
  );
}

const HOST_ROOM_KEY = 'jeopardy-host-room';

export function HostContent() {
  const { token } = useHostAuth();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(() => localStorage.getItem(HOST_ROOM_KEY));
  const [loadingBoards, setLoadingBoards] = useState(() => Boolean(token && !roomCode));
  const [gameState, setGameState] = useState<HostView | null>(null);

  useEffect(() => {
    if (!token || roomCode) return;
    boardApi
      .getBoards(token)
      .then(setBoards)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load boards'))
      .finally(() => setLoadingBoards(false));
  }, [token, roomCode]);

  const handleCreate = useCallback(
    async (boardId: string) => {
      if (!token) return;
      try {
        const result = await createGame(boardId, token);
        localStorage.setItem(HOST_ROOM_KEY, result.roomCode);
        setRoomCode(result.roomCode);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create game');
      }
    },
    [token, setRoomCode, setError],
  );

  const handleCreateNewGame = useCallback(() => {
    localStorage.removeItem(HOST_ROOM_KEY);
    setRoomCode(null);
    setGameState(null);
    setLoadingBoards(true);
  }, [setRoomCode, setGameState, setLoadingBoards]);

  const hostSocket = useSocket<HostView>('host', roomCode ?? '', setGameState, undefined, undefined, token ?? '');
  const handleStartGame = useCallback(() => {
    hostSocket.startGame?.();
  }, [hostSocket]);

  if (roomCode) {
    return (
      <HostLobby
        roomCode={roomCode}
        state={gameState}
        onStartGame={handleStartGame}
        onCreateNewGame={handleCreateNewGame}
        startError={hostSocket.error}
      />
    );
  }

  if (loadingBoards) {
    return <main className="route-stub"><p>Loading boards...</p></main>;
  }

  if (error) {
    return <main className="route-stub"><p className="error">{error}</p></main>;
  }

  return (
    <main className="route-stub">
      <h1>Host</h1>
      <p>Select a board to create a game.</p>
      {boards.length === 0 ? (
        <p>No boards available. Create one in Admin.</p>
      ) : (
        <ul className="board-list">
          {boards.map((board) => (
            <li key={board.id}>
              <button
                type="button"
                onClick={() => handleCreate(board.id)}
                disabled={!board.isComplete}
                title={board.isComplete ? undefined : 'This board is incomplete and cannot be used to start a game'}
              >
                {board.name} {board.isComplete ? '' : '(incomplete)'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function HostRoute() {
  return (
    <PasscodeGate>
      <HostContent />
    </PasscodeGate>
  );
}
