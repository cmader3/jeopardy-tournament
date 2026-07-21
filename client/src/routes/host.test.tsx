import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostLobby, HostInProgress, HostContent, HostGameControls } from './host.js';
import type { HostView } from '@jeopardy/shared';

vi.mock('../auth/useHostAuth.js', () => ({ useHostAuth: vi.fn() }));
vi.mock('../api/boards.js', () => ({
  boardApi: { getBoards: vi.fn() },
  __esModule: true,
}));
vi.mock('../api/games.js', () => ({
  createGame: vi.fn(),
  listGames: vi.fn(),
  setGameArchived: vi.fn(),
  deleteGame: vi.fn(),
  __esModule: true,
}));
vi.mock('../socket/useSocket.js', () => ({
  useSocket: vi.fn(),
  __esModule: true,
}));

import { useHostAuth } from '../auth/useHostAuth.js';
import { boardApi } from '../api/boards.js';
import { createGame, listGames, setGameArchived, deleteGame } from '../api/games.js';
import { useSocket } from '../socket/useSocket.js';

beforeEach(() => {
  vi.mocked(listGames).mockReset().mockResolvedValue([]);
  vi.mocked(setGameArchived).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteGame).mockReset().mockResolvedValue(undefined);
});

function mockUseSocket(overrides: Record<string, unknown> = {}) {
  useSocket.mockReturnValue({
    connected: true,
    error: null,
    data: null,
    startGame: vi.fn(),
    leaveGame: vi.fn(),
    selectClue: vi.fn(),
    revealClue: vi.fn(),
    revealAnswer: vi.fn(),
    returnToBoard: vi.fn(),
    armBuzzers: vi.fn(),
    buzz: vi.fn(),
    ruleCorrect: vi.fn(),
    ruleIncorrect: vi.fn(),
    adjustScore: vi.fn(),
    undoLastRuling: vi.fn(),
    submitDDWager: vi.fn(),
    cancelDailyDouble: vi.fn(),
    advanceRound: vi.fn(),
    openFinalWagers: vi.fn(),
    submitFinalWager: vi.fn(),
    submitFinalAnswer: vi.fn(),
    forceFinalWagers: vi.fn(),
    overrideControl: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  });
}

function makeRound(overrides: Partial<HostView['round']> = {}): NonNullable<HostView['round']> {
  return {
    id: 'r1',
    type: 'JEOPARDY',
    order: 0,
    categories: [
      {
        id: 'c1',
        title: 'Science',
        order: 0,
        clues: [
          { id: 'cl1', categoryId: 'c1', row: 0, value: 100, clueText: 'H2O is this compound', answer: 'Water', isDailyDouble: false },
          { id: 'cl2', categoryId: 'c1', row: 1, value: 200, clueText: 'This planet is the Red Planet', answer: 'Mars', isDailyDouble: true },
        ],
      },
      {
        id: 'c2',
        title: 'History',
        order: 1,
        clues: [{ id: 'cl3', categoryId: 'c2', row: 0, value: 100, clueText: 'First US president', answer: 'Washington', isDailyDouble: false }],
      },
    ],
    ...overrides,
  };
}

function makeFinalRound(overrides: Partial<HostView['round']> = {}): NonNullable<HostView['round']> {
  return {
    id: 'r-final',
    type: 'FINAL',
    order: 1,
    categories: [
      {
        id: 'c-final',
        title: 'Literature',
        order: 0,
        clues: [
          {
            id: 'cl-final',
            categoryId: 'c-final',
            row: 0,
            value: null,
            clueText: 'He wrote The Hobbit',
            answer: 'J.R.R. Tolkien',
            isDailyDouble: false,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeHostState(overrides: Partial<HostView> = {}): HostView {
  return {
    phase: 'LOBBY',
    roomCode: 'ABCD',
    roundIndex: 0,
    players: [],
    round: null,
    usedClueIds: [],
    currentClueId: null,
    currentClueText: null,
    controllingPlayerId: null,
    buzzWinnerId: null,
    deadline: null,
    answer: null,
    lastOutcome: null,
    lockedOutPlayerIds: [],
    auditLog: [],
    dailyDoubleWager: null,
    transitionTarget: null,
    finalNoEligiblePlayers: false,
    finalEligiblePlayerIds: [],
    finalWagerSubmissionStatus: {},
    finalAnswerSubmissionStatus: {},
    roundComplete: false,
    nextRoundTarget: 'FINAL',
    removedPlayers: [],
    serverNow: 0,
    clueSelectionMode: 'HOST',
    pendingClueId: null,
    ...overrides,
  };
}

describe('HostLobby', () => {
  it('shows the room code and an empty roster', () => {
    render(<HostLobby roomCode="ABCD" state={makeHostState()} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByTestId('room-code')).toHaveTextContent('Room Code: ABCD');
    expect(screen.getByText('Waiting for players...')).toBeInTheDocument();
  });

  it('renders a back-to-menu link that returns to the games list', async () => {
    const onCreateNewGame = vi.fn();
    render(
      <HostLobby
        roomCode="ABCD"
        state={makeHostState()}
        onStartGame={vi.fn()}
        onCreateNewGame={onCreateNewGame}
        startError={null}
      />,
    );

    await userEvent.click(screen.getByTestId('lobby-menu-button'));
    expect(onCreateNewGame).toHaveBeenCalledTimes(1);
  });

  it('disables the start button when no players are in the lobby', () => {
    render(<HostLobby roomCode="ABCD" state={makeHostState()} onStartGame={vi.fn()} startError={null} />);

    const button = screen.getByTestId('start-game-button');
    expect(button).toBeDisabled();
    expect(screen.getByText('At least one connected contestant is required to start.')).toBeInTheDocument();
  });

  it('enables the start button when at least one player is connected', () => {
    const state = makeHostState({
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
    });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByTestId('start-game-button')).toBeEnabled();
  });

  it('disables the start button when only disconnected players are in the lobby', () => {
    const state = makeHostState({
      players: [
        { id: 'p1', name: 'Alice', score: 0, connected: false },
        { id: 'p2', name: 'Bob', score: 0, connected: false },
      ],
    });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByTestId('start-game-button')).toBeDisabled();
  });

  it('shows the minimum-players message when no players are connected', () => {
    const state = makeHostState({
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: false }],
    });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByText(/at least one connected contestant/i)).toBeInTheDocument();
  });

  it('shows the server rejection message when starting fails', () => {
    const state = makeHostState({
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: false }],
    });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError="At least one connected contestant is required to start" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/connected contestant/i);
  });

  it('calls onStartGame when the start button is clicked', async () => {
    const onStartGame = vi.fn();
    const state = makeHostState({
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
    });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={onStartGame} startError={null} />);

    await userEvent.click(screen.getByTestId('start-game-button'));
    expect(onStartGame).toHaveBeenCalledTimes(1);
  });

  it('shows a per-player connection status indicator', () => {
    const state = makeHostState({
      players: [
        { id: 'p1', name: 'Alice', score: 0, connected: true },
        { id: 'p2', name: 'Bob', score: 0, connected: false },
      ],
    });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByTestId('player-status-p1')).toHaveTextContent('connected');
    expect(screen.getByTestId('player-status-p2')).toHaveTextContent('disconnected');
  });

  it('keeps the start controls visible while the server phase is still LOBBY', () => {
    const state = makeHostState({ players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }] });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByTestId('start-game-button')).toBeInTheDocument();
    expect(screen.queryByText('Game started!')).not.toBeInTheDocument();
  });

  it('shows the clue-selection toggle defaulting to Host picks', () => {
    render(<HostLobby roomCode="ABCD" state={makeHostState()} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByTestId('clue-mode-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('clue-mode-host')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('clue-mode-player')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects Players-pick mode as active when set', () => {
    const state = makeHostState({ clueSelectionMode: 'PLAYER' });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByTestId('clue-mode-player')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('clue-mode-host')).toHaveAttribute('aria-pressed', 'false');
  });

  it('emits a clue-selection mode change from the lobby toggle', async () => {
    const onSetClueSelectionMode = vi.fn();
    render(
      <HostLobby
        roomCode="ABCD"
        state={makeHostState()}
        onStartGame={vi.fn()}
        onSetClueSelectionMode={onSetClueSelectionMode}
        startError={null}
      />,
    );

    await userEvent.click(screen.getByTestId('clue-mode-player'));
    expect(onSetClueSelectionMode).toHaveBeenCalledWith('PLAYER');
  });

  it('shows a remove button for each player in the lobby', () => {
    const state = makeHostState({
      players: [
        { id: 'p1', name: 'Alice', score: 0, connected: true },
        { id: 'p2', name: 'Bob', score: 0, connected: false },
      ],
    });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByTestId('remove-player-p1')).toBeInTheDocument();
    expect(screen.getByTestId('remove-player-p2')).toBeInTheDocument();
  });

  it('removes a player only after confirming', async () => {
    const onRemovePlayer = vi.fn();
    const state = makeHostState({
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
    });
    render(
      <HostLobby
        roomCode="ABCD"
        state={state}
        onStartGame={vi.fn()}
        onRemovePlayer={onRemovePlayer}
        startError={null}
      />,
    );

    await userEvent.click(screen.getByTestId('remove-player-p1'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onRemovePlayer).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('confirm-remove-player-button'));
    expect(onRemovePlayer).toHaveBeenCalledWith('p1');
  });

  it('does not remove a player when the confirmation is cancelled', async () => {
    const onRemovePlayer = vi.fn();
    const state = makeHostState({
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
    });
    render(
      <HostLobby
        roomCode="ABCD"
        state={state}
        onStartGame={vi.fn()}
        onRemovePlayer={onRemovePlayer}
        startError={null}
      />,
    );

    await userEvent.click(screen.getByTestId('remove-player-p1'));
    await userEvent.click(screen.getByTestId('cancel-remove-player-button'));
    expect(onRemovePlayer).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not show the removed players section when nobody is removed', () => {
    render(<HostLobby roomCode="ABCD" state={makeHostState()} onStartGame={vi.fn()} startError={null} />);
    expect(screen.queryByTestId('removed-players')).not.toBeInTheDocument();
  });

  it('lists removed players and allows the host to let them back in', async () => {
    const onAdmitPlayer = vi.fn();
    const state = makeHostState({
      removedPlayers: [{ id: 'p1', name: 'Alice' }],
    });
    render(
      <HostLobby
        roomCode="ABCD"
        state={state}
        onStartGame={vi.fn()}
        onAdmitPlayer={onAdmitPlayer}
        startError={null}
      />,
    );

    expect(screen.getByTestId('removed-players')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('admit-player-p1'));
    expect(onAdmitPlayer).toHaveBeenCalledWith('p1');
  });
});

