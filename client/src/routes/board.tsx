import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useSocket } from '../socket/useSocket.js';
import type { BoardView, ProjectedPlayer } from '@jeopardy/shared';
import styles from './board.module.css';

interface ScoreboardProps {
  players: ProjectedPlayer[];
  controllingPlayerId?: string | null;
}

function Scoreboard({ players, controllingPlayerId }: ScoreboardProps) {
  return (
    <div className={styles.scoreboard}>
      {players.map((player) => (
        <div
          key={player.id}
          className={`${styles.scoreCard} ${!player.connected ? styles.disconnected : ''} ${
            player.id === controllingPlayerId ? styles.controlling : ''
          }`}
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

interface ShareableLinkProps {
  roomCode: string;
}

function ShareableLink({ roomCode }: ShareableLinkProps) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/board?room=${encodeURIComponent(roomCode)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={styles.shareBox}>
      <a
        href={url}
        data-testid="share-link"
        className={styles.shareLink}
        target="_blank"
        rel="noopener noreferrer"
      >
        {url}
      </a>
      <button type="button" className={styles.shareButton} onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy Link'}
      </button>
    </div>
  );
}

interface BoardGridProps {
  round: NonNullable<BoardView['round']>;
  usedClueIds: string[];
}

function BoardGrid({ round, usedClueIds }: BoardGridProps) {
  const maxRow = Math.max(0, ...round.categories.flatMap((c) => c.clues.map((clue) => clue.row)));
  const rows = Array.from({ length: maxRow + 1 }, (_, i) => i);

  return (
    <div
      className={styles.grid}
      data-testid="board-grid"
      style={{ gridTemplateColumns: `repeat(${round.categories.length}, 1fr)` }}
    >
      {round.categories.map((category) => (
        <div key={category.id} className={styles.categoryHeader} data-testid="category-header">
          {category.title}
        </div>
      ))}
      {rows.map((row) =>
        round.categories.map((category) => {
          const clue = category.clues.find((c) => c.row === row);
          if (!clue) return <div key={`${category.id}-${row}`} className={styles.cell} />;
          const used = usedClueIds.includes(clue.id);
          return (
            <div
              key={clue.id}
              className={`${styles.cell} ${used ? styles.cellUsed : ''}`}
              data-testid={used ? 'used-cell' : 'clue-cell'}
              data-clue-id={clue.id}
            >
              {!used && clue.value !== null && (
                <span className={styles.value}>${clue.value}</span>
              )}
            </div>
          );
        }),
      )}
    </div>
  );
}

interface ClueOverlayProps {
  clueText: string;
  isDailyDouble?: boolean;
}

function ClueOverlay({ clueText, isDailyDouble }: ClueOverlayProps) {
  return (
    <div className={styles.clueOverlay} data-testid="clue-overlay">
      {isDailyDouble ? (
        <div className={styles.dailyDoubleSplash} data-testid="daily-double-splash">
          DAILY DOUBLE
        </div>
      ) : (
        <p className={styles.clueText} data-testid="clue-text">
          {clueText}
        </p>
      )}
    </div>
  );
}

interface GameStatusBannerProps {
  state: BoardView;
}

function GameStatusBanner({ state }: GameStatusBannerProps) {
  if (state.phase === 'BUZZERS_ARMED') {
    return (
      <div className={styles.armedIndicator} data-testid="armed-indicator">
        BUZZERS ARMED
      </div>
    );
  }

  if (state.phase === 'BUZZED' && state.buzzWinnerId) {
    const winner = state.players.find((p) => p.id === state.buzzWinnerId);
    if (winner) {
      return (
        <div className={styles.buzzedIndicator} data-testid="buzzed-indicator">
          Buzzed in: <strong data-testid="buzzed-player-name">{winner.name}</strong>
        </div>
      );
    }
  }

  return null;
}

interface AnswerBannerProps {
  state: BoardView;
}

function AnswerBanner({ state }: AnswerBannerProps) {
  if (!state.answer) return null;
  const outcome = state.lastOutcome;
  const player = outcome ? state.players.find((p) => p.id === outcome.playerId) : undefined;
  const outcomeLabel =
    outcome?.type === 'CORRECT'
      ? `Correct! ${player?.name ?? ''} +$${outcome.value}`
      : outcome?.type === 'INCORRECT'
        ? `Incorrect! ${player?.name ?? ''} -$${outcome.value}`
        : null;

  return (
    <div
      className={`${styles.answerBanner} ${outcome?.type === 'CORRECT' ? styles.answerCorrect : outcome?.type === 'INCORRECT' ? styles.answerIncorrect : ''}`}
      data-testid="answer-banner"
      role="status"
      aria-live="polite"
    >
      <p className={styles.answerLabel}>Answer:</p>
      <p className={styles.answerText} data-testid="answer-text">
        {state.answer}
      </p>
      {outcomeLabel && <p className={styles.outcomeLabel} data-testid="outcome-label">{outcomeLabel}</p>}
    </div>
  );
}

function renderStage(state: BoardView) {
  const clueOverlay =
    state.currentClueId && state.currentClueText ? (
      <ClueOverlay clueText={state.currentClueText} />
    ) : state.phase === 'DAILY_DOUBLE_WAGER' ? (
      <ClueOverlay clueText="" isDailyDouble />
    ) : null;

  if (clueOverlay) {
    return (
      <div className={styles.clueStage}>
        <GameStatusBanner state={state} />
        {clueOverlay}
      </div>
    );
  }

  if (state.phase === 'LOBBY') {
    return (
      <div className={styles.lobbyStage}>
        <p className={styles.waiting}>Waiting for the host to start the game.</p>
      </div>
    );
  }

  if (state.answer) {
    return (
      <div className={styles.clueStage}>
        <AnswerBanner state={state} />
      </div>
    );
  }

  if (state.round) {
    return <BoardGrid round={state.round} usedClueIds={state.usedClueIds} />;
  }

  return <p className={styles.waiting}>No active round</p>;
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

  return (
    <main className={styles.board}>
      <header className={styles.header}>
        <h1 className={styles.headerTitle}>Board</h1>
        <p className={styles.roomCode} data-testid="room-code">
          Room Code: {roomCode}
        </p>
      </header>
      <div className={styles.stage}>{renderStage(state)}</div>
      <div className={styles.shareSection}>
        <p className={styles.shareLabel}>Share this board display:</p>
        <ShareableLink roomCode={roomCode} />
      </div>
      <Scoreboard players={state.players} controllingPlayerId={state.controllingPlayerId} />
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

function resolveInitialRoom(): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('room')?.trim().toUpperCase();
  if (fromUrl) {
    try {
      localStorage.setItem(BOARD_ROOM_KEY, fromUrl);
    } catch {
      // ignore storage failure
    }
    return fromUrl;
  }
  return getStoredBoardRoom() ?? '';
}

export function BoardRoute() {
  const [searchParams] = useSearchParams();
  const fromUrl = searchParams.get('room')?.trim().toUpperCase();
  const initialRoom = fromUrl ? fromUrl : resolveInitialRoom();

  const [roomCode, setRoomCode] = useState(initialRoom);
  const [submitted, setSubmitted] = useState(Boolean(initialRoom));

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
