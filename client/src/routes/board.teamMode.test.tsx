import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { useCallback } from 'react';
import { BoardRoute } from './board.js';
import type { BoardView, ProjectedTeam } from '@jeopardy/shared';

vi.mock('../socket/useSocket.js', () => ({
  useSocket: vi.fn(),
  __esModule: true,
}));

vi.mock('../hooks/useServerTime.js', () => ({
  useServerTime: () => 0,
  __esModule: true,
}));

vi.mock('../hooks/useBoardAudio.js', () => ({
  useBoardAudio: () => {
    const playCue = useCallback(() => {}, []);
    const setThinkMusic = useCallback(() => {}, []);
    const toggleMute = useCallback(() => {}, []);
    return { muted: false, toggleMute, playCue, setThinkMusic };
  },
  __esModule: true,
}));

import { useSocket } from '../socket/useSocket.js';

beforeEach(() => {
  localStorage.clear();
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

function makeBoardState(overrides: Partial<BoardView> = {}): BoardView {
  return {
    phase: 'BOARD_SELECT',
    roomCode: 'ABCD',
    roundIndex: 0,
    players: [
      { id: 'a', name: 'Alice', score: 0, connected: true, teamId: 't1' },
      { id: 'b', name: 'Bob', score: 0, connected: true, teamId: 't2' },
    ],
    teamMode: true,
    teams: [
      team({ id: 't1', name: 'Red', memberIds: ['a'], connectedMemberIds: ['a'], captainId: 'a', actingCaptainId: 'a', score: 400 }),
      team({ id: 't2', name: 'Blue', memberIds: ['b'], connectedMemberIds: ['b'], captainId: 'b', actingCaptainId: 'b', score: 100 }),
    ],
    round: { id: 'r1', type: 'JEOPARDY', order: 0, categories: [{ id: 'c1', title: 'Science', order: 0, clues: [{ id: 'cl1', categoryId: 'c1', row: 0, value: 100 }] }] },
    usedClueIds: [],
    currentClueId: null,
    currentClueText: null,
    controllingPlayerId: null,
    controllingTeamId: 't1',
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

async function showBoard(state: BoardView) {
  (useSocket as ReturnType<typeof vi.fn>).mockReturnValue({ connected: true, error: null, data: state });
  render(
    <MemoryRouter>
      <BoardRoute />
    </MemoryRouter>,
  );
  await userEvent.type(screen.getByLabelText(/room code/i), 'ABCD');
  await userEvent.click(screen.getByRole('button', { name: /view board/i }));
}

describe('Board team mode', () => {
  it('renders a team scoreboard with team names and scores', async () => {
    await showBoard(makeBoardState());

    const scoreboard = await screen.findByTestId('team-scoreboard');
    expect(scoreboard).toBeInTheDocument();
    const names = screen.getAllByTestId('team-score-name').map((n) => n.textContent);
    expect(names).toEqual(['Red', 'Blue']);
    expect(screen.queryByTestId('scoreboard')).not.toBeInTheDocument();
  });

  it('shows team scores on the between-round screen', async () => {
    await showBoard(makeBoardState({ phase: 'ROUND_TRANSITION', transitionTarget: 'FINAL' }));

    const scores = await screen.findByTestId('between-round-scores');
    expect(scores).toHaveTextContent('Red');
    expect(scores).toHaveTextContent('Blue');
  });

  it('shows the buzzed-in player with their team name in parentheses', async () => {
    await showBoard(
      makeBoardState({
        phase: 'BUZZED',
        currentClueId: 'cl1',
        currentClueText: 'H2O is this compound',
        buzzWinnerId: 'b',
      }),
    );

    expect(await screen.findByTestId('buzzed-player-name')).toHaveTextContent('Bob (Blue)');
  });

  it('renders team names in the final standings', async () => {
    await showBoard(
      makeBoardState({
        phase: 'COMPLETE',
        roundIndex: 1,
        round: { id: 'r2', type: 'FINAL', order: 1, categories: [] },
      }),
    );

    expect(await screen.findByTestId('final-standing-name-t1')).toHaveTextContent('Red');
    expect(screen.getByTestId('final-standing-name-t2')).toHaveTextContent('Blue');
  });
});
