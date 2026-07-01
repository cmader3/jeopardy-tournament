import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostLobby, HostInProgress, HostContent } from './host.js';
import type { HostView } from '@jeopardy/shared';

vi.mock('../auth/useHostAuth.js', () => ({ useHostAuth: vi.fn() }));
vi.mock('../api/boards.js', () => ({
  boardApi: { getBoards: vi.fn() },
  __esModule: true,
}));
vi.mock('../api/games.js', () => ({
  createGame: vi.fn(),
  __esModule: true,
}));
vi.mock('../socket/useSocket.js', () => ({
  useSocket: vi.fn(),
  __esModule: true,
}));

import { useHostAuth } from '../auth/useHostAuth.js';
import { boardApi } from '../api/boards.js';
import { createGame } from '../api/games.js';
import { useSocket } from '../socket/useSocket.js';

function makeHostState(overrides: Partial<HostView> = {}): HostView {
  return {
    phase: 'LOBBY',
    roomCode: 'ABCD',
    roundIndex: 0,
    players: [],
    currentClueId: null,
    buzzWinnerId: null,
    deadline: null,
    answer: null,
    ...overrides,
  };
}

describe('HostLobby', () => {
  it('shows the room code and an empty roster', () => {
    render(<HostLobby roomCode="ABCD" state={makeHostState()} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByTestId('room-code')).toHaveTextContent('Room Code: ABCD');
    expect(screen.getByText('Waiting for players...')).toBeInTheDocument();
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
    expect(screen.getByTestId('roster-score-p2')).toHaveTextContent('-100');
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
    useSocket.mockReturnValue({ connected: true, error: null, data: null, startGame });

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
    useSocket.mockReturnValue({ connected: true, error: null, data: null, startGame });

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
