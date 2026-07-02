import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  useSocket,
  getStoredContestantToken,
  clearStoredContestantToken,
} from '../socket/useSocket.js';
import { Countdown } from '../components/Countdown.js';
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

function useClientTime(serverNow: number): number {
  return useSyncExternalStore(
    (callback) => {
      const id = setInterval(callback, 50);
      return () => clearInterval(id);
    },
    () => Date.now(),
    () => serverNow,
  );
}

const TOO_EARLY_DISPLAY_MS = 1500;

function Buzzer({
  state,
  onBuzz,
}: {
  state: ContestantView;
  onBuzz?: (playerId: string) => void;
}) {
  const clientTime = useClientTime(state.serverNow ?? 0);
  const [lastTooEarlyAt, setLastTooEarlyAt] = useState<number | null>(null);

  useEffect(() => {
    if (lastTooEarlyAt == null) return;
    const id = setTimeout(() => setLastTooEarlyAt(null), TOO_EARLY_DISPLAY_MS);
    return () => clearTimeout(id);
  }, [lastTooEarlyAt]);

  const isServerLocked = state.isLockedOut || (state.lockoutUntil != null && state.lockoutUntil > clientTime);
  const isWinner = state.buzzWinnerId === state.playerId;
  const isLoser = state.buzzWinnerId != null && state.buzzWinnerId !== state.playerId;

  const displayLockout = lastTooEarlyAt != null && clientTime - lastTooEarlyAt < TOO_EARLY_DISPLAY_MS;

  let label = 'Buzz In';
  if (state.phase === 'CLUE_REVEALED') {
    label = isServerLocked || displayLockout ? 'Too Early' : 'Wait for Host';
  } else if (state.phase === 'BUZZERS_ARMED') {
    label = isServerLocked ? 'Locked Out' : 'Buzz In';
  } else if (state.phase === 'BUZZED') {
    label = isWinner ? 'You\'re In!' : 'Locked Out';
  }

  const canBuzz =
    (state.phase === 'CLUE_REVEALED' && !isServerLocked && !displayLockout) ||
    (state.phase === 'BUZZERS_ARMED' && !isServerLocked && !isWinner && !isLoser);

  const showTooEarly = state.phase === 'CLUE_REVEALED' && (isServerLocked || displayLockout);

  const handlePress = useCallback(() => {
    if (state.phase === 'CLUE_REVEALED' && !isServerLocked && !displayLockout) {
      setLastTooEarlyAt(clientTime);
      onBuzz?.(state.playerId);
    } else if (state.phase === 'BUZZERS_ARMED' && !isServerLocked && !isWinner && !isLoser) {
      onBuzz?.(state.playerId);
    }
  }, [state.phase, isServerLocked, displayLockout, isWinner, isLoser, onBuzz, state.playerId, clientTime]);

  return (
    <button
      type="button"
      data-testid="contestant-buzzer"
      data-too-early={showTooEarly ? 'true' : undefined}
      aria-label={label}
      disabled={!canBuzz}
      onClick={handlePress}
      style={{
        width: '100%',
        minHeight: '50vh',
        fontSize: '2rem',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        touchAction: 'manipulation',
        userSelect: 'none',
      }}
    >
      {label}
    </button>
  );
}

function AnswerBanner({ state }: { state: ContestantView }) {
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
    <div data-testid="contestant-answer-banner" role="status" aria-live="polite">
      <p>
        Answer: <strong data-testid="contestant-answer-text">{state.answer}</strong>
      </p>
      {outcomeLabel && <p data-testid="contestant-outcome-label">{outcomeLabel}</p>}
    </div>
  );
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

