import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayRoute } from './play.js';
import type { ContestantView, ProjectedTeam } from '@jeopardy/shared';

vi.mock('../socket/useSocket.js', () => ({
  useSocket: vi.fn(),
  getStoredContestantToken: vi.fn(() => null),
  clearStoredContestantToken: vi.fn(),
  __esModule: true,
}));

import { useSocket, getStoredContestantToken } from '../socket/useSocket.js';

beforeEach(() => {
  localStorage.clear();
  (getStoredContestantToken as ReturnType<typeof vi.fn>).mockReturnValue({
    reconnectToken: 'stored-token',
    playerId: 'a',
    roomCode: 'ABCD',
  });
});

function team(overrides: Partial<ProjectedTeam> & { id: string; name: string }): ProjectedTeam {
  return {
    score: 0,
    captainId: null,
    actingCaptainId: null,
    memberIds: [],
    connectedMemberIds: [],
    ...overrides,
  };
}

function makeState(overrides: Partial<ContestantView> = {}): ContestantView {
  return {
    phase: 'LOBBY',
    roomCode: 'ABCD',
    roundIndex: 0,
    players: [
      { id: 'a', name: 'Alice', score: 0, connected: true, teamId: 't1' },
      { id: 'b', name: 'Bob', score: 0, connected: true, teamId: 't1' },
    ],
    teamMode: true,
    teams: [
      team({ id: 't1', name: 'Red', memberIds: ['a', 'b'], connectedMemberIds: ['a', 'b'], captainId: 'a', actingCaptainId: 'a', score: 0 }),
      team({ id: 't2', name: 'Blue', memberIds: ['c'], connectedMemberIds: ['c'], captainId: 'c', actingCaptainId: 'c', score: 0 }),
    ],
    round: null,
    usedClueIds: [],
    currentClueId: null,
    currentClueText: null,
    controllingPlayerId: null,
    controllingTeamId: 't1',
    buzzWinnerId: null,
    deadline: null,
    answer: null,
    lastOutcome: null,
    serverNow: 0,
    playerId: 'a',
    teamId: 't1',
    teamName: 'Red',
    teamScore: 0,
    isCaptain: true,
    isActingCaptain: true,
    isTemporaryCaptain: false,
    isTeamLockedOut: false,
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
    finalAnswerSubmissionStatus: {},
    finalRevealOrder: [],
    finalRevealIndex: 0,
    finalRevealStep: 'ANSWER',
    finalRevealedAnswers: {},
    finalRevealedWagers: {},
    isEligibleForFinal: false,
    finalWagerSubmitted: false,
    myFinalWager: null,
    finalAnswerSubmitted: false,
    myFinalAnswer: null,
    roundComplete: false,
    clueSelectionMode: 'HOST',
    pendingClueId: null,
    ...overrides,
  };
}

function mockSocket(state: ContestantView, overrides: Record<string, unknown> = {}) {
  (useSocket as ReturnType<typeof vi.fn>).mockReturnValue({
    connected: true,
    status: 'connected',
    error: null,
    data: state,
    leaveGame: vi.fn(),
    chooseTeam: vi.fn(),
    submitFinalWager: vi.fn(),
    submitFinalAnswer: vi.fn(),
    submitFinalAnswerDraft: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  });
}

describe('Contestant team mode', () => {
  it('shows the team picker when the player has not chosen a team, and choosing emits chooseTeam', async () => {
    const chooseTeam = vi.fn();
    mockSocket(
      makeState({
        teamId: null,
        teamName: null,
        teamScore: null,
        isCaptain: false,
        isActingCaptain: false,
        players: [{ id: 'a', name: 'Alice', score: 0, connected: true, teamId: null }],
      }),
      { chooseTeam },
    );

    render(<PlayRoute />);

    expect(await screen.findByTestId('team-picker')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('choose-team-t2'));
    expect(chooseTeam).toHaveBeenCalledWith('t2');
  });

  it('shows the team banner with the team name and score', async () => {
    mockSocket(makeState({ teamScore: 400, teams: [team({ id: 't1', name: 'Red', memberIds: ['a'], connectedMemberIds: ['a'], captainId: 'a', actingCaptainId: 'a', score: 400 }), team({ id: 't2', name: 'Blue' })] }));

    render(<PlayRoute />);

    expect(await screen.findByTestId('contestant-team-name')).toHaveTextContent('Red');
    expect(screen.getByTestId('contestant-team-score')).toHaveTextContent('$400');
    expect(screen.getByTestId('contestant-team-role')).toHaveTextContent('You are the team captain');
  });

  it('tells a stand-in captain they are temporary', async () => {
    mockSocket(makeState({ isCaptain: false, isActingCaptain: true, isTemporaryCaptain: true, playerId: 'b', teamId: 't1' }));

    render(<PlayRoute />);

    expect(await screen.findByTestId('contestant-team-role')).toHaveTextContent('You are the temporary captain');
  });

  it('warns teammates when the team is locked out', async () => {
    mockSocket(
      makeState({
        phase: 'BUZZERS_ARMED',
        isTeamLockedOut: true,
        isLockedOut: true,
        currentClueId: 'cl1',
        currentClueText: 'A clue',
      }),
    );

    render(<PlayRoute />);

    expect(await screen.findByTestId('contestant-team-locked')).toBeInTheDocument();
  });

  it('shows a passive Final wager view for non-captain teammates', async () => {
    mockSocket(
      makeState({
        phase: 'FINAL_WAGER',
        isEligibleForFinal: true,
        isCaptain: false,
        isActingCaptain: false,
        playerId: 'b',
      }),
    );

    render(<PlayRoute />);

    expect(await screen.findByTestId('final-wager-team-passive')).toHaveTextContent('captain is entering the wager');
  });

  it('renders team names in the final standings', async () => {
    mockSocket(
      makeState({
        phase: 'COMPLETE',
        teams: [
          team({ id: 't1', name: 'Red', memberIds: ['a', 'b'], connectedMemberIds: ['a', 'b'], captainId: 'a', actingCaptainId: 'a', score: 500 }),
          team({ id: 't2', name: 'Blue', memberIds: ['c'], connectedMemberIds: ['c'], captainId: 'c', actingCaptainId: 'c', score: 200 }),
        ],
        teamScore: 500,
      }),
    );

    render(<PlayRoute />);

    expect(await screen.findByTestId('contestant-final-standing-name-t1')).toHaveTextContent('Red');
    expect(screen.getByTestId('contestant-final-standing-name-t2')).toHaveTextContent('Blue');
  });
});
