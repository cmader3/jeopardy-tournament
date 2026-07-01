import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { BoardRoute } from './board.js';
import type { BoardView } from '@jeopardy/shared';

function renderBoardRoute() {
  render(
    <MemoryRouter>
      <BoardRoute />
    </MemoryRouter>,
  );
}

vi.mock('../socket/useSocket.js', () => ({
  useSocket: vi.fn(),
  __esModule: true,
}));

import { useSocket } from '../socket/useSocket.js';

function makeBoardState(overrides: Partial<BoardView> = {}): BoardView {
  return {
    phase: 'LOBBY',
    roomCode: 'ABCD',
    roundIndex: 0,
    players: [],
    currentClueId: null,
    buzzWinnerId: null,
    deadline: null,
    ...overrides,
  };
}

function mockUseSocket(state: BoardView | null, error: string | null = null) {
  useSocket.mockReturnValue({ connected: true, error, data: state });
}

describe('BoardRoute', () => {
  it('renders the room code entry form without a host passcode gate', () => {
    useSocket.mockReturnValue({ connected: false, error: null, data: null });

    renderBoardRoute();

    expect(screen.getByRole('heading', { name: /board/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/host passcode/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view board/i })).toBeDisabled();
  });

  it('shows the room code and a waiting-for-players state before anyone joins', async () => {
    mockUseSocket(makeBoardState());

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('room-code')).toHaveTextContent('ABCD');
    expect(screen.getByText(/waiting for players/i)).toBeInTheDocument();
  });

  it('shows a scoreboard with every joined contestant name and score', async () => {
    mockUseSocket(
      makeBoardState({
        players: [
          { id: 'p1', name: 'Alice', score: 0, connected: true },
          { id: 'p2', name: 'Bob', score: 0, connected: true },
        ],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    const scoreCards = screen.getAllByTestId('score-card');
    expect(scoreCards).toHaveLength(2);
    expect(scoreCards[0]).toHaveTextContent('0');
    expect(scoreCards[1]).toHaveTextContent('0');
  });

  it('renders all five contestants legibly at capacity', async () => {
    const players = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Player ${i + 1}`,
      score: 0,
      connected: true,
    }));
    mockUseSocket(makeBoardState({ players }));

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    const scoreCards = await screen.findAllByTestId('score-card');
    expect(scoreCards).toHaveLength(5);
  });

  it('truncates long contestant names without breaking layout', async () => {
    mockUseSocket(
      makeBoardState({
        players: [
          {
            id: 'p1',
            name: 'This is a very long contestant name that should not overflow',
            score: 0,
            connected: true,
          },
        ],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    const name = await screen.findByTestId('score-name');
    expect(name.className).toMatch(/truncated/);
  });

  it('shows an informative placeholder for an unknown or missing room', async () => {
    useSocket.mockReturnValue({ connected: false, error: 'Unknown room code', data: null });

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ZZZZ');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no active game/i);
    expect(screen.getByText('ZZZZ')).toBeInTheDocument();
  });

  it('exposes no interactive game controls on the board', async () => {
    mockUseSocket(
      makeBoardState({
        players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    await screen.findByText('Alice');
    expect(screen.queryByRole('button', { name: /buzz/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /correct/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /incorrect/i })).not.toBeInTheDocument();
  });

  it('allows entering a different room code after an unknown room error', async () => {
    useSocket.mockReturnValue({ connected: false, error: 'Unknown room code', data: null });

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ZZZZ');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter another code/i })).toBeInTheDocument();
  });

  it('restores a stored room code and reconnects automatically', async () => {
    localStorage.setItem('jeopardy-board-room', 'WXYZ');
    mockUseSocket(makeBoardState({ roomCode: 'WXYZ' }));

    renderBoardRoute();

    expect(await screen.findByTestId('room-code')).toHaveTextContent('WXYZ');
    expect(useSocket).toHaveBeenCalledWith('board', 'WXYZ', expect.any(Function));
  });

  it('clears the stored room code when entering a different room', async () => {
    localStorage.setItem('jeopardy-board-room', 'WXYZ');
    useSocket.mockReturnValue({ connected: false, error: 'Unknown room code', data: null });

    renderBoardRoute();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /enter another code/i }));

    expect(localStorage.getItem('jeopardy-board-room')).toBeNull();
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
  });
});
