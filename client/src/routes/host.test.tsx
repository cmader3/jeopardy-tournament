import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostLobby, HostContent } from './host.js';
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
    expect(screen.getByText('At least one contestant is required to start.')).toBeInTheDocument();
  });

  it('enables the start button when at least one player is connected', () => {
    const state = makeHostState({
      players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
    });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByTestId('start-game-button')).toBeEnabled();
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

  it('hides the start controls after the game has left the lobby', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }] });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError={null} />);

    expect(screen.queryByTestId('start-game-button')).not.toBeInTheDocument();
    expect(screen.getByText('Game started!')).toBeInTheDocument();
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
  });
});
