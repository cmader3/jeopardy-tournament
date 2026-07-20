import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useSocket } from '../socket/useSocket.js';
import { Countdown, useCountdown } from '../components/Countdown.js';
import { FitText } from '../components/FitText.js';
import { RoundBanner } from '../components/RoundBanner.js';
import { AudioToggle } from '../components/AudioToggle.js';
import { ConnectionStatus } from '../components/ConnectionStatus.js';
import { useBoardAudio } from '../hooks/useBoardAudio.js';
import { useServerTime } from '../hooks/useServerTime.js';
import { formatScore } from '../format.js';
import type { BoardView, ProjectedPlayer } from '@jeopardy/shared';
import styles from './board.module.css';

interface ScoreboardProps {
  players: ProjectedPlayer[];
  controllingPlayerId?: string | null;
}

function Scoreboard({ players, controllingPlayerId }: ScoreboardProps) {
  return (
    <div className={styles.scoreboard} aria-live="polite" aria-atomic="false" data-testid="scoreboard">
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
            {formatScore(player.score)}
          </span>
        </div>
      ))}
    </div>
  );
}

interface BoardScoreHolder {
  id: string;
  name: string;
  score: number;
}

function getBoardHolders(state: BoardView): BoardScoreHolder[] {
  if (state.teamMode) {
    return state.teams.map((t) => ({ id: t.id, name: t.name, score: t.score }));
  }
  return state.players.map((p) => ({ id: p.id, name: p.name, score: p.score }));
}

