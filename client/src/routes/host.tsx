import { useCallback, useEffect, useState } from 'react';
import { PasscodeGate } from '../components/PasscodeGate.js';
import { useHostAuth } from '../auth/useHostAuth.js';
import { boardApi, BoardSummary } from '../api/boards.js';
import { createGame, listGames, setGameArchived, deleteGame, GameSummary } from '../api/games.js';
import { useSocket } from '../socket/useSocket.js';
import { Countdown } from '../components/Countdown.js';
import { ConnectionStatus } from '../components/ConnectionStatus.js';
import type { HostView, ClueSelectionMode } from '@jeopardy/shared';
import { formatScore } from '../format.js';
import styles from './host.module.css';

interface HostScoreHolder {
  id: string;
  name: string;
  score: number;
}

function getHostHolders(state: HostView): HostScoreHolder[] {
  if (state.teamMode) {
    return state.teams.map((t) => ({ id: t.id, name: t.name, score: t.score }));
  }
  return state.players.map((p) => ({ id: p.id, name: p.name, score: p.score }));
}

function makeTeamId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `team-${Math.random().toString(36).slice(2, 10)}`;
}

export interface HostLobbyProps {
  roomCode: string;
  state: HostView | null;
  onStartGame: () => void;
  onCreateNewGame?: () => void;
  onSetClueSelectionMode?: (mode: ClueSelectionMode) => void;
  onRemovePlayer?: (playerId: string) => void;
  onAdmitPlayer?: (playerId: string) => void;
  onConfigureTeams?: (enabled: boolean, teams: { id: string; name: string }[]) => void;
  onSetCaptain?: (teamId: string, playerId: string) => void;
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

function TeamSetup({
  state,
  onConfigureTeams,
}: {
  state: HostView | null;
  onConfigureTeams?: (enabled: boolean, teams: { id: string; name: string }[]) => void;
}) {
  const savedTeams = state?.teams ?? [];
  const teamMode = state?.teamMode ?? false;
  // Local edits are seeded from the server config on mount. HostLobby remounts
  // this component (via key) whenever the saved config changes, so a save or a
  // reconnect re-seeds these initializers without clobbering in-progress typing.
  const [enabled, setEnabled] = useState(teamMode);
  const [rows, setRows] = useState<{ id: string; name: string }[]>(() =>
    savedTeams.length >= 2
      ? savedTeams.map((t) => ({ id: t.id, name: t.name }))
      : [
          { id: makeTeamId(), name: '' },
          { id: makeTeamId(), name: '' },
        ],
  );

  const trimmed = rows.map((r) => ({ id: r.id, name: r.name.trim() }));
  const lowerNames = trimmed.map((r) => r.name.toLowerCase());
  const hasBlank = trimmed.some((r) => r.name.length === 0);
  const hasDuplicate = new Set(lowerNames).size !== lowerNames.length;
  const canSave = rows.length >= 2 && rows.length <= 6 && !hasBlank && !hasDuplicate;
  const isDirty = !teamMode || savedTeams.map((t) => t.name).join('|') !== trimmed.map((r) => r.name).join('|');

  const handleToggle = (next: boolean) => {
    setEnabled(next);
    if (!next) onConfigureTeams?.(false, []);
  };

  return (
    <div className={styles.teamSetup} data-testid="team-setup">
      <label className={styles.teamModeToggle}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
          data-testid="team-mode-toggle"
        />
        Team Mode
      </label>
      {enabled && (
        <div className={styles.teamSetupBody}>
          <p className={styles.teamSetupHint}>Enter 2–6 team names. Players choose a team after joining.</p>
          {rows.map((row, i) => (
            <div key={row.id} className={styles.teamSetupRow}>
              <input
                className={styles.teamNameInput}
                value={row.name}
                placeholder={`Team ${i + 1} name`}
                onChange={(e) =>
                  setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, name: e.target.value } : r)))
                }
                data-testid={`team-name-input-${i}`}
                aria-label={`Team ${i + 1} name`}
              />
              {rows.length > 2 && (
                <button
                  type="button"
                  className={styles.removePlayerButton}
                  onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                  data-testid={`remove-team-${i}`}
                  aria-label={`Remove team ${i + 1}`}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <div className={styles.teamSetupActions}>
            {rows.length < 6 && (
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => setRows((prev) => [...prev, { id: makeTeamId(), name: '' }])}
                data-testid="add-team-button"
              >
                Add Team
              </button>
            )}
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => onConfigureTeams?.(true, trimmed)}
              disabled={!canSave || !isDirty}
              data-testid="save-teams-button"
            >
              Save Teams
            </button>
          </div>
          {hasBlank && (
            <p className={styles.teamSetupWarn} data-testid="team-setup-blank">
              Every team needs a name.
            </p>
          )}
          {hasDuplicate && (
            <p className={styles.teamSetupWarn} data-testid="team-setup-duplicate">
              Team names must be unique.
            </p>
          )}
          {teamMode && !isDirty && (
            <p className={styles.teamSetupSaved} data-testid="team-setup-saved">
              Teams saved.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TeamRoster({
  state,
  showControl,
  onSetCaptain,
  onOverrideControlTeam,
  onRequestRemove,
}: {
  state: HostView;
  showControl?: boolean;
  onSetCaptain?: (teamId: string, playerId: string) => void;
  onOverrideControlTeam?: (teamId: string) => void;
  onRequestRemove?: (player: { id: string; name: string }) => void;
}) {
  return (
    <div className={styles.teamRoster} data-testid="team-roster">
      {state.teams.map((team) => {
        const members = team.memberIds
          .map((id) => state.players.find((p) => p.id === id))
          .filter((p): p is HostView['players'][number] => Boolean(p));
        const isControlling = state.controllingTeamId === team.id;
        return (
          <div
            key={team.id}
            className={`${styles.teamRosterGroup} ${isControlling ? styles.teamRosterControlling : ''}`}
            data-testid={`team-roster-${team.id}`}
          >
            <div className={styles.teamRosterHeader}>
              <span className={styles.teamRosterName} data-testid={`team-roster-name-${team.id}`}>
                {team.name}
              </span>
              <span
                className={`${styles.playerScore} ${team.score < 0 ? styles.negativeScore : ''}`}
                data-testid={`team-roster-score-${team.id}`}
              >
                {formatScore(team.score)}
              </span>
              {showControl &&
                (isControlling ? (
                  <span className={styles.controllerBadge} data-testid={`team-controlling-${team.id}`}>
                    Controlling
                  </span>
                ) : onOverrideControlTeam ? (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => onOverrideControlTeam(team.id)}
                    data-testid={`assign-control-team-${team.id}`}
                  >
                    Assign Control
                  </button>
                ) : null)}
            </div>
            {members.length === 0 ? (
              <p className={styles.teamRosterEmpty} data-testid={`team-empty-${team.id}`}>
                No players yet
              </p>
            ) : (
              <ul className={styles.teamRosterMembers}>
                {members.map((m) => {
                  const isCaptain = team.captainId === m.id;
                  const isActing = team.actingCaptainId === m.id;
                  return (
                    <li key={m.id} data-testid={`team-member-${m.id}`}>
                      <span className={styles.playerName}>{m.name}</span>
                      {isCaptain ? (
                        <span className={styles.captainBadge} data-testid={`captain-badge-${m.id}`}>
                          Captain
                        </span>
                      ) : (
                        onSetCaptain && (
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => onSetCaptain(team.id, m.id)}
                            data-testid={`make-captain-${m.id}`}
                          >
                            Make Captain
                          </button>
                        )
                      )}
                      {isActing && !isCaptain && (
                        <span className={styles.actingBadge} data-testid={`acting-captain-${m.id}`}>
                          Acting captain
                        </span>
                      )}
                      <span
                        className={m.connected ? styles.statusConnected : styles.statusDisconnected}
                        data-testid={`player-status-${m.id}`}
                      >
                        {m.connected ? 'connected' : 'disconnected'}
                      </span>
                      {onRequestRemove && (
                        <button
                          type="button"
                          className={styles.removePlayerButton}
                          onClick={() => onRequestRemove({ id: m.id, name: m.name })}
                          data-testid={`remove-player-${m.id}`}
                          aria-label={`Remove ${m.name}`}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function HostLobby({ roomCode, state, onStartGame, onCreateNewGame, onSetClueSelectionMode, onRemovePlayer, onAdmitPlayer, onConfigureTeams, onSetCaptain, startError }: HostLobbyProps) {
  const playerCount = state?.players.length ?? 0;
  const removedPlayers = state?.removedPlayers ?? [];
  const connectedCount = state?.players.filter((p) => p.connected).length ?? 0;
  const teamMode = state?.teamMode ?? false;
  const teams = state?.teams ?? [];
  const emptyTeams = teamMode ? teams.filter((t) => t.memberIds.length === 0) : [];
  const teamsReady = !teamMode || (teams.length >= 2 && emptyTeams.length === 0);
  const canStart = connectedCount > 0 && teamsReady;
  const unassignedPlayers = teamMode ? (state?.players ?? []).filter((p) => !p.teamId) : [];
  const teamSetupKey = teamMode ? teams.map((t) => `${t.id}:${t.name}`).join('|') : 'teams-off';
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null);

  return (
    <main className={styles.hostLobby}>
      {onCreateNewGame && (
        <button
          type="button"
          className={styles.backToMenuLink}
          onClick={onCreateNewGame}
          data-testid="lobby-menu-button"
        >
          ← All Games
        </button>
      )}
      <h1>Host Lobby</h1>
      <p className={styles.roomCode} data-testid="room-code">
        Room Code: {roomCode}
      </p>
      {startError && (
        <p className="error" role="alert">
          {startError}
        </p>
      )}
      <TeamSetup key={teamSetupKey} state={state} onConfigureTeams={onConfigureTeams} />
      <h2>Players</h2>
      {playerCount === 0 ? (
        <p>Waiting for players...</p>
      ) : teamMode && state ? (
        <>
          <TeamRoster
            state={state}
            onSetCaptain={onSetCaptain}
            onRequestRemove={onRemovePlayer ? setPendingRemoval : undefined}
          />
          {unassignedPlayers.length > 0 && (
            <div className={styles.unassignedPlayers} data-testid="unassigned-players">
              <h3>Not on a team yet</h3>
              <ul className={styles.playerList}>
                {unassignedPlayers.map((player) => (
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
            </div>
          )}
        </>
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
      {removedPlayers.length > 0 && (
        <div className={styles.removedPlayers} data-testid="removed-players">
          <h2>Removed players</h2>
          <p className={styles.removedPlayersHint}>
            These players cannot rejoin until you allow them back.
          </p>
          <ul className={styles.playerList}>
            {removedPlayers.map((player) => (
              <li key={player.id} data-testid={`removed-player-${player.id}`}>
                <span className={styles.playerName}>{player.name}</span>{' '}
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => onAdmitPlayer?.(player.id)}
                  data-testid={`admit-player-${player.id}`}
                  aria-label={`Allow ${player.name} back`}
                >
                  Allow back
                </button>
              </li>
            ))}
          </ul>
        </div>
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
        {connectedCount === 0 && (
          <p className={styles.minimumPlayers}>At least one connected contestant is required to start.</p>
        )}
        {connectedCount > 0 && teamMode && !teamsReady && (
          <p className={styles.minimumPlayers} data-testid="team-start-gate">
            {teams.length < 2
              ? 'Set up at least two teams to start.'
              : `Every team needs at least one player. Waiting on: ${emptyTeams.map((t) => t.name).join(', ')}.`}
          </p>
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
  onReopenClue?: (clueId: string, revertScores: boolean) => void;
  onRemovePlayer?: (playerId: string) => void;
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
  onStartFinalTimer?: () => void;
  onOverrideControl?: (playerId: string) => void;
  onOverrideControlTeam?: (teamId: string) => void;
  onSetCaptain?: (teamId: string, playerId: string) => void;
  onRevealFinalAnswer?: () => void;
  onRuleFinalCorrect?: () => void;
  onRuleFinalIncorrect?: () => void;
  onRevealFinalWager?: () => void;
}

function HostGrid({
  state,
  onSelectClue,
  onReopenClue,
}: {
  state: HostView;
  onSelectClue?: (clueId: string) => void;
  onReopenClue?: (clueId: string, revertScores: boolean) => void;
}) {
  const [pendingReopen, setPendingReopen] = useState<{ id: string; value: number | null } | null>(null);

  if (!state.round) return <p>No active round.</p>;

  const maxRow = Math.max(0, ...state.round.categories.flatMap((c) => c.clues.map((clue) => clue.row)));
  const rows = Array.from({ length: maxRow + 1 }, (_, i) => i);
  const canReopen = state.phase === 'BOARD_SELECT';

  return (
    <>
      <div
        className={styles.hostGrid}
        data-testid="host-grid"
        style={{ gridTemplateColumns: `repeat(${state.round.categories.length}, 1fr)` }}
      >
        {state.round.categories.map((category) => (
          <div key={category.id} className={styles.hostCategoryHeader} data-testid="host-category-header">
            {category.title}
          </div>
        ))}
        {rows.map((row) =>
          state.round!.categories.map((category) => {
            const clue = category.clues.find((c) => c.row === row);
            if (!clue) return <div key={`${category.id}-${row}`} className={styles.hostCell} />;
            const used = state.usedClueIds.includes(clue.id);
            if (used) {
              return (
                <div
                  key={clue.id}
                  className={`${styles.hostCell} ${styles.hostCellUsed}`}
                  data-testid="host-used-cell"
                  data-clue-id={clue.id}
                >
                  <span className={styles.value}>${clue.value}</span>
                  {canReopen && onReopenClue && (
                    <button
                      type="button"
                      className={styles.redoButton}
                      onClick={() => setPendingReopen({ id: clue.id, value: clue.value })}
                      data-testid={`redo-clue-${clue.id}`}
                    >
                      Re-do
                    </button>
                  )}
                </div>
              );
            }
            return (
              <button
                key={clue.id}
                type="button"
                className={styles.hostCell}
                data-testid="host-clue-cell"
                data-clue-id={clue.id}
                onClick={() => onSelectClue?.(clue.id)}
              >
                <span className={styles.value}>${clue.value}</span>
                {clue.isDailyDouble && (
                  <span className={styles.hostDdMarker} data-testid="dd-marker">
                    DD
                  </span>
                )}
              </button>
            );
          }),
        )}
      </div>
      {pendingReopen && (
        <div className={styles.confirmDialogModal} role="alertdialog" aria-modal="true">
          <div className={styles.confirmCard}>
            <p>
              Re-do the ${pendingReopen.value} clue? It will return to the board so it can be played again. Do you want
              to revert the points it awarded or deducted?
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => {
                  onReopenClue?.(pendingReopen.id, true);
                  setPendingReopen(null);
                }}
                data-testid="confirm-reopen-revert-button"
              >
                Re-do &amp; revert scores
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => {
                  onReopenClue?.(pendingReopen.id, false);
                  setPendingReopen(null);
                }}
                data-testid="confirm-reopen-keep-button"
              >
                Re-do &amp; keep scores
              </button>
              <button
                type="button"
                onClick={() => setPendingReopen(null)}
                data-testid="cancel-reopen-button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface RosterItemProps {
  player: HostView['players'][number];
  isController: boolean;
  onAdjustScore?: (playerId: string, score: number) => void;
  onOverrideControl?: (playerId: string) => void;
  onRequestRemove?: (player: { id: string; name: string }) => void;
  canAssignControl?: boolean;
}

function RosterItem({ player, isController, onAdjustScore, onOverrideControl, onRequestRemove, canAssignControl }: RosterItemProps) {
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
      <div className={styles.rosterControl}>
        {isController ? (
          <span className={styles.controllerBadge} data-testid={`controller-badge-${player.id}`}>
            Controller
          </span>
        ) : canAssignControl && onOverrideControl ? (
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => onOverrideControl(player.id)}
            data-testid={`assign-control-${player.id}`}
          >
            Assign Control
          </button>
        ) : null}
      </div>
      <div className={styles.rosterScoreGroup}>
        <span
          className={`${styles.playerScore} ${player.score < 0 ? styles.negativeScore : ''}`}
          data-testid={`roster-score-${player.id}`}
        >
          {formatScore(player.score)}
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
      </div>
      <div className={styles.rosterStatus}>
        <span
          className={`${player.connected ? styles.statusConnected : styles.statusDisconnected}`}
          data-testid={`player-status-${player.id}`}
        >
          {player.connected ? 'connected' : 'disconnected'}
        </span>
        {onRequestRemove && (
          <button
            type="button"
            className={styles.removePlayerButton}
            onClick={() => onRequestRemove({ id: player.id, name: player.name })}
            data-testid={`remove-player-${player.id}`}
            aria-label={`Remove ${player.name}`}
          >
            Remove
          </button>
        )}
      </div>
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

const ROUND_TARGET_NAMES: Record<'DOUBLE_JEOPARDY' | 'FINAL', string> = {
  DOUBLE_JEOPARDY: 'Double Jeopardy',
  FINAL: 'Final Jeopardy',
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
        {getHostHolders(state).map((holder) => (
          <li key={holder.id} data-testid={`transition-score-${holder.id}`}>
            <span className={styles.playerName}>{holder.name}</span>
            <span className={`${styles.playerScore} ${holder.score < 0 ? styles.negativeScore : ''}`}>
              {formatScore(holder.score)}
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
        {getHostHolders(state).map((holder) => {
          const eligible = eligibleSet.has(holder.id);
          return (
            <li
              key={holder.id}
              className={eligible ? styles.hostFinalEligible : styles.hostFinalIneligible}
              data-testid={eligible ? 'host-final-eligible' : 'host-final-ineligible'}
            >
              <span className={styles.playerName}>{holder.name}</span>
              <span className={`${styles.playerScore} ${holder.score < 0 ? styles.negativeScore : ''}`}>{formatScore(holder.score)}</span>
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
  onStartFinalTimer?: () => void;
}

function HostFinalClue({ state, onStartFinalTimer }: HostFinalClueProps) {
  const category = state.round?.categories[0];
  const eligibleSet = new Set(state.finalEligiblePlayerIds);
  const timerStarted = state.deadline != null;

  return (
    <div className={styles.hostFinalClue} data-testid="host-final-clue">
      <h2 data-testid="host-final-clue-heading">Final Jeopardy Clue</h2>
      <div className={styles.hostFinalCategory} data-testid="host-final-category">
        {category?.title ?? 'Final Category'}
      </div>
      <p className={styles.hostFinalClueText} data-testid="host-final-clue-text">
        {state.currentClueText}
      </p>
      {timerStarted ? (
        <Countdown deadline={state.deadline} serverNow={state.serverNow} />
      ) : (
        <button
          type="button"
          className={`${styles.actionButton} ${styles.startFinalTimerButton}`}
          onClick={onStartFinalTimer}
          data-testid="start-final-timer-button"
        >
          Start Timer
        </button>
      )}
      <ul className={styles.hostFinalAnswerList} data-testid="host-final-answer-list">
        {getHostHolders(state).map((holder) => {
          const eligible = eligibleSet.has(holder.id);
          const submitted = state.finalAnswerSubmissionStatus[holder.id] ?? false;
          return (
            <li key={holder.id} data-testid={`host-final-answer-player-${holder.id}`}>
              <span className={styles.playerName}>{holder.name}</span>
              <span className={`${styles.playerScore} ${holder.score < 0 ? styles.negativeScore : ''}`}>{formatScore(holder.score)}</span>
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
  const holders = getHostHolders(state);
  const findHolder = (id: string | null) => (id ? holders.find((h) => h.id === id) : undefined);
  const currentPlayerId = state.finalRevealOrder[state.finalRevealIndex] ?? null;
  const currentPlayer = findHolder(currentPlayerId);
  const currentAnswer = currentPlayerId ? state.finalRevealedAnswers[currentPlayerId] : undefined;
  const currentWager = currentPlayerId ? state.finalRevealedWagers[currentPlayerId] : undefined;
  const revealedPlayerIds = state.finalRevealOrder.slice(0, state.finalRevealIndex);

  return (
    <div className={styles.hostFinalReveal} data-testid="host-final-reveal">
      <h2 data-testid="host-final-reveal-heading">Final Jeopardy Reveal</h2>
      {currentPlayer && (
        <div className={styles.hostFinalRevealCurrent} data-testid="host-final-reveal-current">
          <p data-testid="host-final-reveal-player-name">
            <span className={styles.nameCaps}>{currentPlayer.name}</span> —{' '}
            <span className={`${styles.playerScore} ${currentPlayer.score < 0 ? styles.negativeScore : ''}`} data-testid="host-final-reveal-player-score">{formatScore(currentPlayer.score)}</span>
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
                Wager: {formatScore(currentWager ?? 0)}
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
              const player = findHolder(playerId);
              if (!player) return null;
              return (
                <li key={playerId} data-testid={`host-final-revealed-player-${playerId}`}>
                  <span className={styles.playerName}>{player.name}</span>
                  <span className={`${styles.playerScore} ${player.score < 0 ? styles.negativeScore : ''}`}>{formatScore(player.score)}</span>
                  <span data-testid={`host-final-revealed-answer-${playerId}`}>{state.finalRevealedAnswers[playerId]}</span>
                  <span data-testid={`host-final-revealed-wager-${playerId}`}>{formatScore(state.finalRevealedWagers[playerId])}</span>
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
  const sorted = [...getHostHolders(state)].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? null;
  const coWinners = topScore != null ? sorted.filter((p) => p.score === topScore).map((p) => p.id) : [];

  return (
    <div className={styles.hostFinalStandings} data-testid="host-final-standings">
      {state.finalNoEligiblePlayers && (
        <p className={styles.hostNoEligible} data-testid="host-no-eligible-standings">
          {state.teamMode ? 'No teams were eligible for Final Jeopardy.' : 'No contestants were eligible for Final Jeopardy.'}
        </p>
      )}
      <h2 data-testid="host-final-standings-heading">Final Standings</h2>
      <ul className={styles.hostFinalStandingsList} data-testid="host-final-standings-list">
        {sorted.map((holder) => (
          <li
            key={holder.id}
            className={coWinners.includes(holder.id) ? styles.hostFinalWinner : undefined}
            data-testid={`host-final-standing-${holder.id}`}
          >
            <span className={styles.playerName}>{holder.name}</span>
            <span className={`${styles.playerScore} ${holder.score < 0 ? styles.negativeScore : ''}`}>
              {formatScore(holder.score)}
            </span>
            {coWinners.includes(holder.id) && (
              <span className={styles.hostFinalWinnerBadge} data-testid={`host-final-winner-${holder.id}`}>
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
        {getHostHolders(state).map((holder) => {
          const eligible = eligibleSet.has(holder.id);
          const submitted = state.finalWagerSubmissionStatus[holder.id] ?? false;
          return (
            <li key={holder.id} data-testid={`host-final-wager-player-${holder.id}`}>
              <span className={styles.playerName}>{holder.name}</span>
              <span className={`${styles.playerScore} ${holder.score < 0 ? styles.negativeScore : ''}`}>{formatScore(holder.score)}</span>
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
  onReopenClue,
  onRemovePlayer,
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
  onStartFinalTimer,
  onOverrideControl,
  onOverrideControlTeam,
  onSetCaptain,
  onRevealFinalAnswer,
  onRuleFinalCorrect,
  onRuleFinalIncorrect,
  onRevealFinalWager,
}: HostInProgressProps) {
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null);
  const [roundAdvanceDismissed, setRoundAdvanceDismissed] = useState(false);
  const [finalStartDismissed, setFinalStartDismissed] = useState(false);
  const players = state?.players ?? [];

  const roundOver = state?.phase === 'BOARD_SELECT' && Boolean(state?.roundComplete);
  useEffect(() => {
    if (!roundOver) setRoundAdvanceDismissed(false);
  }, [roundOver]);

  const nextRoundTarget = state?.nextRoundTarget ?? 'FINAL';
  const nextRoundName = ROUND_TARGET_NAMES[nextRoundTarget];

  const eligibleFinalIds = state?.finalEligiblePlayerIds ?? [];
  const allFinalWagersIn =
    state?.phase === 'FINAL_WAGER' &&
    eligibleFinalIds.length > 0 &&
    eligibleFinalIds.every((id) => state?.finalWagerSubmissionStatus?.[id]);
  useEffect(() => {
    if (!allFinalWagersIn) setFinalStartDismissed(false);
  }, [allFinalWagersIn]);
  const currentClue = state?.currentClueId
    ? state?.round?.categories.flatMap((c) => c.clues).find((c) => c.id === state.currentClueId)
    : null;
  const pendingCategory = state?.pendingClueId
    ? state?.round?.categories.find((c) => c.clues.some((cl) => cl.id === state.pendingClueId))
    : null;
  const pendingClue = pendingCategory?.clues.find((cl) => cl.id === state?.pendingClueId) ?? null;
  const teamMode = state?.teamMode ?? false;
  const controllingTeam = teamMode ? state?.teams.find((t) => t.id === state?.controllingTeamId) ?? null : null;
  const controllerName = teamMode
    ? controllingTeam?.name ?? null
    : state?.controllingPlayerId
      ? players.find((p) => p.id === state.controllingPlayerId)?.name ?? null
      : null;
  // In team mode the acting captain answers the Daily Double on the team's behalf.
  const ddActorId = teamMode ? controllingTeam?.actingCaptainId ?? null : state?.controllingPlayerId ?? null;
  const ddActorName = teamMode
    ? controllingTeam?.name ?? 'Controller'
    : players.find((p) => p.id === state?.controllingPlayerId)?.name ?? 'Controller';
  const showCancelDailyDouble =
    state?.phase === 'DAILY_DOUBLE_WAGER' &&
    state?.dailyDoubleWager == null &&
    (teamMode
      ? Boolean(controllingTeam && controllingTeam.connectedMemberIds.length === 0)
      : state?.controllingPlayerId != null &&
        players.find((p) => p.id === state.controllingPlayerId)?.connected === false);
  const buzzedPlayer = state?.buzzWinnerId ? players.find((p) => p.id === state.buzzWinnerId) : null;
  const buzzedTeam =
    teamMode && buzzedPlayer?.teamId
      ? state?.teams.find((t) => t.id === buzzedPlayer?.teamId) ?? null
      : null;
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
        {allFinalWagersIn && !finalStartDismissed && (
          <div className={styles.confirmDialogModal} role="alertdialog" aria-modal="true" data-testid="start-final-modal">
            <div className={styles.confirmCard}>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close"
                onClick={() => setFinalStartDismissed(true)}
                data-testid="start-final-modal-close"
              >
                ✕
              </button>
              <p>All wagers are in. Ready to start Final Jeopardy?</p>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => {
                  onForceFinalWagers?.();
                  setFinalStartDismissed(true);
                }}
                data-testid="start-final-modal-confirm"
              >
                Start Final Jeopardy
              </button>
            </div>
          </div>
        )}
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
        <HostFinalClue state={state} onStartFinalTimer={onStartFinalTimer} />
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
      <h2>Roster</h2>
      {players.length === 0 ? (
        <p>No contestants connected.</p>
      ) : teamMode && state ? (
        <TeamRoster
          state={state}
          showControl={state.phase === 'BOARD_SELECT'}
          onSetCaptain={onSetCaptain}
          onOverrideControlTeam={onOverrideControlTeam}
          onRequestRemove={onRemovePlayer ? setPendingRemoval : undefined}
        />
      ) : (
        <ul className={styles.roster} data-testid="roster">
          {players.map((player) => (
            <RosterItem
              key={`${player.id}-${player.score}`}
              player={player}
              isController={player.id === state?.controllingPlayerId}
              onAdjustScore={onAdjustScore}
              onOverrideControl={onOverrideControl}
              onRequestRemove={onRemovePlayer ? setPendingRemoval : undefined}
              canAssignControl={state?.phase === 'BOARD_SELECT'}
            />
          ))}
        </ul>
      )}
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
                  Daily Double wager: {formatScore(state.dailyDoubleWager)}
                </p>
              )}
              <Countdown deadline={state?.deadline ?? null} serverNow={state?.serverNow ?? 0} />
              {state?.phase === 'DAILY_DOUBLE_WAGER' && state?.dailyDoubleWager == null && (
                <p className={styles.waitingOnWager} data-testid="waiting-on-wager">
                  Waiting on Wager
                </p>
              )}
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
                {showCancelDailyDouble && (
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
                {state?.phase === 'DAILY_DOUBLE_CLUE' && ddActorId && (
                  <div className={styles.buzzedPanel} data-testid="daily-double-ruling">
                    <p>
                      Daily Double: <strong>{ddActorName}</strong>
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
                        onClick={() => onRuleIncorrect?.(ddActorId)}
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
                      Buzzed in: <strong className={styles.nameCaps}>{buzzedPlayer.name}{buzzedTeam ? ` (${buzzedTeam.name})` : ''}</strong>
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
            Advance to {nextRoundName}
          </button>
        </div>
      )}
      {roundOver && !roundAdvanceDismissed && (
        <div className={styles.confirmDialogModal} role="alertdialog" aria-modal="true" data-testid="advance-round-modal">
          <div className={styles.confirmCard}>
            <button
              type="button"
              className={styles.modalClose}
              aria-label="Close"
              onClick={() => setRoundAdvanceDismissed(true)}
              data-testid="advance-round-modal-close"
            >
              ✕
            </button>
            <p>The round is complete. Ready to move on to {nextRoundName}?</p>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => {
                onAdvanceRound?.();
                setRoundAdvanceDismissed(true);
              }}
              data-testid="advance-round-modal-confirm"
            >
              Advance to {nextRoundName}
            </button>
          </div>
        </div>
      )}
      <h2>Board</h2>
      {state && <HostGrid state={state} onSelectClue={onSelectClue} onReopenClue={onReopenClue} />}
      {pendingRemoval && (
        <div className={styles.confirmDialogModal} role="alertdialog" aria-modal="true">
          <div className={styles.confirmCard}>
            <p>
              Remove {pendingRemoval.name} from the game? They will be removed from the roster and forfeit their score.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.removePlayerButton}
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

function gameStatusLabel(status: GameSummary['status']): string {
  switch (status) {
    case 'LOBBY':
      return 'Lobby';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'FINAL':
      return 'Final';
    case 'COMPLETE':
      return 'Complete';
    default:
      return status;
  }
}

function GameRow({
  game,
  onEnter,
  onArchiveToggle,
  onDelete,
}: {
  game: GameSummary;
  onEnter: (roomCode: string) => void;
  onArchiveToggle: (game: GameSummary) => void;
  onDelete: (game: GameSummary) => void;
}) {
  return (
    <li className={styles.gameCard} data-testid={`game-card-${game.roomCode}`}>
      <button
        type="button"
        className={styles.gameEnter}
        onClick={() => onEnter(game.roomCode)}
        data-testid={`enter-game-${game.roomCode}`}
      >
        <span className={styles.gameCode}>{game.roomCode}</span>
        <span className={styles.gameBoard}>{game.boardName}</span>
        <span className={styles.gameMeta}>
          <span className={styles.gameStatus} data-status={game.status}>
            {gameStatusLabel(game.status)}
          </span>
          <span className={styles.gamePlayers}>
            {game.playerCount} player{game.playerCount === 1 ? '' : 's'}
          </span>
        </span>
      </button>
      <div className={styles.gameActions}>
        <button
          type="button"
          className={styles.gameActionButton}
          onClick={() => onArchiveToggle(game)}
          data-testid={`${game.archived ? 'unarchive' : 'archive'}-game-${game.roomCode}`}
        >
          {game.archived ? 'Unarchive' : 'Archive'}
        </button>
        <button
          type="button"
          className={styles.gameDeleteButton}
          onClick={() => onDelete(game)}
          data-testid={`delete-game-${game.roomCode}`}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function GamesManager({
  games,
  loading,
  error,
  onEnter,
  onArchive,
  onDelete,
}: {
  games: GameSummary[];
  loading: boolean;
  error?: string | null;
  onEnter: (roomCode: string) => void;
  onArchive: (roomCode: string, archived: boolean) => void;
  onDelete: (roomCode: string) => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GameSummary | null>(null);

  const active = games.filter((g) => !g.archived);
  const archived = games.filter((g) => g.archived);

  return (
    <section className={styles.gamesManager} data-testid="games-manager">
      <h2>Active Games</h2>
      {error && (
        <p className="error" role="alert" data-testid="games-error">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading games...</p>
      ) : active.length === 0 ? (
        <p className={styles.gamesEmpty} data-testid="active-games-empty">
          No active games yet. Create one from a board above.
        </p>
      ) : (
        <ul className={styles.gameList} data-testid="active-games-list">
          {active.map((game) => (
            <GameRow
              key={game.roomCode}
              game={game}
              onEnter={onEnter}
              onArchiveToggle={(g) => onArchive(g.roomCode, true)}
              onDelete={setPendingDelete}
            />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div className={styles.archivedSection} data-testid="archived-games-section">
          <button
            type="button"
            className={styles.archivedToggle}
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            data-testid="archived-games-toggle"
          >
            {showArchived ? '▾' : '▸'} Archived Games ({archived.length})
          </button>
          {showArchived && (
            <ul className={styles.gameList} data-testid="archived-games-list">
              {archived.map((game) => (
                <GameRow
                  key={game.roomCode}
                  game={game}
                  onEnter={onEnter}
                  onArchiveToggle={(g) => onArchive(g.roomCode, false)}
                  onDelete={setPendingDelete}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {pendingDelete && (
        <div className={styles.confirmDialogModal} role="alertdialog" aria-modal="true">
          <div className={styles.confirmCard}>
            <p>
              Delete game {pendingDelete.roomCode} ({pendingDelete.boardName})? This permanently removes the game and its
              scores.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.gameDeleteButton}
                onClick={() => {
                  onDelete(pendingDelete.roomCode);
                  setPendingDelete(null);
                }}
                data-testid="confirm-delete-game-button"
              >
                Delete
              </button>
              <button type="button" onClick={() => setPendingDelete(null)} data-testid="cancel-delete-game-button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function HostContent() {
  const { token } = useHostAuth();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(() => localStorage.getItem(HOST_ROOM_KEY));
  const [loadingBoards, setLoadingBoards] = useState(() => Boolean(token && !roomCode));
  const [gameState, setGameState] = useState<HostView | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loadingGames, setLoadingGames] = useState(() => Boolean(token && !roomCode));
  const [gamesError, setGamesError] = useState<string | null>(null);

  const refreshGames = useCallback(async () => {
    if (!token) return;
    setLoadingGames(true);
    try {
      setGames(await listGames(token));
      setGamesError(null);
    } catch (e) {
      setGamesError(e instanceof Error ? e.message : 'Failed to load games');
    } finally {
      setLoadingGames(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token || roomCode) return;
    boardApi
      .getBoards(token)
      .then(setBoards)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load boards'))
      .finally(() => setLoadingBoards(false));
    refreshGames();
  }, [token, roomCode, refreshGames]);

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

  const handleEnterGame = useCallback((code: string) => {
    localStorage.setItem(HOST_ROOM_KEY, code);
    setRoomCode(code);
    setGameState(null);
  }, []);

  const handleArchiveGame = useCallback(
    async (code: string, archived: boolean) => {
      if (!token) return;
      try {
        await setGameArchived(code, archived, token);
        await refreshGames();
      } catch (e) {
        setGamesError(e instanceof Error ? e.message : 'Failed to update game');
      }
    },
    [token, refreshGames],
  );

  const handleDeleteGame = useCallback(
    async (code: string) => {
      if (!token) return;
      try {
        await deleteGame(code, token);
        await refreshGames();
      } catch (e) {
        setGamesError(e instanceof Error ? e.message : 'Failed to delete game');
      }
    },
    [token, refreshGames],
  );

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
  const handleAdmitPlayer = useCallback(
    (playerId: string) => {
      hostSocket.admitPlayer?.(playerId);
    },
    [hostSocket],
  );
  const handleSelectClue = useCallback(
    (clueId: string) => {
      hostSocket.selectClue?.(clueId);
    },
    [hostSocket],
  );
  const handleReopenClue = useCallback(
    (clueId: string, revertScores: boolean) => {
      hostSocket.reopenClue?.(clueId, revertScores);
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
  const handleStartFinalTimer = useCallback(() => {
    hostSocket.startFinalTimer?.();
  }, [hostSocket]);
  const handleOverrideControl = useCallback(
    (playerId: string) => {
      hostSocket.overrideControl?.(playerId);
    },
    [hostSocket],
  );
  const handleConfigureTeams = useCallback(
    (enabled: boolean, teams: { id: string; name: string }[]) => {
      hostSocket.configureTeams?.(enabled, teams);
    },
    [hostSocket],
  );
  const handleSetCaptain = useCallback(
    (teamId: string, playerId: string) => {
      hostSocket.setCaptain?.(teamId, playerId);
    },
    [hostSocket],
  );
  const handleOverrideControlTeam = useCallback(
    (teamId: string) => {
      hostSocket.overrideControlTeam?.(teamId);
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
        <>
          <ConnectionStatus status={hostSocket.status} />
          <HostLobby
            roomCode={roomCode}
            state={gameState}
            onStartGame={handleStartGame}
            onCreateNewGame={handleCreateNewGame}
            onSetClueSelectionMode={handleSetClueSelectionMode}
            onRemovePlayer={handleRemovePlayer}
            onAdmitPlayer={handleAdmitPlayer}
            onConfigureTeams={handleConfigureTeams}
            onSetCaptain={handleSetCaptain}
            startError={hostSocket.error}
          />
        </>
      );
    }
    return (
      <>
        <ConnectionStatus status={hostSocket.status} />
        <HostGameControls onRestart={handleRestartGame} onBackToMenu={handleCreateNewGame} />
        <HostInProgress
        roomCode={roomCode}
        state={gameState}
        onSelectClue={handleSelectClue}
        onReopenClue={handleReopenClue}
        onRemovePlayer={handleRemovePlayer}
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
        onStartFinalTimer={handleStartFinalTimer}
        onOverrideControl={handleOverrideControl}
        onOverrideControlTeam={handleOverrideControlTeam}
        onSetCaptain={handleSetCaptain}
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
      <GamesManager
        games={games}
        loading={loadingGames}
        error={gamesError}
        onEnter={handleEnterGame}
        onArchive={handleArchiveGame}
        onDelete={handleDeleteGame}
      />
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
