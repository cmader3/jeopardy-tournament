import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useSocket,
  getStoredContestantToken,
  clearStoredContestantToken,
} from '../socket/useSocket.js';
import type { RemovedReason } from '../socket/useSocket.js';
import { Countdown } from '../components/Countdown.js';
import { ConnectionStatus } from '../components/ConnectionStatus.js';
import { useServerTime } from '../hooks/useServerTime.js';
import { formatScore } from '../format.js';
import type { ContestantView } from '@jeopardy/shared';
import { EARLY_BUZZ_LOCKOUT_MS } from '@jeopardy/shared';
import styles from './play.module.css';

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

function safeVibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  try {
    navigator.vibrate(pattern);
  } catch {
    // Vibration API is optional; ignore failures.
  }
}

function getStatusDescription(state: ContestantView): string {
  const me = state.players.find((p) => p.id === state.playerId);
  const score = me?.score ?? 0;
  const controller = state.players.find((p) => p.id === state.controllingPlayerId);
  const isWinner = state.buzzWinnerId === state.playerId;

  switch (state.phase) {
    case 'LOBBY':
      return `Score ${score}. Waiting for the host to start.`;
    case 'ROUND_TRANSITION':
      return `Score ${score}. Round transition.`;
    case 'FINAL_INTRO':
      return `Score ${score}. Final Jeopardy. ${state.isEligibleForFinal ? 'You are eligible.' : 'You are not eligible.'}`;
    case 'FINAL_WAGER':
      return `Score ${score}. Place your Final Jeopardy wager.`;
    case 'BOARD_SELECT': {
      if (state.isControllingPlayer) {
        return `Score ${score}. It is your turn to select a clue.`;
      }
      const controllerLabel = state.teamMode
        ? state.teams.find((t) => t.id === state.controllingTeamId)?.name ?? 'the controlling team'
        : controller?.name ?? 'the controller';
      return `Score ${score}. Waiting for ${controllerLabel} to select a clue.`;
    }
    case 'CLUE_REVEALED':
      return `Score ${score}. Clue revealed. Buzzers are not yet armed.`;
    case 'BUZZERS_ARMED':
      return `Score ${score}. Buzzers are armed.`;
    case 'BUZZED':
      return isWinner ? `Score ${score}. You buzzed in first.` : `Score ${score}. Another contestant buzzed in.`;
    case 'DAILY_DOUBLE_WAGER':
      return `Score ${score}. Daily Double.`;
    case 'DAILY_DOUBLE_CLUE':
      return `Score ${score}. Daily Double clue.`;
    case 'FINAL_CLUE':
      return `Score ${score}. Final Jeopardy clue.`;
    case 'FINAL_REVEAL':
      return `Score ${score}. Final Jeopardy reveal.`;
    case 'COMPLETE':
      return `Score ${score}. Game over.`;
    default:
      return `Score ${score}.`;
  }
}

interface ScoreHolder {
  id: string;
  name: string;
  score: number;
}

function getScoreHolders(state: ContestantView): ScoreHolder[] {
  if (state.teamMode) {
    return state.teams.map((t) => ({ id: t.id, name: t.name, score: t.score }));
  }
  return state.players.map((p) => ({ id: p.id, name: p.name, score: p.score }));
}

