import { useState } from 'react';
import { useSocket } from '../socket/useSocket.js';
import type { BoardView, ProjectedPlayer } from '@jeopardy/shared';
import styles from './board.module.css';

interface ScoreboardProps {
  players: ProjectedPlayer[];
}

function Scoreboard({ players }: ScoreboardProps) {
  return (
    <div className={styles.scoreboard}>
      {players.map((player) => (
        <div
          key={player.id}
          className={`${styles.scoreCard} ${!player.connected ? styles.disconnected : ''}`}
          data-testid="score-card"
        >
          <span className={`${styles.name} ${styles.truncated}`} data-testid="score-name">
            {player.name}
          </span>
          <span className={`${styles.score} ${player.score < 0 ? styles.negative : ''}`}>
            {player.score}
          </span>
        </div>
      ))}
    </div>
  );
}

interface BoardDisplayProps {
  roomCode: string;
  onReset: () => void;
}

function BoardDisplay({ roomCode, onReset }: BoardDisplayProps) {
  const [gameState, setGameState] = useState<BoardView | null>(null);
  const socket = useSocket<BoardView>('board', roomCode, setGameState);
  const state = gameState ?? socket.data;

  if (socket.error) {
    return (
      <main className={styles.placeholder}>
        <h1 className={styles.title}>Board</h1>
        <div className={styles.errorAlert} role="alert">
          <p>
            No active game found for room code <strong>{roomCode}</strong>.
          </p>
          <p>{socket.error}</p>
        </div>
        <button type="button" className={styles.resetButton} onClick={onReset}>
          Enter another code
        </button>
      </main>
    );
  }

  if (!state) {
    return (
      <main className={styles.board}>
        <header className={styles.header}>
          <h1 className={styles.headerTitle}>Board</h1>
          <p className={styles.roomCode} data-testid="room-code">
            Room Code: {roomCode}
          </p>
        </header>
        <div className={styles.stage}>
          <p className={styles.waiting}>Connecting...</p>
        </div>
      </main>
    );
  }

  const waitingForPlayers = state.phase === 'LOBBY' && state.players.length === 0;

  return (
    <main className={styles.board}>
      <header className={styles.header}>
        <h1 className={styles.headerTitle}>Board</h1>
        <p className={styles.roomCode} data-testid="room-code">
          Room Code: {roomCode}
        </p>
      </header>
      <div className={styles.stage}>
        {waitingForPlayers ? (
          <p className={styles.waiting}>Waiting for players...</p>
        ) : (
          <p className={styles.waiting}>Game in progress</p>
        )}
      </div>
      <Scoreboard players={state.players} />
    </main>
  );
}

const BOARD_ROOM_KEY = 'jeopardy-board-room';

function getStoredBoardRoom(): string | null {
  try {
    return localStorage.getItem(BOARD_ROOM_KEY);
  } catch {
    return null;
  }
}

export function BoardRoute() {
  const stored = getStoredBoardRoom();
  const [roomCode, setRoomCode] = useState(stored ?? '');
  const [submitted, setSubmitted] = useState(Boolean(stored));

  const handleReset = () => {
    localStorage.removeItem(BOARD_ROOM_KEY);
    setSubmitted(false);
    setRoomCode('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = roomCode.trim().toUpperCase();
    if (normalized) {
      localStorage.setItem(BOARD_ROOM_KEY, normalized);
      setRoomCode(normalized);
      setSubmitted(true);
    }
  };

  if (submitted && roomCode.trim()) {
    return <BoardDisplay roomCode={roomCode.trim().toUpperCase()} onReset={handleReset} />;
  }

  return (
    <main className={styles.entry}>
      <h1 className={styles.title}>Board</h1>
      <form className={styles.form} onSubmit={handleSubmit}>
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
