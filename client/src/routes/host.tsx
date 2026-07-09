import { useCallback, useEffect, useState } from 'react';
import { PasscodeGate } from '../components/PasscodeGate.js';
import { useHostAuth } from '../auth/useHostAuth.js';
import { boardApi, BoardSummary } from '../api/boards.js';
import { createGame } from '../api/games.js';
import { useSocket } from '../socket/useSocket.js';
import { Countdown } from '../components/Countdown.js';
import type { HostView, ClueSelectionMode } from '@jeopardy/shared';
import styles from './host.module.css';

export interface HostLobbyProps {
  roomCode: string;
  state: HostView | null;
  onStartGame: () => void;
  onCreateNewGame?: () => void;
  onSetClueSelectionMode?: (mode: ClueSelectionMode) => void;
  onRemovePlayer?: (playerId: string) => void;
  startError: string | null;
}

function ClueSelectionToggle({
  mode,
  onSetMode,
}: {
  mode: ClueSelectionMode;
  onSetMode?: (mode: ClueSelectionMode) => void;
}) {
  return (
    <div className={styles.clueModeToggle} data-testid="clue-mode-toggle">
      <span className={styles.clueModeLabel}>Clue selection</span>
      <div className={styles.clueModeOptions} role="group" aria-label="Clue selection mode">
        <button
          type="button"
          className={`${styles.clueModeButton} ${mode === 'HOST' ? styles.clueModeActive : ''}`}
          aria-pressed={mode === 'HOST'}
          onClick={() => onSetMode?.('HOST')}
          data-testid="clue-mode-host"
        >
          Host picks clues
        </button>
        <button
          type="button"
          className={`${styles.clueModeButton} ${mode === 'PLAYER' ? styles.clueModeActive : ''}`}
          aria-pressed={mode === 'PLAYER'}
          onClick={() => onSetMode?.('PLAYER')}
          data-testid="clue-mode-player"
        >
          Players pick clues
        </button>
      </div>
      <p className={styles.clueModeHint} data-testid="clue-mode-hint">
        {mode === 'PLAYER'
          ? 'The controlling player picks a clue, then you reveal it.'
          : 'Only you can pick clues, and they reveal immediately.'}
      </p>
    </div>
  );
}

