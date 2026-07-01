import { useState } from 'react';
import {
  useSocket,
  getStoredContestantToken,
  clearStoredContestantToken,
} from '../socket/useSocket.js';
import type { ContestantView } from '@jeopardy/shared';

interface JoinForm {
  roomCode: string;
  name: string;
  submitted: boolean;
}

interface ContestantLobbyProps {
  roomCode: string;
  name: string;
  onLeave: () => void;
  onTryAgain: () => void;
}

function ContestantGrid({
  state,
  onSelectClue,
}: {
  state: ContestantView;
  onSelectClue?: (clueId: string) => void;
}) {
  if (!state.round) return <p>No active round.</p>;

  const maxRow = Math.max(0, ...state.round.categories.flatMap((c) => c.clues.map((clue) => clue.row)));
  const rows = Array.from({ length: maxRow + 1 }, (_, i) => i);
  const canSelect = state.isControllingPlayer;

  return (
    <div
      className="contestant-grid"
      data-testid="contestant-grid"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${state.round.categories.length}, 1fr)`, gap: '0.5rem' }}
    >
      {state.round.categories.map((category) => (
        <div key={category.id} className="contestant-category-header" data-testid="contestant-category-header">
          {category.title}
        </div>
      ))}
      {rows.map((row) =>
        state.round!.categories.map((category) => {
          const clue = category.clues.find((c) => c.row === row);
          if (!clue) return <div key={`${category.id}-${row}`} className="contestant-cell" />;
          const used = state.usedClueIds.includes(clue.id);
          return (
            <button
              key={clue.id}
              type="button"
              className="contestant-cell"
              data-testid={used ? 'contestant-used-cell' : 'contestant-clue-cell'}
              data-clue-id={clue.id}
              disabled={used || !canSelect}
              onClick={() => onSelectClue?.(clue.id)}
            >
              {used ? '' : `$${clue.value}`}
            </button>
          );
        }),
      )}
    </div>
  );
}

function ContestantLobby({ roomCode, name, onLeave, onTryAgain }: ContestantLobbyProps) {
  const token = getStoredContestantToken();
  const reconnectToken = token?.roomCode === roomCode ? token.reconnectToken : undefined;
  const socket = useSocket<ContestantView>('contestant', roomCode, undefined, name || undefined, reconnectToken);

  const gameState = socket.data;
  const me = gameState?.players.find((p) => p.id === gameState?.playerId);

  const showClue =
    gameState?.currentClueId &&
    gameState?.currentClueText &&
    (gameState?.phase === 'CLUE_REVEALED' || gameState?.phase === 'BUZZERS_ARMED' || gameState?.phase === 'BUZZED');

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
          <p>Welcome, {me?.name ?? 'Contestant'}</p>
          <p>Score: {me?.score ?? 0}</p>
          {gameState.phase === 'LOBBY' && (
            <>
              <p>Waiting for the host to start the game.</p>
              <button
                type="button"
                onClick={() => {
                  socket.leaveGame?.();
                  onLeave();
                }}
              >
                Leave Game
              </button>
            </>
          )}
          {gameState.phase === 'BOARD_SELECT' && gameState.round && (
            <>
              <p>Phase: {gameState.phase}</p>
              {gameState.isControllingPlayer ? (
                <p>Select a clue from the board.</p>
              ) : (
                <p>Waiting for {gameState.players.find((p) => p.id === gameState.controllingPlayerId)?.name ?? 'the controller'} to select a clue.</p>
              )}
              <ContestantGrid state={gameState} onSelectClue={socket.selectClue} />
            </>
          )}
          {showClue && (
            <div className="clue-overlay" data-testid="contestant-clue-overlay">
              <p data-testid="contestant-clue-text">{gameState.currentClueText}</p>
            </div>
          )}
          {gameState.phase === 'DAILY_DOUBLE_WAGER' && (
            <div data-testid="daily-double-splash">DAILY DOUBLE</div>
          )}
        </div>
      )}
      {!socket.error && !gameState && <p>Joining...</p>}
    </main>
  );
}

function getInitialJoinForm(): JoinForm {
  const token = getStoredContestantToken();
  if (token?.roomCode) {
    return { roomCode: token.roomCode, name: '', submitted: true };
  }
  return { roomCode: '', name: '', submitted: false };
}

export function PlayRoute() {
  const [form, setForm] = useState<JoinForm>(getInitialJoinForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const trimmedRoomCode = form.roomCode.trim().toUpperCase();
  const trimmedName = form.name.trim();
  const canSubmit = form.roomCode.length > 0 && form.name.length > 0;

  if (form.submitted) {
    const handleTryAgain = () => {
      setForm({ roomCode: form.roomCode, name: '', submitted: false });
    };
    const handleLeave = () => {
      clearStoredContestantToken();
      setForm({ roomCode: '', name: '', submitted: false });
    };
    return <ContestantLobby roomCode={trimmedRoomCode} name={form.name} onLeave={handleLeave} onTryAgain={handleTryAgain} />;
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
          setForm({ ...form, submitted: true });
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
          value={form.roomCode}
          onChange={(e) => {
            setForm({ ...form, roomCode: e.target.value });
            setValidationError(null);
          }}
          placeholder="ABCD"
        />
        <label htmlFor="play-name">Your Name</label>
        <input
          id="play-name"
          value={form.name}
          onChange={(e) => {
            setForm({ ...form, name: e.target.value });
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