describe('HostInProgress clue-selection mode', () => {
  it('shows the toggle and a reveal panel while a clue is pending in player-pick mode', () => {
    const state = makeHostState({
      phase: 'CLUE_SELECTED',
      round: makeRound(),
      clueSelectionMode: 'PLAYER',
      pendingClueId: 'cl1',
      controllingPlayerId: 'p1',
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('clue-mode-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('pending-clue')).toBeInTheDocument();
    expect(screen.getByTestId('pending-clue-text')).toHaveTextContent('Science for $100');
    expect(screen.getByTestId('pending-clue-text')).toHaveTextContent('Alice');
    expect(screen.getByTestId('reveal-selected-clue-button')).toBeInTheDocument();
  });

  it('emits reveal when the host clicks Reveal Clue', async () => {
    const onRevealSelectedClue = vi.fn();
    const state = makeHostState({
      phase: 'CLUE_SELECTED',
      round: makeRound(),
      clueSelectionMode: 'PLAYER',
      pendingClueId: 'cl1',
      controllingPlayerId: 'p1',
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onRevealSelectedClue={onRevealSelectedClue} />);

    await userEvent.click(screen.getByTestId('reveal-selected-clue-button'));
    expect(onRevealSelectedClue).toHaveBeenCalledTimes(1);
  });

  it('emits a clue-selection mode change from the in-progress toggle', async () => {
    const onSetClueSelectionMode = vi.fn();
    const state = makeHostState({ phase: 'BOARD_SELECT', round: makeRound() });
    render(<HostInProgress roomCode="WXYZ" state={state} onSetClueSelectionMode={onSetClueSelectionMode} />);

    await userEvent.click(screen.getByTestId('clue-mode-player'));
    expect(onSetClueSelectionMode).toHaveBeenCalledWith('PLAYER');
  });
});

describe('HostInProgress clue pop-out modal', () => {
  it('pops the active clue into a modal dialog while a clue is live', () => {
    const state = makeHostState({
      phase: 'CLUE_REVEALED',
      round: makeRound(),
      currentClueId: 'cl1',
      currentClueText: 'H2O is this compound',
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    const modal = screen.getByTestId('clue-modal');
    expect(modal).toHaveAttribute('role', 'dialog');
    expect(modal).toHaveAttribute('aria-modal', 'true');
    expect(within(modal).getByTestId('current-clue')).toBeInTheDocument();
    expect(within(modal).getByTestId('clue-text')).toHaveTextContent('H2O is this compound');
    expect(within(modal).getByTestId('arm-buzzers-button')).toBeInTheDocument();
  });

  it('pops the pending clue into the modal during CLUE_SELECTED', () => {
    const state = makeHostState({
      phase: 'CLUE_SELECTED',
      round: makeRound(),
      pendingClueId: 'cl1',
      controllingPlayerId: 'p1',
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    const modal = screen.getByTestId('clue-modal');
    expect(within(modal).getByTestId('pending-clue')).toBeInTheDocument();
    expect(within(modal).getByTestId('reveal-selected-clue-button')).toBeInTheDocument();
  });

  it('does not render the clue modal on the board-select screen', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', round: makeRound() });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.queryByTestId('clue-modal')).not.toBeInTheDocument();
  });

  it('keeps the answer recap inline after a ruling instead of in the modal', () => {
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      round: makeRound(),
      currentClueId: null,
      answer: 'Water',
      lastOutcome: { playerId: 'p1', type: 'CORRECT', value: 100 },
      players: [{ id: 'p1', name: 'Alice', score: 100, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.queryByTestId('clue-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('host-answer-banner')).toBeInTheDocument();
  });
});

describe('HostGameControls', () => {
  it('restarts only after confirming in the warning dialog', async () => {
    const onRestart = vi.fn();
    render(<HostGameControls onRestart={onRestart} onBackToMenu={vi.fn()} />);

    await userEvent.click(screen.getByTestId('restart-game-button'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onRestart).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('confirm-restart-button'));
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cancels the restart without calling the handler', async () => {
    const onRestart = vi.fn();
    render(<HostGameControls onRestart={onRestart} onBackToMenu={vi.fn()} />);

    await userEvent.click(screen.getByTestId('restart-game-button'));
    await userEvent.click(screen.getByTestId('cancel-restart-button'));

    expect(onRestart).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('returns to the menu only after confirming', async () => {
    const onBackToMenu = vi.fn();
    render(<HostGameControls onRestart={vi.fn()} onBackToMenu={onBackToMenu} />);

    await userEvent.click(screen.getByTestId('back-to-menu-button'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onBackToMenu).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('confirm-back-to-menu-button'));
    expect(onBackToMenu).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('HostInProgress', () => {
  it('renders the room code and a phase indicator', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', roomCode: 'WXYZ' });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('room-code')).toHaveTextContent('Room Code: WXYZ');
    expect(screen.getByTestId('phase-indicator')).toHaveTextContent('BOARD_SELECT');
  });

  it('renders the roster with names and scores', () => {
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      players: [
        { id: 'p1', name: 'Alice', score: 200, connected: true },
        { id: 'p2', name: 'Bob', score: -100, connected: true },
      ],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('roster')).toBeInTheDocument();
    expect(screen.getByTestId('roster-name-p1')).toHaveTextContent('Alice');
    expect(screen.getByTestId('roster-score-p1')).toHaveTextContent('200');
    expect(screen.getByTestId('roster-name-p2')).toHaveTextContent('Bob');
    expect(screen.getByTestId('roster-score-p2')).toHaveTextContent('-$100');
  });

  it('shows a waiting message when the roster is empty', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', players: [] });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByText('No contestants connected.')).toBeInTheDocument();
  });
});

describe('HostContent', () => {
  it('renders the board picker and creates a game when a board is selected', async () => {
    const token = 'host-token';
    const startGame = vi.fn();
    useHostAuth.mockReturnValue({
      token,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
    });
    boardApi.getBoards.mockResolvedValue([
      { id: 'b1', name: 'Board One', isComplete: true },
      { id: 'b2', name: 'Board Two', isComplete: false },
    ]);
    createGame.mockResolvedValue({ roomCode: 'WXYZ' });
    mockUseSocket({ startGame });

    render(<HostContent />);

    expect(await screen.findByText('Board One')).toBeInTheDocument();
    expect(screen.getByText('Board Two (incomplete)')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Board One'));
    expect(createGame).toHaveBeenCalledWith('b1', token);
    expect(await screen.findByTestId('room-code')).toHaveTextContent('Room Code: WXYZ');
    expect(localStorage.getItem('jeopardy-host-room')).toBe('WXYZ');
  });

  it('restores a stored room code and shows the lobby without returning to the board picker', async () => {
    const token = 'host-token';
    const startGame = vi.fn();
    localStorage.setItem('jeopardy-host-room', 'WXYZ');
    useHostAuth.mockReturnValue({
      token,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
    });
    boardApi.getBoards.mockResolvedValue([
      { id: 'b1', name: 'Board One', isComplete: true },
    ]);
    mockUseSocket({ startGame });

    render(<HostContent />);

    expect(await screen.findByTestId('room-code')).toHaveTextContent('Room Code: WXYZ');
    expect(screen.queryByText('Board One')).not.toBeInTheDocument();
    expect(useSocket).toHaveBeenCalledWith('host', 'WXYZ', expect.any(Function), undefined, undefined, token);
  });

  it('switches to the in-progress view when the server projection leaves the lobby', async () => {
    const token = 'host-token';
    const startGame = vi.fn();
    const inProgressState = makeHostState({
      phase: 'BOARD_SELECT',
      roomCode: 'WXYZ',
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
    });
    localStorage.setItem('jeopardy-host-room', 'WXYZ');
    useHostAuth.mockReturnValue({
      token,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
    });
    let seeded = false;
    useSocket.mockImplementation((_role, _roomCode, onState) => {
      if (!seeded) {
        seeded = true;
        onState?.(inProgressState);
      }
      return { connected: true, error: null, data: inProgressState, startGame };
    });

    render(<HostContent />);

    expect(await screen.findByTestId('room-code')).toHaveTextContent('Room Code: WXYZ');
    expect(screen.queryByText('Host Lobby')).not.toBeInTheDocument();
    expect(screen.getByTestId('phase-indicator')).toHaveTextContent('BOARD_SELECT');
    expect(screen.getByTestId('roster-name-p1')).toHaveTextContent('Alice');
    expect(screen.getByTestId('roster-score-p1')).toHaveTextContent('0');
  });
});

describe('HostInProgress grid and selection', () => {
  it('renders the host grid with categories and values', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', round: makeRound() });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('host-grid')).toBeInTheDocument();
    const headers = screen.getAllByTestId('host-category-header');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveTextContent('Science');
    expect(headers[1]).toHaveTextContent('History');
    expect(screen.getAllByTestId('host-clue-cell')).toHaveLength(3);
  });

  it('marks the daily double on its clue cell, not the category header', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', round: makeRound() });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    const marker = screen.getByTestId('dd-marker');
    expect(marker).toBeInTheDocument();
    expect(marker.closest('[data-testid="host-clue-cell"]')?.getAttribute('data-clue-id')).toBe('cl2');
    for (const header of screen.getAllByTestId('host-category-header')) {
      expect(header.textContent).not.toContain('DD');
    }
  });

  it('calls onSelectClue when a usable cell is clicked', async () => {
    const onSelectClue = vi.fn();
    const state = makeHostState({ phase: 'BOARD_SELECT', round: makeRound() });
    render(<HostInProgress roomCode="WXYZ" state={state} onSelectClue={onSelectClue} />);

    const cell = screen.getAllByTestId('host-clue-cell')[0];
    await userEvent.click(cell);

    expect(onSelectClue).toHaveBeenCalledWith('cl1');
  });

  it('disables used cells on the host grid', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', round: makeRound(), usedClueIds: ['cl1'] });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getAllByTestId('host-used-cell')).toHaveLength(1);
    expect(screen.getAllByTestId('host-clue-cell')).toHaveLength(2);
  });

  it('shows the current clue and answer', () => {
    const state = makeHostState({
      phase: 'CLUE_REVEALED',
      round: makeRound(),
      currentClueId: 'cl1',
      currentClueText: 'H2O is this compound',
      answer: 'Water',
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('clue-text')).toHaveTextContent('H2O is this compound');
    expect(screen.getByTestId('answer-text')).toHaveTextContent('Answer: Water');
  });

  it('calls onRevealAnswer when the reveal button is clicked', async () => {
    const onRevealAnswer = vi.fn();
    const state = makeHostState({
      phase: 'CLUE_REVEALED',
      round: makeRound(),
      currentClueId: 'cl1',
      currentClueText: 'H2O is this compound',
      answer: 'Water',
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onRevealAnswer={onRevealAnswer} />);

    await userEvent.click(screen.getByTestId('reveal-answer-button'));
    expect(onRevealAnswer).toHaveBeenCalledTimes(1);
  });

  it('shows Return to Board before Reveal Answer during CLUE_REVEALED', () => {
    const state = makeHostState({
      phase: 'CLUE_REVEALED',
      round: makeRound(),
      currentClueId: 'cl1',
      currentClueText: 'H2O is this compound',
      answer: 'Water',
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    const returnButton = screen.getByTestId('return-to-board-button');
    const revealButton = screen.getByTestId('reveal-answer-button');
    expect(returnButton).toHaveTextContent('Return to Board');
    expect(revealButton).toHaveTextContent('Reveal Answer');
    expect(returnButton.compareDocumentPosition(revealButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('calls onReturnToBoard without revealing the answer when Return to Board is clicked', async () => {
    const onReturnToBoard = vi.fn();
    const onRevealAnswer = vi.fn();
    const state = makeHostState({
      phase: 'CLUE_REVEALED',
      round: makeRound(),
      currentClueId: 'cl1',
      currentClueText: 'H2O is this compound',
      answer: 'Water',
    });
    render(
      <HostInProgress
        roomCode="WXYZ"
        state={state}
        onReturnToBoard={onReturnToBoard}
        onRevealAnswer={onRevealAnswer}
      />,
    );

    await userEvent.click(screen.getByTestId('return-to-board-button'));
    expect(onReturnToBoard).toHaveBeenCalledTimes(1);
    expect(onRevealAnswer).not.toHaveBeenCalled();
  });

  it('shows the arm buzzers button during CLUE_REVEALED', () => {
    const onArmBuzzers = vi.fn();
    const state = makeHostState({
      phase: 'CLUE_REVEALED',
      round: makeRound(),
      currentClueId: 'cl1',
      currentClueText: 'H2O is this compound',
      answer: 'Water',
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onArmBuzzers={onArmBuzzers} />);

    expect(screen.getByTestId('arm-buzzers-button')).toBeInTheDocument();
  });

  it('calls onArmBuzzers when the arm button is clicked', async () => {
    const onArmBuzzers = vi.fn();
    const state = makeHostState({
      phase: 'CLUE_REVEALED',
      round: makeRound(),
      currentClueId: 'cl1',
      currentClueText: 'H2O is this compound',
      answer: 'Water',
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onArmBuzzers={onArmBuzzers} />);

    await userEvent.click(screen.getByTestId('arm-buzzers-button'));
    expect(onArmBuzzers).toHaveBeenCalledTimes(1);
  });

  it('shows the buzzed contestant and ruling buttons during BUZZED', () => {
    const state = makeHostState({
      phase: 'BUZZED',
      round: makeRound(),
      currentClueId: 'cl1',
      currentClueText: 'H2O is this compound',
      answer: 'Water',
      buzzWinnerId: 'p2',
      players: [
        { id: 'p1', name: 'Alice', score: 0, connected: true },
        { id: 'p2', name: 'Bob', score: 0, connected: true },
      ],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('buzzed-player')).toHaveTextContent('Buzzed in: Bob');
    expect(screen.getByTestId('rule-correct-button')).toBeInTheDocument();
    expect(screen.getByTestId('rule-incorrect-button')).toBeInTheDocument();
  });

  it('shows the buzzed contestant with their team name in parentheses in team mode', () => {
    const state = makeHostState({
      phase: 'BUZZED',
      teamMode: true,
      round: makeRound(),
      currentClueId: 'cl1',
      currentClueText: 'H2O is this compound',
      answer: 'Water',
      buzzWinnerId: 'p2',
      controllingTeamId: 't2',
      players: [
        { id: 'p1', name: 'Alice', score: 0, connected: true, teamId: 't1' },
        { id: 'p2', name: 'Bob', score: 0, connected: true, teamId: 't2' },
      ],
      teams: [
        { id: 't1', name: 'Red', score: 0, captainId: 'p1', actingCaptainId: 'p1', memberIds: ['p1'], connectedMemberIds: ['p1'] },
        { id: 't2', name: 'Blue', score: 0, captainId: 'p2', actingCaptainId: 'p2', memberIds: ['p2'], connectedMemberIds: ['p2'] },
      ],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('buzzed-player')).toHaveTextContent('Buzzed in: Bob (Blue)');
  });

  it('calls onRuleCorrect and onRuleIncorrect when ruling buttons are clicked', async () => {
    const onRuleCorrect = vi.fn();
    const onRuleIncorrect = vi.fn();
    const state = makeHostState({
      phase: 'BUZZED',
      round: makeRound(),
      currentClueId: 'cl1',
      currentClueText: 'H2O is this compound',
      answer: 'Water',
      buzzWinnerId: 'p2',
      players: [
        { id: 'p1', name: 'Alice', score: 0, connected: true },
        { id: 'p2', name: 'Bob', score: 0, connected: true },
      ],
    });
    render(
      <HostInProgress
        roomCode="WXYZ"
        state={state}
        onRuleCorrect={onRuleCorrect}
        onRuleIncorrect={onRuleIncorrect}
      />,
    );

    await userEvent.click(screen.getByTestId('rule-correct-button'));
    expect(onRuleCorrect).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTestId('rule-incorrect-button'));
    expect(onRuleIncorrect).toHaveBeenCalledWith('p2');
  });

  it('shows the reveal clue button once the Daily Double wager is submitted', () => {
    const onRevealClue = vi.fn();
    const state = makeHostState({
      phase: 'DAILY_DOUBLE_WAGER',
      round: makeRound(),
      currentClueId: 'cl2',
      currentClueText: null,
      controllingPlayerId: 'p1',
      dailyDoubleWager: 200,
      players: [{ id: 'p1', name: 'Alice', score: 1000, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onRevealClue={onRevealClue} />);

    expect(screen.getByTestId('reveal-clue-button')).toBeInTheDocument();
    expect(screen.getByTestId('daily-double-wager')).toHaveTextContent('200');
    expect(screen.queryByTestId('rule-correct-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('waiting-on-wager')).not.toBeInTheDocument();
  });

  it('calls onRevealClue when the reveal clue button is clicked', async () => {
    const onRevealClue = vi.fn();
    const state = makeHostState({
      phase: 'DAILY_DOUBLE_WAGER',
      round: makeRound(),
      currentClueId: 'cl2',
      currentClueText: null,
      controllingPlayerId: 'p1',
      dailyDoubleWager: 200,
      players: [{ id: 'p1', name: 'Alice', score: 1000, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onRevealClue={onRevealClue} />);

    await userEvent.click(screen.getByTestId('reveal-clue-button'));
    expect(onRevealClue).toHaveBeenCalledTimes(1);
  });

  it('shows a cancel Daily Double button when the controller is disconnected mid-wager', async () => {
    const onCancelDailyDouble = vi.fn();
    const state = makeHostState({
      phase: 'DAILY_DOUBLE_WAGER',
      round: makeRound(),
      currentClueId: 'cl2',
      currentClueText: null,
      controllingPlayerId: 'p1',
      dailyDoubleWager: null,
      players: [
        { id: 'p1', name: 'Alice', score: 1000, connected: false },
        { id: 'p2', name: 'Bob', score: 0, connected: true },
      ],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onCancelDailyDouble={onCancelDailyDouble} />);

    const cancelButton = screen.getByTestId('cancel-daily-double-button');
    expect(cancelButton).toBeInTheDocument();

    await userEvent.click(cancelButton);
    expect(onCancelDailyDouble).toHaveBeenCalledTimes(1);
  });

  it('does not show the cancel Daily Double button when the controller is still connected', () => {
    const state = makeHostState({
      phase: 'DAILY_DOUBLE_WAGER',
      round: makeRound(),
      currentClueId: 'cl2',
      currentClueText: null,
      controllingPlayerId: 'p1',
      dailyDoubleWager: null,
      players: [{ id: 'p1', name: 'Alice', score: 1000, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.queryByTestId('cancel-daily-double-button')).not.toBeInTheDocument();
  });

  it('shows Waiting on Wager while the Daily Double wager is still pending', () => {
    const state = makeHostState({
      phase: 'DAILY_DOUBLE_WAGER',
      round: makeRound(),
      currentClueId: 'cl2',
      currentClueText: null,
      controllingPlayerId: 'p1',
      dailyDoubleWager: null,
      players: [{ id: 'p1', name: 'Alice', score: 1000, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('waiting-on-wager')).toHaveTextContent('Waiting on Wager');
  });

  it('shows the ruling buttons during DAILY_DOUBLE_CLUE and rules the controller', async () => {
    const onRuleCorrect = vi.fn();
    const onRuleIncorrect = vi.fn();
    const state = makeHostState({
      phase: 'DAILY_DOUBLE_CLUE',
      round: makeRound(),
      currentClueId: 'cl2',
      currentClueText: 'This planet is the Red Planet',
      answer: 'Mars',
      controllingPlayerId: 'p1',
      dailyDoubleWager: 200,
      players: [
        { id: 'p1', name: 'Alice', score: 1000, connected: true },
        { id: 'p2', name: 'Bob', score: 0, connected: true },
      ],
    });
    render(
      <HostInProgress
        roomCode="WXYZ"
        state={state}
        onRuleCorrect={onRuleCorrect}
        onRuleIncorrect={onRuleIncorrect}
      />,
    );

    expect(screen.getByTestId('rule-correct-button')).toBeInTheDocument();
    expect(screen.getByTestId('rule-incorrect-button')).toBeInTheDocument();
    expect(screen.queryByTestId('reveal-clue-button')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('rule-correct-button'));
    expect(onRuleCorrect).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTestId('rule-incorrect-button'));
    expect(onRuleIncorrect).toHaveBeenCalledWith('p1');
  });
});

describe('HostInProgress in-game removal and re-do', () => {
  it('shows a roster Remove button only when onRemovePlayer is provided', () => {
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      players: [{ id: 'p1', name: 'Alice', score: 100, connected: true }],
    });

    const { rerender } = render(<HostInProgress roomCode="WXYZ" state={state} />);
    expect(screen.queryByTestId('remove-player-p1')).not.toBeInTheDocument();

    rerender(<HostInProgress roomCode="WXYZ" state={state} onRemovePlayer={vi.fn()} />);
    expect(screen.getByTestId('remove-player-p1')).toBeInTheDocument();
  });

  it('confirms before removing a player mid-game and calls onRemovePlayer', async () => {
    const onRemovePlayer = vi.fn();
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      players: [{ id: 'p1', name: 'Alice', score: 100, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onRemovePlayer={onRemovePlayer} />);

    await userEvent.click(screen.getByTestId('remove-player-p1'));
    expect(screen.getByTestId('confirm-remove-player-button')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('confirm-remove-player-button'));

    expect(onRemovePlayer).toHaveBeenCalledWith('p1');
  });

  it('does not remove a player when the removal is cancelled', async () => {
    const onRemovePlayer = vi.fn();
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      players: [{ id: 'p1', name: 'Alice', score: 100, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onRemovePlayer={onRemovePlayer} />);

    await userEvent.click(screen.getByTestId('remove-player-p1'));
    await userEvent.click(screen.getByTestId('cancel-remove-player-button'));

    expect(onRemovePlayer).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-remove-player-button')).not.toBeInTheDocument();
  });

  it('shows a Re-do button on used cells only between clues (BOARD_SELECT)', () => {
    const boardSelect = makeHostState({
      phase: 'BOARD_SELECT',
      round: makeRound(),
      usedClueIds: ['cl1'],
    });
    const { rerender } = render(
      <HostInProgress roomCode="WXYZ" state={boardSelect} onReopenClue={vi.fn()} />,
    );
    expect(screen.getByTestId('redo-clue-cl1')).toBeInTheDocument();

    const midClue = makeHostState({
      phase: 'CLUE_REVEALED',
      round: makeRound(),
      usedClueIds: ['cl1'],
      currentClueId: 'cl3',
      currentClueText: 'First US president',
    });
    rerender(<HostInProgress roomCode="WXYZ" state={midClue} onReopenClue={vi.fn()} />);
    expect(screen.getByTestId('host-used-cell')).toBeInTheDocument();
    expect(screen.queryByTestId('redo-clue-cl1')).not.toBeInTheDocument();
  });

  it('does not show the Re-do button when onReopenClue is not provided', () => {
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      round: makeRound(),
      usedClueIds: ['cl1'],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('host-used-cell')).toBeInTheDocument();
    expect(screen.queryByTestId('redo-clue-cl1')).not.toBeInTheDocument();
  });

  it('re-does a clue and reverts scores when confirmed', async () => {
    const onReopenClue = vi.fn();
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      round: makeRound(),
      usedClueIds: ['cl1'],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onReopenClue={onReopenClue} />);

    await userEvent.click(screen.getByTestId('redo-clue-cl1'));
    await userEvent.click(screen.getByTestId('confirm-reopen-revert-button'));

    expect(onReopenClue).toHaveBeenCalledWith('cl1', true);
  });

  it('re-does a clue and keeps scores when chosen', async () => {
    const onReopenClue = vi.fn();
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      round: makeRound(),
      usedClueIds: ['cl1'],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onReopenClue={onReopenClue} />);

    await userEvent.click(screen.getByTestId('redo-clue-cl1'));
    await userEvent.click(screen.getByTestId('confirm-reopen-keep-button'));

    expect(onReopenClue).toHaveBeenCalledWith('cl1', false);
  });

  it('does not re-do a clue when the re-do is cancelled', async () => {
    const onReopenClue = vi.fn();
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      round: makeRound(),
      usedClueIds: ['cl1'],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onReopenClue={onReopenClue} />);

    await userEvent.click(screen.getByTestId('redo-clue-cl1'));
    await userEvent.click(screen.getByTestId('cancel-reopen-button'));

    expect(onReopenClue).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-reopen-revert-button')).not.toBeInTheDocument();
  });
});

describe('HostInProgress score tools', () => {
  it('shows a score input and apply button for each contestant', () => {
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      players: [
        { id: 'p1', name: 'Alice', score: 200, connected: true },
        { id: 'p2', name: 'Bob', score: -100, connected: true },
      ],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('score-input-p1')).toBeInTheDocument();
    expect(screen.getByTestId('score-input-p2')).toBeInTheDocument();
    expect(screen.getByTestId('apply-score-p1')).toBeInTheDocument();
    expect(screen.getByTestId('apply-score-p2')).toBeInTheDocument();
  });

  it('calls onAdjustScore when a new score is applied', async () => {
    const onAdjustScore = vi.fn();
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onAdjustScore={onAdjustScore} />);

    const input = screen.getByTestId('score-input-p1');
    await userEvent.clear(input);
    await userEvent.type(input, '500');
    await userEvent.click(screen.getByTestId('apply-score-p1'));

    expect(onAdjustScore).toHaveBeenCalledWith('p1', 500);
  });

  it('disables the undo button when no rulings have been recorded', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', auditLog: [] });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('undo-last-ruling-button')).toBeDisabled();
  });

  it('disables the undo button when only manual adjustments are recorded', () => {
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      auditLog: [
        {
          id: 'audit-1',
          type: 'MANUAL',
          playerId: 'p1',
          value: 500,
          scoreBefore: 0,
          scoreAfter: 500,
          controllingPlayerIdBefore: null,
          timestamp: 1,
        },
      ],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('undo-last-ruling-button')).toBeDisabled();
  });

  it('enables the undo button when a ruling is recorded', () => {
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      auditLog: [
        {
          id: 'audit-1',
          type: 'CORRECT',
          playerId: 'p1',
          clueId: 'cl1',
          value: 100,
          scoreBefore: 0,
          scoreAfter: 100,
          controllingPlayerIdBefore: null,
          timestamp: 1,
        },
      ],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('undo-last-ruling-button')).toBeEnabled();
  });

  it('calls onUndoLastRuling when the undo button is clicked', async () => {
    const onUndoLastRuling = vi.fn();
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      auditLog: [
        {
          id: 'audit-1',
          type: 'CORRECT',
          playerId: 'p1',
          clueId: 'cl1',
          value: 100,
          scoreBefore: 0,
          scoreAfter: 100,
          controllingPlayerIdBefore: null,
          timestamp: 1,
        },
      ],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onUndoLastRuling={onUndoLastRuling} />);

    await userEvent.click(screen.getByTestId('undo-last-ruling-button'));
    expect(onUndoLastRuling).toHaveBeenCalledTimes(1);
  });

  it('shows the advance round button labeled with the next round when the round is complete', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', roundComplete: true, nextRoundTarget: 'DOUBLE_JEOPARDY' });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('advance-round-button')).toHaveTextContent('Advance to Double Jeopardy');
  });

  it('shows the round-complete popup and dismisses it via the X without advancing', async () => {
    const onAdvanceRound = vi.fn();
    const state = makeHostState({ phase: 'BOARD_SELECT', roundComplete: true, nextRoundTarget: 'FINAL' });
    render(<HostInProgress roomCode="WXYZ" state={state} onAdvanceRound={onAdvanceRound} />);

    expect(screen.getByTestId('advance-round-modal')).toBeInTheDocument();
    expect(screen.getByTestId('advance-round-modal-confirm')).toHaveTextContent('Advance to Final Jeopardy');

    await userEvent.click(screen.getByTestId('advance-round-modal-close'));
    expect(screen.queryByTestId('advance-round-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('advance-round-button')).toBeInTheDocument();
    expect(onAdvanceRound).not.toHaveBeenCalled();
  });

  it('advances the round from the popup confirm button', async () => {
    const onAdvanceRound = vi.fn();
    const state = makeHostState({ phase: 'BOARD_SELECT', roundComplete: true });
    render(<HostInProgress roomCode="WXYZ" state={state} onAdvanceRound={onAdvanceRound} />);

    await userEvent.click(screen.getByTestId('advance-round-modal-confirm'));
    expect(onAdvanceRound).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('advance-round-modal')).not.toBeInTheDocument();
  });

  it('does not show the advance round button while the round is incomplete', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', roundComplete: false });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.queryByTestId('advance-round-button')).not.toBeInTheDocument();
  });

  it('calls onAdvanceRound when the advance button is clicked', async () => {
    const onAdvanceRound = vi.fn();
    const state = makeHostState({ phase: 'BOARD_SELECT', roundComplete: true });
    render(<HostInProgress roomCode="WXYZ" state={state} onAdvanceRound={onAdvanceRound} />);

    await userEvent.click(screen.getByTestId('advance-round-button'));
    expect(onAdvanceRound).toHaveBeenCalledTimes(1);
  });

  it('shows the controller badge and allows the host to assign control during BOARD_SELECT', async () => {
    const onOverrideControl = vi.fn();
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      players: [
        { id: 'p1', name: 'Alice', score: 200, connected: true },
        { id: 'p2', name: 'Bob', score: 0, connected: true },
      ],
      controllingPlayerId: 'p1',
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onOverrideControl={onOverrideControl} />);

    expect(screen.getByTestId('controller-badge-p1')).toHaveTextContent('Controller');
    expect(screen.queryByTestId('controller-badge-p2')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('assign-control-p2'));
    expect(onOverrideControl).toHaveBeenCalledWith('p2');
  });

  it('does not show assign-control buttons outside BOARD_SELECT', () => {
    const onOverrideControl = vi.fn();
    const state = makeHostState({
      phase: 'CLUE_REVEALED',
      players: [
        { id: 'p1', name: 'Alice', score: 200, connected: true },
        { id: 'p2', name: 'Bob', score: 0, connected: true },
      ],
      controllingPlayerId: 'p1',
      round: makeRound(),
      currentClueId: 'cl1',
      currentClueText: 'H2O is this compound',
      answer: 'Water',
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onOverrideControl={onOverrideControl} />);

    expect(screen.queryByTestId('assign-control-p2')).not.toBeInTheDocument();
  });

  it('renders the round transition screen with scores and a continue button', () => {
    const state = makeHostState({
      phase: 'ROUND_TRANSITION',
      transitionTarget: 'DOUBLE_JEOPARDY',
      players: [
        { id: 'p1', name: 'Alice', score: 200, connected: true },
        { id: 'p2', name: 'Bob', score: -100, connected: true },
      ],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('round-transition')).toBeInTheDocument();
    expect(screen.getByTestId('transition-heading')).toHaveTextContent('Double Jeopardy!');
    expect(screen.getByTestId('transition-scores')).toBeInTheDocument();
    expect(screen.getByTestId('transition-score-p1')).toHaveTextContent('Alice');
    expect(screen.getByTestId('transition-score-p1')).toHaveTextContent('200');
    expect(screen.getByTestId('transition-score-p2')).toHaveTextContent('-$100');
    expect(screen.getByTestId('continue-round-button')).toHaveTextContent(/Continue to Double Jeopardy!/i);
  });

  it('calls onAdvanceRound when the continue button is clicked during ROUND_TRANSITION', async () => {
    const onAdvanceRound = vi.fn();
    const state = makeHostState({
      phase: 'ROUND_TRANSITION',
      transitionTarget: 'FINAL',
      players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onAdvanceRound={onAdvanceRound} />);

    await userEvent.click(screen.getByTestId('continue-round-button'));
    expect(onAdvanceRound).toHaveBeenCalledTimes(1);
  });

  it('shows the Final Jeopardy intro with category and eligibility', () => {
    const state = makeHostState({
      phase: 'FINAL_INTRO',
      roundIndex: 1,
      round: makeFinalRound(),
      players: [
        { id: 'p1', name: 'Alice', score: 200, connected: true },
        { id: 'p2', name: 'Bob', score: 0, connected: true },
        { id: 'p3', name: 'Carol', score: -100, connected: true },
      ],
      finalEligiblePlayerIds: ['p1'],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('host-final-intro')).toBeInTheDocument();
    expect(screen.getByTestId('host-final-heading')).toHaveTextContent('Final Jeopardy!');
    expect(screen.getByTestId('host-final-category')).toHaveTextContent('Literature');
    expect(screen.getByTestId('host-final-eligibility')).toBeInTheDocument();
    expect(screen.getAllByTestId('host-final-eligible')).toHaveLength(1);
    expect(screen.getAllByTestId('host-final-ineligible')).toHaveLength(2);
  });

  it('shows the open final wagers button when at least one contestant is eligible', () => {
    const onOpenFinalWagers = vi.fn();
    const state = makeHostState({
      phase: 'FINAL_INTRO',
      roundIndex: 1,
      round: makeFinalRound(),
      players: [
        { id: 'p1', name: 'Alice', score: 200, connected: true },
        { id: 'p2', name: 'Bob', score: 0, connected: true },
      ],
      finalEligiblePlayerIds: ['p1'],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onOpenFinalWagers={onOpenFinalWagers} />);

    expect(screen.getByTestId('open-final-wagers-button')).toBeInTheDocument();
  });

  it('calls onOpenFinalWagers when the open final wagers button is clicked', async () => {
    const onOpenFinalWagers = vi.fn();
    const state = makeHostState({
      phase: 'FINAL_INTRO',
      roundIndex: 1,
      round: makeFinalRound(),
      players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
      finalEligiblePlayerIds: ['p1'],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onOpenFinalWagers={onOpenFinalWagers} />);

    await userEvent.click(screen.getByTestId('open-final-wagers-button'));
    expect(onOpenFinalWagers).toHaveBeenCalledTimes(1);
  });

  it('shows a proceed-to-standings button when no contestants are eligible', () => {
    const onOpenFinalWagers = vi.fn();
    const state = makeHostState({
      phase: 'FINAL_INTRO',
      roundIndex: 1,
      round: makeFinalRound(),
      players: [
        { id: 'p1', name: 'Alice', score: 0, connected: true },
        { id: 'p2', name: 'Bob', score: -100, connected: true },
      ],
      finalEligiblePlayerIds: [],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onOpenFinalWagers={onOpenFinalWagers} />);

    expect(screen.getByTestId('host-no-eligible')).toBeInTheDocument();
    expect(screen.getByTestId('proceed-to-standings-button')).toBeInTheDocument();
    expect(screen.queryByTestId('open-final-wagers-button')).not.toBeInTheDocument();
  });

  it('calls onOpenFinalWagers when the proceed-to-standings button is clicked', async () => {
    const onOpenFinalWagers = vi.fn();
    const state = makeHostState({
      phase: 'FINAL_INTRO',
      roundIndex: 1,
      round: makeFinalRound(),
      players: [
        { id: 'p1', name: 'Alice', score: 0, connected: true },
        { id: 'p2', name: 'Bob', score: -100, connected: true },
      ],
      finalEligiblePlayerIds: [],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onOpenFinalWagers={onOpenFinalWagers} />);

    await userEvent.click(screen.getByTestId('proceed-to-standings-button'));
    expect(onOpenFinalWagers).toHaveBeenCalledTimes(1);
  });

  it('shows final standings alongside the no-eligible message when COMPLETE was reached via the all-ineligible skip', () => {
    const state = makeHostState({
      phase: 'COMPLETE',
      roundIndex: 1,
      round: makeFinalRound(),
      finalNoEligiblePlayers: true,
      players: [
        { id: 'p1', name: 'Alice', score: 0, connected: true },
        { id: 'p2', name: 'Bob', score: -100, connected: true },
      ],
      finalEligiblePlayerIds: [],
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('host-no-eligible-standings')).toBeInTheDocument();
    expect(screen.getByTestId('host-final-standings-list')).toBeInTheDocument();
    expect(screen.getByTestId('host-final-standing-p1')).toHaveTextContent('Alice');
    expect(screen.getByTestId('host-final-standing-p1')).toHaveTextContent('0');
    expect(screen.getByTestId('host-final-standing-p2')).toHaveTextContent('Bob');
    expect(screen.getByTestId('host-final-standing-p2')).toHaveTextContent('-$100');
  });

  it('shows the Final wager phase with submission status and force button', () => {
    const state = makeHostState({
      phase: 'FINAL_WAGER',
      roundIndex: 1,
      round: makeFinalRound(),
      players: [
        { id: 'p1', name: 'Alice', score: 200, connected: true },
        { id: 'p2', name: 'Bob', score: 100, connected: true },
        { id: 'p3', name: 'Carol', score: 0, connected: true },
      ],
      finalEligiblePlayerIds: ['p1', 'p2'],
      finalWagerSubmissionStatus: { p1: true, p2: false, p3: false },
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('host-final-wager')).toBeInTheDocument();
    expect(screen.getByTestId('host-final-wager-list')).toBeInTheDocument();
    expect(screen.getAllByTestId('host-final-wager-submitted')).toHaveLength(1);
    expect(screen.getAllByTestId('host-final-wager-pending')).toHaveLength(1);
    expect(screen.getAllByTestId('host-final-wager-not-participating')).toHaveLength(1);
  });

  it('calls onForceFinalWagers when the force button is clicked', async () => {
    const onForceFinalWagers = vi.fn();
    const state = makeHostState({
      phase: 'FINAL_WAGER',
      roundIndex: 1,
      round: makeFinalRound(),
      players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
      finalEligiblePlayerIds: ['p1'],
      finalWagerSubmissionStatus: { p1: false },
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onForceFinalWagers={onForceFinalWagers} />);

    await userEvent.click(screen.getByTestId('force-final-wagers-button'));
    expect(onForceFinalWagers).toHaveBeenCalledTimes(1);
  });

  it('shows the start-final popup when all eligible wagers are in and starts Final Jeopardy', async () => {
    const onForceFinalWagers = vi.fn();
    const state = makeHostState({
      phase: 'FINAL_WAGER',
      roundIndex: 1,
      round: makeFinalRound(),
      players: [
        { id: 'p1', name: 'Alice', score: 200, connected: true },
        { id: 'p2', name: 'Bob', score: 100, connected: true },
      ],
      finalEligiblePlayerIds: ['p1', 'p2'],
      finalWagerSubmissionStatus: { p1: true, p2: true },
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onForceFinalWagers={onForceFinalWagers} />);

    expect(screen.getByTestId('start-final-modal')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('start-final-modal-confirm'));
    expect(onForceFinalWagers).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('start-final-modal')).not.toBeInTheDocument();
  });

  it('dismisses the start-final popup via the X without starting', async () => {
    const onForceFinalWagers = vi.fn();
    const state = makeHostState({
      phase: 'FINAL_WAGER',
      roundIndex: 1,
      round: makeFinalRound(),
      players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
      finalEligiblePlayerIds: ['p1'],
      finalWagerSubmissionStatus: { p1: true },
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onForceFinalWagers={onForceFinalWagers} />);

    expect(screen.getByTestId('start-final-modal')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('start-final-modal-close'));
    expect(screen.queryByTestId('start-final-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('force-final-wagers-button')).toBeInTheDocument();
    expect(onForceFinalWagers).not.toHaveBeenCalled();
  });

  it('shows the Final clue and answer submission status during FINAL_CLUE', () => {
    const state = makeHostState({
      phase: 'FINAL_CLUE',
      roundIndex: 1,
      round: makeFinalRound(),
      currentClueId: 'cl-final',
      currentClueText: 'He wrote The Hobbit',
      players: [
        { id: 'p1', name: 'Alice', score: 200, connected: true },
        { id: 'p2', name: 'Bob', score: 100, connected: true },
      ],
      finalEligiblePlayerIds: ['p1', 'p2'],
      finalWagerSubmissionStatus: { p1: true, p2: true },
      finalAnswerSubmissionStatus: { p1: true, p2: false },
      deadline: 30_000,
      serverNow: 0,
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('host-final-clue')).toBeInTheDocument();
    expect(screen.getByTestId('host-final-clue-text')).toHaveTextContent('He wrote The Hobbit');
    expect(screen.getByTestId('countdown')).toHaveTextContent('30');
    expect(screen.getByTestId('host-final-answer-submitted')).toHaveTextContent('Answer submitted');
    expect(screen.getByTestId('host-final-answer-pending')).toHaveTextContent('Pending');
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
  });

  it('shows a Start Timer button before the Final timer starts and starts it on click', async () => {
    const onStartFinalTimer = vi.fn();
    const state = makeHostState({
      phase: 'FINAL_CLUE',
      roundIndex: 1,
      round: makeFinalRound(),
      currentClueId: 'cl-final',
      currentClueText: 'He wrote The Hobbit',
      players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
      finalEligiblePlayerIds: ['p1'],
      finalWagerSubmissionStatus: { p1: true },
      finalAnswerSubmissionStatus: { p1: false },
      deadline: null,
      serverNow: 0,
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onStartFinalTimer={onStartFinalTimer} />);

    expect(screen.queryByTestId('countdown')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('start-final-timer-button'));
    expect(onStartFinalTimer).toHaveBeenCalledTimes(1);
  });

  it('hides the Start Timer button and shows the countdown once the Final timer is running', () => {
    const state = makeHostState({
      phase: 'FINAL_CLUE',
      roundIndex: 1,
      round: makeFinalRound(),
      currentClueId: 'cl-final',
      currentClueText: 'He wrote The Hobbit',
      players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
      finalEligiblePlayerIds: ['p1'],
      finalWagerSubmissionStatus: { p1: true },
      finalAnswerSubmissionStatus: { p1: false },
      deadline: 30_000,
      serverNow: 0,
    });
    render(<HostInProgress roomCode="WXYZ" state={state} onStartFinalTimer={vi.fn()} />);

    expect(screen.queryByTestId('start-final-timer-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('countdown')).toHaveTextContent('30');
  });

  it('does not expose Final answers to the host before reveal', () => {
    const state = makeHostState({
      phase: 'FINAL_CLUE',
      roundIndex: 1,
      round: makeFinalRound(),
      currentClueId: 'cl-final',
      currentClueText: 'He wrote The Hobbit',
      players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
      finalEligiblePlayerIds: ['p1'],
      finalWagerSubmissionStatus: { p1: true },
      finalAnswerSubmissionStatus: { p1: true },
      deadline: 30_000,
      serverNow: 0,
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('host-final-clue-text')).toHaveTextContent('He wrote The Hobbit');
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
    expect(screen.queryByText('J.R.R. Tolkien')).not.toBeInTheDocument();
  });

  it('wraps host grid dollar values in a themed value span', () => {
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      round: makeRound(),
    });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    const cells = screen.getAllByTestId('host-clue-cell');
    expect(cells[0].className).toMatch(/hostCell/);
    const valueSpan = cells[0].querySelector('span');
    expect(valueSpan).toBeTruthy();
    expect(valueSpan?.className).toMatch(/value/);
  });
});

describe('HostContent games manager', () => {
  const token = 'host-token';

  function authAndRender() {
    useHostAuth.mockReturnValue({
      token,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
    });
    boardApi.getBoards.mockResolvedValue([{ id: 'b1', name: 'Board One', isComplete: true }]);
    mockUseSocket();
    return render(<HostContent />);
  }

  function makeGameSummary(overrides = {}) {
    return {
      roomCode: 'AAAA',
      boardName: 'History 101',
      status: 'LOBBY',
      phase: 'LOBBY',
      playerCount: 0,
      connectedCount: 0,
      archived: false,
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('lists active games and enters host mode when one is clicked', async () => {
    vi.mocked(listGames).mockResolvedValue([makeGameSummary({ roomCode: 'AAAA', boardName: 'History 101' })]);
    authAndRender();

    const card = await screen.findByTestId('game-card-AAAA');
    expect(card).toHaveTextContent('AAAA');
    expect(card).toHaveTextContent('History 101');

    await userEvent.click(screen.getByTestId('enter-game-AAAA'));

    expect(await screen.findByTestId('room-code')).toHaveTextContent('Room Code: AAAA');
    expect(localStorage.getItem('jeopardy-host-room')).toBe('AAAA');
  });

  it('shows an empty state when there are no active games', async () => {
    vi.mocked(listGames).mockResolvedValue([]);
    authAndRender();

    expect(await screen.findByTestId('active-games-empty')).toBeInTheDocument();
  });

  it('archives an active game and moves it to the archived section', async () => {
    vi.mocked(listGames)
      .mockResolvedValueOnce([makeGameSummary({ roomCode: 'AAAA' })])
      .mockResolvedValueOnce([makeGameSummary({ roomCode: 'AAAA', archived: true })]);
    authAndRender();

    await userEvent.click(await screen.findByTestId('archive-game-AAAA'));

    expect(setGameArchived).toHaveBeenCalledWith('AAAA', true, token);
    expect(await screen.findByTestId('archived-games-section')).toBeInTheDocument();
    expect(screen.getByTestId('active-games-empty')).toBeInTheDocument();
  });

  it('keeps archived games collapsed until expanded, then unarchives', async () => {
    vi.mocked(listGames).mockResolvedValue([makeGameSummary({ roomCode: 'ZZZZ', archived: true })]);
    authAndRender();

    expect(await screen.findByTestId('archived-games-section')).toBeInTheDocument();
    expect(screen.queryByTestId('archived-games-list')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('archived-games-toggle'));

    expect(screen.getByTestId('archived-games-list')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('unarchive-game-ZZZZ'));
    expect(setGameArchived).toHaveBeenCalledWith('ZZZZ', false, token);
  });

  it('deletes a game only after confirmation', async () => {
    vi.mocked(listGames).mockResolvedValue([makeGameSummary({ roomCode: 'AAAA' })]);
    authAndRender();

    await userEvent.click(await screen.findByTestId('delete-game-AAAA'));
    expect(deleteGame).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('confirm-delete-game-button'));
    expect(deleteGame).toHaveBeenCalledWith('AAAA', token);
  });

  it('does not delete when the confirmation is cancelled', async () => {
    vi.mocked(listGames).mockResolvedValue([makeGameSummary({ roomCode: 'AAAA' })]);
    authAndRender();

    await userEvent.click(await screen.findByTestId('delete-game-AAAA'));
    await userEvent.click(screen.getByTestId('cancel-delete-game-button'));

    expect(deleteGame).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
