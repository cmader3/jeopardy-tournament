import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayRoute } from './play.js';
import type { ContestantView } from '@jeopardy/shared';

vi.mock('../socket/useSocket.js', () => ({
  useSocket: vi.fn(),
  getStoredContestantToken: vi.fn(() => null),
  clearStoredContestantToken: vi.fn(),
  __esModule: true,
}));

import { useSocket, clearStoredContestantToken } from '../socket/useSocket.js';

function makeContestantState(overrides: Partial<ContestantView> = {}): ContestantView {
  return {
    phase: 'LOBBY',
    roomCode: 'ABCD',
    roundIndex: 0,
    players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
    currentClueId: null,
    buzzWinnerId: null,
    deadline: null,
    playerId: 'p1',
    isControllingPlayer: false,
    canWager: false,
    canAnswer: false,
    ...overrides,
  };
}

function mockUseSocket(state: ContestantView | null, error: string | null = null) {
  useSocket.mockReturnValue({
    connected: true,
    error,
    data: state,
    startGame: vi.fn(),
    leaveGame: vi.fn(),
  });
}

import { getStoredContestantToken } from '../socket/useSocket.js';

describe('PlayRoute', () => {
  it('renders the contestant join form without a host passcode gate', () => {
    useSocket.mockReturnValue({ connected: false, error: null, data: null });

    render(<PlayRoute />);

    expect(screen.getByRole('heading', { name: 'Join Game' })).toBeInTheDocument();
    expect(screen.getByLabelText('Room Code')).toBeInTheDocument();
    expect(screen.getByLabelText('Your Name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Host Passcode')).not.toBeInTheDocument();
  });

  it('disables join until room code and name have text', async () => {
    useSocket.mockReturnValue({ connected: false, error: null, data: null });

    render(<PlayRoute />);

    const button = screen.getByRole('button', { name: 'Join Game' });
    expect(button).toBeDisabled();

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');

    await userEvent.type(roomInput, 'ABCD');
    expect(button).toBeDisabled();

    await userEvent.type(nameInput, '   ');
    expect(button).toBeEnabled();

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Alice');
    expect(button).toBeEnabled();
  });

  it('shows a validation message for a whitespace-only name', async () => {
    useSocket.mockReturnValue({ connected: false, error: null, data: null });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, '   ');
    await userEvent.click(button);

    expect(screen.getByRole('alert')).toHaveTextContent(/name/i);
  });

  it('shows the lobby with the contestant name and a waiting-for-host state after joining', async () => {
    mockUseSocket(makeContestantState());

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByText('Welcome, Alice')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the host to start the game.')).toBeInTheDocument();
    expect(screen.getByTestId('room-code')).toHaveTextContent('ABCD');
  });

  it('displays a socket error and lets the contestant try again', async () => {
    mockUseSocket(null, 'Game is full');

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent('Game is full');
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('returns to the join form when try again is clicked after an error', async () => {
    mockUseSocket(null, 'Game is full');

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent('Game is full');
    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(screen.getByRole('heading', { name: 'Join Game' })).toBeInTheDocument();
    expect(screen.getByLabelText('Room Code')).toHaveValue('ABCD');
    expect(screen.getByLabelText('Your Name')).toHaveValue('');
  });

  it('restores the lobby from a stored contestant token without re-entering a name', async () => {
    (getStoredContestantToken as ReturnType<typeof vi.fn>).mockReturnValue({
      reconnectToken: 'stored-token',
      playerId: 'p1',
      roomCode: 'ABCD',
    });
    mockUseSocket(makeContestantState());

    render(<PlayRoute />);

    expect(await screen.findByText('Welcome, Alice')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the host to start the game.')).toBeInTheDocument();
    expect(screen.getByTestId('room-code')).toHaveTextContent('ABCD');
    expect(useSocket).toHaveBeenCalledWith(
      'contestant',
      'ABCD',
      undefined,
      undefined,
      'stored-token',
    );
  });

  it('lets an explicit leave return to the join form and clears the stored token', async () => {
    const leaveGame = vi.fn();
    (getStoredContestantToken as ReturnType<typeof vi.fn>).mockReturnValue({
      reconnectToken: 'stored-token',
      playerId: 'p1',
      roomCode: 'ABCD',
    });
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState(),
      startGame: vi.fn(),
      leaveGame,
    });

    render(<PlayRoute />);

    expect(await screen.findByText('Welcome, Alice')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /leave game/i }));

    expect(leaveGame).toHaveBeenCalledTimes(1);
    expect(clearStoredContestantToken).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Join Game' })).toBeInTheDocument();
  });
});
