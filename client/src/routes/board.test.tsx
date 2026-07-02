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

function makeRound(overrides: Partial<BoardView['round']> = {}): NonNullable<BoardView['round']> {
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
          { id: 'cl1', categoryId: 'c1', row: 0, value: 100 },
          { id: 'cl2', categoryId: 'c1', row: 1, value: 200 },
        ],
      },
      {
        id: 'c2',
        title: 'History',
        order: 1,
        clues: [{ id: 'cl3', categoryId: 'c2', row: 0, value: 100 }],
      },
    ],
    ...overrides,
  };
}

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
    serverNow: 0,
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

  it('shows the room code and a waiting-for-host state while in the lobby', async () => {
    mockUseSocket(makeBoardState());

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('room-code')).toHaveTextContent('ABCD');
    expect(screen.getByText(/waiting for the host/i)).toBeInTheDocument();
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

  it('renders the category grid after the game leaves the lobby', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('board-grid')).toBeInTheDocument();
    const headers = screen.getAllByTestId('category-header');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveTextContent('Science');
    expect(headers[1]).toHaveTextContent('History');
    expect(screen.getAllByTestId('clue-cell')).toHaveLength(3);
  });

  it('shows the round banner at the start of a round', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('round-banner')).toHaveTextContent('Jeopardy!');
  });

  it('shows the correct round banner for Double Jeopardy', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        roundIndex: 1,
        round: makeRound({ type: 'DOUBLE_JEOPARDY' }),
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('round-banner')).toHaveTextContent('Double Jeopardy!');
  });

  it('shows a countdown while the buzzers are armed', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BUZZERS_ARMED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        deadline: 5_000,
        serverNow: 0,
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('countdown')).toHaveTextContent('5');
  });

  it('renders used cells as empty', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        usedClueIds: ['cl1'],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    await screen.findByTestId('board-grid');
    expect(screen.getAllByTestId('used-cell')).toHaveLength(1);
    expect(screen.getAllByTestId('clue-cell')).toHaveLength(2);
  });

  it('shows the current clue full-screen without the answer', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'CLUE_REVEALED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('clue-text')).toHaveTextContent('H2O is this compound');
    expect(screen.getByTestId('clue-overlay')).not.toHaveTextContent('Water');
  });

  it('shows a Daily Double splash instead of the clue text during the wager phase', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'DAILY_DOUBLE_WAGER',
        round: makeRound(),
        currentClueId: 'cl2',
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('daily-double-splash')).toBeInTheDocument();
  });

  it('highlights the controlling player on the scoreboard', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
        controllingPlayerId: 'p1',
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    const scoreCards = await screen.findAllByTestId('score-card');
    expect(scoreCards[0].className).toMatch(/controlling/);
  });

  it('shows the armed indicator only while buzzers are armed', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BUZZERS_ARMED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('armed-indicator')).toHaveTextContent('BUZZERS ARMED');
  });

  it('shows the buzzed contestant by identity', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BUZZED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        buzzWinnerId: 'p2',
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

    expect(await screen.findByTestId('buzzed-indicator')).toHaveTextContent('Buzzed in:');
    expect(screen.getByTestId('buzzed-player-name')).toHaveTextContent('Bob');
  });

  it('shows the revealed answer after a correct ruling with feedback', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        usedClueIds: ['cl1'],
        answer: 'Water',
        lastOutcome: { playerId: 'p2', type: 'CORRECT', value: 100 },
        players: [
          { id: 'p1', name: 'Alice', score: 0, connected: true },
          { id: 'p2', name: 'Bob', score: 100, connected: true },
        ],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('answer-banner')).toBeInTheDocument();
    expect(screen.getByTestId('answer-text')).toHaveTextContent('Water');
    expect(screen.getByTestId('outcome-label')).toHaveTextContent('Correct!');
    expect(screen.getByTestId('outcome-label')).toHaveTextContent('Bob');
    expect(screen.getByTestId('outcome-label')).toHaveTextContent('+$100');
  });

  it('shows the revealed answer after an incorrect ruling with feedback', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        usedClueIds: ['cl1'],
        answer: 'Water',
        lastOutcome: { playerId: 'p1', type: 'INCORRECT', value: 100 },
        players: [
          { id: 'p1', name: 'Alice', score: -100, connected: true },
          { id: 'p2', name: 'Bob', score: 0, connected: true },
        ],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('answer-banner')).toBeInTheDocument();
    expect(screen.getByTestId('answer-text')).toHaveTextContent('Water');
    expect(screen.getByTestId('outcome-label')).toHaveTextContent('Incorrect!');
    expect(screen.getByTestId('outcome-label')).toHaveTextContent('Alice');
    expect(screen.getByTestId('outcome-label')).toHaveTextContent('-$100');
  });

  it('shows the revealed answer after a timeout with no score change', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        usedClueIds: ['cl1'],
        answer: 'Water',
        lastOutcome: null,
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

    expect(await screen.findByTestId('answer-banner')).toBeInTheDocument();
    expect(screen.getByTestId('answer-text')).toHaveTextContent('Water');
    expect(screen.queryByTestId('outcome-label')).not.toBeInTheDocument();
  });

  it('shows the answer banner together with the grid after a ruling so the board returns to the board-select stage', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        usedClueIds: ['cl1'],
        answer: 'Water',
        lastOutcome: { playerId: 'p2', type: 'CORRECT', value: 100 },
        controllingPlayerId: 'p2',
        players: [
          { id: 'p1', name: 'Alice', score: 0, connected: true },
          { id: 'p2', name: 'Bob', score: 100, connected: true },
        ],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('answer-banner')).toBeInTheDocument();
    expect(screen.getByTestId('answer-text')).toHaveTextContent('Water');
    expect(screen.getByTestId('board-grid')).toBeInTheDocument();
    expect(screen.getAllByTestId('used-cell')).toHaveLength(1);
    expect(screen.getAllByTestId('clue-cell')).toHaveLength(2);
  });
});
