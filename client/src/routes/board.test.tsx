import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { useState, useCallback } from 'react';
import { BoardRoute, AnswerReveal, ClueOverlay } from './board.js';
import type { BoardView } from '@jeopardy/shared';

function renderBoardRoute() {
  return render(
    <MemoryRouter>
      <BoardRoute />
    </MemoryRouter>,
  );
}

vi.mock('../socket/useSocket.js', () => ({
  useSocket: vi.fn(),
  __esModule: true,
}));

const mockServerTimeNow = { current: 0 };

vi.mock('../hooks/useServerTime.js', () => ({
  useServerTime: () => mockServerTimeNow.current,
  __esModule: true,
}));

const recordedCues: string[] = [];
const recordedThinkMusic: boolean[] = [];
const recordedWinnerMusic = { count: 0 };
const mockAudioMuted = { current: false };

function MockUseBoardAudio() {
  const [muted, setMuted] = useState(mockAudioMuted.current);

  const playCue = useCallback((cue: string) => {
    recordedCues.push(cue);
  }, []);

  const setThinkMusic = useCallback((active: boolean) => {
    recordedThinkMusic.push(active);
  }, []);

  const playWinnerMusic = useCallback(() => {
    recordedWinnerMusic.count += 1;
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      mockAudioMuted.current = next;
      return next;
    });
  }, []);

  return { muted, toggleMute, playCue, setThinkMusic, playWinnerMusic };
}

vi.mock('../hooks/useBoardAudio.js', () => ({
  useBoardAudio: MockUseBoardAudio,
  __esModule: true,
}));

import { useSocket } from '../socket/useSocket.js';

function mockServerTime(now: number) {
  mockServerTimeNow.current = now;
}

function mockBoardAudioReset() {
  mockAudioMuted.current = false;
  recordedCues.length = 0;
  recordedThinkMusic.length = 0;
  recordedWinnerMusic.count = 0;
}

beforeEach(() => {
  mockServerTime(0);
  mockBoardAudioReset();
});

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
    dailyDoubleWager: null,
    transitionTarget: null,
    finalNoEligiblePlayers: false,
    finalEligiblePlayerIds: [],
    finalWagerSubmissionStatus: {},
    finalAnswerSubmissionStatus: {},
    finalRevealOrder: [],
    finalRevealIndex: 0,
    finalRevealStep: 'ANSWER',
    finalRevealedAnswers: {},
    finalRevealedWagers: {},
    roundComplete: false,
    serverNow: 0,
    clueSelectionMode: 'HOST',
    pendingClueId: null,
    ...overrides,
  };
}

function mockUseSocket(state: BoardView | null, error: string | null = null) {
  useSocket.mockReturnValue({ connected: true, error, data: state });
}

function makeFinalRound(overrides: Partial<NonNullable<BoardView['round']>> = {}): NonNullable<BoardView['round']> {
  return {
    id: 'r-final',
    type: 'FINAL',
    order: 1,
    categories: [
      {
        id: 'c-final',
        title: 'Literature',
        order: 0,
        clues: [{ id: 'cl-final', categoryId: 'c-final', row: 0, value: null }],
      },
    ],
    ...overrides,
  };
}

