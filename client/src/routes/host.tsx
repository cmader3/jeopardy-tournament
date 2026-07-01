import { useCallback, useEffect, useState } from 'react';
import { PasscodeGate } from '../components/PasscodeGate.js';
import { useHostAuth } from '../auth/useHostAuth.js';
import { boardApi, BoardSummary } from '../api/boards.js';
import { createGame } from '../api/games.js';
import { useSocket } from '../socket/useSocket.js';
import type { HostView } from '@jeopardy/shared';

function HostContent() {
  const { token } = useHostAuth();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [gameState, setGameState] = useState<HostView | null>(null);

  useEffect(() => {
    if (!token) return;
    boardApi
      .getBoards(token)
      .then(setBoards)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load boards'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleCreate = useCallback(
    async (boardId: string) => {
      if (!token) return;
      try {
        const result = await createGame(boardId, token);
        setRoomCode(result.roomCode);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create game');
      }
    },
    [token],
  );

  const hostSocket = useSocket<HostView>('host', roomCode ?? '', setGameState, undefined, undefined, token ?? '');

  if (loading) {
    return <main className="route-stub"><p>Loading boards...</p></main>;
  }

  if (error && !roomCode) {
    return <main className="route-stub"><p className="error">{error}</p></main>;
  }

  if (!roomCode) {
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
                <button type="button" onClick={() => handleCreate(board.id)}>
                  {board.name} {board.isComplete ? '' : '(incomplete)'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  return (
    <main className="route-stub">
      <h1>Host Lobby</h1>
      <p className="room-code">Room Code: {roomCode}</p>
      {hostSocket.error && <p className="error">{hostSocket.error}</p>}
      <h2>Players</h2>
      {gameState?.players.length === 0 ? (
        <p>Waiting for players...</p>
      ) : (
        <ul className="player-list">
          {gameState?.players.map((player) => (
            <li key={player.id} className={player.connected ? 'connected' : 'disconnected'}>
              {player.name} {player.connected ? '(connected)' : '(disconnected)'}
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
