import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostLobby, HostInProgress } from './host.js';
import type { HostView, ProjectedTeam, ProjectedPlayer } from '@jeopardy/shared';

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

function player(overrides: Partial<ProjectedPlayer> & { id: string; name: string }): ProjectedPlayer {
  return {
    score: 0,
    connected: true,
    teamId: null,
    ...overrides,
  };
}

function makeHostState(overrides: Partial<HostView> = {}): HostView {
  return {
    phase: 'LOBBY',
    roomCode: 'ABCD',
    roundIndex: 0,
    players: [],
    teamMode: false,
    teams: [],
    round: null,
    usedClueIds: [],
    clueSelectionMode: 'HOST',
    pendingClueId: null,
    currentClueId: null,
    currentClueText: null,
    controllingPlayerId: null,
    controllingTeamId: null,
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
    finalWagerSubmissionStatus: {},
    finalAnswerSubmissionStatus: {},
    finalRevealOrder: [],
    finalRevealIndex: 0,
    finalRevealStep: 'ANSWER',
    finalRevealedAnswers: {},
    finalRevealedWagers: {},
    roundComplete: false,
    nextRoundTarget: 'FINAL',
    removedPlayers: [],
    serverNow: 0,
    ...overrides,
  };
}

describe('HostLobby team mode', () => {
  it('reveals team name inputs when Team Mode is toggled on and saves teams', async () => {
    const onConfigureTeams = vi.fn();
    render(
      <HostLobby
        roomCode="ABCD"
        state={makeHostState()}
        onStartGame={vi.fn()}
        onConfigureTeams={onConfigureTeams}
        startError={null}
      />,
    );

    await userEvent.click(screen.getByTestId('team-mode-toggle'));
    await userEvent.type(screen.getByTestId('team-name-input-0'), 'Red');
    await userEvent.type(screen.getByTestId('team-name-input-1'), 'Blue');
    await userEvent.click(screen.getByTestId('save-teams-button'));

    expect(onConfigureTeams).toHaveBeenCalledTimes(1);
    const [enabled, teams] = onConfigureTeams.mock.calls[0];
    expect(enabled).toBe(true);
    expect(teams.map((t: { name: string }) => t.name)).toEqual(['Red', 'Blue']);
    expect(teams[0].id).toBeTruthy();
  });

  it('disables Save Teams when a team name is blank', async () => {
    render(
      <HostLobby roomCode="ABCD" state={makeHostState()} onStartGame={vi.fn()} onConfigureTeams={vi.fn()} startError={null} />,
    );
    await userEvent.click(screen.getByTestId('team-mode-toggle'));
    await userEvent.type(screen.getByTestId('team-name-input-0'), 'Red');
    expect(screen.getByTestId('save-teams-button')).toBeDisabled();
    expect(screen.getByTestId('team-setup-blank')).toBeInTheDocument();
  });

  it('gates Start until every team has a player', () => {
    const state = makeHostState({
      teamMode: true,
      teams: [
        team({ id: 't1', name: 'Red', memberIds: ['a'], connectedMemberIds: ['a'], captainId: 'a', actingCaptainId: 'a' }),
        team({ id: 't2', name: 'Blue' }),
      ],
      players: [player({ id: 'a', name: 'Alice', teamId: 't1' })],
    });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError={null} />);

    expect(screen.getByTestId('start-game-button')).toBeDisabled();
    expect(screen.getByTestId('team-start-gate')).toHaveTextContent('Blue');
  });

  it('enables Start when all teams have players', () => {
    const state = makeHostState({
      teamMode: true,
      teams: [
        team({ id: 't1', name: 'Red', memberIds: ['a'], connectedMemberIds: ['a'], captainId: 'a', actingCaptainId: 'a' }),
        team({ id: 't2', name: 'Blue', memberIds: ['b'], connectedMemberIds: ['b'], captainId: 'b', actingCaptainId: 'b' }),
      ],
      players: [player({ id: 'a', name: 'Alice', teamId: 't1' }), player({ id: 'b', name: 'Bob', teamId: 't2' })],
    });
    render(<HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} startError={null} />);
    expect(screen.getByTestId('start-game-button')).toBeEnabled();
  });

  it('shows the captain badge and lets the host reassign the captain', async () => {
    const onSetCaptain = vi.fn();
    const state = makeHostState({
      teamMode: true,
      teams: [
        team({
          id: 't1',
          name: 'Red',
          memberIds: ['a', 'b'],
          connectedMemberIds: ['a', 'b'],
          captainId: 'a',
          actingCaptainId: 'a',
        }),
        team({ id: 't2', name: 'Blue', memberIds: ['c'], connectedMemberIds: ['c'], captainId: 'c', actingCaptainId: 'c' }),
      ],
      players: [
        player({ id: 'a', name: 'Alice', teamId: 't1' }),
        player({ id: 'b', name: 'Bob', teamId: 't1' }),
        player({ id: 'c', name: 'Carol', teamId: 't2' }),
      ],
    });
    render(
      <HostLobby roomCode="ABCD" state={state} onStartGame={vi.fn()} onSetCaptain={onSetCaptain} startError={null} />,
    );

    expect(screen.getByTestId('captain-badge-a')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('make-captain-b'));
    expect(onSetCaptain).toHaveBeenCalledWith('t1', 'b');
  });
});

describe('HostInProgress team mode', () => {
  const baseTeams = [
    team({ id: 't1', name: 'Red', memberIds: ['a'], connectedMemberIds: ['a'], captainId: 'a', actingCaptainId: 'a', score: 400 }),
    team({ id: 't2', name: 'Blue', memberIds: ['b'], connectedMemberIds: ['b'], captainId: 'b', actingCaptainId: 'b', score: 100 }),
  ];
  const basePlayers = [player({ id: 'a', name: 'Alice', teamId: 't1' }), player({ id: 'b', name: 'Bob', teamId: 't2' })];

  it('reassigns team control from the roster', async () => {
    const onOverrideControlTeam = vi.fn();
    const state = makeHostState({
      phase: 'BOARD_SELECT',
      teamMode: true,
      teams: baseTeams,
      players: basePlayers,
      controllingTeamId: 't1',
      round: { id: 'r1', type: 'JEOPARDY', order: 0, categories: [] },
    });
    render(
      <HostInProgress roomCode="ABCD" state={state} onOverrideControlTeam={onOverrideControlTeam} />,
    );

    expect(screen.getByTestId('team-controlling-t1')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('assign-control-team-t2'));
    expect(onOverrideControlTeam).toHaveBeenCalledWith('t2');
  });

  it('shows team standings on completion', () => {
    const state = makeHostState({
      phase: 'COMPLETE',
      teamMode: true,
      teams: baseTeams,
      players: basePlayers,
    });
    render(<HostInProgress roomCode="ABCD" state={state} />);

    expect(screen.getByTestId('host-final-standing-t1')).toHaveTextContent('Red');
    expect(screen.getByTestId('host-final-winner-t1')).toBeInTheDocument();
  });
});
