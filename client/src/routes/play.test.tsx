import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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

beforeEach(() => {
  localStorage.clear();
  (getStoredContestantToken as ReturnType<typeof vi.fn>).mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeRound(overrides: Partial<ContestantView['round']> = {}): NonNullable<ContestantView['round']> {
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

function makeFinalRound(overrides: Partial<ContestantView['round']> = {}): NonNullable<ContestantView['round']> {
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

function makeContestantState(overrides: Partial<ContestantView> = {}): ContestantView {
  return {
    phase: 'LOBBY',
    roomCode: 'ABCD',
    roundIndex: 0,
    players: [{ id: 'p1', name: 'Alice', score: 0, connected: true }],
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
    playerId: 'p1',
    isControllingPlayer: false,
    isLockedOut: false,
    lockoutUntil: null,
    canWager: false,
    canAnswer: false,
    dailyDoubleWager: null,
    transitionTarget: null,
    finalNoEligiblePlayers: false,
    finalEligiblePlayerIds: [],
    finalWagerSubmissionStatus: {},
    isEligibleForFinal: false,
    finalWagerSubmitted: false,
    myFinalWager: null,
    roundComplete: false,
    ...overrides,
  };
}

function mockUseSocket(state: ContestantView | null, error: string | null = null, overrides: Record<string, unknown> = {}) {
  useSocket.mockReturnValue({
    connected: true,
    error,
    data: state,
    startGame: vi.fn(),
    leaveGame: vi.fn(),
    selectClue: vi.fn(),
    revealAnswer: vi.fn(),
    armBuzzers: vi.fn(),
    buzz: vi.fn(),
    ruleCorrect: vi.fn(),
    ruleIncorrect: vi.fn(),
    submitDDWager: vi.fn(),
    submitFinalWager: vi.fn(),
    submitFinalAnswer: vi.fn(),
    forceFinalWagers: vi.fn(),
    advanceRound: vi.fn(),
    openFinalWagers: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
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

  it('shows the grid and lets the controlling player select a clue', async () => {
    const selectClue = vi.fn();
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        isControllingPlayer: true,
        controllingPlayerId: 'p1',
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue,
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('contestant-grid')).toBeInTheDocument();
    const cells = screen.getAllByTestId('contestant-clue-cell');
    expect(cells).toHaveLength(3);
    await userEvent.click(cells[0]);
    expect(selectClue).toHaveBeenCalledWith('cl1');
  });

  it('disables clue selection for a non-controlling contestant', async () => {
    const selectClue = vi.fn();
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        isControllingPlayer: false,
        controllingPlayerId: 'p2',
        players: [
          { id: 'p1', name: 'Alice', score: 0, connected: true },
          { id: 'p2', name: 'Bob', score: 0, connected: true },
        ],
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue,
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('contestant-grid')).toBeInTheDocument();
    const cells = screen.getAllByTestId('contestant-clue-cell');
    expect(cells[0]).toBeDisabled();
    await userEvent.click(cells[0]);
    expect(selectClue).not.toHaveBeenCalled();
  });

  it('shows the revealed clue on the contestant device', async () => {
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'CLUE_REVEALED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('contestant-clue-text')).toHaveTextContent('H2O is this compound');
  });

  it('shows a Daily Double splash during the wager phase', async () => {
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'DAILY_DOUBLE_WAGER',
        round: makeRound(),
        currentClueId: 'cl2',
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('daily-double-splash')).toBeInTheDocument();
  });

  it('shows a wager input only to the controlling contestant during a Daily Double', async () => {
    const submitDDWager = vi.fn();
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'DAILY_DOUBLE_WAGER',
        round: makeRound(),
        currentClueId: 'cl2',
        playerId: 'p1',
        isControllingPlayer: true,
        canWager: true,
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
      submitDDWager,
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('daily-double-wager-input')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-double-passive')).not.toBeInTheDocument();

    const wagerInput = screen.getByTestId('dd-wager-input');
    await userEvent.clear(wagerInput);
    await userEvent.type(wagerInput, '200');
    await userEvent.click(screen.getByTestId('dd-wager-submit'));

    expect(submitDDWager).toHaveBeenCalledWith(200);
  });

  it('shows an inline minimum-bound error when the controlling contestant submits a below-minimum Daily Double wager', async () => {
    const submitDDWager = vi.fn();
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'DAILY_DOUBLE_WAGER',
        round: makeRound(),
        currentClueId: 'cl2',
        playerId: 'p1',
        isControllingPlayer: true,
        canWager: true,
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
      submitDDWager,
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('daily-double-wager-input')).toBeInTheDocument();

    const wagerInput = screen.getByTestId('dd-wager-input');
    await userEvent.clear(wagerInput);
    await userEvent.type(wagerInput, '4');
    await userEvent.click(screen.getByTestId('dd-wager-submit'));

    expect(submitDDWager).not.toHaveBeenCalled();
    expect(await screen.findByTestId('dd-wager-error')).toHaveTextContent(/at least \$5/i);
    expect(screen.getByTestId('dd-wager-error')).toHaveTextContent(/allowed range/i);
  });

  it('shows an inline over-maximum error when the controlling contestant submits an above-max Daily Double wager', async () => {
    const submitDDWager = vi.fn();
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'DAILY_DOUBLE_WAGER',
        round: makeRound(),
        currentClueId: 'cl2',
        playerId: 'p1',
        isControllingPlayer: true,
        canWager: true,
        players: [{ id: 'p1', name: 'Alice', score: 100, connected: true }],
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
      submitDDWager,
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('daily-double-wager-input')).toBeInTheDocument();

    const wagerInput = screen.getByTestId('dd-wager-input');
    await userEvent.clear(wagerInput);
    await userEvent.type(wagerInput, '201');
    await userEvent.click(screen.getByTestId('dd-wager-submit'));

    expect(submitDDWager).not.toHaveBeenCalled();
    expect(await screen.findByTestId('dd-wager-error')).toHaveTextContent(/cannot exceed \$200/i);
    expect(screen.getByTestId('dd-wager-error')).toHaveTextContent(/allowed range/i);
  });

  it('clears the inline wager error and allows resubmit when the contestant corrects the wager', async () => {
    const submitDDWager = vi.fn();
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'DAILY_DOUBLE_WAGER',
        round: makeRound(),
        currentClueId: 'cl2',
        playerId: 'p1',
        isControllingPlayer: true,
        canWager: true,
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
      submitDDWager,
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('daily-double-wager-input')).toBeInTheDocument();

    const wagerInput = screen.getByTestId('dd-wager-input');
    await userEvent.clear(wagerInput);
    await userEvent.type(wagerInput, '4');
    await userEvent.click(screen.getByTestId('dd-wager-submit'));

    expect(await screen.findByTestId('dd-wager-error')).toBeInTheDocument();

    await userEvent.clear(wagerInput);
    await userEvent.type(wagerInput, '50');
    await userEvent.click(screen.getByTestId('dd-wager-submit'));

    expect(screen.queryByTestId('dd-wager-error')).not.toBeInTheDocument();
    expect(submitDDWager).toHaveBeenCalledWith(50);
  });

  it('shows a passive Daily Double state to non-controlling contestants', async () => {
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'DAILY_DOUBLE_WAGER',
        round: makeRound(),
        currentClueId: 'cl2',
        playerId: 'p2',
        isControllingPlayer: false,
        controllingPlayerId: 'p1',
        players: [
          { id: 'p1', name: 'Alice', score: 0, connected: true },
          { id: 'p2', name: 'Bob', score: 0, connected: true },
        ],
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Bob');
    await userEvent.click(button);

    expect(await screen.findByTestId('daily-double-passive')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-double-wager-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dd-wager-input')).not.toBeInTheDocument();
  });

  it('shows a locked wager to the controlling contestant while waiting for host reveal', async () => {
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'DAILY_DOUBLE_WAGER',
        round: makeRound(),
        currentClueId: 'cl2',
        playerId: 'p1',
        isControllingPlayer: true,
        canWager: false,
        dailyDoubleWager: 200,
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('daily-double-wager-locked')).toBeInTheDocument();
    expect(screen.getByTestId('dd-wager-locked-amount')).toHaveTextContent('200');
    expect(screen.queryByTestId('contestant-clue-text')).not.toBeInTheDocument();
  });

  it('shows a locked wager to the controlling contestant after submission', async () => {
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'DAILY_DOUBLE_CLUE',
        round: makeRound(),
        currentClueId: 'cl2',
        currentClueText: 'This planet is known as the Red Planet',
        playerId: 'p1',
        isControllingPlayer: true,
        dailyDoubleWager: 200,
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('contestant-clue-text')).toHaveTextContent('This planet is known as the Red Planet');
    expect(screen.getByTestId('dd-wager-locked-amount')).toHaveTextContent('200');
  });

  it('shows the buzzer and sends a buzz when armed', async () => {
    const buzz = vi.fn();
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'BUZZERS_ARMED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        playerId: 'p1',
        isLockedOut: false,
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
      buzz,
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    const buzzer = await screen.findByTestId('contestant-buzzer');
    expect(buzzer).toHaveTextContent('Buzz In');
    await userEvent.click(buzzer);
    expect(buzz).toHaveBeenCalledWith('p1');
  });

  it('presses the buzzer before arming and shows a visible Too Early state', async () => {
    const buzz = vi.fn();
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'CLUE_REVEALED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        playerId: 'p1',
        isLockedOut: false,
        lockoutUntil: null,
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
      buzz,
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    const buzzer = await screen.findByTestId('contestant-buzzer');
    expect(buzzer).toHaveTextContent('Wait for Host');
    expect(buzzer).not.toHaveAttribute('data-too-early');
    expect(buzzer).toBeEnabled();

    await userEvent.click(buzzer);

    expect(buzz).toHaveBeenCalledWith('p1');
    expect(buzzer).toHaveTextContent('Too Early');
    expect(buzzer).toHaveAttribute('data-too-early', 'true');
    expect(buzzer).toBeDisabled();
  });

  it('returns to Wait for Host after the too-early display lockout expires', async () => {
    const buzz = vi.fn();
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'CLUE_REVEALED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        playerId: 'p1',
        isLockedOut: false,
        lockoutUntil: null,
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
      buzz,
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    const buzzer = await screen.findByTestId('contestant-buzzer');
    await userEvent.click(buzzer);
    expect(buzzer).toHaveTextContent('Too Early');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });

    expect(buzzer).toHaveTextContent('Wait for Host');
    expect(buzzer).not.toHaveAttribute('data-too-early');
    expect(buzzer).toBeEnabled();
  });

  it('shows Too Early when the contestant is already locked out before arming', async () => {
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'CLUE_REVEALED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        playerId: 'p1',
        isLockedOut: true,
        lockoutUntil: Date.now() + 250,
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
      buzz: vi.fn(),
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    const buzzer = await screen.findByTestId('contestant-buzzer');
    expect(buzzer).toHaveTextContent('Too Early');
    expect(buzzer).toHaveAttribute('data-too-early', 'true');
    expect(buzzer).toBeDisabled();
  });

  it('disables the buzzer when the contestant is locked out', async () => {
    const buzz = vi.fn();
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'BUZZERS_ARMED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        playerId: 'p1',
        isLockedOut: true,
        lockoutUntil: Date.now() + 250,
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
      buzz,
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    const buzzer = await screen.findByTestId('contestant-buzzer');
    expect(buzzer).toBeDisabled();
    await userEvent.click(buzzer);
    expect(buzz).not.toHaveBeenCalled();
  });

  it('shows a countdown while the buzzers are armed', async () => {
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'BUZZERS_ARMED',
        round: makeRound(),
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        playerId: 'p1',
        deadline: 5_000,
        serverNow: 0,
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
      buzz: vi.fn(),
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('countdown')).toHaveTextContent('5');
  });

  it('shows the revealed answer and outcome on the contestant device after a ruling', async () => {
    useSocket.mockReturnValue({
      connected: true,
      error: null,
      data: makeContestantState({
        phase: 'BOARD_SELECT',
        round: makeRound(),
        usedClueIds: ['cl1'],
        answer: 'Water',
        lastOutcome: { playerId: 'p2', type: 'CORRECT', value: 100 },
        controllingPlayerId: 'p2',
        playerId: 'p1',
        isControllingPlayer: false,
        players: [
          { id: 'p1', name: 'Alice', score: 0, connected: true },
          { id: 'p2', name: 'Bob', score: 100, connected: true },
        ],
      }),
      startGame: vi.fn(),
      leaveGame: vi.fn(),
      selectClue: vi.fn(),
    });

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('contestant-answer-banner')).toBeInTheDocument();
    expect(screen.getByTestId('contestant-answer-text')).toHaveTextContent('Water');
    expect(screen.getByTestId('contestant-outcome-label')).toHaveTextContent('Correct!');
    expect(screen.getByTestId('contestant-outcome-label')).toHaveTextContent('Bob');
    expect(screen.getByTestId('contestant-outcome-label')).toHaveTextContent('+$100');
  });

  it('shows the between-round transition screen with carried-over scores', async () => {
    mockUseSocket(
      makeContestantState({
        phase: 'ROUND_TRANSITION',
        transitionTarget: 'DOUBLE_JEOPARDY',
        playerId: 'p1',
        players: [
          { id: 'p1', name: 'Alice', score: 300, connected: true },
          { id: 'p2', name: 'Bob', score: -100, connected: true },
        ],
      }),
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('contestant-round-transition')).toBeInTheDocument();
    expect(screen.getByTestId('contestant-transition-heading')).toHaveTextContent('Double Jeopardy!');
    const scores = screen.getAllByTestId('contestant-transition-score');
    expect(scores).toHaveLength(2);
    expect(scores[0]).toHaveTextContent('Alice');
    expect(scores[0]).toHaveTextContent('300');
    expect(scores[1]).toHaveTextContent('Bob');
    expect(scores[1]).toHaveTextContent('-100');
  });

  it('shows the Final Jeopardy category and eligible message to an eligible contestant', async () => {
    mockUseSocket(
      makeContestantState({
        phase: 'FINAL_INTRO',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p1',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        isEligibleForFinal: true,
      }),
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('contestant-final-intro')).toBeInTheDocument();
    expect(screen.getByTestId('contestant-final-category')).toHaveTextContent('Literature');
    expect(screen.getByTestId('contestant-final-eligible')).toBeInTheDocument();
    expect(screen.queryByTestId('contestant-final-ineligible')).not.toBeInTheDocument();
  });

  it('shows the Final Jeopardy category and not-eligible message to an ineligible contestant', async () => {
    mockUseSocket(
      makeContestantState({
        phase: 'FINAL_INTRO',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p2',
        players: [
          { id: 'p1', name: 'Alice', score: 200, connected: true },
          { id: 'p2', name: 'Bob', score: 0, connected: true },
        ],
        isEligibleForFinal: false,
      }),
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Bob');
    await userEvent.click(button);

    expect(await screen.findByTestId('contestant-final-intro')).toBeInTheDocument();
    expect(screen.getByTestId('contestant-final-category')).toHaveTextContent('Literature');
    expect(screen.getByTestId('contestant-final-ineligible')).toBeInTheDocument();
    expect(screen.queryByTestId('contestant-final-eligible')).not.toBeInTheDocument();
  });

  it('shows the Final wager input to an eligible contestant', async () => {
    const submitFinalWager = vi.fn();
    mockUseSocket(
      makeContestantState({
        phase: 'FINAL_WAGER',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p1',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        isEligibleForFinal: true,
        canWager: true,
        finalWagerSubmitted: false,
        myFinalWager: null,
      }),
      null,
      { submitFinalWager },
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('final-wager-input')).toBeInTheDocument();
    expect(screen.getByTestId('final-wager-heading')).toHaveTextContent('Final Jeopardy Wager');

    await userEvent.type(screen.getByTestId('final-wager-amount-input'), '150');
    await userEvent.click(screen.getByTestId('final-wager-submit'));
    expect(submitFinalWager).toHaveBeenCalledWith(150);
  });

  it('shows a locked confirmation after an eligible contestant submits a Final wager', async () => {
    mockUseSocket(
      makeContestantState({
        phase: 'FINAL_WAGER',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p1',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        isEligibleForFinal: true,
        canWager: false,
        finalWagerSubmitted: true,
        myFinalWager: 150,
      }),
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('final-wager-locked')).toBeInTheDocument();
    expect(screen.getByTestId('final-wager-locked-amount')).toHaveTextContent('$150');
  });

  it('shows an ineligible message to a contestant during FINAL_WAGER', async () => {
    mockUseSocket(
      makeContestantState({
        phase: 'FINAL_WAGER',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p2',
        players: [
          { id: 'p1', name: 'Alice', score: 200, connected: true },
          { id: 'p2', name: 'Bob', score: 0, connected: true },
        ],
        isEligibleForFinal: false,
        canWager: false,
        finalWagerSubmitted: false,
        myFinalWager: null,
      }),
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Bob');
    await userEvent.click(button);

    expect(await screen.findByTestId('final-wager-ineligible')).toBeInTheDocument();
  });

  it('shows an inline validation error for an out-of-range Final wager', async () => {
    const submitFinalWager = vi.fn();
    mockUseSocket(
      makeContestantState({
        phase: 'FINAL_WAGER',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p1',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        isEligibleForFinal: true,
        canWager: true,
        finalWagerSubmitted: false,
        myFinalWager: null,
      }),
      null,
      { submitFinalWager },
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('final-wager-input')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('final-wager-amount-input'), '250');
    await userEvent.click(screen.getByTestId('final-wager-submit'));
    expect(submitFinalWager).not.toHaveBeenCalled();
    expect(screen.getByTestId('final-wager-error')).toHaveTextContent(/cannot exceed/i);
  });

  it('shows the Final clue text during FINAL_CLUE', async () => {
    mockUseSocket(
      makeContestantState({
        phase: 'FINAL_CLUE',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p1',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        currentClueId: 'cl-final',
        currentClueText: 'He wrote The Hobbit',
      }),
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('contestant-clue-text')).toHaveTextContent('He wrote The Hobbit');
  });

  it('shows an answer input and countdown to an eligible contestant during FINAL_CLUE', async () => {
    mockUseSocket(
      makeContestantState({
        phase: 'FINAL_CLUE',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p1',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        currentClueId: 'cl-final',
        currentClueText: 'He wrote The Hobbit',
        isEligibleForFinal: true,
        canAnswer: true,
        finalAnswerSubmitted: false,
        myFinalAnswer: null,
        deadline: 30_000,
        serverNow: 0,
      }),
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('countdown')).toHaveTextContent('30');
    expect(screen.getByTestId('final-answer-input')).toBeInTheDocument();
    expect(screen.getByTestId('final-answer-heading')).toHaveTextContent('Final Jeopardy Answer');
  });

  it('submits a written Final answer and locks the input', async () => {
    const submitFinalAnswer = vi.fn();
    mockUseSocket(
      makeContestantState({
        phase: 'FINAL_CLUE',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p1',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        currentClueId: 'cl-final',
        currentClueText: 'He wrote The Hobbit',
        isEligibleForFinal: true,
        canAnswer: true,
        finalAnswerSubmitted: false,
        myFinalAnswer: null,
      }),
      null,
      { submitFinalAnswer },
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('final-answer-input')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('final-answer-text-input'), 'Tolkien');
    await userEvent.click(screen.getByTestId('final-answer-submit'));
    expect(submitFinalAnswer).toHaveBeenCalledWith('Tolkien');
  });

  it('shows a locked answer to the contestant after submission', async () => {
    mockUseSocket(
      makeContestantState({
        phase: 'FINAL_CLUE',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p1',
        players: [{ id: 'p1', name: 'Alice', score: 200, connected: true }],
        currentClueId: 'cl-final',
        currentClueText: 'He wrote The Hobbit',
        isEligibleForFinal: true,
        canAnswer: false,
        finalAnswerSubmitted: true,
        myFinalAnswer: 'Tolkien',
      }),
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Alice');
    await userEvent.click(button);

    expect(await screen.findByTestId('final-answer-locked')).toBeInTheDocument();
    expect(screen.getByTestId('final-answer-locked-text')).toHaveTextContent('Tolkien');
  });

  it('shows an ineligible message to a contestant during FINAL_CLUE', async () => {
    mockUseSocket(
      makeContestantState({
        phase: 'FINAL_CLUE',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p2',
        players: [
          { id: 'p1', name: 'Alice', score: 200, connected: true },
          { id: 'p2', name: 'Bob', score: 0, connected: true },
        ],
        isEligibleForFinal: false,
        canAnswer: false,
        finalAnswerSubmitted: false,
        myFinalAnswer: null,
      }),
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Bob');
    await userEvent.click(button);

    expect(await screen.findByTestId('final-answer-ineligible')).toBeInTheDocument();
  });

  it('shows the final standings alongside the no-eligible message after the all-ineligible skip', async () => {
    mockUseSocket(
      makeContestantState({
        phase: 'COMPLETE',
        roundIndex: 1,
        round: makeFinalRound(),
        playerId: 'p2',
        finalNoEligiblePlayers: true,
        players: [
          { id: 'p1', name: 'Alice', score: 0, connected: true },
          { id: 'p2', name: 'Bob', score: -100, connected: true },
        ],
        isEligibleForFinal: false,
      }),
    );

    render(<PlayRoute />);

    const roomInput = screen.getByLabelText('Room Code');
    const nameInput = screen.getByLabelText('Your Name');
    const button = screen.getByRole('button', { name: 'Join Game' });

    await userEvent.type(roomInput, 'ABCD');
    await userEvent.type(nameInput, 'Bob');
    await userEvent.click(button);

    expect(await screen.findByTestId('contestant-final-standings')).toBeInTheDocument();
    expect(screen.getByTestId('contestant-final-no-eligible')).toBeInTheDocument();
    expect(screen.getByTestId('contestant-final-standings-list')).toBeInTheDocument();
    expect(screen.getByTestId('contestant-final-standing-name-p1')).toHaveTextContent('Alice');
    expect(screen.getByTestId('contestant-final-standing-score-p1')).toHaveTextContent('0');
    expect(screen.getByTestId('contestant-final-standing-name-p2')).toHaveTextContent('Bob');
    expect(screen.getByTestId('contestant-final-standing-score-p2')).toHaveTextContent('-100');
  });
});
