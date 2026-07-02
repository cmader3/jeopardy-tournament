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
    roundComplete: false,
    serverNow: 0,
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

  it('shows daily double markers on the host grid', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', round: makeRound() });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('dd-marker')).toBeInTheDocument();
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

  it('shows the advance round button when the round is complete', () => {
    const state = makeHostState({ phase: 'BOARD_SELECT', roundComplete: true });
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('advance-round-button')).toBeInTheDocument();
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
    expect(screen.getByTestId('transition-score-p2')).toHaveTextContent('-100');
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

  it('shows a no-eligible message when no contestants are eligible', () => {
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
    render(<HostInProgress roomCode="WXYZ" state={state} />);

    expect(screen.getByTestId('host-no-eligible')).toBeInTheDocument();
    expect(screen.queryByTestId('open-final-wagers-button')).not.toBeInTheDocument();
  });
});
