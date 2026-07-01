import { useState } from 'react';
import { useSocket, getStoredContestantToken } from '../socket/useSocket.js';
import type { ContestantView } from '@jeopardy/shared';

interface ContestantLobbyProps {
  roomCode: string;
  name: string;
  onTryAgain: () => void;
}

function ContestantLobby({ roomCode, name, onTryAgain }: ContestantLobbyProps) {
  const token = getStoredContestantToken();
  const reconnectToken = token?.roomCode === roomCode ? token.reconnectToken : undefined;
  const socket = useSocket<ContestantView>('contestant', roomCode, undefined, name, reconnectToken);

  const gameState = socket.data;
  const me = gameState?.players.find((p) => p.id === gameState?.playerId);

  return (
    <main className="route-stub">
      <h1>Play</h1>
      <p className="room-code" data-testid="room-code">
        Room Code: {roomCode}
      </p>
      {socket.error && (
        <div className="error" role="alert">
          <p>{socket.error}</p>
          <button type="button" onClick={onTryAgain}>
            Try Again
          </button>
        </div>
      )}
      {!socket.error && gameState && (
        <div className="contestant-state">
          <p>Welcome, {me?.name ?? name}</p>
          <p>Score: {me?.score ?? 0}</p>
          {gameState.phase === 'LOBBY' ? (
            <p>Waiting for the host to start the game.</p>
          ) : (
            <p>Phase: {gameState.phase}</p>
          )}
        </div>
      )}
      {!socket.error && !gameState && <p>Joining...</p>}
    </main>
  );
}

export function PlayRoute() {
  const [roomCode, setRoomCode] = useState('');
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const trimmedRoomCode = roomCode.trim().toUpperCase();
  const trimmedName = name.trim();
  const canSubmit = roomCode.length > 0 && name.length > 0;

  if (submitted) {
    const handleTryAgain = () => {
      setSubmitted(false);
      setName('');
    };
    return <ContestantLobby roomCode={trimmedRoomCode} name={trimmedName} onTryAgain={handleTryAgain} />;
  }

  return (
    <main className="route-stub">
      <h1>Join Game</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmedRoomCode) {
            setValidationError('Room code is required');
            return;
          }
          if (!trimmedName) {
            setValidationError('Name is required');
            return;
          }
          setValidationError(null);
          setSubmitted(true);
        }}
      >
        {validationError && (
          <p className="error" role="alert">
            {validationError}
          </p>
        )}
        <label htmlFor="play-room-code">Room Code</label>
        <input
          id="play-room-code"
          value={roomCode}
          onChange={(e) => {
            setRoomCode(e.target.value);
            setValidationError(null);
          }}
          placeholder="ABCD"
        />
        <label htmlFor="play-name">Your Name</label>
        <input
          id="play-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setValidationError(null);
          }}
          placeholder="Your name"
        />
        <button type="submit" disabled={!canSubmit}>
          Join Game
        </button>
      </form>
    </main>
  );
}