function TeamPicker({
  state,
  onChoose,
}: {
  state: ContestantView;
  onChoose?: (teamId: string) => void;
}) {
  return (
    <div className={styles.teamPicker} data-testid="team-picker">
      <p className={styles.teamPickerHeading}>Choose your team</p>
      <div className={styles.teamPickerOptions}>
        {state.teams.map((team) => (
          <button
            key={team.id}
            type="button"
            className={styles.teamPickerButton}
            data-testid={`choose-team-${team.id}`}
            onClick={() => onChoose?.(team.id)}
          >
            <span className={styles.teamPickerName}>{team.name}</span>
            <span className={styles.teamPickerCount}>
              {team.memberIds.length} player{team.memberIds.length === 1 ? '' : 's'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TeamBanner({ state }: { state: ContestantView }) {
  if (!state.teamMode || !state.teamId) return null;
  const role = state.isTemporaryCaptain
    ? 'You are the temporary captain'
    : state.isCaptain
      ? 'You are the team captain'
      : 'Teammate';
  return (
    <div className={styles.teamBanner} data-testid="contestant-team-banner">
      <div className={styles.teamBannerRow}>
        <span className={styles.teamBannerName} data-testid="contestant-team-name">
          {state.teamName}
        </span>
        <span
          className={`${styles.scoreDisplay} ${(state.teamScore ?? 0) < 0 ? styles.negativeScore : ''}`}
          data-testid="contestant-team-score"
        >
          {formatScore(state.teamScore ?? 0)}
        </span>
      </div>
      <span className={styles.teamRole} data-testid="contestant-team-role">
        {role}
      </span>
      {state.isTeamLockedOut && (
        <span className={styles.teamLocked} data-testid="contestant-team-locked">
          Your team is locked out for this clue.
        </span>
      )}
    </div>
  );
}

function ContestantTeamScores({ state }: { state: ContestantView }) {
  if (!state.teamMode) return null;
  return (
    <div className={styles.teamScores} data-testid="contestant-team-scores">
      {state.teams.map((team) => (
        <div
          key={team.id}
          className={`${styles.teamScoreRow} ${state.controllingTeamId === team.id ? styles.teamScoreControlling : ''}`}
          data-testid={`contestant-team-score-row-${team.id}`}
        >
          <span className={styles.teamScoreName}>
            {team.name}
            {team.id === state.teamId ? ' (You)' : ''}
          </span>
          <span className={`${styles.scoreDisplay} ${team.score < 0 ? styles.negativeScore : ''}`}>
            {formatScore(team.score)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Buzzer({
  state,
  onBuzz,
}: {
  state: ContestantView;
  onBuzz?: (playerId: string) => void;
}) {
  const [earlyLocked, setEarlyLocked] = useState(false);
  const unlockAtRef = useRef(0);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousPhaseRef = useRef(state.phase);

  // Arm the transient early-buzz lockout for a relative duration. A plain
  // timeout (rather than a ticking clock or waiting on the next broadcast)
  // guarantees the buzzer releases itself, even on mobile browsers that throttle
  // intervals. The absolute unlock time is kept in a ref so repeated arming
  // never shortens an in-flight lockout.
  const armLockout = useCallback((durationMs: number) => {
    const target = Date.now() + durationMs;
    if (target <= unlockAtRef.current) return;
    unlockAtRef.current = target;
    setEarlyLocked(true);
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    lockTimerRef.current = setTimeout(() => setEarlyLocked(false), durationMs);
  }, []);

  useEffect(
    () => () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    },
    [],
  );

  // Mirror the server's early-buzz lockout for this player. The remaining time
  // is derived in server time (lockoutUntil - serverNow), so it is immune to
  // client/server clock skew.
  useEffect(() => {
    const remaining = state.lockoutUntil != null ? state.lockoutUntil - (state.serverNow ?? 0) : 0;
    if (remaining > 0) armLockout(remaining);
  }, [state.lockoutUntil, state.serverNow, armLockout]);

  useEffect(() => {
    if (previousPhaseRef.current !== 'BUZZERS_ARMED' && state.phase === 'BUZZERS_ARMED') {
      safeVibrate([40, 20, 40]);
    }
    previousPhaseRef.current = state.phase;
  }, [state.phase]);

  const isServerLocked = state.isLockedOut;
  const isWinner = state.buzzWinnerId === state.playerId;
  const isLoser = state.buzzWinnerId != null && state.buzzWinnerId !== state.playerId;

  let label = 'Buzz In';
  if (state.phase === 'CLUE_REVEALED') {
    label = isServerLocked || earlyLocked ? 'Too Early' : 'Wait for Host';
  } else if (state.phase === 'BUZZERS_ARMED') {
    label = isServerLocked || earlyLocked ? 'Locked Out' : 'Buzz In';
  } else if (state.phase === 'BUZZED') {
    label = isWinner ? 'You\'re In!' : 'Locked Out';
  }

  const canBuzz =
    (state.phase === 'CLUE_REVEALED' && !isServerLocked && !earlyLocked) ||
    (state.phase === 'BUZZERS_ARMED' && !isServerLocked && !earlyLocked && !isWinner && !isLoser);

  const showTooEarly = state.phase === 'CLUE_REVEALED' && (isServerLocked || earlyLocked);

  const handlePress = useCallback(() => {
    if (state.phase === 'CLUE_REVEALED' && !isServerLocked && !earlyLocked) {
      armLockout(EARLY_BUZZ_LOCKOUT_MS);
      safeVibrate(50);
      onBuzz?.(state.playerId);
    } else if (state.phase === 'BUZZERS_ARMED' && !isServerLocked && !earlyLocked && !isWinner && !isLoser) {
      safeVibrate(80);
      onBuzz?.(state.playerId);
    }
  }, [state.phase, isServerLocked, earlyLocked, isWinner, isLoser, onBuzz, state.playerId, armLockout]);

  let stateClass = styles.buzzerWait;
  if (state.phase === 'BUZZERS_ARMED' && canBuzz) {
    stateClass = styles.buzzerArmed;
  } else if (state.phase === 'BUZZED' && isWinner) {
    stateClass = styles.buzzerWinner;
  } else if (showTooEarly) {
    stateClass = styles.buzzerTooEarly;
  } else if (isServerLocked || isLoser) {
    stateClass = styles.buzzerLocked;
  }

  return (
    <button
      type="button"
      data-testid="contestant-buzzer"
      data-too-early={showTooEarly ? 'true' : undefined}
      aria-label={label}
      disabled={!canBuzz}
      onClick={handlePress}
      className={`${styles.buzzer} ${stateClass}`}
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
    <div className={styles.answerBanner} data-testid="contestant-answer-banner" role="status" aria-live="polite">
      <p className={styles.answerLabel}>Answer</p>
      <p className={styles.answerValue}>
        <strong data-testid="contestant-answer-text">{state.answer}</strong>
      </p>
      {outcomeLabel && (
        <p className={styles.outcomeLabel} data-testid="contestant-outcome-label">
          {outcomeLabel}
        </p>
      )}
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
  const canSelect = state.isControllingPlayer && state.clueSelectionMode === 'PLAYER';

  return (
    <div
      className={styles.grid}
      data-testid="contestant-grid"
      style={{ gridTemplateColumns: `repeat(${state.round.categories.length}, 1fr)` }}
    >
      {state.round.categories.map((category) => (
        <div key={category.id} className={styles.categoryHeader} data-testid="contestant-category-header">
          {category.title}
        </div>
      ))}
      {rows.map((row) =>
        state.round!.categories.map((category) => {
          const clue = category.clues.find((c) => c.row === row);
          if (!clue) return <div key={`${category.id}-${row}`} className={styles.cell} />;
          const used = state.usedClueIds.includes(clue.id);
          return (
            <button
              key={clue.id}
              type="button"
              className={`${styles.cell}${used ? ` ${styles.used}` : ''}`}
              data-testid={used ? 'contestant-used-cell' : 'contestant-clue-cell'}
              data-clue-id={clue.id}
              disabled={used || !canSelect}
              onClick={() => onSelectClue?.(clue.id)}
            >
              {used ? '' : <span className={styles.value}>${clue.value}</span>}
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
  const holderScore = state.teamMode ? state.teams.find((t) => t.id === state.controllingTeamId)?.score ?? 0 : me?.score ?? 0;
  const maxWager = Math.max(holderScore, highestValue);
  const minWager = 5;
  const isLocked = state.dailyDoubleWager != null;
  const controllerName = state.teamMode
    ? `${state.teams.find((t) => t.id === state.controllingTeamId)?.name ?? 'the controlling team'} captain`
    : state.players.find((p) => p.id === state.controllingPlayerId)?.name ?? 'the controller';

  if (!state.isControllingPlayer) {
    return (
      <div data-testid="daily-double-passive">
        <p className={styles.dailyDoubleSplash} data-testid="daily-double-splash">DAILY DOUBLE</p>
        <p>Waiting for {controllerName} to wager.</p>
      </div>
    );
  }

  if (isLocked) {
    return (
      <div data-testid="daily-double-wager-locked">
        <p className={styles.dailyDoubleSplash} data-testid="daily-double-splash">DAILY DOUBLE</p>
        <p data-testid="dd-wager-locked-amount">Your wager: {formatScore(state.dailyDoubleWager ?? 0)}</p>
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
      <p className={styles.dailyDoubleSplash} data-testid="daily-double-splash">DAILY DOUBLE</p>
      <p>Enter your wager ({'$'}{minWager} - {'$'}{maxWager})</p>
      <input
        type="number"
        step="1"
        value={amount}
        onChange={(e) => handleAmountChange(e.target.value)}
        min={minWager}
        max={maxWager}
        data-testid="dd-wager-input"
        className={styles.input}
        aria-invalid={displayError ? 'true' : undefined}
        aria-describedby={displayError ? 'dd-wager-error' : undefined}
      />
      {displayError && (
        <p
          id="dd-wager-error"
          data-testid="dd-wager-error"
          className={styles.error}
          role="alert"
          aria-live="polite"
        >
          {displayError}
        </p>
      )}
      <button
        type="button"
        className={styles.button}
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
  const maxWager = state.teamMode ? state.teamScore ?? 0 : me?.score ?? 0;
  const isLocked = state.finalWagerSubmitted;
  const wagerOwnerLabel = state.teamMode ? "Your team's" : 'Your';

  if (!state.isEligibleForFinal) {
    return (
      <div data-testid="final-wager-ineligible">
        <p>{state.teamMode ? 'Your team is not eligible for Final Jeopardy.' : 'You are not eligible for Final Jeopardy.'}</p>
      </div>
    );
  }

  if (state.teamMode && !state.isActingCaptain) {
    return (
      <div data-testid="final-wager-team-passive">
        <p className={styles.finalHeading}>Final Jeopardy Wager</p>
        {isLocked ? (
          <p data-testid="final-wager-locked-amount">Team wager: {formatScore(state.myFinalWager ?? 0)}</p>
        ) : (
          <p>Your team captain is entering the wager.</p>
        )}
      </div>
    );
  }

  if (isLocked) {
    return (
      <div data-testid="final-wager-locked">
        <p data-testid="final-wager-locked-message">{wagerOwnerLabel} Final Jeopardy wager is locked in.</p>
        <p data-testid="final-wager-locked-amount">{state.teamMode ? 'Team' : 'Your'} wager: {formatScore(state.myFinalWager ?? 0)}</p>
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
      <p className={styles.finalHeading} data-testid="final-wager-heading">Final Jeopardy Wager</p>
      <p>Enter your wager ({'$'}0 - {'$'}{maxWager})</p>
      <input
        type="number"
        step="1"
        value={amount}
        onChange={(e) => handleAmountChange(e.target.value)}
        min={0}
        max={maxWager}
        data-testid="final-wager-amount-input"
        className={styles.input}
        aria-invalid={displayError ? 'true' : undefined}
        aria-describedby={displayError ? 'final-wager-error' : undefined}
      />
      {displayError && (
        <p
          id="final-wager-error"
          data-testid="final-wager-error"
          className={styles.error}
          role="alert"
          aria-live="polite"
        >
          {displayError}
        </p>
      )}
      <button type="button" className={styles.button} onClick={handleSubmit} data-testid="final-wager-submit">
        Submit Wager
      </button>
    </div>
  );
}

const DRAFT_DEBOUNCE_MS = 300;

function FinalAnswer({
  state,
  error,
  onSubmit,
  onDraft,
  clearError,
  deadline,
  serverNow,
}: {
  state: ContestantView;
  error?: string | null;
  onSubmit?: (answer: string) => void;
  onDraft?: (answer: string) => void;
  clearError?: () => void;
  deadline: number | null;
  serverNow: number;
}) {
  const [answer, setAnswer] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const isLocked = state.finalAnswerSubmitted;
  const answerRef = useRef(answer);
  const lastEmittedRef = useRef<string | null>(null);
  const hasInteractedRef = useRef(false);
  useEffect(() => {
    answerRef.current = answer;
  }, [answer]);

  const now = useServerTime(serverNow);
  const remainingMs = deadline != null ? Math.max(0, deadline - now) : null;
  const isNearDeadline = remainingMs != null && remainingMs <= DRAFT_DEBOUNCE_MS;
  const isExpired = remainingMs === 0;

  const emitDraft = useCallback(
    (value: string) => {
      if (!onDraft || !hasInteractedRef.current) return;
      if (value !== lastEmittedRef.current) {
        onDraft(value);
        lastEmittedRef.current = value;
      }
    },
    [onDraft],
  );

  // Emit drafts: debounced normally, immediately when the deadline is close.
  useEffect(() => {
    if (isLocked || !onDraft) return;
    if (isExpired) return;
    if (isNearDeadline) {
      emitDraft(answer);
      return;
    }
    const timer = setTimeout(() => emitDraft(answer), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [answer, isLocked, onDraft, isNearDeadline, isExpired, emitDraft]);

  // Flush any pending draft the moment the local countdown reaches zero.
  useEffect(() => {
    if (isLocked || !onDraft || !isExpired) return;
    emitDraft(answer);
  }, [isExpired, isLocked, onDraft, emitDraft, answer]);

  // Flush the current draft if the input locks or the component unmounts.
  useEffect(() => {
    return () => {
      if (!onDraft) return;
      const latest = answerRef.current;
      if (hasInteractedRef.current && latest !== lastEmittedRef.current) {
        onDraft(latest);
      }
    };
  }, [onDraft]);

  if (!state.isEligibleForFinal) {
    return (
      <div data-testid="final-answer-ineligible">
        <p>{state.teamMode ? 'Your team is not eligible for Final Jeopardy.' : 'You are not eligible for Final Jeopardy.'}</p>
      </div>
    );
  }

  if (state.teamMode && !state.isActingCaptain) {
    return (
      <div data-testid="final-answer-team-passive">
        <p className={styles.finalHeading}>Final Jeopardy Answer</p>
        {isLocked ? (
          <p data-testid="final-answer-locked-text">Team answer: {state.myFinalAnswer}</p>
        ) : (
          <p>Your team captain is entering the answer.</p>
        )}
      </div>
    );
  }

  if (isLocked) {
    return (
      <div data-testid="final-answer-locked">
        <p data-testid="final-answer-locked-message">{state.teamMode ? "Your team's" : 'Your'} Final Jeopardy answer is locked in.</p>
        <p data-testid="final-answer-locked-text">{state.teamMode ? 'Team' : 'Your'} answer: {state.myFinalAnswer}</p>
      </div>
    );
  }

  const isAnswerError = (msg?: string | null) => Boolean(msg && /answer/i.test(msg));
  const displayError = validationError || (isAnswerError(error) ? error : null);

  const handleAnswerChange = (value: string) => {
    hasInteractedRef.current = true;
    setAnswer(value);
    if (validationError) {
      setValidationError(null);
    }
    if (error && isAnswerError(error)) {
      clearError?.();
    }
  };

  const handleSubmit = () => {
    onSubmit?.(answer);
  };

  return (
    <div data-testid="final-answer-input">
      <p className={styles.finalHeading} data-testid="final-answer-heading">Final Jeopardy Answer</p>
      <p>Enter your written answer before time expires.</p>
      <textarea
        value={answer}
        onChange={(e) => handleAnswerChange(e.target.value)}
        data-testid="final-answer-text-input"
        aria-invalid={displayError ? 'true' : undefined}
        aria-describedby={displayError ? 'final-answer-error' : undefined}
        rows={3}
        className={styles.textarea}
      />
      {displayError && (
        <p
          id="final-answer-error"
          data-testid="final-answer-error"
          className={styles.error}
          role="alert"
          aria-live="polite"
        >
          {displayError}
        </p>
      )}
      <button type="button" className={styles.button} onClick={handleSubmit} data-testid="final-answer-submit">
        Submit Answer
      </button>
    </div>
  );
}

function FinalReveal({ state }: { state: ContestantView }) {
  const holders = getScoreHolders(state);
  const findHolder = (id: string | null) => (id ? holders.find((h) => h.id === id) : undefined);
  const currentPlayerId = state.finalRevealOrder[state.finalRevealIndex] ?? null;
  const currentPlayer = findHolder(currentPlayerId);
  const currentAnswer = currentPlayerId ? state.finalRevealedAnswers[currentPlayerId] : undefined;
  const currentWager = currentPlayerId ? state.finalRevealedWagers[currentPlayerId] : undefined;
  const revealedPlayerIds = state.finalRevealOrder.slice(0, state.finalRevealIndex);
  const isMe = state.teamMode ? currentPlayerId === state.teamId : currentPlayerId === state.playerId;

  return (
    <div data-testid="contestant-final-reveal">
      <h2 className={styles.finalHeading} data-testid="contestant-final-reveal-heading">Final Jeopardy Reveal</h2>
      {currentPlayer && (
        <div className={styles.finalRevealCard} data-testid="contestant-final-reveal-current">
          <p data-testid="contestant-final-reveal-player-name" className={styles.finalRevealName}>
            {currentPlayer.name}
          </p>
          <p className={styles.finalRevealLine} data-testid="contestant-final-reveal-player-score">
            <span className={styles.finalRevealLabel}>Score</span>
            <span className={`${styles.scoreDisplay} ${currentPlayer.score < 0 ? styles.negativeScore : ''}`}>
              {formatScore(currentPlayer.score)}
            </span>
          </p>
          {currentAnswer !== undefined && (
            <p className={styles.finalRevealLine} data-testid="contestant-final-reveal-answer">
              <span className={styles.finalRevealLabel}>Answer</span>
              <span className={styles.finalRevealAnswerText}>{currentAnswer}</span>
            </p>
          )}
          {currentWager !== undefined && (
            <p className={styles.finalRevealLine} data-testid="contestant-final-reveal-wager">
              <span className={styles.finalRevealLabel}>Wager</span>
              <span className={styles.scoreDisplay}>{formatScore(currentWager)}</span>
            </p>
          )}
          {isMe && (
            <p className={styles.finalRevealIsMe} data-testid="contestant-final-reveal-is-me">
              This is your reveal!
            </p>
          )}
          {state.lastOutcome && (
            <p
              className={state.lastOutcome.type === 'CORRECT' ? styles.outcomeCorrect : styles.outcomeIncorrect}
              data-testid="contestant-final-reveal-outcome"
            >
              {state.lastOutcome.type === 'CORRECT' ? 'Correct!' : 'Incorrect!'}
            </p>
          )}
        </div>
      )}
      {revealedPlayerIds.length > 0 && (
        <div data-testid="contestant-final-revealed-list">
          <h3 className={styles.finalRevealedHeading}>Revealed</h3>
          <ul className={styles.revealedList}>
            {revealedPlayerIds.map((playerId) => {
              const player = findHolder(playerId);
              if (!player) return null;
              return (
                <li key={playerId} className={styles.revealedItem} data-testid="contestant-final-revealed-player">
                  <div className={styles.revealedItemHeader}>
                    <span className={styles.contestantName}>{player.name}</span>
                    <span className={`${styles.scoreDisplay} ${player.score < 0 ? styles.negativeScore : ''}`}>
                      {formatScore(player.score)}
                    </span>
                  </div>
                  <div className={styles.revealedItemDetail}>
                    <span className={styles.finalRevealLabel}>Answer</span>
                    <span data-testid={`contestant-final-revealed-answer-${playerId}`}>
                      {state.finalRevealedAnswers[playerId]}
                    </span>
                  </div>
                  <div className={styles.revealedItemDetail}>
                    <span className={styles.finalRevealLabel}>Wager</span>
                    <span className={styles.scoreDisplay} data-testid={`contestant-final-revealed-wager-${playerId}`}>
                      {formatScore(state.finalRevealedWagers[playerId])}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function FinalStandings({ state }: { state: ContestantView }) {
  const sorted = [...getScoreHolders(state)].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? null;
  const coWinners = topScore != null ? sorted.filter((p) => p.score === topScore).map((p) => p.id) : [];
  const myId = state.teamMode ? state.teamId : state.playerId;
  const me = sorted.find((h) => h.id === myId);

  return (
    <div data-testid="contestant-final-standings">
      {state.finalNoEligiblePlayers && (
        <p data-testid="contestant-final-no-eligible">
          {state.teamMode ? 'No teams were eligible for Final Jeopardy.' : 'No contestants were eligible for Final Jeopardy.'}
        </p>
      )}
      <h2 className={styles.finalHeading} data-testid="contestant-final-standings-heading">Final Standings</h2>
      <p data-testid="contestant-final-standings-self">
        {state.teamMode ? "Your team's final score:" : 'Your final score:'}{' '}
        <span className={`${styles.scoreDisplay} ${me?.score != null && me.score < 0 ? styles.negativeScore : ''}`}>
          {formatScore(me?.score ?? 0)}
        </span>
      </p>
      <ul data-testid="contestant-final-standings-list">
        {sorted.map((player) => (
          <li key={player.id} data-testid="contestant-final-standing">
            <span data-testid={`contestant-final-standing-name-${player.id}`} className={styles.contestantName}>
              {player.name}
            </span>
            <span
              data-testid={`contestant-final-standing-score-${player.id}`}
              className={`${styles.transitionScore} ${styles.scoreDisplay} ${player.score < 0 ? styles.negativeScore : ''}`}
            >
              {formatScore(player.score)}
            </span>
            {coWinners.includes(player.id) && (
              <span className={styles.winnerBadge} data-testid={`contestant-final-winner-${player.id}`}>Winner</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContestantRemoved({
  reason,
  onBack,
}: {
  reason: RemovedReason | null;
  onBack: () => void;
}) {
  const kicked = reason === 'kicked';
  return (
    <main className={styles.entry} data-testid="contestant-removed">
      <h1 className={styles.title}>{kicked ? 'Removed from Game' : 'You Left the Game'}</h1>
      <p className={styles.removedMessage}>
        {kicked
          ? 'The host has removed you from this game.'
          : 'You have left this game.'}
      </p>
      <button
        type="button"
        className={styles.button}
        data-testid="removed-back-button"
        onClick={onBack}
      >
        Back to Join
      </button>
    </main>
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

  if (socket.status === 'removed') {
    return <ContestantRemoved reason={socket.removedReason} onBack={onLeave} />;
  }

  return (
    <main className={styles.play}>
      <ConnectionStatus status={socket.status} />
      <header className={styles.playerBar}>
        <span className={styles.playerBrand}>Jeopardy!</span>
        <div className={styles.playerBarMeta}>
          <p className={styles.roomCode} data-testid="room-code">
            Room Code: {roomCode}
          </p>
          <button
            type="button"
            className={styles.leaveButton}
            data-testid="leave-game-button"
            onClick={() => {
              socket.leaveGame?.();
              onLeave();
            }}
          >
            Leave Game
          </button>
        </div>
      </header>
      {isJoinError && (
        <div className={styles.error} role="alert" data-testid="join-error">
          <p>{error}</p>
          <button type="button" onClick={onTryAgain}>
            Try Again
          </button>
        </div>
      )}
      {isTransientError && (
        <div className={styles.errorToast} role="status" data-testid="transient-error" aria-live="polite">
          {error}
        </div>
      )}
      {gameState && (
        <div className={styles.state}>
          <div className={styles.playerCard}>
            <p className={styles.playerName} data-testid="contestant-welcome">
              Welcome, <span className={styles.contestantName}>{me?.name ?? 'Contestant'}</span>
            </p>
            <div className={styles.scoreBlock} aria-live="polite" aria-atomic="true">
              <span className={styles.scoreLabel}>Score:</span>
              <span className={`${styles.scoreDisplay} ${me?.score != null && me.score < 0 ? styles.negativeScore : ''}`}>
                {formatScore(me?.score ?? 0)}
              </span>
            </div>
          </div>
          <TeamBanner state={gameState} />
          <div className={styles.srOnly} aria-live="polite" aria-atomic="true">
            {getStatusDescription(gameState)}
          </div>
          {gameState.phase === 'LOBBY' && (
            <>
              {gameState.teamMode && !gameState.teamId ? (
                <TeamPicker state={gameState} onChoose={socket.chooseTeam} />
              ) : (
                <p>Waiting for the host to start the game.</p>
              )}
              <div className={styles.lobbyPlayers} data-testid="lobby-players">
                <p className={styles.lobbyPlayersHeading}>Players ({gameState.players.length})</p>
                <ul className={styles.playerList}>
                  {gameState.players.map((player) => (
                    <li
                      key={player.id}
                      className={styles.playerListItem}
                      data-testid={`lobby-player-${player.id}`}
                    >
                      <span className={styles.playerListName}>
                        <span className={styles.contestantName}>{player.name}</span>
                        {player.id === gameState.playerId ? ' (You)' : ''}
                      </span>
                      <span className={player.connected ? styles.statusConnected : styles.statusDisconnected}>
                        {player.connected ? 'connected' : 'disconnected'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
          {gameState.phase === 'ROUND_TRANSITION' && (
            <div data-testid="contestant-round-transition">
              <h2 data-testid="contestant-transition-heading">{transitionLabel}</h2>
              <p>Between-round scores</p>
              <ul data-testid="contestant-transition-scores">
                {getScoreHolders(gameState).map((holder) => (
                  <li key={holder.id} data-testid="contestant-transition-score">
                    <span className={styles.contestantName}>{holder.name}</span>
                    <span
                      className={`${styles.transitionScore} ${styles.scoreDisplay} ${holder.score < 0 ? styles.negativeScore : ''}`}
                    >
                      {formatScore(holder.score)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {gameState.phase === 'FINAL_INTRO' && (
            <div data-testid="contestant-final-intro">
              <h2 className={styles.finalHeading} data-testid="contestant-final-heading">Final Jeopardy!</h2>
              <p className={styles.finalCategory} data-testid="contestant-final-category">
                {gameState.round?.categories[0]?.title ?? 'Final Category'}
              </p>
              {gameState.isEligibleForFinal ? (
                <p data-testid="contestant-final-eligible">
                  {gameState.teamMode ? 'Your team is eligible for Final Jeopardy.' : 'You are eligible for Final Jeopardy.'} Wait for the host to open wagers.
                </p>
              ) : (
                <p data-testid="contestant-final-ineligible">
                  {gameState.teamMode ? 'Your team is not eligible for Final Jeopardy.' : 'You are not eligible for Final Jeopardy.'}
                </p>
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
              {gameState.clueSelectionMode === 'PLAYER' && gameState.isControllingPlayer ? (
                <p className={styles.instruction}>Select a clue from the board.</p>
              ) : gameState.clueSelectionMode === 'PLAYER' ? (
                <p className={styles.instruction}>
                  Waiting for{' '}
                  {gameState.teamMode
                    ? gameState.teams.find((t) => t.id === gameState.controllingTeamId)?.name ?? 'the controlling team'
                    : gameState.players.find((p) => p.id === gameState.controllingPlayerId)?.name ?? 'the controller'}{' '}
                  to select a clue.
                </p>
              ) : (
                <p className={styles.instruction}>Waiting for the host to select a clue.</p>
              )}
              <ContestantTeamScores state={gameState} />
              <ContestantGrid state={gameState} onSelectClue={socket.selectClue} />
            </>
          )}
          {gameState.phase === 'CLUE_SELECTED' && (
            <p className={styles.instruction} data-testid="contestant-clue-selected">
              {gameState.isControllingPlayer
                ? 'Clue selected. Waiting for the host to reveal it.'
                : 'A clue has been selected. Waiting for the host to reveal it.'}
            </p>
          )}
          {showBuzzer ? (
            <div className={styles.clueBox} data-testid="contestant-clue-overlay">
              <div className={styles.clueBoxText}>
                <p className={styles.clueText} data-testid="contestant-clue-text">{gameState.currentClueText}</p>
              </div>
              <div className={styles.buzzerZone}>
                <Countdown deadline={gameState.deadline} serverNow={gameState.serverNow} />
                <Buzzer key={gameState.currentClueId} state={gameState} onBuzz={socket.buzz} />
              </div>
            </div>
          ) : showClue ? (
            <div className={styles.clueBanner} data-testid="contestant-clue-overlay">
              <p className={styles.clueText} data-testid="contestant-clue-text">{gameState.currentClueText}</p>
            </div>
          ) : null}
          {gameState.phase === 'FINAL_CLUE' && (
            <>
              <Countdown deadline={gameState.deadline} serverNow={gameState.serverNow} />
              <FinalAnswer
                state={gameState}
                onSubmit={socket.submitFinalAnswer}
                onDraft={socket.submitFinalAnswerDraft}
                error={error}
                clearError={clearError}
                deadline={gameState.deadline}
                serverNow={gameState.serverNow}
              />
            </>
          )}
          {gameState.phase === 'FINAL_REVEAL' && <FinalReveal state={gameState} />}
          {gameState.phase === 'COMPLETE' && <FinalStandings state={gameState} />}
          {gameState.phase === 'DAILY_DOUBLE_WAGER' && (
            <DailyDoubleWager state={gameState} onSubmit={socket.submitDDWager} error={error} clearError={clearError} />
          )}
          {gameState.phase === 'DAILY_DOUBLE_CLUE' && gameState.isControllingPlayer && gameState.dailyDoubleWager != null && (
            <p data-testid="dd-wager-locked-amount">Your wager: {formatScore(gameState.dailyDoubleWager ?? 0)}</p>
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
      // A stale/invalid reconnect token keeps forcing the server onto the
      // failing reconnect branch, so clear it and retry as a clean fresh join.
      clearStoredContestantToken();
      setForm({ roomCode: form.roomCode, name: '', submitted: false });
    };
    const handleLeave = () => {
      clearStoredContestantToken();
      setForm({ roomCode: '', name: '', submitted: false });
    };
    return <ContestantLobby roomCode={trimmedRoomCode} name={form.name} onLeave={handleLeave} onTryAgain={handleTryAgain} />;
  }

  return (
    <main className={styles.entry}>
      <h1 className={styles.title}>Join Game</h1>
      <form
        className={styles.form}
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
          <p className={styles.error} role="alert">
            {validationError}
          </p>
        )}
        <label htmlFor="play-room-code">Room Code</label>
        <input
          id="play-room-code"
          className={styles.input}
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
          className={styles.input}
          value={form.name}
          onChange={(e) => {
            setForm({ ...form, name: e.target.value });
            setValidationError(null);
          }}
          placeholder="Your name"
        />
        <button type="submit" className={styles.button} disabled={!canSubmit}>
          Join Game
        </button>
      </form>
    </main>
  );
}