function TeamScoreboard({
  teams,
  controllingTeamId,
}: {
  teams: BoardView['teams'];
  controllingTeamId?: string | null;
}) {
  return (
    <div className={styles.scoreboard} aria-live="polite" aria-atomic="false" data-testid="team-scoreboard">
      {teams.map((team) => (
        <div
          key={team.id}
          className={`${styles.scoreCard} ${team.id === controllingTeamId ? styles.controlling : ''}`}
          data-testid="team-score-card"
        >
          <span className={`${styles.name} ${styles.truncated}`} data-testid="team-score-name">
            {team.name}
          </span>
          <span className={`${styles.score} ${team.score < 0 ? styles.negative : ''}`}>
            {formatScore(team.score)}
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
  pendingClueId?: string | null;
}

function BoardGrid({ round, usedClueIds, pendingClueId }: BoardGridProps) {
  const maxRow = Math.max(0, ...round.categories.flatMap((c) => c.clues.map((clue) => clue.row)));
  const rows = Array.from({ length: maxRow + 1 }, (_, i) => i);

  return (
    <div
      className={styles.grid}
      data-testid="board-grid"
      style={{
        gridTemplateColumns: `repeat(${round.categories.length}, minmax(0, 1fr))`,
        gridTemplateRows: `auto repeat(${rows.length}, minmax(0, 1fr))`,
      }}
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
          const selected = !used && clue.id === pendingClueId;
          return (
            <div
              key={clue.id}
              className={`${styles.cell} ${used ? styles.cellUsed : ''} ${selected ? styles.cellSelected : ''}`}
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

interface ClueContentProps {
  clueText: string;
  isDailyDouble?: boolean;
}

function ClueContent({ clueText, isDailyDouble }: ClueContentProps) {
  if (isDailyDouble) {
    return (
      <div className={styles.dailyDoubleSplash} data-testid="daily-double-splash">
        DAILY DOUBLE
      </div>
    );
  }
  return (
    <FitText className={styles.clueText} data-testid="clue-text" maxFontSize={96} minFontSize={12}>
      {clueText}
    </FitText>
  );
}

function ArmedLights() {
  return (
    <div className={styles.armedLights} data-testid="armed-indicator-lights" aria-hidden="true">
      <span className={styles.armedLight} data-testid="armed-light" />
      <span className={styles.armedLight} data-testid="armed-light" />
      <span className={styles.armedLight} data-testid="armed-light" />
      <span className={styles.armedLight} data-testid="armed-light" />
      <span className={styles.armedLight} data-testid="armed-light" />
    </div>
  );
}

interface BuzzerStatusBarProps {
  deadline: number | null;
  serverNow: number;
}

function BuzzerStatusBar({ deadline, serverNow }: BuzzerStatusBarProps) {
  const countdown = useCountdown(deadline, serverNow);
  return (
    <div className={styles.statusGroup} role="status" aria-live="polite" aria-atomic="true">
      <div className={styles.buzzerBar} data-testid="armed-indicator">
        <div className={styles.buzzerBarHeader}>
          <ArmedLights />
          <span className={styles.buzzerLabel}>BUZZERS ARMED</span>
          <span className={styles.buzzerCount} data-testid="countdown">
            {countdown?.seconds ?? ''}
          </span>
        </div>
        {countdown && (
          <div className={styles.buzzerBarTrack} data-testid="countdown-bar-track">
            <div
              className={styles.buzzerBarFill}
              data-testid="countdown-bar"
              data-width-percent={countdown.widthPercent}
              style={{ width: `${countdown.widthPercent}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface GameStatusBannerProps {
  state: BoardView;
}

function GameStatusBanner({ state }: GameStatusBannerProps) {
  if (state.phase === 'BUZZERS_ARMED') {
    return <BuzzerStatusBar deadline={state.deadline} serverNow={state.serverNow} />;
  }

  if (state.phase === 'FINAL_CLUE') {
    return (
      <div className={styles.statusGroup} role="status" aria-live="polite" aria-atomic="true">
        <Countdown deadline={state.deadline} serverNow={state.serverNow} showBar />
      </div>
    );
  }

  if (state.phase === 'BUZZED' && state.buzzWinnerId) {
    const winner = state.players.find((p) => p.id === state.buzzWinnerId);
    if (winner) {
      const winnerTeam =
        state.teamMode && winner.teamId ? state.teams.find((t) => t.id === winner.teamId) : null;
      return (
        <div className={styles.buzzedIndicator} data-testid="buzzed-indicator" role="status" aria-live="polite" aria-atomic="true">
          Buzzed in: <strong data-testid="buzzed-player-name">{winner.name}{winnerTeam ? ` (${winnerTeam.name})` : ''}</strong>
        </div>
      );
    }
  }

  return null;
}

function isRoundStart(state: BoardView): boolean {
  if (!state.round || state.phase !== 'BOARD_SELECT') return false;
  const roundClueIds = new Set(state.round.categories.flatMap((c) => c.clues.map((clue) => clue.id)));
  return !state.usedClueIds.some((id) => roundClueIds.has(id));
}

const TRANSITION_LABELS: Record<'DOUBLE_JEOPARDY' | 'FINAL', string> = {
  DOUBLE_JEOPARDY: 'Double Jeopardy!',
  FINAL: 'Final Jeopardy!',
};

interface BetweenRoundScreenProps {
  state: BoardView;
}

function BetweenRoundScreen({ state }: BetweenRoundScreenProps) {
  const target = state.transitionTarget ?? 'FINAL';
  const label = TRANSITION_LABELS[target];

  return (
    <div className={styles.betweenRoundScreen} data-testid="between-round-screen">
      <h2 className={styles.betweenRoundHeading} data-testid="between-round-heading">
        {label}
      </h2>
      <div className={styles.betweenRoundScores} data-testid="between-round-scores">
        {getBoardHolders(state).map((holder) => (
          <div
            key={holder.id}
            className={`${styles.betweenRoundScore} ${holder.id === (state.teamMode ? state.controllingTeamId : state.controllingPlayerId) ? styles.controlling : ''}`}
            data-testid="between-round-score"
          >
            <span className={`${styles.name} ${styles.truncated}`}>{holder.name}</span>
            <span className={`${styles.score} ${holder.score < 0 ? styles.negative : ''}`}>
              {formatScore(holder.score)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
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

interface IncorrectFeedbackProps {
  state: BoardView;
}

function IncorrectFeedback({ state }: IncorrectFeedbackProps) {
  const outcome = state.lastOutcome;
  if (!outcome || outcome.type !== 'INCORRECT' || state.answer) return null;

  const player = state.players.find((p) => p.id === outcome.playerId);
  return (
    <div
      className={styles.incorrectFeedback}
      data-testid="incorrect-feedback"
      role="status"
      aria-live="polite"
    >
      <span className={styles.incorrectText}>
        Incorrect!{' '}
        <strong className={styles.incorrectPlayer}>{player?.name ?? 'Contestant'}</strong>{' '}
        <span className={styles.incorrectValue}>{`-$${outcome.value}`}</span>
      </span>
    </div>
  );
}

interface FinalIntroProps {
  state: BoardView;
}

interface FinalWagerProps {
  state: BoardView;
}

function FinalWager({ state }: FinalWagerProps) {
  const category = state.round?.categories[0];
  const eligibleSet = new Set(state.finalEligiblePlayerIds);

  return (
    <div className={styles.finalWager} data-testid="final-wager">
      <RoundBanner roundType="FINAL" />
      <div className={styles.finalCategory} data-testid="final-category">
        {category?.title ?? 'Final Category'}
      </div>
      <div className={styles.finalWagerStatus} data-testid="final-wager-status">
        <h3 className={styles.finalWagerHeading}>Wagers are being submitted</h3>
        <div className={styles.finalPlayerList} data-testid="final-wager-player-list">
          {getBoardHolders(state).map((holder) => {
            const eligible = eligibleSet.has(holder.id);
            const submitted = state.finalWagerSubmissionStatus[holder.id] ?? false;
            return (
              <div
                key={holder.id}
                className={`${styles.finalPlayer} ${eligible ? styles.finalEligible : styles.finalIneligible}`}
                data-testid="final-wager-player"
              >
                <span className={styles.finalPlayerName}>{holder.name}</span>
                <span className={styles.finalPlayerStatus} data-testid={eligible ? (submitted ? 'final-wager-submitted' : 'final-wager-pending') : 'final-wager-not-participating'}>
                  {eligible ? (submitted ? 'Wager submitted' : 'Pending') : 'Not participating'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FinalIntro({ state }: FinalIntroProps) {
  const category = state.round?.categories[0];
  const eligibleSet = new Set(state.finalEligiblePlayerIds);

  return (
    <div className={styles.finalIntro} data-testid="final-intro">
      <RoundBanner roundType="FINAL" />
      <div className={styles.finalCategory} data-testid="final-category">
        {category?.title ?? 'Final Category'}
      </div>
      <div className={styles.finalEligibility}>
        <h3 className={styles.finalEligibilityHeading}>Final Jeopardy Eligibility</h3>
        {getBoardHolders(state).length === 0 ? (
          <p className={styles.finalNoPlayers}>{state.teamMode ? 'No teams joined.' : 'No contestants joined.'}</p>
        ) : (
          <div className={styles.finalPlayerList} data-testid="final-player-list">
            {getBoardHolders(state).map((holder) => {
              const eligible = eligibleSet.has(holder.id);
              return (
                <div
                  key={holder.id}
                  className={`${styles.finalPlayer} ${eligible ? styles.finalEligible : styles.finalIneligible}`}
                  data-testid="final-player"
                >
                  <span className={styles.finalPlayerName}>{holder.name}</span>
                  <span className={styles.finalPlayerStatus} data-testid={eligible ? 'eligible' : 'not-participating'}>
                    {eligible ? 'Eligible' : 'Not participating'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface CompleteScreenProps {
  state: BoardView;
}

function FinalStandings({ state }: CompleteScreenProps) {
  const sorted = [...getBoardHolders(state)].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? null;
  const coWinners = topScore != null ? sorted.filter((p) => p.score === topScore).map((p) => p.id) : [];

  return (
    <div className={styles.finalStandings} data-testid="final-standings">
      <h2 className={styles.finalStandingsHeading} data-testid="final-standings-heading">Final Standings</h2>
      <div className={styles.finalStandingsList} data-testid="final-standings-list">
        {sorted.map((holder) => {
          const isWinner = coWinners.includes(holder.id);
          return (
            <div
              key={holder.id}
              className={`${styles.finalStanding} ${isWinner ? styles.finalStandingWinner : ''}`}
              data-testid="final-standing"
            >
              <span className={styles.finalStandingBadge}>
                {isWinner && (
                  <span className={styles.finalWinnerBadge} data-testid={`final-winner-${holder.id}`}>
                    Winner
                  </span>
                )}
              </span>
              <span className={`${styles.name} ${styles.truncated}`} data-testid={`final-standing-name-${holder.id}`}>
                {holder.name}
              </span>
              <span className={`${styles.score} ${holder.score < 0 ? styles.negative : ''}`} data-testid={`final-standing-score-${holder.id}`}>
                {formatScore(holder.score)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompleteScreen({ state }: CompleteScreenProps) {
  return (
    <div className={styles.finalIntro} data-testid={state.finalNoEligiblePlayers ? 'final-no-eligible' : 'final-standings'}>
      <RoundBanner roundType="FINAL" />
      {state.finalNoEligiblePlayers && (
        <p className={styles.finalNoEligibleMessage} data-testid="final-no-eligible-message">
          No contestants were eligible for Final Jeopardy.
        </p>
      )}
      <FinalStandings state={state} />
    </div>
  );
}

interface FinalRevealProps {
  state: BoardView;
}

function FinalReveal({ state }: FinalRevealProps) {
  const holders = getBoardHolders(state);
  const findHolder = (id: string | null) => (id ? holders.find((h) => h.id === id) : undefined);
  const currentPlayerId = state.finalRevealOrder[state.finalRevealIndex] ?? null;
  const currentPlayer = findHolder(currentPlayerId);
  const currentAnswer = currentPlayerId ? state.finalRevealedAnswers[currentPlayerId] : undefined;
  const currentWager = currentPlayerId ? state.finalRevealedWagers[currentPlayerId] : undefined;
  const revealedPlayerIds = state.finalRevealOrder.slice(0, state.finalRevealIndex);

  return (
    <div className={styles.finalReveal} data-testid="final-reveal">
      <h2 className={styles.finalRevealHeading} data-testid="final-reveal-heading">Final Jeopardy Reveal</h2>
      {currentPlayer && (
        <div className={styles.finalRevealCurrent} data-testid="final-reveal-current">
          <p className={styles.finalRevealPlayerName} data-testid="final-reveal-player-name">
            {currentPlayer.name}
          </p>
          <p className={`${styles.finalRevealPlayerScore} ${currentPlayer.score < 0 ? styles.negative : ''}`} data-testid="final-reveal-player-score">
            {formatScore(currentPlayer.score)}
          </p>
          {currentAnswer !== undefined && (
            <p className={styles.finalRevealAnswer} data-testid="final-reveal-answer">
              {currentAnswer}
            </p>
          )}
          {currentWager !== undefined && (
            <p className={styles.finalRevealWager} data-testid="final-reveal-wager">
              Wager: {formatScore(currentWager)}
            </p>
          )}
          {state.lastOutcome && (
            <p
              className={
                state.lastOutcome.type === 'CORRECT' ? styles.finalRevealCorrect : styles.finalRevealIncorrect
              }
              data-testid="final-reveal-outcome"
            >
              {state.lastOutcome.type === 'CORRECT' ? 'Correct!' : 'Incorrect!'}
            </p>
          )}
        </div>
      )}
      {revealedPlayerIds.length > 0 && (
        <div className={styles.finalRevealedList} data-testid="final-revealed-list">
          <h3>Revealed</h3>
          <div className={styles.finalRevealedGrid}>
            {revealedPlayerIds.map((playerId) => {
              const player = findHolder(playerId);
              if (!player) return null;
              return (
                <div key={playerId} className={styles.finalRevealedPlayer} data-testid="final-revealed-player">
                  <span className={styles.finalRevealPlayerName}>{player.name}</span>
                  <span className={`${styles.finalRevealPlayerScore} ${player.score < 0 ? styles.negative : ''}`}>{formatScore(player.score)}</span>
                  <span data-testid={`final-revealed-answer-${playerId}`}>{state.finalRevealedAnswers[playerId]}</span>
                  <span data-testid={`final-revealed-wager-${playerId}`}>{formatScore(state.finalRevealedWagers[playerId])}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function renderStage(state: BoardView) {
  if (state.phase === 'ROUND_TRANSITION') {
    return <BetweenRoundScreen state={state} />;
  }

  if (state.phase === 'FINAL_INTRO') {
    return <FinalIntro state={state} />;
  }

  if (state.phase === 'FINAL_WAGER') {
    return <FinalWager state={state} />;
  }

  if (state.phase === 'FINAL_REVEAL') {
    return <FinalReveal state={state} />;
  }

  if (state.phase === 'COMPLETE') {
    return <CompleteScreen state={state} />;
  }

  const hasIncorrectFlash = Boolean(
    state.lastOutcome && state.lastOutcome.type === 'INCORRECT' && !state.answer,
  );

  const clueContent =
    state.currentClueId && state.currentClueText ? (
      <ClueContent clueText={state.currentClueText} />
    ) : state.phase === 'DAILY_DOUBLE_WAGER' ? (
      <ClueContent clueText="" isDailyDouble />
    ) : null;

  if (clueContent) {
    return (
      <div className={styles.clueStage}>
        <div className={styles.clueScreen} data-testid="clue-overlay">
          <div className={styles.clueTopZone} data-testid="clue-status-band-top">
            {hasIncorrectFlash && <IncorrectFeedback state={state} />}
          </div>
          <div className={styles.clueMainZone}>{clueContent}</div>
          <div className={styles.clueBottomZone} data-testid="clue-status-band">
            <GameStatusBanner state={state} />
          </div>
        </div>
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

  const answerBanner = state.answer ? <AnswerBanner state={state} /> : null;

  if (state.round) {
    return (
      <div className={styles.roundStage}>
        {answerBanner}
        {state.phase === 'CLUE_SELECTED' && (
          <p className={styles.selectedBanner} data-testid="board-clue-selected">
            Clue selected — waiting for the host to reveal it.
          </p>
        )}
        {isRoundStart(state) && <RoundBanner roundType={state.round.type} />}
        <BoardGrid round={state.round} usedClueIds={state.usedClueIds} pendingClueId={state.pendingClueId} />
      </div>
    );
  }

  if (answerBanner) {
    return <div className={styles.clueStage}>{answerBanner}</div>;
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
  const { muted, toggleMute, playCue, setThinkMusic } = useBoardAudio();

  const prevPhaseRef = useRef<BoardView['phase'] | null>(null);
  const prevDeadlineRef = useRef<number | null>(null);
  const timeUpFiredForDeadlineRef = useRef<number | null>(null);
  const serverNow = useServerTime(state?.serverNow ?? 0);
  const serverNowRef = useRef(serverNow);

  useEffect(() => {
    serverNowRef.current = serverNow;
  }, [serverNow]);

  useEffect(() => {
    if (!state) return;

    const phase = state.phase;
    const prevPhase = prevPhaseRef.current;
    const prevDeadline = prevDeadlineRef.current;

    if (prevPhase !== 'BUZZERS_ARMED' && phase === 'BUZZERS_ARMED') {
      playCue('armed');
    }

    // Transition detection: fire timeUp when leaving a timed phase due to
    // expiry. This handles the case where the server broadcasts the phase
    // transition before the local setTimeout fires, causing the effect cleanup
    // to cancel the scheduled cue. Both paths key on the same numeric deadline
    // so timeUp fires at most once per deadline.

    // BUZZERS_ARMED expiry: left for a non-buzz, non-armed phase. No
    // serverNow >= deadline guard: the client-extrapolated server clock
    // (useServerTime, 100ms tick + offset error) typically lags behind
    // the real server time at the moment the expiry transition broadcast
    // arrives, making the guard false and suppressing the cue. The only
    // non-buzz exit from BUZZERS_ARMED is to BOARD_SELECT (clue done via
    // time expiry or host reveal), so firing on any such transition is
    // correct. An early host reveal also plays the time-up cue, which is
    // acceptable and not a contract violation.
    if (
      prevPhase === 'BUZZERS_ARMED' &&
      phase !== 'BUZZERS_ARMED' &&
      phase !== 'BUZZED' &&
      prevDeadline != null &&
      timeUpFiredForDeadlineRef.current !== prevDeadline
    ) {
      timeUpFiredForDeadlineRef.current = prevDeadline;
      playCue('timeUp');
    }

    // FINAL_CLUE expiry: FINAL_CLUE only ever exits via time expiry (to
    // FINAL_REVEAL or COMPLETE), so no deadline guard is needed.
    if (
      prevPhase === 'FINAL_CLUE' &&
      phase !== 'FINAL_CLUE' &&
      prevDeadline != null &&
      timeUpFiredForDeadlineRef.current !== prevDeadline
    ) {
      timeUpFiredForDeadlineRef.current = prevDeadline;
      playCue('timeUp');
    }

    prevDeadlineRef.current = state.deadline;
    prevPhaseRef.current = phase;
  }, [state, playCue]);

  // Loop the "think" music while a clue or Final countdown is running, and stop
  // it as soon as the phase ends (buzz-in, time-up, or reveal).
  useEffect(() => {
    const phase = state?.phase;
    // In Final Jeopardy the clue is revealed before the host starts the timer,
    // so the think music must wait until the answer timer is actually running.
    const finalTimerRunning = phase === 'FINAL_CLUE' && state?.deadline != null;
    setThinkMusic(phase === 'BUZZERS_ARMED' || finalTimerRunning);
  }, [state?.phase, state?.deadline, setThinkMusic]);

  // Dedicated deadline-based effect for the timeUp cue. Serves as a backup
  // for the no-broadcast case (e.g., server doesn't broadcast the transition).
  // Both this path and the transition-detection path key on the same numeric
  // deadline so timeUp fires at most once per deadline.
  useEffect(() => {
    const deadline = state?.deadline;
    const phase = state?.phase;
    if (deadline == null || (phase !== 'BUZZERS_ARMED' && phase !== 'FINAL_CLUE')) return;
    if (deadline < serverNowRef.current) return;

    const delay = Math.max(0, deadline - serverNowRef.current);
    const timer = setTimeout(() => {
      if (timeUpFiredForDeadlineRef.current !== deadline) {
        timeUpFiredForDeadlineRef.current = deadline;
        playCue('timeUp');
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [state?.deadline, state?.phase, playCue]);

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
      <ConnectionStatus status={socket.status} />
      <header className={styles.header}>
        <h1 className={styles.headerTitle}>Board</h1>
        <p className={styles.roomCode} data-testid="room-code">
          Room Code: {roomCode}
        </p>
        <AudioToggle muted={muted} onToggle={toggleMute} />
        <button
          type="button"
          className={styles.leaveButton}
          data-testid="board-leave-game-button"
          onClick={() => {
            socket.leaveGame?.();
            onReset();
          }}
        >
          Leave Game
        </button>
      </header>
      <div className={styles.stage}>{renderStage(state)}</div>
      <div className={styles.shareSection}>
        <p className={styles.shareLabel}>Share this board display:</p>
        <ShareableLink roomCode={roomCode} />
      </div>
      {state.phase !== 'COMPLETE' &&
        (state.teamMode ? (
          <TeamScoreboard teams={state.teams} controllingTeamId={state.controllingTeamId} />
        ) : (
          <Scoreboard players={state.players} controllingPlayerId={state.controllingPlayerId} />
        ))}
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