function DailyDoubleWager({
  state,
  error,
  onSubmit,
  clearError,
}: {
  state: ContestantView;
  error?: string | null;
  onSubmit?: (amount: number) => void;
  clearError?: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const me = state.players.find((p) => p.id === state.playerId);
  const highestValue =
    state.round?.categories
      .flatMap((c) => c.clues)
      .reduce((max, clue) => Math.max(max, clue.value ?? 0), 0) ?? 0;
  const maxWager = Math.max(me?.score ?? 0, highestValue);
  const minWager = 5;
  const isLocked = state.dailyDoubleWager != null;
  const controllerName = state.players.find((p) => p.id === state.controllingPlayerId)?.name ?? 'the controller';

  if (!state.isControllingPlayer) {
    return (
      <div data-testid="daily-double-passive">
        <p data-testid="daily-double-splash">DAILY DOUBLE</p>
        <p>Waiting for {controllerName} to wager.</p>
      </div>
    );
  }

  if (isLocked) {
    return (
      <div data-testid="daily-double-wager-locked">
        <p data-testid="daily-double-splash">DAILY DOUBLE</p>
        <p data-testid="dd-wager-locked-amount">Your wager: {'$'}{state.dailyDoubleWager}</p>
      </div>
    );
  }

  const isWagerError = (msg?: string | null) => Boolean(msg && /wager/i.test(msg));
  const displayError = validationError || (isWagerError(error) ? error : null);

  const handleAmountChange = (value: string) => {
    setAmount(value);
    if (validationError) {
      setValidationError(null);
    }
    if (error && isWagerError(error)) {
      clearError?.();
    }
  };

  const handleSubmit = () => {
    const parsed = Number(amount);
    if (amount === '' || Number.isNaN(parsed)) {
      setValidationError(`Please enter a valid wager amount between $${minWager} and $${maxWager}.`);
      return;
    }
    if (parsed < minWager) {
      setValidationError(`Wager must be at least $${minWager} (allowed range: $${minWager} - $${maxWager}).`);
      return;
    }
    if (parsed > maxWager) {
      setValidationError(`Wager cannot exceed $${maxWager} (allowed range: $${minWager} - $${maxWager}).`);
      return;
    }
    onSubmit?.(parsed);
  };

  return (
    <div data-testid="daily-double-wager-input">
      <p data-testid="daily-double-splash">DAILY DOUBLE</p>
      <p>Enter your wager ({'$'}{minWager} - {'$'}{maxWager})</p>
      <input
        type="number"
        step="1"
        value={amount}
        onChange={(e) => handleAmountChange(e.target.value)}
        min={minWager}
        max={maxWager}
        data-testid="dd-wager-input"
        aria-invalid={displayError ? 'true' : undefined}
        aria-describedby={displayError ? 'dd-wager-error' : undefined}
      />
      {displayError && (
        <p
          id="dd-wager-error"
          data-testid="dd-wager-error"
          className="error"
          role="alert"
          aria-live="polite"
        >
          {displayError}
        </p>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        data-testid="dd-wager-submit"
      >
        Submit Wager
      </button>
    </div>
  );
}

function FinalWager({
  state,
  error,
  onSubmit,
  clearError,
}: {
  state: ContestantView;
  error?: string | null;
  onSubmit?: (amount: number) => void;
  clearError?: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const me = state.players.find((p) => p.id === state.playerId);
  const maxWager = me?.score ?? 0;
  const isLocked = state.finalWagerSubmitted;

  if (!state.isEligibleForFinal) {
    return (
      <div data-testid="final-wager-ineligible">
        <p>You are not eligible for Final Jeopardy.</p>
      </div>
    );
  }

  if (isLocked) {
    return (
      <div data-testid="final-wager-locked">
        <p data-testid="final-wager-locked-message">Your Final Jeopardy wager is locked in.</p>
        <p data-testid="final-wager-locked-amount">Your wager: {'$'}{state.myFinalWager}</p>
      </div>
    );
  }

  const isWagerError = (msg?: string | null) => Boolean(msg && /wager/i.test(msg));
  const displayError = validationError || (isWagerError(error) ? error : null);

  const handleAmountChange = (value: string) => {
    setAmount(value);
    if (validationError) {
      setValidationError(null);
    }
    if (error && isWagerError(error)) {
      clearError?.();
    }
  };

  const handleSubmit = () => {
    const parsed = Number(amount);
    if (amount === '' || Number.isNaN(parsed) || !Number.isInteger(parsed)) {
      setValidationError(`Please enter a valid whole-dollar wager amount between $0 and $${maxWager}.`);
      return;
    }
    if (parsed < 0) {
      setValidationError(`Wager cannot be negative (allowed range: $0 - $${maxWager}).`);
      return;
    }
    if (parsed > maxWager) {
      setValidationError(`Wager cannot exceed $${maxWager} (allowed range: $0 - $${maxWager}).`);
      return;
    }
    onSubmit?.(parsed);
  };

  return (
    <div data-testid="final-wager-input">
      <p data-testid="final-wager-heading">Final Jeopardy Wager</p>
      <p>Enter your wager ({'$'}0 - {'$'}{maxWager})</p>
      <input
        type="number"
        step="1"
        value={amount}
        onChange={(e) => handleAmountChange(e.target.value)}
        min={0}
        max={maxWager}
        data-testid="final-wager-amount-input"
        aria-invalid={displayError ? 'true' : undefined}
        aria-describedby={displayError ? 'final-wager-error' : undefined}
      />
      {displayError && (
        <p
          id="final-wager-error"
          data-testid="final-wager-error"
          className="error"
          role="alert"
          aria-live="polite"
        >
          {displayError}
        </p>
      )}
      <button type="button" onClick={handleSubmit} data-testid="final-wager-submit">
        Submit Wager
      </button>
    </div>
  );
}

function ContestantLobby({ roomCode, name, onLeave, onTryAgain }: ContestantLobbyProps) {
  const token = getStoredContestantToken();
  const reconnectToken = token?.roomCode === roomCode ? token.reconnectToken : undefined;
  const socket = useSocket<ContestantView>('contestant', roomCode, undefined, name || undefined, reconnectToken);

  const gameState = socket.data;
  const me = gameState?.players.find((p) => p.id === gameState?.playerId);

  const error = socket.error;
  const clearError = socket.clearError;
  const isJoinError = Boolean(error && !gameState);
  const isTransientError = Boolean(error && gameState);

  useEffect(() => {
    if (!isTransientError || !clearError) return;
    const id = setTimeout(() => clearError(), 2000);
    return () => clearTimeout(id);
  }, [isTransientError, clearError]);

  const showClue =
    gameState?.currentClueId &&
    gameState?.currentClueText &&
    (gameState?.phase === 'CLUE_REVEALED' ||
      gameState?.phase === 'BUZZERS_ARMED' ||
      gameState?.phase === 'BUZZED' ||
      gameState?.phase === 'DAILY_DOUBLE_CLUE' ||
      gameState?.phase === 'FINAL_CLUE');

  const showBuzzer =
    gameState?.phase === 'CLUE_REVEALED' ||
    gameState?.phase === 'BUZZERS_ARMED' ||
    gameState?.phase === 'BUZZED';

  const transitionLabel =
    gameState?.phase === 'ROUND_TRANSITION'
      ? gameState.transitionTarget === 'DOUBLE_JEOPARDY'
        ? 'Double Jeopardy!'
        : 'Final Jeopardy!'
      : null;

  return (
    <main className="route-stub">
      <h1>Play</h1>
      <p className="room-code" data-testid="room-code">
        Room Code: {roomCode}
      </p>
      {isJoinError && (
        <div className="error" role="alert" data-testid="join-error">
          <p>{error}</p>
          <button type="button" onClick={onTryAgain}>
            Try Again
          </button>
        </div>
      )}
      {isTransientError && (
        <div className="error-toast" role="status" data-testid="transient-error" aria-live="polite">
          {error}
        </div>
      )}
      {gameState && (
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
          {gameState.phase === 'ROUND_TRANSITION' && (
            <div data-testid="contestant-round-transition">
              <h2 data-testid="contestant-transition-heading">{transitionLabel}</h2>
              <p>Between-round scores</p>
              <ul data-testid="contestant-transition-scores">
                {gameState.players.map((player) => (
                  <li key={player.id} data-testid="contestant-transition-score">
                    <span>{player.name}</span>
                    <span>{player.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {gameState.phase === 'FINAL_INTRO' && (
            <div data-testid="contestant-final-intro">
              <h2 data-testid="contestant-final-heading">Final Jeopardy!</h2>
              <p data-testid="contestant-final-category">
                Category: {gameState.round?.categories[0]?.title ?? 'Final Category'}
              </p>
              {gameState.isEligibleForFinal ? (
                <p data-testid="contestant-final-eligible">You are eligible for Final Jeopardy. Wait for the host to open wagers.</p>
              ) : (
                <p data-testid="contestant-final-ineligible">You are not eligible for Final Jeopardy.</p>
              )}
            </div>
          )}
          {gameState.phase === 'FINAL_WAGER' && (
            <FinalWager
              state={gameState}
              onSubmit={socket.submitFinalWager}
              error={error}
              clearError={clearError}
            />
          )}
          {gameState.phase === 'BOARD_SELECT' && gameState.round && (
            <>
              {gameState.answer && <AnswerBanner state={gameState} />}
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
          {showBuzzer && (
            <>
              <Countdown deadline={gameState.deadline} serverNow={gameState.serverNow} />
              <Buzzer key={gameState.currentClueId} state={gameState} onBuzz={socket.buzz} />
            </>
          )}
          {gameState.phase === 'DAILY_DOUBLE_WAGER' && (
            <DailyDoubleWager state={gameState} onSubmit={socket.submitDDWager} error={error} clearError={clearError} />
          )}
          {gameState.phase === 'DAILY_DOUBLE_CLUE' && gameState.isControllingPlayer && gameState.dailyDoubleWager != null && (
            <p data-testid="dd-wager-locked-amount">Your wager: {'$'}{gameState.dailyDoubleWager}</p>
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
