import { useCallback, useEffect, useState } from 'react';
import { PasscodeGate } from '../components/PasscodeGate.js';
import { useHostAuth } from '../auth/useHostAuth.js';
import { boardApi, BoardSummary } from '../api/boards.js';
import { createGame } from '../api/games.js';
import { useSocket } from '../socket/useSocket.js';
import type { HostView } from '@jeopardy/shared';

export interface HostLobbyProps {
  roomCode: string;
  state: HostView | null;
  onStartGame: () => void;
  onCreateNewGame?: () => void;
  startError: string | null;
}

export function HostLobby({ roomCode, state, onStartGame, onCreateNewGame, startError }: HostLobbyProps) {
  const playerCount = state?.players.length ?? 0;
  const connectedCount = state?.players.filter((p) => p.connected).length ?? 0;
  const canStart = connectedCount > 0;

  return (
    <main className="host-lobby route-stub">
      <h1>Host Lobby</h1>
      <p className="room-code" data-testid="room-code">
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
        <ul className="player-list">
          {state?.players.map((player) => (
            <li key={player.id} className={player.connected ? 'connected' : 'disconnected'}>
              <span className="player-name">{player.name}</span>{' '}
              <span
                className={`player-status ${player.connected ? 'status-connected' : 'status-disconnected'}`}
                data-testid={`player-status-${player.id}`}
              >
                {player.connected ? 'connected' : 'disconnected'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="start-controls">
        <button
          type="button"
          onClick={onStartGame}
          disabled={!canStart}
          aria-disabled={!canStart}
          data-testid="start-game-button"
        >
          Start Game
        </button>
        {onCreateNewGame && (
          <button type="button" onClick={onCreateNewGame}>
            New Game
          </button>
        )}
        {connectedCount === 0 && (
          <p className="minimum-players">At least one connected contestant is required to start.</p>
        )}
      </div>
    </main>
  );
}

export interface HostInProgressProps {
  roomCode: string;
  state: HostView | null;
  onSelectClue?: (clueId: string) => void;
  onRevealAnswer?: () => void;
  onArmBuzzers?: () => void;
  onRuleCorrect?: () => void;
  onRuleIncorrect?: (playerId: string) => void;
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
      className="host-grid"
      data-testid="host-grid"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${state.round.categories.length}, 1fr)`, gap: '0.5rem' }}
    >
      {state.round.categories.map((category) => (
        <div key={category.id} className="host-category-header" data-testid="host-category-header">
          {category.title}
          {category.clues.some((c) => c.isDailyDouble) && <span data-testid="dd-marker"> (DD)</span>}
        </div>
      ))}
      {rows.map((row) =>
        state.round!.categories.map((category) => {
          const clue = category.clues.find((c) => c.row === row);
          if (!clue) return <div key={`${category.id}-${row}`} className="host-cell" />;
          const used = state.usedClueIds.includes(clue.id);
          return (
            <button
              key={clue.id}
              type="button"
              className="host-cell"
              data-testid={used ? 'host-used-cell' : 'host-clue-cell'}
              data-clue-id={clue.id}
              disabled={used}
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

export function HostInProgress({
  roomCode,
  state,
  onSelectClue,
  onRevealAnswer,
  onArmBuzzers,
  onRuleCorrect,
  onRuleIncorrect,
}: HostInProgressProps) {
  const players = state?.players ?? [];
  const currentClue = state?.currentClueId
    ? state?.round?.categories.flatMap((c) => c.clues).find((c) => c.id === state.currentClueId)
    : null;
  const buzzedPlayer = state?.buzzWinnerId ? players.find((p) => p.id === state.buzzWinnerId) : null;

  return (
    <main className="host-in-progress route-stub">
      <h1>Game in Progress</h1>
      <p className="room-code" data-testid="room-code">
        Room Code: {roomCode}
      </p>
      <p className="phase" data-testid="phase-indicator">
        Phase: {state?.phase ?? '—'}
      </p>
      <h2>Roster</h2>
      {players.length === 0 ? (
        <p>No contestants connected.</p>
      ) : (
        <ul className="player-list" data-testid="roster">
          {players.map((player) => (
            <li
              key={player.id}
              className={player.connected ? 'connected' : 'disconnected'}
              data-testid={`roster-item-${player.id}`}
            >
              <span className="player-name" data-testid={`roster-name-${player.id}`}>
                {player.name}
              </span>
              <span className="player-score" data-testid={`roster-score-${player.id}`}>
                {player.score}
              </span>
              <span
                className={`player-status ${player.connected ? 'status-connected' : 'status-disconnected'}`}
                data-testid={`player-status-${player.id}`}
              >
                {player.connected ? 'connected' : 'disconnected'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h2>Board</h2>
      {state && <HostGrid state={state} onSelectClue={onSelectClue} />}
      {currentClue && (
        <div className="current-clue" data-testid="current-clue">
          <h3>Current Clue</h3>
          <p data-testid="clue-text">{currentClue.clueText}</p>
          <p data-testid="answer-text">Answer: {currentClue.answer}</p>
          {state?.phase === 'CLUE_REVEALED' && (
            <button type="button" onClick={onArmBuzzers} data-testid="arm-buzzers-button">
              Arm Buzzers
            </button>
          )}
          {state?.phase === 'CLUE_REVEALED' && (
            <button type="button" onClick={onRevealAnswer} data-testid="reveal-answer-button">
              Reveal Answer / Return to Board
            </button>
          )}
          {state?.phase === 'BUZZED' && buzzedPlayer && (
            <div data-testid="buzzed-player">
              <p>
                Buzzed in: <strong>{buzzedPlayer.name}</strong>
              </p>
              <button type="button" onClick={onRuleCorrect} data-testid="rule-correct-button">
                Correct
              </button>
              <button
                type="button"
                onClick={() => onRuleIncorrect?.(buzzedPlayer.id)}
                data-testid="rule-incorrect-button"
              >
                Incorrect
              </button>
            </div>
          )}
        </div>
      )}
    </main>
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
  const handleSelectClue = useCallback(
    (clueId: string) => {
      hostSocket.selectClue?.(clueId);
    },
    [hostSocket],
  );
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

  if (roomCode) {
    const inLobby = !gameState || gameState.phase === 'LOBBY';
    if (inLobby) {
      return (
        <HostLobby
          roomCode={roomCode}
          state={gameState}
          onStartGame={handleStartGame}
          onCreateNewGame={handleCreateNewGame}
          startError={hostSocket.error}
        />
      );
    }
    return (
      <HostInProgress
        roomCode={roomCode}
        state={gameState}
        onSelectClue={handleSelectClue}
        onRevealAnswer={handleRevealAnswer}
        onArmBuzzers={handleArmBuzzers}
        onRuleCorrect={handleRuleCorrect}
        onRuleIncorrect={handleRuleIncorrect}
      />
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
        <ul className="board-list">
          {boards.map((board) => (
            <li key={board.id}>
              <button
                type="button"
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
