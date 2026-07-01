import { useState } from 'react';
import { useSocket, getStoredContestantToken } from '../socket/useSocket.js';
import type { ContestantView } from '@jeopardy/shared';

function ContestantLobby({ roomCode, name }: { roomCode: string; name: string }) {
  const [gameState, setGameState] = useState<ContestantView | null>(null);
  const token = getStoredContestantToken();
  const reconnectToken = token?.roomCode === roomCode ? token.reconnectToken : undefined;
  const socket = useSocket<ContestantView>('contestant', roomCode, setGameState, name, reconnectToken);

  return (
    <main className="route-stub">
      <h1>Play</h1>
      <p className="room-code">Room Code: {roomCode}</p>
      {socket.error && <p className="error">{socket.error}</p>}
      {gameState && (
        <div className="contestant-state">
          <p>Welcome, {gameState.players.find((p) => p.id === gameState.playerId)?.name}</p>
          <p>Score: {gameState.players.find((p) => p.id === gameState.playerId)?.score}</p>
          <p>Phase: {gameState.phase}</p>
        </div>
      )}
    </main>
  );
}

export function PlayRoute() {
  const [roomCode, setRoomCode] = useState('');
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (submitted && roomCode.trim() && name.trim()) {
    return <ContestantLobby roomCode={roomCode.trim()} name={name.trim()} />;
  }

  return (
    <main className="route-stub">
      <h1>Play</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (roomCode.trim() && name.trim()) {
            setSubmitted(true);
          }
        }}
      >
        <label htmlFor="play-room-code">Room Code</label>
        <input
          id="play-room-code"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
          placeholder="ABCD"
        />
        <label htmlFor="play-name">Name</label>
        <input
          id="play-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
        />
        <button type="submit" disabled={!roomCode.trim() || !name.trim()}>
          Join Game
        </button>
      </form>
    </main>
  );
}
