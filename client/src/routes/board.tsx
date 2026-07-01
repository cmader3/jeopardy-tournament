import { useState } from 'react';
import { useSocket } from '../socket/useSocket.js';
import type { BoardView } from '@jeopardy/shared';

function BoardDisplay({ roomCode }: { roomCode: string }) {
  const [gameState, setGameState] = useState<BoardView | null>(null);
  const socket = useSocket<BoardView>('board', roomCode, setGameState);

  return (
    <main className="route-stub">
      <h1>Board</h1>
      <p className="room-code">Room Code: {roomCode}</p>
      {socket.error && <p className="error">{socket.error}</p>}
      {gameState?.players.length === 0 ? (
        <p>Waiting for players...</p>
      ) : (
        <ul className="player-list">
          {gameState?.players.map((player) => (
            <li key={player.id} className={player.connected ? 'connected' : 'disconnected'}>
              {player.name}: {player.score}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function BoardRoute() {
  const [roomCode, setRoomCode] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (submitted && roomCode.trim()) {
    return <BoardDisplay roomCode={roomCode.trim()} />;
  }

  return (
    <main className="route-stub">
      <h1>Board</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (roomCode.trim()) {
            setSubmitted(true);
          }
        }}
      >
        <label htmlFor="board-room-code">Room Code</label>
        <input
          id="board-room-code"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
          placeholder="ABCD"
        />
        <button type="submit" disabled={!roomCode.trim()}>
          View Board
        </button>
      </form>
    </main>
  );
}