export function HostLobby({ roomCode, state, onStartGame, onCreateNewGame, onSetClueSelectionMode, onRemovePlayer, startError }: HostLobbyProps) {
  const playerCount = state?.players.length ?? 0;
  const connectedCount = state?.players.filter((p) => p.connected).length ?? 0;
  const canStart = connectedCount > 0;
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null);

  return (
    <main className={styles.hostLobby}>
      <h1>Host Lobby</h1>
      <p className={styles.roomCode} data-testid="room-code">
        Room Code: {roomCode}
      </p>
      {startError && (
        <p className="error" role="alert">
          {startError}
        </p>
      )}
      <h2>Players</h2>
      {playerCount === 0 ? (
        <p>Waiting for players...</p>
      ) : (
        <ul className={styles.playerList}>
          {state?.players.map((player) => (
            <li key={player.id}>
              <span className={styles.playerName}>{player.name}</span>{' '}
              <span
                className={`${player.connected ? styles.statusConnected : styles.statusDisconnected}`}
                data-testid={`player-status-${player.id}`}
              >
                {player.connected ? 'connected' : 'disconnected'}
              </span>
              <button
                type="button"
                className={styles.removePlayerButton}
                onClick={() => setPendingRemoval({ id: player.id, name: player.name })}
                data-testid={`remove-player-${player.id}`}
                aria-label={`Remove ${player.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <ClueSelectionToggle mode={state?.clueSelectionMode ?? 'HOST'} onSetMode={onSetClueSelectionMode} />
      <div className={styles.startControls}>
        <button
          type="button"
          className={styles.actionButton}
          onClick={onStartGame}
          disabled={!canStart}
          aria-disabled={!canStart}
          data-testid="start-game-button"
        >
          Start Game
        </button>
        {onCreateNewGame && (
          <button type="button" className={styles.actionButton} onClick={onCreateNewGame}>
            New Game
          </button>
        )}
        {connectedCount === 0 && (
          <p className={styles.minimumPlayers}>At least one connected contestant is required to start.</p>
        )}
      </div>
      {pendingRemoval && (
        <div className={styles.confirmDialogModal} role="alertdialog" aria-modal="true">
          <div className={styles.confirmCard}>
            <p>Remove {pendingRemoval.name} from the game? They will be removed from the lobby.</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => {
                  onRemovePlayer?.(pendingRemoval.id);
                  setPendingRemoval(null);
                }}
                data-testid="confirm-remove-player-button"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => setPendingRemoval(null)}
                data-testid="cancel-remove-player-button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export interface HostInProgressProps {
  roomCode: string;
  state: HostView | null;
  onSelectClue?: (clueId: string) => void;
  onSetClueSelectionMode?: (mode: ClueSelectionMode) => void;
  onRevealSelectedClue?: () => void;
  onRevealClue?: () => void;
  onRevealAnswer?: () => void;
  onArmBuzzers?: () => void;
  onRuleCorrect?: () => void;
  onRuleIncorrect?: (playerId: string) => void;
  onAdjustScore?: (playerId: string, score: number) => void;
  onUndoLastRuling?: () => void;
  onCancelDailyDouble?: () => void;
  onAdvanceRound?: () => void;
  onOpenFinalWagers?: () => void;
  onForceFinalWagers?: () => void;
  onOverrideControl?: (playerId: string) => void;
  onRevealFinalAnswer?: () => void;
  onRuleFinalCorrect?: () => void;
  onRuleFinalIncorrect?: () => void;
  onRevealFinalWager?: () => void;
}

function HostGrid({
  state,
  onSelectClue,
}: {
  state: HostView;
  onSelectClue?: (clueId: string) => void;
}) {
  if (!state.round) return <p>No active round.</p>;

  const maxRow = Math.max(0, ...state.round.categories.flatMap((c) => c.clues.map((clue) => clue.row)));
  const rows = Array.from({ length: maxRow + 1 }, (_, i) => i);

  return (
    <div
      className={styles.hostGrid}
      data-testid="host-grid"
      style={{ gridTemplateColumns: `repeat(${state.round.categories.length}, 1fr)` }}
    >
      {state.round.categories.map((category) => (
        <div key={category.id} className={styles.hostCategoryHeader} data-testid="host-category-header">
          {category.title}
          {category.clues.some((c) => c.isDailyDouble) && <span data-testid="dd-marker"> (DD)</span>}
        </div>
      ))}
      {rows.map((row) =>
        state.round!.categories.map((category) => {
          const clue = category.clues.find((c) => c.row === row);
          if (!clue) return <div key={`${category.id}-${row}`} className={styles.hostCell} />;
          const used = state.usedClueIds.includes(clue.id);
          return (
            <button
              key={clue.id}
              type="button"
              className={styles.hostCell}
              data-testid={used ? 'host-used-cell' : 'host-clue-cell'}
              data-clue-id={clue.id}
              disabled={used}
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

interface RosterItemProps {
  player: HostView['players'][number];
  isController: boolean;
  onAdjustScore?: (playerId: string, score: number) => void;
  onOverrideControl?: (playerId: string) => void;
  canAssignControl?: boolean;
}

function RosterItem({ player, isController, onAdjustScore, onOverrideControl, canAssignControl }: RosterItemProps) {
  const [draft, setDraft] = useState(String(player.score));

  const handleApply = () => {
    const value = Number(draft);
    if (!Number.isNaN(value)) {
      onAdjustScore?.(player.id, value);
    }
  };

  return (
    <li
      data-testid={`roster-item-${player.id}`}
      className={isController ? styles.controllingRosterItem : undefined}
    >
      <span className={styles.playerName} data-testid={`roster-name-${player.id}`}>
        {player.name}
      </span>
      {isController && (
        <span className={styles.controllerBadge} data-testid={`controller-badge-${player.id}`}>
          Controller
        </span>
      )}
      <span
        className={`${styles.playerScore} ${player.score < 0 ? styles.negativeScore : ''}`}
        data-testid={`roster-score-${player.id}`}
      >
        {player.score}
      </span>
      <input
        type="number"
        className={styles.scoreInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        data-testid={`score-input-${player.id}`}
        aria-label={`Adjust score for ${player.name}`}
      />
      <button
        type="button"
        className={styles.actionButton}
        onClick={handleApply}
        data-testid={`apply-score-${player.id}`}
      >
        Set
      </button>
      {canAssignControl && !isController && onOverrideControl && (
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => onOverrideControl(player.id)}
          data-testid={`assign-control-${player.id}`}
        >
          Assign Control
        </button>
      )}
      <span
        className={`${player.connected ? styles.statusConnected : styles.statusDisconnected}`}
        data-testid={`player-status-${player.id}`}
      >
        {player.connected ? 'connected' : 'disconnected'}
      </span>
    </li>
  );
}

function HostAnswerBanner({ state }: { state: HostView }) {
  if (!state.answer) return null;
  const outcome = state.lastOutcome;
  const player = outcome ? state.players.find((p) => p.id === outcome.playerId) : undefined;
  const outcomeLabel =
    outcome?.type === 'CORRECT'
      ? `Correct! ${player?.name ?? ''} +$${outcome.value}`
      : outcome?.type === 'INCORRECT'
        ? `Incorrect! ${player?.name ?? ''} -$${outcome.value}`
        : null;
  const bannerClass =
    outcome?.type === 'CORRECT'
      ? `${styles.answerBanner} ${styles.correct}`
      : outcome?.type === 'INCORRECT'
        ? `${styles.answerBanner} ${styles.incorrect}`
        : styles.answerBanner;

  return (
    <div className={bannerClass} data-testid="host-answer-banner" role="status" aria-live="polite">
      <p className={styles.label}>Answer:</p>
      <p className={styles.text} data-testid="host-answer-text">
        {state.answer}
      </p>
      {outcomeLabel && <p data-testid="host-outcome-label">{outcomeLabel}</p>}
    </div>
  );
}

const ROUND_LABELS: Record<'DOUBLE_JEOPARDY' | 'FINAL', string> = {
  DOUBLE_JEOPARDY: 'Double Jeopardy!',
  FINAL: 'Final Jeopardy!',
};

interface HostRoundTransitionProps {
  state: HostView;
  onAdvanceRound?: () => void;
}

function HostRoundTransition({ state, onAdvanceRound }: HostRoundTransitionProps) {
  const target = state.transitionTarget ?? 'FINAL';
  const label = ROUND_LABELS[target];

  return (
    <div className={styles.roundTransition} data-testid="round-transition">
      <h2 data-testid="transition-heading">{label}</h2>
      <p>Between-round scores</p>
      <ul className={styles.transitionScores} data-testid="transition-scores">
        {state.players.map((player) => (
          <li key={player.id} data-testid={`transition-score-${player.id}`}>
            <span className={styles.playerName}>{player.name}</span>
            <span className={`${styles.playerScore} ${player.score < 0 ? styles.negativeScore : ''}`}>
              {player.score}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={styles.actionButton}
        onClick={onAdvanceRound}
        data-testid="continue-round-button"
      >
        Continue to {label}
      </button>
    </div>
  );
}

interface HostFinalIntroProps {
  state: HostView;
  onOpenFinalWagers?: () => void;
}

function HostFinalIntro({ state, onOpenFinalWagers }: HostFinalIntroProps) {
  const category = state.round?.categories[0];
  const eligibleSet = new Set(state.finalEligiblePlayerIds);
  const hasEligible = eligibleSet.size > 0;

  return (
    <div className={styles.hostFinalIntro} data-testid="host-final-intro">
      <h2 data-testid="host-final-heading">Final Jeopardy!</h2>
      <div className={styles.hostFinalCategory} data-testid="host-final-category">
        {category?.title ?? 'Final Category'}
      </div>
      <h3>Eligibility</h3>
      <ul className={styles.hostFinalEligibility} data-testid="host-final-eligibility">
        {state.players.map((player) => {
          const eligible = eligibleSet.has(player.id);
          return (
            <li
              key={player.id}
              className={eligible ? styles.hostFinalEligible : styles.hostFinalIneligible}
              data-testid={eligible ? 'host-final-eligible' : 'host-final-ineligible'}
            >
              <span className={styles.playerName}>{player.name}</span>
              <span className={styles.playerScore}>{player.score}</span>
              <span>{eligible ? 'Eligible' : 'Not participating'}</span>
            </li>
          );
        })}
      </ul>
      {hasEligible ? (
        <button
          type="button"
          className={styles.actionButton}
          onClick={onOpenFinalWagers}
          data-testid="open-final-wagers-button"
        >
          Open Final Wagers
        </button>
      ) : (
        <>
          <p className={styles.hostNoEligible} data-testid="host-no-eligible">
            No contestants are eligible for Final Jeopardy. The game will proceed to final standings.
          </p>
          <button
            type="button"
            className={styles.actionButton}
            onClick={onOpenFinalWagers}
            data-testid="proceed-to-standings-button"
          >
            Proceed to Final Standings
          </button>
        </>
      )}
    </div>
  );
}

interface HostFinalWagerProps {
  state: HostView;
  onForceFinalWagers?: () => void;
}

interface HostFinalClueProps {
  state: HostView;
}

function HostFinalClue({ state }: HostFinalClueProps) {
  const category = state.round?.categories[0];
  const eligibleSet = new Set(state.finalEligiblePlayerIds);

  return (
    <div className={styles.hostFinalClue} data-testid="host-final-clue">
      <h2 data-testid="host-final-clue-heading">Final Jeopardy Clue</h2>
      <div className={styles.hostFinalCategory} data-testid="host-final-category">
        {category?.title ?? 'Final Category'}
      </div>
      <p className={styles.hostFinalClueText} data-testid="host-final-clue-text">
        {state.currentClueText}
      </p>
      <Countdown deadline={state.deadline} serverNow={state.serverNow} />
      <ul className={styles.hostFinalAnswerList} data-testid="host-final-answer-list">
        {state.players.map((player) => {
          const eligible = eligibleSet.has(player.id);
          const submitted = state.finalAnswerSubmissionStatus[player.id] ?? false;
          return (
            <li key={player.id} data-testid={`host-final-answer-player-${player.id}`}>
              <span className={styles.playerName}>{player.name}</span>
              <span className={styles.playerScore}>{player.score}</span>
              {eligible ? (
                <span data-testid={submitted ? 'host-final-answer-submitted' : 'host-final-answer-pending'}>
                  {submitted ? 'Answer submitted' : 'Pending'}
                </span>
              ) : (
                <span data-testid="host-final-answer-not-participating">Not participating</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface HostFinalRevealProps {
  state: HostView;
  onRevealFinalAnswer?: () => void;
  onRuleFinalCorrect?: () => void;
  onRuleFinalIncorrect?: () => void;
  onRevealFinalWager?: () => void;
}

function HostFinalReveal({
  state,
  onRevealFinalAnswer,
  onRuleFinalCorrect,
  onRuleFinalIncorrect,
  onRevealFinalWager,
}: HostFinalRevealProps) {
  const currentPlayerId = state.finalRevealOrder[state.finalRevealIndex] ?? null;
  const currentPlayer = currentPlayerId ? state.players.find((p) => p.id === currentPlayerId) : undefined;
  const currentAnswer = currentPlayerId ? state.finalRevealedAnswers[currentPlayerId] : undefined;
  const currentWager = currentPlayerId ? state.finalRevealedWagers[currentPlayerId] : undefined;
  const revealedPlayerIds = state.finalRevealOrder.slice(0, state.finalRevealIndex);

  return (
    <div className={styles.hostFinalReveal} data-testid="host-final-reveal">
      <h2 data-testid="host-final-reveal-heading">Final Jeopardy Reveal</h2>
      {currentPlayer && (
        <div className={styles.hostFinalRevealCurrent} data-testid="host-final-reveal-current">
          <p data-testid="host-final-reveal-player-name">
            {currentPlayer.name} — <span data-testid="host-final-reveal-player-score">${currentPlayer.score}</span>
          </p>
          {state.finalRevealStep === 'ANSWER' && (
            <button
              type="button"
              className={styles.actionButton}
              onClick={onRevealFinalAnswer}
              data-testid="host-reveal-final-answer-button"
            >
              Reveal Answer
            </button>
          )}
          {state.finalRevealStep === 'RULE' && (
            <>
              <p className={styles.hostFinalRevealAnswer} data-testid="host-final-reveal-answer">
                {currentAnswer}
              </p>
              <div className={styles.actionRow} data-testid="host-final-ruling-buttons">
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={onRuleFinalCorrect}
                  data-testid="host-rule-final-correct-button"
                >
                  Correct
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={onRuleFinalIncorrect}
                  data-testid="host-rule-final-incorrect-button"
                >
                  Incorrect
                </button>
              </div>
            </>
          )}
          {state.finalRevealStep === 'WAGER' && (
            <>
              <p className={styles.hostFinalRevealAnswer} data-testid="host-final-reveal-answer">
                {currentAnswer}
              </p>
              <p className={styles.hostFinalRevealWager} data-testid="host-final-reveal-wager">
                {'Wager: $'}{currentWager}
              </p>
              <button
                type="button"
                className={styles.actionButton}
                onClick={onRevealFinalWager}
                data-testid="host-reveal-final-wager-button"
              >
                Reveal Wager / Next
              </button>
            </>
          )}
        </div>
      )}
      {revealedPlayerIds.length > 0 && (
        <div className={styles.hostFinalRevealedList} data-testid="host-final-revealed-list">
          <h3>Revealed</h3>
          <ul>
            {revealedPlayerIds.map((playerId) => {
              const player = state.players.find((p) => p.id === playerId);
              if (!player) return null;
              return (
                <li key={playerId} data-testid={`host-final-revealed-player-${playerId}`}>
                  <span className={styles.playerName}>{player.name}</span>
                  <span className={styles.playerScore}>${player.score}</span>
                  <span data-testid={`host-final-revealed-answer-${playerId}`}>{state.finalRevealedAnswers[playerId]}</span>
                  <span data-testid={`host-final-revealed-wager-${playerId}`}>${state.finalRevealedWagers[playerId]}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

interface HostFinalStandingsProps {
  state: HostView;
}

function HostFinalStandings({ state }: HostFinalStandingsProps) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? null;
  const coWinners = topScore != null ? sorted.filter((p) => p.score === topScore).map((p) => p.id) : [];

  return (
    <div className={styles.hostFinalStandings} data-testid="host-final-standings">
      {state.finalNoEligiblePlayers && (
        <p className={styles.hostNoEligible} data-testid="host-no-eligible-standings">
          No contestants were eligible for Final Jeopardy.
        </p>
      )}
      <h2 data-testid="host-final-standings-heading">Final Standings</h2>
      <ul className={styles.hostFinalStandingsList} data-testid="host-final-standings-list">
        {sorted.map((player) => (
          <li
            key={player.id}
            className={coWinners.includes(player.id) ? styles.hostFinalWinner : undefined}
            data-testid={`host-final-standing-${player.id}`}
          >
            <span className={styles.playerName}>{player.name}</span>
            <span className={`${styles.playerScore} ${player.score < 0 ? styles.negativeScore : ''}`}>
              {player.score}
            </span>
            {coWinners.includes(player.id) && (
              <span className={styles.hostFinalWinnerBadge} data-testid={`host-final-winner-${player.id}`}>
                Winner
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HostFinalWager({ state, onForceFinalWagers }: HostFinalWagerProps) {
  const eligibleSet = new Set(state.finalEligiblePlayerIds);

  return (
    <div className={styles.hostFinalWager} data-testid="host-final-wager">
      <h2 data-testid="host-final-wager-heading">Final Jeopardy Wagers</h2>
      <p data-testid="host-final-wager-instruction">Waiting for eligible contestants to submit their wagers.</p>
      <ul className={styles.hostFinalWagerList} data-testid="host-final-wager-list">
        {state.players.map((player) => {
          const eligible = eligibleSet.has(player.id);
          const submitted = state.finalWagerSubmissionStatus[player.id] ?? false;
          return (
            <li key={player.id} data-testid={`host-final-wager-player-${player.id}`}>
              <span className={styles.playerName}>{player.name}</span>
              <span className={styles.playerScore}>{player.score}</span>
              {eligible ? (
                <span data-testid={submitted ? 'host-final-wager-submitted' : 'host-final-wager-pending'}>
                  {submitted ? 'Wager submitted' : 'Pending'}
                </span>
              ) : (
                <span data-testid="host-final-wager-not-participating">Not participating</span>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className={styles.actionButton}
        onClick={onForceFinalWagers}
        data-testid="force-final-wagers-button"
      >
        Reveal Final Clue
      </button>
    </div>
  );
}

export function HostInProgress({
  roomCode,
  state,
  onSelectClue,
  onSetClueSelectionMode,
  onRevealSelectedClue,
  onRevealClue,
  onRevealAnswer,
  onArmBuzzers,
  onRuleCorrect,
  onRuleIncorrect,
  onAdjustScore,
  onUndoLastRuling,
  onCancelDailyDouble,
  onAdvanceRound,
  onOpenFinalWagers,
  onForceFinalWagers,
  onOverrideControl,
  onRevealFinalAnswer,
  onRuleFinalCorrect,
  onRuleFinalIncorrect,
  onRevealFinalWager,
}: HostInProgressProps) {
  const players = state?.players ?? [];
  const currentClue = state?.currentClueId
    ? state?.round?.categories.flatMap((c) => c.clues).find((c) => c.id === state.currentClueId)
    : null;
  const pendingCategory = state?.pendingClueId
    ? state?.round?.categories.find((c) => c.clues.some((cl) => cl.id === state.pendingClueId))
    : null;
  const pendingClue = pendingCategory?.clues.find((cl) => cl.id === state?.pendingClueId) ?? null;
  const controllerName = state?.controllingPlayerId
    ? players.find((p) => p.id === state.controllingPlayerId)?.name ?? null
    : null;
  const buzzedPlayer = state?.buzzWinnerId ? players.find((p) => p.id === state.buzzWinnerId) : null;
  // Enable "undo last ruling" only when there is an actual ruling (correct or
  // incorrect) to undo. Manual score adjustments are not undoable via this control.
  const hasUndoableRuling = state?.auditLog?.some(
    (record) => record.type === 'CORRECT' || record.type === 'INCORRECT',
  );

  const showControls = currentClue || state?.answer;

  if (state?.phase === 'ROUND_TRANSITION') {
    return (
      <main className={styles.hostInProgress}>
        <h1>Game in Progress</h1>
        <p className={styles.roomCode} data-testid="room-code">
          Room Code: {roomCode}
        </p>
        <p className={styles.phase} data-testid="phase-indicator">
          Phase: {state.phase}
        </p>
        <HostRoundTransition state={state} onAdvanceRound={onAdvanceRound} />
      </main>
    );
  }

  if (state?.phase === 'FINAL_INTRO') {
    return (
      <main className={styles.hostInProgress}>
        <h1>Game in Progress</h1>
        <p className={styles.roomCode} data-testid="room-code">
          Room Code: {roomCode}
        </p>
        <p className={styles.phase} data-testid="phase-indicator">
          Phase: {state.phase}
        </p>
        <HostFinalIntro state={state} onOpenFinalWagers={onOpenFinalWagers} />
      </main>
    );
  }

  if (state?.phase === 'FINAL_WAGER') {
    return (
      <main className={styles.hostInProgress}>
        <h1>Game in Progress</h1>
        <p className={styles.roomCode} data-testid="room-code">
          Room Code: {roomCode}
        </p>
        <p className={styles.phase} data-testid="phase-indicator">
          Phase: {state.phase}
        </p>
        <HostFinalWager state={state} onForceFinalWagers={onForceFinalWagers} />
      </main>
    );
  }

  if (state?.phase === 'FINAL_CLUE') {
    return (
      <main className={styles.hostInProgress}>
        <h1>Game in Progress</h1>
        <p className={styles.roomCode} data-testid="room-code">
          Room Code: {roomCode}
        </p>
        <p className={styles.phase} data-testid="phase-indicator">
          Phase: {state.phase}
        </p>
        <HostFinalClue state={state} />
      </main>
    );
  }

  if (state?.phase === 'FINAL_REVEAL') {
    return (
      <main className={styles.hostInProgress}>
        <h1>Game in Progress</h1>
        <p className={styles.roomCode} data-testid="room-code">
          Room Code: {roomCode}
        </p>
        <p className={styles.phase} data-testid="phase-indicator">
          Phase: {state.phase}
        </p>
        <HostFinalReveal
          state={state}
          onRevealFinalAnswer={onRevealFinalAnswer}
          onRuleFinalCorrect={onRuleFinalCorrect}
          onRuleFinalIncorrect={onRuleFinalIncorrect}
          onRevealFinalWager={onRevealFinalWager}
        />
      </main>
    );
  }

  if (state?.phase === 'COMPLETE') {
    return (
      <main className={styles.hostInProgress}>
        <h1>Game in Progress</h1>
        <p className={styles.roomCode} data-testid="room-code">
          Room Code: {roomCode}
        </p>
        <p className={styles.phase} data-testid="phase-indicator">
          Phase: {state.phase}
        </p>
        <HostFinalStandings state={state} />
      </main>
    );
  }

  return (
    <main className={styles.hostInProgress}>
      <h1>Game in Progress</h1>
      <p className={styles.roomCode} data-testid="room-code">
        Room Code: {roomCode}
      </p>
      <p className={styles.phase} data-testid="phase-indicator">
        Phase: {state?.phase ?? '—'}
      </p>
      <ClueSelectionToggle mode={state?.clueSelectionMode ?? 'HOST'} onSetMode={onSetClueSelectionMode} />
      {state?.phase === 'CLUE_SELECTED' && pendingClue && (
        <div className={styles.stickyControls}>
          <div className={styles.currentClue} data-testid="pending-clue">
            <h3>Clue Selected</h3>
            <p className={styles.clueText} data-testid="pending-clue-text">
              {pendingCategory?.title} for ${pendingClue.value}
              {controllerName ? ` — picked by ${controllerName}` : ''}
            </p>
            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={onRevealSelectedClue}
                data-testid="reveal-selected-clue-button"
              >
                Reveal Clue
              </button>
            </div>
          </div>
        </div>
      )}
      {showControls && (
        <div className={styles.stickyControls}>
          {state?.answer && !currentClue && <HostAnswerBanner state={state} />}
          {currentClue && (
            <div className={styles.currentClue} data-testid="current-clue">
              <h3>Current Clue</h3>
              <p className={styles.clueText} data-testid="clue-text">
                {state?.currentClueText}
              </p>
              {state?.answer && (
                <p className={styles.answerText} data-testid="answer-text">
                  Answer: {state.answer}
                </p>
              )}
              {state?.dailyDoubleWager != null && (
                <p className={styles.wagerText} data-testid="daily-double-wager">
                  Daily Double wager: {'$'}{state.dailyDoubleWager}
                </p>
              )}
              <Countdown deadline={state?.deadline ?? null} serverNow={state?.serverNow ?? 0} />
              <div className={styles.actionRow}>
                {state?.phase === 'CLUE_REVEALED' && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={onArmBuzzers}
                    data-testid="arm-buzzers-button"
                  >
                    Arm Buzzers
                  </button>
                )}
                {state?.phase === 'DAILY_DOUBLE_WAGER' && state?.dailyDoubleWager != null && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={onRevealClue}
                    data-testid="reveal-clue-button"
                  >
                    Reveal Daily Double Clue
                  </button>
                )}
                {state?.phase === 'DAILY_DOUBLE_WAGER' && state?.dailyDoubleWager == null &&
                  state?.controllingPlayerId != null &&
                  state?.players.find((p) => p.id === state.controllingPlayerId)?.connected === false && (
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={onCancelDailyDouble}
                      data-testid="cancel-daily-double-button"
                    >
                      Cancel Daily Double / Return to Board
                    </button>
                  )}
                {(state?.phase === 'CLUE_REVEALED' ||
                  (state?.phase === 'BUZZERS_ARMED' && state?.buzzWinnerId == null)) && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={onRevealAnswer}
                    data-testid="reveal-answer-button"
                  >
                    Reveal Answer / Return to Board
                  </button>
                )}
                {state?.phase === 'DAILY_DOUBLE_CLUE' && state?.controllingPlayerId && (
                  <div className={styles.buzzedPanel} data-testid="daily-double-ruling">
                    <p>
                      Daily Double:{' '}
                      <strong>
                        {state.players.find((p) => p.id === state.controllingPlayerId)?.name ?? 'Controller'}
                      </strong>
                    </p>
                    <div className={styles.actionRow}>
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={onRuleCorrect}
                        data-testid="rule-correct-button"
                      >
                        Correct
                      </button>
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={() => onRuleIncorrect?.(state.controllingPlayerId!)}
                        data-testid="rule-incorrect-button"
                      >
                        Incorrect
                      </button>
                    </div>
                  </div>
                )}
                {state?.phase === 'BUZZED' && buzzedPlayer && (
                  <div className={styles.buzzedPanel} data-testid="buzzed-player">
                    <p>
                      Buzzed in: <strong>{buzzedPlayer.name}</strong>
                    </p>
                    <div className={styles.actionRow}>
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={onRuleCorrect}
                        data-testid="rule-correct-button"
                      >
                        Correct
                      </button>
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={() => onRuleIncorrect?.(buzzedPlayer.id)}
                        data-testid="rule-incorrect-button"
                      >
                        Incorrect
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.actionButton}
          onClick={onUndoLastRuling}
          disabled={!hasUndoableRuling}
          aria-disabled={!hasUndoableRuling}
          data-testid="undo-last-ruling-button"
        >
          Undo Last Ruling
        </button>
      </div>
      {state?.phase === 'BOARD_SELECT' && state.roundComplete && (
        <div className={styles.actionRow} data-testid="advance-round-section">
          <button
            type="button"
            className={styles.actionButton}
            onClick={onAdvanceRound}
            data-testid="advance-round-button"
          >
            Advance Round
          </button>
        </div>
      )}
      <h2>Roster</h2>
      {players.length === 0 ? (
        <p>No contestants connected.</p>
      ) : (
        <ul className={styles.roster} data-testid="roster">
          {players.map((player) => (
            <RosterItem
              key={`${player.id}-${player.score}`}
              player={player}
              isController={player.id === state?.controllingPlayerId}
              onAdjustScore={onAdjustScore}
              onOverrideControl={onOverrideControl}
              canAssignControl={state?.phase === 'BOARD_SELECT'}
            />
          ))}
        </ul>
      )}
      <h2>Board</h2>
      {state && <HostGrid state={state} onSelectClue={onSelectClue} />}
    </main>
  );
}

export function HostGameControls({
  onRestart,
  onBackToMenu,
}: {
  onRestart: () => void;
  onBackToMenu: () => void;
}) {
  const [confirm, setConfirm] = useState<null | 'restart' | 'menu'>(null);

  return (
    <>
      <div className={styles.gameControlsBar}>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => setConfirm('restart')}
          data-testid="restart-game-button"
        >
          Restart Game
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => setConfirm('menu')}
          data-testid="back-to-menu-button"
        >
          Back to Menu
        </button>
      </div>
      {confirm === 'restart' && (
        <div className={styles.confirmDialogModal} role="alertdialog" aria-modal="true">
          <div className={styles.confirmCard}>
            <p>Restart the game? All scores and progress will be cleared and players return to the lobby.</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => {
                  onRestart();
                  setConfirm(null);
                }}
                data-testid="confirm-restart-button"
              >
                Restart Game
              </button>
              <button type="button" onClick={() => setConfirm(null)} data-testid="cancel-restart-button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {confirm === 'menu' && (
        <div className={styles.confirmDialogModal} role="alertdialog" aria-modal="true">
          <div className={styles.confirmCard}>
            <p>Leave this game and return to the menu? The current game will be abandoned.</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => {
                  onBackToMenu();
                  setConfirm(null);
                }}
                data-testid="confirm-back-to-menu-button"
              >
                Back to Menu
              </button>
              <button type="button" onClick={() => setConfirm(null)} data-testid="cancel-back-to-menu-button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const HOST_ROOM_KEY = 'jeopardy-host-room';

export function HostContent() {
  const { token } = useHostAuth();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(() => localStorage.getItem(HOST_ROOM_KEY));
  const [loadingBoards, setLoadingBoards] = useState(() => Boolean(token && !roomCode));
  const [gameState, setGameState] = useState<HostView | null>(null);

  useEffect(() => {
    if (!token || roomCode) return;
    boardApi
      .getBoards(token)
      .then(setBoards)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load boards'))
      .finally(() => setLoadingBoards(false));
  }, [token, roomCode]);

  const handleCreate = useCallback(
    async (boardId: string) => {
      if (!token) return;
      try {
        const result = await createGame(boardId, token);
        localStorage.setItem(HOST_ROOM_KEY, result.roomCode);
        setRoomCode(result.roomCode);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create game');
      }
    },
    [token, setRoomCode, setError],
  );

  const handleCreateNewGame = useCallback(() => {
    localStorage.removeItem(HOST_ROOM_KEY);
    setRoomCode(null);
    setGameState(null);
    setLoadingBoards(true);
  }, [setRoomCode, setGameState, setLoadingBoards]);

  const hostSocket = useSocket<HostView>('host', roomCode ?? '', setGameState, undefined, undefined, token ?? '');
  const handleStartGame = useCallback(() => {
    hostSocket.startGame?.();
  }, [hostSocket]);
  const handleRestartGame = useCallback(() => {
    hostSocket.restartGame?.();
  }, [hostSocket]);
  const handleRemovePlayer = useCallback(
    (playerId: string) => {
      hostSocket.removePlayer?.(playerId);
    },
    [hostSocket],
  );
  const handleSelectClue = useCallback(
    (clueId: string) => {
      hostSocket.selectClue?.(clueId);
    },
    [hostSocket],
  );
  const handleSetClueSelectionMode = useCallback(
    (mode: ClueSelectionMode) => {
      hostSocket.setClueSelectionMode?.(mode);
    },
    [hostSocket],
  );
  const handleRevealSelectedClue = useCallback(() => {
    hostSocket.revealSelectedClue?.();
  }, [hostSocket]);
  const handleRevealClue = useCallback(() => {
    hostSocket.revealClue?.();
  }, [hostSocket]);
  const handleRevealAnswer = useCallback(() => {
    hostSocket.revealAnswer?.();
  }, [hostSocket]);
  const handleArmBuzzers = useCallback(() => {
    hostSocket.armBuzzers?.();
  }, [hostSocket]);
  const handleRuleCorrect = useCallback(() => {
    hostSocket.ruleCorrect?.();
  }, [hostSocket]);
  const handleRuleIncorrect = useCallback(
    (playerId: string) => {
      hostSocket.ruleIncorrect?.(playerId);
    },
    [hostSocket],
  );
  const handleAdjustScore = useCallback(
    (playerId: string, score: number) => {
      hostSocket.adjustScore?.(playerId, score);
    },
    [hostSocket],
  );
  const handleUndoLastRuling = useCallback(() => {
    hostSocket.undoLastRuling?.();
  }, [hostSocket]);
  const handleCancelDailyDouble = useCallback(() => {
    hostSocket.cancelDailyDouble?.();
  }, [hostSocket]);
  const handleAdvanceRound = useCallback(() => {
    hostSocket.advanceRound?.();
  }, [hostSocket]);
  const handleOpenFinalWagers = useCallback(() => {
    hostSocket.openFinalWagers?.();
  }, [hostSocket]);
  const handleForceFinalWagers = useCallback(() => {
    hostSocket.forceFinalWagers?.();
  }, [hostSocket]);
  const handleOverrideControl = useCallback(
    (playerId: string) => {
      hostSocket.overrideControl?.(playerId);
    },
    [hostSocket],
  );
  const handleRevealFinalAnswer = useCallback(() => {
    hostSocket.revealFinalAnswer?.();
  }, [hostSocket]);
  const handleRuleFinalCorrect = useCallback(() => {
    hostSocket.ruleFinalCorrect?.();
  }, [hostSocket]);
  const handleRuleFinalIncorrect = useCallback(() => {
    hostSocket.ruleFinalIncorrect?.();
  }, [hostSocket]);
  const handleRevealFinalWager = useCallback(() => {
    hostSocket.revealFinalWager?.();
  }, [hostSocket]);

  if (roomCode) {
    const inLobby = !gameState || gameState.phase === 'LOBBY';
    if (inLobby) {
      return (
        <HostLobby
          roomCode={roomCode}
          state={gameState}
          onStartGame={handleStartGame}
          onCreateNewGame={handleCreateNewGame}
          onSetClueSelectionMode={handleSetClueSelectionMode}
          onRemovePlayer={handleRemovePlayer}
          startError={hostSocket.error}
        />
      );
    }
    return (
      <>
        <HostGameControls onRestart={handleRestartGame} onBackToMenu={handleCreateNewGame} />
        <HostInProgress
        roomCode={roomCode}
        state={gameState}
        onSelectClue={handleSelectClue}
        onSetClueSelectionMode={handleSetClueSelectionMode}
        onRevealSelectedClue={handleRevealSelectedClue}
        onRevealClue={handleRevealClue}
        onRevealAnswer={handleRevealAnswer}
        onArmBuzzers={handleArmBuzzers}
        onRuleCorrect={handleRuleCorrect}
        onRuleIncorrect={handleRuleIncorrect}
        onAdjustScore={handleAdjustScore}
        onUndoLastRuling={handleUndoLastRuling}
        onCancelDailyDouble={handleCancelDailyDouble}
        onAdvanceRound={handleAdvanceRound}
        onOpenFinalWagers={handleOpenFinalWagers}
        onForceFinalWagers={handleForceFinalWagers}
        onOverrideControl={handleOverrideControl}
        onRevealFinalAnswer={handleRevealFinalAnswer}
        onRuleFinalCorrect={handleRuleFinalCorrect}
        onRuleFinalIncorrect={handleRuleFinalIncorrect}
        onRevealFinalWager={handleRevealFinalWager}
        />
      </>
    );
  }

  if (loadingBoards) {
    return <main className="route-stub"><p>Loading boards...</p></main>;
  }

  if (error) {
    return <main className="route-stub"><p className="error">{error}</p></main>;
  }

  return (
    <main className="route-stub">
      <h1>Host</h1>
      <p>Select a board to create a game.</p>
      {boards.length === 0 ? (
        <p>No boards available. Create one in Admin.</p>
      ) : (
        <ul className={styles.boardList} data-testid="board-list">
          {boards.map((board) => (
            <li key={board.id}>
              <button
                type="button"
                className={styles.actionButton}
                data-testid="board-list-item"
                onClick={() => handleCreate(board.id)}
                disabled={!board.isComplete}
                title={board.isComplete ? undefined : 'This board is incomplete and cannot be used to start a game'}
              >
                {board.name} {board.isComplete ? '' : '(incomplete)'}
              </button>
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
