import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { BoardRoute } from './board.js';
import type { BoardView } from '@jeopardy/shared';

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
    round: null,
    usedClueIds: [],
    currentClueId: null,
    currentClueText: null,
    controllingPlayerId: null,
    buzzWinnerId: null,
    deadline: null,
    answer: null,
    lastOutcome: null,
    dailyDoubleWager: null,
    transitionTarget: null,
    finalNoEligiblePlayers: false,
    finalEligiblePlayerIds: [],
    roundComplete: false,
    serverNow: 0,
    ...overrides,
  };
}

function mockUseSocket(state: BoardView | null, error: string | null = null) {
  useSocket.mockReturnValue({ connected: true, error, data: state });
}

function renderBoard(initialPath: string) {
  const router = createMemoryRouter([{ path: '/board', element: <BoardRoute /> }], {
    initialEntries: [initialPath],
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('BoardRoute shareable reference', () => {
  it('shows a shareable link for the room once connected', async () => {
    mockUseSocket(makeBoardState({ roomCode: 'ABCD' }));

    renderBoard('/board');
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    const shareLink = await screen.findByTestId('share-link');
    expect(shareLink).toHaveAttribute('href', expect.stringContaining('/board?room=ABCD'));
  });

  it('auto-connects from a shareable URL query parameter', async () => {
    mockUseSocket(makeBoardState({ roomCode: 'ABCD' }));

    renderBoard('/board?room=ABCD');

    expect(await screen.findByTestId('room-code')).toHaveTextContent('ABCD');
  });
});