function makeFinalIntroState(overrides: Partial<BoardView> = {}): BoardView {
  return makeBoardState({
    phase: 'FINAL_INTRO',
    roundIndex: 1,
    round: makeFinalRound(),
    ...overrides,
  });
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

  it('leaves the game from the board via the Leave Game button', async () => {
    const leaveGame = vi.fn();
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeBoardState({ phase: 'BOARD_SELECT', round: makeRound() }),
      leaveGame,
    });

    renderBoardRoute();
    await userEvent.type(screen.getByLabelText(/room code/i), 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('board-grid')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('board-leave-game-button'));

    expect(leaveGame).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('jeopardy-board-room')).toBeNull();
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
  });

  it('shows a pending banner and highlights the selected cell without revealing the clue', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'CLUE_SELECTED',
        round: makeRound(),
        pendingClueId: 'cl1',
        clueSelectionMode: 'PLAYER',
      }),
    );

    renderBoardRoute();
    await userEvent.type(screen.getByLabelText(/room code/i), 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('board-clue-selected')).toBeInTheDocument();
    expect(screen.getByTestId('board-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('clue-overlay')).not.toBeInTheDocument();
    const selectedCell = document.querySelector('[data-clue-id="cl1"]');
    expect(selectedCell?.className).toMatch(/cellSelected/);
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

  it('keeps a very long clue fully contained within the clue overlay', async () => {
    const longClue = 'A'.repeat(3000);
    mockUseSocket(
      makeBoardState({
        phase: 'CLUE_REVEALED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: longClue,
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    const text = await screen.findByTestId('clue-text');
    expect(text).toHaveTextContent(longClue);
    expect(text).toHaveAttribute('data-fit-text', 'true');
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
    expect(screen.queryByTestId('clue-text')).not.toBeInTheDocument();
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
  });

  it('does not expose the Daily Double wager on the board', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'DAILY_DOUBLE_WAGER',
        round: makeRound(),
        currentClueId: 'cl2',
        dailyDoubleWager: 500,
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    await screen.findByTestId('daily-double-splash');
    expect(screen.queryByText(/500/)).not.toBeInTheDocument();
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

  it('shows a distinct incorrect feedback indicator while re-armed without revealing the answer', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BUZZERS_ARMED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        answer: null,
        lastOutcome: { playerId: 'p1', type: 'INCORRECT', value: 100 },
        deadline: 10_000,
        serverNow: 0,
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

    expect(await screen.findByTestId('incorrect-feedback')).toBeInTheDocument();
    expect(screen.getByTestId('incorrect-feedback')).toHaveTextContent('Incorrect!');
    expect(screen.getByTestId('incorrect-feedback')).toHaveTextContent('Alice');
    expect(screen.getByTestId('incorrect-feedback')).toHaveTextContent('-$100');
    expect(screen.getByTestId('incorrect-feedback').className).toMatch(/incorrectFeedback/);
    expect(screen.queryByTestId('answer-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
    expect(screen.getByTestId('clue-text')).toHaveTextContent('H2O is this compound');
    expect(screen.getByTestId('armed-indicator')).toHaveTextContent('BUZZERS ARMED');
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

  it('reveals the answer big and centered over the board grid without replacing it', async () => {
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
    await userEvent.type(screen.getByLabelText(/room code/i), 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    const banner = await screen.findByTestId('answer-banner');
    const grid = screen.getByTestId('board-grid');
    const reveal = banner.parentElement as HTMLElement;

    expect(screen.queryByTestId('answer-overlay')).not.toBeInTheDocument();
    expect(banner).toBeInTheDocument();
    expect(grid).toBeInTheDocument();
    // The reveal starts centered and never contains (replaces) the grid.
    expect(reveal.className).toMatch(/answerRevealCentered/);
    expect(banner).not.toContainElement(grid);
    expect(grid).not.toContainElement(banner);
    // The animated reveal and the grid both live inside the round stage.
    expect(grid.parentElement).toBe(reveal.parentElement);
  });

  it('docks the revealed answer to the top bar after the centered delay elapses', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <AnswerReveal
          state={makeBoardState({
            phase: 'BOARD_SELECT',
            round: makeRound(),
            usedClueIds: ['cl1'],
            answer: 'Water',
            lastOutcome: { playerId: 'p2', type: 'CORRECT', value: 100 },
            currentClueId: 'cl1',
            players: [
              { id: 'p1', name: 'Alice', score: 0, connected: true },
              { id: 'p2', name: 'Bob', score: 100, connected: true },
            ],
          })}
        />,
      );

      const banner = screen.getByTestId('answer-banner');
      const reveal = banner.parentElement as HTMLElement;
      expect(reveal.className).toMatch(/answerRevealCentered/);
      expect(reveal.className).not.toMatch(/answerRevealDocked/);

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(reveal.className).toMatch(/answerRevealDocked/);
      expect(reveal.className).not.toMatch(/answerRevealCentered/);
      // A hidden spacer reserves the docked bar's height so the grid sits below it.
      expect(container.querySelector('[class*="answerRevealSpacer"]')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the between-round screen during ROUND_TRANSITION with carried-over scores', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'ROUND_TRANSITION',
        transitionTarget: 'DOUBLE_JEOPARDY',
        players: [
          { id: 'p1', name: 'Alice', score: 250, connected: true },
          { id: 'p2', name: 'Bob', score: -50, connected: true },
        ],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('between-round-screen')).toBeInTheDocument();
    expect(screen.getByTestId('between-round-heading')).toHaveTextContent('Double Jeopardy!');
    expect(screen.getByTestId('between-round-scores')).toBeInTheDocument();
    const scores = screen.getAllByTestId('between-round-score');
    expect(scores).toHaveLength(2);
    expect(scores[0]).toHaveTextContent('Alice');
    expect(scores[0]).toHaveTextContent('250');
    expect(scores[1]).toHaveTextContent('Bob');
    expect(scores[1]).toHaveTextContent('-$50');
  });

  it('shows the Final Jeopardy between-round screen when the target is FINAL', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'ROUND_TRANSITION',
        transitionTarget: 'FINAL',
        players: [{ id: 'p1', name: 'Alice', score: 300, connected: true }],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('between-round-screen')).toBeInTheDocument();
    expect(screen.getByTestId('between-round-heading')).toHaveTextContent('Final Jeopardy!');
  });

  it('shows the Final Jeopardy banner and category during FINAL_INTRO', async () => {
    mockUseSocket(makeFinalIntroState());

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('final-intro')).toBeInTheDocument();
    expect(screen.getByTestId('round-banner')).toHaveTextContent('Final Jeopardy!');
    expect(screen.getByTestId('final-category')).toHaveTextContent('Literature');
    expect(screen.queryByTestId('clue-text')).not.toBeInTheDocument();
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
  });

  it('shows eligible and not-participating contestants during FINAL_INTRO', async () => {
    mockUseSocket(
      makeFinalIntroState({
        players: [
          { id: 'p1', name: 'Alice', score: 100, connected: true },
          { id: 'p2', name: 'Bob', score: 0, connected: true },
          { id: 'p3', name: 'Carol', score: -50, connected: true },
        ],
        finalEligiblePlayerIds: ['p1'],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    const players = await screen.findAllByTestId('final-player');
    expect(players).toHaveLength(3);
    expect(screen.getAllByTestId('eligible')).toHaveLength(1);
    expect(screen.getAllByTestId('not-participating')).toHaveLength(2);
  });

  it('shows a no-eligible-players message when the Final was skipped', async () => {
    mockUseSocket(
      makeFinalIntroState({
        phase: 'COMPLETE',
        finalNoEligiblePlayers: true,
        players: [
          { id: 'p1', name: 'Alice', score: 0, connected: true },
          { id: 'p2', name: 'Bob', score: -100, connected: true },
        ],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('final-no-eligible')).toBeInTheDocument();
  });

  it('shows the final standings alongside the no-eligible message after the all-ineligible skip', async () => {
    mockUseSocket(
      makeFinalIntroState({
        phase: 'COMPLETE',
        finalNoEligiblePlayers: true,
        players: [
          { id: 'p1', name: 'Alice', score: 0, connected: true },
          { id: 'p2', name: 'Bob', score: -100, connected: true },
        ],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('final-no-eligible')).toBeInTheDocument();
    expect(screen.getByTestId('final-no-eligible-message')).toBeInTheDocument();
    expect(screen.getByTestId('final-standings')).toBeInTheDocument();
    const standings = screen.getAllByTestId('final-standing');
    expect(standings).toHaveLength(2);
    expect(screen.getByTestId('final-standing-name-p1')).toHaveTextContent('Alice');
    expect(screen.getByTestId('final-standing-score-p1')).toHaveTextContent('0');
    expect(screen.getByTestId('final-standing-name-p2')).toHaveTextContent('Bob');
    expect(screen.getByTestId('final-standing-score-p2')).toHaveTextContent('-$100');
  });

  it('shows the Final wager phase with submission status and no amounts', async () => {
    mockUseSocket(
      makeFinalIntroState({
        phase: 'FINAL_WAGER',
        players: [
          { id: 'p1', name: 'Alice', score: 200, connected: true },
          { id: 'p2', name: 'Bob', score: 100, connected: true },
        ],
        finalEligiblePlayerIds: ['p1', 'p2'],
        finalWagerSubmissionStatus: { p1: true, p2: false },
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('final-wager')).toBeInTheDocument();
    expect(screen.getByTestId('final-wager-status')).toBeInTheDocument();
    expect(screen.getAllByTestId('final-wager-player')).toHaveLength(2);
    expect(screen.getAllByTestId('final-wager-submitted')).toHaveLength(1);
    expect(screen.getAllByTestId('final-wager-pending')).toHaveLength(1);
    expect(screen.queryByText('$150')).not.toBeInTheDocument();
  });

  it('shows the Final clue text during FINAL_CLUE', async () => {
    mockUseSocket(
      makeFinalIntroState({
        phase: 'FINAL_CLUE',
        currentClueId: 'cl-final',
        currentClueText: 'He wrote The Hobbit',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        finalEligiblePlayerIds: ['p1'],
        finalWagerSubmissionStatus: { p1: true },
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('clue-text')).toHaveTextContent('He wrote The Hobbit');
  });

  it('shows a countdown during FINAL_CLUE', async () => {
    mockUseSocket(
      makeFinalIntroState({
        phase: 'FINAL_CLUE',
        currentClueId: 'cl-final',
        currentClueText: 'He wrote The Hobbit',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        finalEligiblePlayerIds: ['p1'],
        finalWagerSubmissionStatus: { p1: true },
        deadline: 30_000,
        serverNow: 0,
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    expect(await screen.findByTestId('countdown')).toHaveTextContent('30');
  });

  it('does not expose Final answers on the board during FINAL_CLUE', async () => {
    mockUseSocket(
      makeFinalIntroState({
        phase: 'FINAL_CLUE',
        currentClueId: 'cl-final',
        currentClueText: 'He wrote The Hobbit',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        finalEligiblePlayerIds: ['p1'],
        finalWagerSubmissionStatus: { p1: true },
        finalAnswerSubmissionStatus: { p1: true },
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    await screen.findByTestId('clue-text');
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
    expect(screen.queryByText('Tolkien')).not.toBeInTheDocument();
  });

  it('styles the full-screen clue overlay with a dedicated theme class', async () => {
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

    const overlay = await screen.findByTestId('clue-overlay');
    expect(overlay.className).toMatch(/clueScreen/);
  });

  function makeCellRect(): DOMRect {
    return {
      width: 120,
      height: 70,
      left: 200,
      top: 300,
      right: 320,
      bottom: 370,
      x: 200,
      y: 300,
      toJSON() {},
    } as DOMRect;
  }

  it('grows the clue overlay out of the selected cell when the origin matches the current clue', () => {
    const rect = makeCellRect();

    render(
      <ClueOverlay getOrigin={() => ({ clueId: 'cl1', rect })} clueId="cl1">
        <div>Clue</div>
      </ClueOverlay>,
    );

    const overlay = screen.getByTestId('clue-overlay');
    // The FLIP animation lands the overlay at full-screen (transform none) with
    // a 700ms transform transition enabled and the CSS keyframe disabled.
    expect(overlay.style.transform).toBe('none');
    expect(overlay.style.transition).toMatch(/transform 700ms/);
    expect(overlay.style.animation).toBe('none');
  });

  it('falls back to the CSS zoom without inline transforms when the captured origin is for another clue', () => {
    const rect = makeCellRect();

    render(
      <ClueOverlay getOrigin={() => ({ clueId: 'other-clue', rect })} clueId="cl1">
        <div>Clue</div>
      </ClueOverlay>,
    );

    const overlay = screen.getByTestId('clue-overlay');
    expect(overlay.className).toMatch(/clueScreen/);
    expect(overlay.style.transform).toBe('');
    expect(overlay.style.transition).toBe('');
    expect(overlay.style.animation).toBe('');
  });

  it('falls back to the CSS zoom when no cell origin was captured', () => {
    render(
      <ClueOverlay getOrigin={() => null} clueId="cl1">
        <div>Clue</div>
      </ClueOverlay>,
    );

    const overlay = screen.getByTestId('clue-overlay');
    expect(overlay.className).toMatch(/clueScreen/);
    expect(overlay.style.transform).toBe('');
  });

  it('shows lit armed indicator lights only when buzzers are armed', async () => {
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

    const lights = await screen.findByTestId('armed-indicator-lights');
    expect(lights).toBeInTheDocument();
    const bulbs = screen.getAllByTestId('armed-light');
    expect(bulbs.length).toBeGreaterThan(0);
  });

  it('does not show armed indicator lights while a clue is merely revealed', async () => {
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

    await screen.findByTestId('clue-overlay');
    expect(screen.queryByTestId('armed-indicator-lights')).not.toBeInTheDocument();
  });

  it('shows a countdown bar alongside the numeric countdown while armed', async () => {
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
    expect(screen.getByTestId('countdown-bar')).toBeInTheDocument();
  });

  it('exposes a visible audio mute toggle on the board', async () => {
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

    const toggle = await screen.findByTestId('audio-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('data-muted', 'false');
  });

  it('reflects the muted state in the audio toggle after clicking it', async () => {
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

    const toggle = await screen.findByTestId('audio-toggle');
    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('data-muted', 'true');
  });
});

describe('Board audio cues', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockServerTime(0);
    mockBoardAudioReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the armed cue on entering BUZZERS_ARMED', async () => {
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

    await screen.findByTestId('armed-indicator');
    expect(recordedCues).toContain('armed');
  });

  it('starts the think music on BUZZERS_ARMED and stops it when the phase ends', async () => {
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

    const { rerender } = renderBoardRoute();
    await userEvent.type(screen.getByLabelText(/room code/i), 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    await screen.findByTestId('armed-indicator');
    expect(recordedThinkMusic).toContain(true);

    mockUseSocket(makeBoardState({ phase: 'BOARD_SELECT', round: makeRound() }));
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );

    expect(recordedThinkMusic[recordedThinkMusic.length - 1]).toBe(false);
  });

  it('fires timeUp exactly once at the deadline during BUZZERS_ARMED', async () => {
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

    await screen.findByTestId('armed-indicator');
    expect(recordedCues).not.toContain('timeUp');

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(recordedCues.filter((cue) => cue === 'timeUp')).toHaveLength(1);

    // Advancing further must not replay the cue for the same deadline.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(recordedCues.filter((cue) => cue === 'timeUp')).toHaveLength(1);
  });

  it('fires timeUp exactly once at the deadline during FINAL_CLUE', async () => {
    mockUseSocket(
      makeFinalIntroState({
        phase: 'FINAL_CLUE',
        currentClueId: 'cl-final',
        currentClueText: 'He wrote The Hobbit',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        finalEligiblePlayerIds: ['p1'],
        finalWagerSubmissionStatus: { p1: true },
        deadline: 30_000,
        serverNow: 0,
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    await screen.findByTestId('clue-text');
    expect(recordedThinkMusic).toContain(true);
    expect(recordedCues).not.toContain('timeUp');

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(recordedCues.filter((cue) => cue === 'timeUp')).toHaveLength(1);
  });

  it('does not start the Final think music until the host starts the timer', async () => {
    mockUseSocket(
      makeFinalIntroState({
        phase: 'FINAL_CLUE',
        currentClueId: 'cl-final',
        currentClueText: 'He wrote The Hobbit',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        finalEligiblePlayerIds: ['p1'],
        finalWagerSubmissionStatus: { p1: true },
        deadline: null,
        serverNow: 0,
      }),
    );

    const { rerender } = renderBoardRoute();
    await userEvent.type(screen.getByLabelText(/room code/i), 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    await screen.findByTestId('clue-text');
    expect(recordedThinkMusic).not.toContain(true);

    mockUseSocket(
      makeFinalIntroState({
        phase: 'FINAL_CLUE',
        currentClueId: 'cl-final',
        currentClueText: 'He wrote The Hobbit',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        finalEligiblePlayerIds: ['p1'],
        finalWagerSubmissionStatus: { p1: true },
        deadline: 30_000,
        serverNow: 0,
      }),
    );
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );

    expect(recordedThinkMusic).toContain(true);
  });

  it('plays the winner music once on entering COMPLETE and re-arms it for a new game', async () => {
    const finalPlayers = [
      { id: 'p1', name: 'Alice', score: 800, connected: true },
      { id: 'p2', name: 'Bob', score: 200, connected: true },
    ];

    mockUseSocket(makeBoardState({ phase: 'BOARD_SELECT', round: makeRound() }));
    const { rerender } = renderBoardRoute();
    await userEvent.type(screen.getByLabelText(/room code/i), 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    await screen.findByTestId('board-grid');
    expect(recordedWinnerMusic.count).toBe(0);

    mockUseSocket(
      makeFinalIntroState({ phase: 'COMPLETE', players: finalPlayers, finalEligiblePlayerIds: ['p1', 'p2'] }),
    );
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );

    await screen.findByTestId('final-standings-heading');
    expect(recordedWinnerMusic.count).toBe(1);

    // A re-broadcast of the same winner screen must not replay the fanfare.
    mockUseSocket(
      makeFinalIntroState({ phase: 'COMPLETE', players: finalPlayers, finalEligiblePlayerIds: ['p1', 'p2'] }),
    );
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );
    expect(recordedWinnerMusic.count).toBe(1);

    // Starting a new game and reaching its winner screen plays it again.
    mockUseSocket(makeBoardState({ phase: 'BOARD_SELECT', round: makeRound() }));
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );
    await screen.findByTestId('board-grid');

    mockUseSocket(
      makeFinalIntroState({ phase: 'COMPLETE', players: finalPlayers, finalEligiblePlayerIds: ['p1', 'p2'] }),
    );
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );
    await screen.findByTestId('final-standings-heading');
    expect(recordedWinnerMusic.count).toBe(2);
  });

  it('cancels the scheduled timeUp cue when the phase changes away before the deadline', async () => {
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

    const { rerender } = renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));
    await screen.findByTestId('armed-indicator');

    // Advance partway, then simulate a contestant buzzing before the deadline.
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    mockUseSocket(
      makeBoardState({
        phase: 'BUZZED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        buzzWinnerId: 'p1',
        deadline: null,
        serverNow: 2_000,
        players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
      }),
    );
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );

    await screen.findByTestId('buzzed-indicator');

    // Pass the original deadline: the canceled cue must not fire.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(recordedCues).not.toContain('timeUp');
  });

  it('does not fire timeUp when the deadline is already expired on entry', async () => {
    mockServerTime(10_000);
    mockUseSocket(
      makeBoardState({
        phase: 'BUZZERS_ARMED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        deadline: 5_000,
        serverNow: 10_000,
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    await screen.findByTestId('armed-indicator');

    // Let any immediate timers flush.
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(recordedCues).not.toContain('timeUp');
  });

  it('schedules a fresh timeUp cue when the deadline advances without changing phase', async () => {
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

    const { rerender } = renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));
    await screen.findByTestId('armed-indicator');

    // Re-arm with a later deadline (e.g., after a wrong answer re-arm).
    mockServerTime(2_000);
    mockUseSocket(
      makeBoardState({
        phase: 'BUZZERS_ARMED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        deadline: 10_000,
        serverNow: 2_000,
        players: [{ id: 'p1', name: 'Alice', score: -100, connected: true }],
      }),
    );
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );

    // The first deadline has passed; the new cue should not have fired yet.
    expect(recordedCues).not.toContain('timeUp');

    act(() => {
      vi.advanceTimersByTime(8_000);
    });

    expect(recordedCues.filter((cue) => cue === 'timeUp')).toHaveLength(1);
  });

  it('fires timeUp via transition detection when BUZZERS_ARMED expires to BOARD_SELECT after the deadline', async () => {
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

    const { rerender } = renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));
    await screen.findByTestId('armed-indicator');
    expect(recordedCues).toContain('armed');
    expect(recordedCues).not.toContain('timeUp');

    // Advance server time past the deadline, then simulate the server
    // broadcasting the expiry transition (BUZZERS_ARMED -> BOARD_SELECT).
    mockServerTime(5_000);
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        usedClueIds: ['cl1'],
        answer: 'Water',
        deadline: null,
        serverNow: 5_000,
      }),
    );
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );

    await screen.findByTestId('board-grid');
    // timeUp fires via transition detection even though the setTimeout was
    // cancelled by the phase change cleanup.
    expect(recordedCues.filter((cue) => cue === 'timeUp')).toHaveLength(1);
  });

  it('fires timeUp via transition detection when FINAL_CLUE expires to FINAL_REVEAL', async () => {
    mockUseSocket(
      makeFinalIntroState({
        phase: 'FINAL_CLUE',
        currentClueId: 'cl-final',
        currentClueText: 'He wrote The Hobbit',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        finalEligiblePlayerIds: ['p1'],
        finalWagerSubmissionStatus: { p1: true },
        deadline: 30_000,
        serverNow: 0,
      }),
    );

    const { rerender } = renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));
    await screen.findByTestId('clue-text');
    expect(recordedThinkMusic).toContain(true);
    expect(recordedCues).not.toContain('timeUp');

    // Simulate the server broadcasting the expiry transition (FINAL_CLUE -> FINAL_REVEAL).
    mockServerTime(30_000);
    mockUseSocket(
      makeFinalIntroState({
        phase: 'FINAL_REVEAL',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        finalEligiblePlayerIds: ['p1'],
        finalRevealOrder: ['p1'],
        finalRevealIndex: 0,
        finalRevealStep: 'ANSWER',
        finalRevealedAnswers: {},
        finalRevealedWagers: {},
        deadline: null,
        serverNow: 30_000,
      }),
    );
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );

    await screen.findByTestId('final-reveal');
    expect(recordedCues.filter((cue) => cue === 'timeUp')).toHaveLength(1);
  });

  it('does not fire timeUp via transition detection on a buzz (BUZZERS_ARMED -> BUZZED)', async () => {
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

    const { rerender } = renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));
    await screen.findByTestId('armed-indicator');

    // Advance partway, then simulate a contestant buzzing before the deadline.
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    mockServerTime(2_000);
    mockUseSocket(
      makeBoardState({
        phase: 'BUZZED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        buzzWinnerId: 'p1',
        deadline: null,
        serverNow: 2_000,
        players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
      }),
    );
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );

    await screen.findByTestId('buzzed-indicator');
    expect(recordedCues).not.toContain('timeUp');
  });

  it('fires timeUp via transition detection on an early host reveal (BUZZERS_ARMED -> BOARD_SELECT before deadline)', async () => {
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

    const { rerender } = renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));
    await screen.findByTestId('armed-indicator');

    // Simulate an early host reveal while armed (before the deadline).
    mockServerTime(2_000);
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        usedClueIds: ['cl1'],
        answer: 'Water',
        deadline: null,
        serverNow: 2_000,
      }),
    );
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );

    await screen.findByTestId('board-grid');
    // timeUp fires on any non-buzz exit from BUZZERS_ARMED, including an
    // early host reveal. This is intentional: the serverNowRef clock guard
    // was removed because the client-extrapolated server time can lag behind
    // the actual server time at the moment of the broadcast, suppressing the
    // cue on genuine expiry transitions. Firing on early reveal is acceptable.
    expect(recordedCues.filter((cue) => cue === 'timeUp')).toHaveLength(1);
  });

  it('dedupes transition-detection timeUp with the setTimeout backup so timeUp fires at most once per deadline', async () => {
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

    const { rerender } = renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));
    await screen.findByTestId('armed-indicator');

    // Let the setTimeout fire the timeUp cue at the deadline.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(recordedCues.filter((cue) => cue === 'timeUp')).toHaveLength(1);

    // Now simulate the server broadcast arriving (late) with the phase transition.
    mockServerTime(5_000);
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        usedClueIds: ['cl1'],
        answer: 'Water',
        deadline: null,
        serverNow: 5_000,
      }),
    );
    rerender(
      <MemoryRouter>
        <BoardRoute />
      </MemoryRouter>,
    );

    await screen.findByTestId('board-grid');
    // The transition detection must not fire timeUp a second time for the same deadline.
    expect(recordedCues.filter((cue) => cue === 'timeUp')).toHaveLength(1);
  });
});

describe('Board accessibility', () => {
  it('marks the scoreboard as an aria-live region', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
      }),
    );

    renderBoardRoute();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /view board/i }));

    const scoreboard = await screen.findByTestId('scoreboard');
    expect(scoreboard).toHaveAttribute('aria-live', 'polite');
  });

  it('marks the armed indicator as an aria-live status region', async () => {
    mockUseSocket(
      makeBoardState({
        phase: 'BUZZERS_ARMED',
        round: makeRound(),
        players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
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

    const indicator = await screen.findByTestId('armed-indicator');
    expect(indicator.parentElement).toHaveAttribute('role', 'status');
    expect(indicator.parentElement).toHaveAttribute('aria-live', 'polite');
  });
});
