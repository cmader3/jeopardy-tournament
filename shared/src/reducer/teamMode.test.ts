import { describe, it, expect } from 'vitest';
import { createInitialState, reduce, getActingCaptainId } from './index.js';
import { projectContestant } from '../projections/index.js';
import type { Board, GameState, Player, Team } from '../models/index.js';

function makeBoard(): Board {
  const jeopardyClues = [
    { id: 'cl1', categoryId: 'c1', row: 0, value: 100, clueText: 'Q1', answer: 'A1', isDailyDouble: false },
    { id: 'cl2', categoryId: 'c1', row: 1, value: 200, clueText: 'Q2', answer: 'A2', isDailyDouble: true },
    { id: 'cl3', categoryId: 'c2', row: 0, value: 100, clueText: 'Q3', answer: 'A3', isDailyDouble: false },
  ];
  const finalClue = {
    id: 'cl-final',
    categoryId: 'c3',
    row: 0,
    value: null,
    clueText: 'Final Q',
    answer: 'Final A',
    isDailyDouble: false,
  };
  return {
    id: 'b1',
    name: 'Team Board',
    includeDoubleJeopardy: false,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    rounds: [
      {
        id: 'r1',
        type: 'JEOPARDY',
        order: 0,
        categories: [
          { id: 'c1', title: 'Cat 1', order: 0 } as never,
          { id: 'c2', title: 'Cat 2', order: 1 } as never,
        ],
        clues: jeopardyClues,
      },
      {
        id: 'r2',
        type: 'FINAL',
        order: 1,
        categories: [{ id: 'c3', title: 'Final Cat', order: 0 } as never],
        clues: [finalClue],
      },
    ],
  };
}

function player(overrides: Partial<Player>): Player {
  return {
    id: 'p',
    name: 'P',
    score: 0,
    seatOrder: 0,
    connected: true,
    reconnectToken: 't',
    teamId: null,
    ...overrides,
  };
}

const NOW = 1_000_000;

const RED = { id: 'team-red', name: 'Red' };
const BLUE = { id: 'team-blue', name: 'Blue' };

// A two-team game (Red: Alice[captain], Bob; Blue: Carol[captain]) in BOARD_SELECT.
function setupTeamGame(overrides: Partial<GameState> = {}): GameState {
  let state = createInitialState('s1', 'ABCD', makeBoard());
  state = reduce(state, { type: 'CONFIGURE_TEAMS', enabled: true, teams: [RED, BLUE] }, { now: NOW }).state;
  state = reduce(state, { type: 'JOIN', player: player({ id: 'a', name: 'Alice', seatOrder: 0, reconnectToken: 'ta' }) }, { now: NOW }).state;
  state = reduce(state, { type: 'JOIN', player: player({ id: 'b', name: 'Bob', seatOrder: 1, reconnectToken: 'tb' }) }, { now: NOW }).state;
  state = reduce(state, { type: 'JOIN', player: player({ id: 'c', name: 'Carol', seatOrder: 2, reconnectToken: 'tc' }) }, { now: NOW }).state;
  state = reduce(state, { type: 'CHOOSE_TEAM', playerId: 'a', teamId: RED.id }, { now: NOW }).state;
  state = reduce(state, { type: 'CHOOSE_TEAM', playerId: 'b', teamId: RED.id }, { now: NOW }).state;
  state = reduce(state, { type: 'CHOOSE_TEAM', playerId: 'c', teamId: BLUE.id }, { now: NOW }).state;
  state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
  return { ...state, ...overrides };
}

function teamById(state: GameState, id: string): Team {
  const team = state.teams.find((t) => t.id === id);
  if (!team) throw new Error(`team ${id} not found`);
  return team;
}

describe('CONFIGURE_TEAMS', () => {
  it('enables team mode and stores the teams', () => {
    const state = createInitialState('s1', 'ABCD', makeBoard());
    const result = reduce(state, { type: 'CONFIGURE_TEAMS', enabled: true, teams: [RED, BLUE] }, { now: NOW });
    expect(result.state.teamMode).toBe(true);
    expect(result.state.teams.map((t) => t.name)).toEqual(['Red', 'Blue']);
    expect(result.state.teams.every((t) => t.score === 0)).toBe(true);
  });

  it('rejects fewer than two teams', () => {
    const state = createInitialState('s1', 'ABCD', makeBoard());
    const result = reduce(state, { type: 'CONFIGURE_TEAMS', enabled: true, teams: [RED] }, { now: NOW });
    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('between') });
  });

  it('rejects more than six teams', () => {
    const state = createInitialState('s1', 'ABCD', makeBoard());
    const teams = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, name: `T${i}` }));
    const result = reduce(state, { type: 'CONFIGURE_TEAMS', enabled: true, teams }, { now: NOW });
    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('between') });
  });

  it('disabling clears teams and membership', () => {
    let state = createInitialState('s1', 'ABCD', makeBoard());
    state = reduce(state, { type: 'CONFIGURE_TEAMS', enabled: true, teams: [RED, BLUE] }, { now: NOW }).state;
    state = reduce(state, { type: 'JOIN', player: player({ id: 'a', name: 'Alice', reconnectToken: 'ta' }) }, { now: NOW }).state;
    state = reduce(state, { type: 'CHOOSE_TEAM', playerId: 'a', teamId: RED.id }, { now: NOW }).state;
    const result = reduce(state, { type: 'CONFIGURE_TEAMS', enabled: false, teams: [] }, { now: NOW });
    expect(result.state.teamMode).toBe(false);
    expect(result.state.teams).toEqual([]);
    expect(result.state.players[0].teamId).toBeNull();
  });
});

describe('CHOOSE_TEAM and captains', () => {
  it('makes the first player to choose a team its captain', () => {
    let state = createInitialState('s1', 'ABCD', makeBoard());
    state = reduce(state, { type: 'CONFIGURE_TEAMS', enabled: true, teams: [RED, BLUE] }, { now: NOW }).state;
    state = reduce(state, { type: 'JOIN', player: player({ id: 'a', name: 'Alice', seatOrder: 0, reconnectToken: 'ta' }) }, { now: NOW }).state;
    state = reduce(state, { type: 'JOIN', player: player({ id: 'b', name: 'Bob', seatOrder: 1, reconnectToken: 'tb' }) }, { now: NOW }).state;
    state = reduce(state, { type: 'CHOOSE_TEAM', playerId: 'a', teamId: RED.id }, { now: NOW }).state;
    state = reduce(state, { type: 'CHOOSE_TEAM', playerId: 'b', teamId: RED.id }, { now: NOW }).state;
    expect(teamById(state, RED.id).captainId).toBe('a');
  });

  it('reassigns the captain when the captain leaves the lobby', () => {
    let state = setupTeamGameLobby();
    // Alice (captain of Red) leaves.
    state = reduce(state, { type: 'LEAVE', playerId: 'a' }, { now: NOW }).state;
    expect(teamById(state, RED.id).captainId).toBe('b');
  });

  it('SET_CAPTAIN lets the host reassign the captain', () => {
    const state = setupTeamGame();
    const result = reduce(state, { type: 'SET_CAPTAIN', teamId: RED.id, playerId: 'b' }, { now: NOW });
    expect(teamById(result.state, RED.id).captainId).toBe('b');
  });

  it('rejects SET_CAPTAIN for a player not on the team', () => {
    const state = setupTeamGame();
    const result = reduce(state, { type: 'SET_CAPTAIN', teamId: RED.id, playerId: 'c' }, { now: NOW });
    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('not on this team') });
  });

  it('acting captain falls back to a connected teammate when the captain is offline', () => {
    let state = setupTeamGame();
    state = reduce(state, { type: 'DISCONNECT', playerId: 'a' }, { now: NOW }).state;
    // Title stays with Alice, but Bob acts.
    expect(teamById(state, RED.id).captainId).toBe('a');
    expect(getActingCaptainId(state, RED.id)).toBe('b');
  });
});

function setupTeamGameLobby(): GameState {
  let state = createInitialState('s1', 'ABCD', makeBoard());
  state = reduce(state, { type: 'CONFIGURE_TEAMS', enabled: true, teams: [RED, BLUE] }, { now: NOW }).state;
  state = reduce(state, { type: 'JOIN', player: player({ id: 'a', name: 'Alice', seatOrder: 0, reconnectToken: 'ta' }) }, { now: NOW }).state;
  state = reduce(state, { type: 'JOIN', player: player({ id: 'b', name: 'Bob', seatOrder: 1, reconnectToken: 'tb' }) }, { now: NOW }).state;
  state = reduce(state, { type: 'JOIN', player: player({ id: 'c', name: 'Carol', seatOrder: 2, reconnectToken: 'tc' }) }, { now: NOW }).state;
  state = reduce(state, { type: 'CHOOSE_TEAM', playerId: 'a', teamId: RED.id }, { now: NOW }).state;
  state = reduce(state, { type: 'CHOOSE_TEAM', playerId: 'b', teamId: RED.id }, { now: NOW }).state;
  state = reduce(state, { type: 'CHOOSE_TEAM', playerId: 'c', teamId: BLUE.id }, { now: NOW }).state;
  return state;
}

describe('START_GAME in team mode', () => {
  it('rejects start when a team has no players', () => {
    let state = createInitialState('s1', 'ABCD', makeBoard());
    state = reduce(state, { type: 'CONFIGURE_TEAMS', enabled: true, teams: [RED, BLUE] }, { now: NOW }).state;
    state = reduce(state, { type: 'JOIN', player: player({ id: 'a', name: 'Alice', reconnectToken: 'ta' }) }, { now: NOW }).state;
    state = reduce(state, { type: 'CHOOSE_TEAM', playerId: 'a', teamId: RED.id }, { now: NOW }).state;
    const result = reduce(state, { type: 'START_GAME' }, { now: NOW });
    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('at least one contestant') });
  });

  it('assigns board control to a team', () => {
    const state = setupTeamGame();
    expect(state.phase).toBe('BOARD_SELECT');
    expect(state.controllingTeamId).toBe(RED.id);
    expect(state.controllingPlayerId).toBeNull();
  });
});

describe('team scoring and lockout', () => {
  function armClue(state: GameState, clueId: string): GameState {
    let s = reduce(state, { type: 'SELECT_CLUE', clueId, hostOverride: true }, { now: NOW }).state;
    s = reduce(s, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    return s;
  }

  it('correct answer scores the team, not the individual, and gives the team control', () => {
    let state = setupTeamGame();
    state = armClue(state, 'cl1');
    state = reduce(state, { type: 'BUZZ', playerId: 'a' }, { now: NOW }).state;
    state = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW }).state;

    expect(teamById(state, RED.id).score).toBe(100);
    expect(state.players.find((p) => p.id === 'a')?.score).toBe(0);
    expect(state.controllingTeamId).toBe(RED.id);
  });

  it('a wrong answer locks the whole team until the next clue', () => {
    let state = setupTeamGame();
    state = armClue(state, 'cl1');
    state = reduce(state, { type: 'BUZZ', playerId: 'a' }, { now: NOW }).state;
    state = reduce(state, { type: 'RULE_INCORRECT', playerId: 'a' }, { now: NOW }).state;

    expect(teamById(state, RED.id).score).toBe(-100);
    expect(state.lockedOutTeamIds).toContain(RED.id);

    // Bob (Red) is locked out; Carol (Blue) can buzz.
    const bobBuzz = reduce(state, { type: 'BUZZ', playerId: 'b' }, { now: NOW });
    expect(bobBuzz.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('locked out') });
    const carolBuzz = reduce(state, { type: 'BUZZ', playerId: 'c' }, { now: NOW });
    expect(carolBuzz.state.buzzWinnerId).toBe('c');
  });

  it('resolves the clue when the only remaining team is locked out', () => {
    // Remove Blue so only Red remains, then a Red wrong answer ends the clue.
    let state = setupTeamGame();
    state = armClue(state, 'cl1');
    state = reduce(state, { type: 'BUZZ', playerId: 'c' }, { now: NOW }).state; // Blue buzzes
    // Blue wrong -> Blue locked; Red still eligible, re-arm.
    state = reduce(state, { type: 'RULE_INCORRECT', playerId: 'c' }, { now: NOW }).state;
    expect(state.phase).toBe('BUZZERS_ARMED');
    state = reduce(state, { type: 'BUZZ', playerId: 'a' }, { now: NOW }).state; // Red buzzes
    state = reduce(state, { type: 'RULE_INCORRECT', playerId: 'a' }, { now: NOW }).state;
    // Both teams now locked -> clue resolves.
    expect(state.phase).toBe('BOARD_SELECT');
    expect(state.usedClueIds).toContain('cl1');
  });
});

describe('Daily Double in team mode', () => {
  it('lets the controlling team captain wager and scores the team', () => {
    let state = setupTeamGame();
    // Give Red a lead so the wager cap comes from the team score.
    state = { ...state, teams: state.teams.map((t) => (t.id === RED.id ? { ...t, score: 500 } : t)) };
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl2', hostOverride: true }, { now: NOW }).state;
    expect(state.phase).toBe('DAILY_DOUBLE_WAGER');

    const wrongWagerer = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: 'b', amount: 300 }, { now: NOW });
    expect(wrongWagerer.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('controlling') });

    state = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: 'a', amount: 500 }, { now: NOW }).state;
    state = reduce(state, { type: 'REVEAL_CLUE' }, { now: NOW }).state;
    state = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW }).state;

    expect(teamById(state, RED.id).score).toBe(1000);
    expect(state.controllingTeamId).toBe(RED.id);
  });

  it('a temporary captain can take the Daily Double when the captain is offline', () => {
    let state = setupTeamGame();
    state = reduce(state, { type: 'DISCONNECT', playerId: 'a' }, { now: NOW }).state;
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl2', hostOverride: true }, { now: NOW }).state;
    // Bob is the acting captain now.
    const result = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: 'b', amount: 200 }, { now: NOW });
    expect(result.state.dailyDoubleWager).toBe(200);
  });
});

describe('OVERRIDE_CONTROL_TEAM', () => {
  it('reassigns board control to another team', () => {
    const state = setupTeamGame();
    const result = reduce(state, { type: 'OVERRIDE_CONTROL_TEAM', teamId: BLUE.id }, { now: NOW });
    expect(result.state.controllingTeamId).toBe(BLUE.id);
  });
});

describe('RESTART_GAME in team mode', () => {
  it('keeps teams and memberships but resets scores', () => {
    let state = setupTeamGame();
    state = { ...state, teams: state.teams.map((t) => ({ ...t, score: 400 })) };
    state = reduce(state, { type: 'RESTART_GAME' }, { now: NOW }).state;
    expect(state.teamMode).toBe(true);
    expect(state.teams.every((t) => t.score === 0)).toBe(true);
    expect(state.players.find((p) => p.id === 'a')?.teamId).toBe(RED.id);
    expect(state.phase).toBe('LOBBY');
  });
});

describe('Final Jeopardy in team mode', () => {
  // Build a team game sitting at FINAL_INTRO with Red=300, Blue=100.
  function setupFinal(): GameState {
    const base = setupTeamGame();
    return {
      ...base,
      phase: 'FINAL_INTRO',
      roundIndex: 1,
      teams: base.teams.map((t) =>
        t.id === RED.id ? { ...t, score: 300 } : t.id === BLUE.id ? { ...t, score: 100 } : t,
      ),
    };
  }

  it('only lets the team captain submit wager and answer, keyed by team, and reveals by team score', () => {
    let state = setupFinal();
    state = reduce(state, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW }).state;
    expect(state.phase).toBe('FINAL_WAGER');

    // A non-captain teammate cannot wager for the team.
    const bobWager = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'b', amount: 100 }, { now: NOW });
    expect(bobWager.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('captain') });

    state = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'a', amount: 300 }, { now: NOW }).state;
    state = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'c', amount: 100 }, { now: NOW }).state;
    expect(state.finalWagers[RED.id]).toBe(300);
    expect(state.finalWagers[BLUE.id]).toBe(100);

    state = reduce(state, { type: 'FORCE_FINAL_WAGERS' }, { now: NOW }).state;
    expect(state.phase).toBe('FINAL_CLUE');
    expect(state.deadline).toBeNull();
    state = reduce(state, { type: 'START_FINAL_TIMER' }, { now: NOW }).state;
    state = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'a', answer: 'Red answer' }, { now: NOW }).state;
    state = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'c', answer: 'Blue answer' }, { now: NOW }).state;
    expect(state.finalAnswers[RED.id]).toBe('Red answer');
    expect(state.finalAnswers[BLUE.id]).toBe('Blue answer');

    state = reduce(state, { type: 'TIME_EXPIRE' }, { now: NOW + 60_000 }).state;
    expect(state.phase).toBe('FINAL_REVEAL');
    // Lowest team score first.
    expect(state.finalRevealOrder).toEqual([BLUE.id, RED.id]);

    // Rule Blue correct -> Blue team gains its wager.
    state = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW }).state;
    state = reduce(state, { type: 'RULE_FINAL_CORRECT' }, { now: NOW }).state;
    expect(teamById(state, BLUE.id).score).toBe(200);
  });

  it('rejects a wager above the team score', () => {
    let state = setupFinal();
    state = reduce(state, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW }).state;
    const result = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'a', amount: 400 }, { now: NOW });
    expect(result.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('between 0 and $300') });
  });
});

describe('team projections', () => {
  it('marks the acting captain of the controlling team as the controlling player', () => {
    const state = setupTeamGame();
    const alice = projectContestant(state, 'a', NOW);
    const bob = projectContestant(state, 'b', NOW);
    expect(alice.isControllingPlayer).toBe(true);
    expect(alice.isCaptain).toBe(true);
    expect(bob.isControllingPlayer).toBe(false);
    expect(alice.teamName).toBe('Red');
  });

  it('flags a temporary captain and exposes team info', () => {
    let state = setupTeamGame();
    state = reduce(state, { type: 'DISCONNECT', playerId: 'a' }, { now: NOW }).state;
    const bob = projectContestant(state, 'b', NOW);
    expect(bob.isActingCaptain).toBe(true);
    expect(bob.isTemporaryCaptain).toBe(true);
    expect(bob.isCaptain).toBe(false);
  });

  it('reports team lockout to teammates', () => {
    let state = setupTeamGame();
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl1', hostOverride: true }, { now: NOW }).state;
    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'a' }, { now: NOW }).state;
    state = reduce(state, { type: 'RULE_INCORRECT', playerId: 'a' }, { now: NOW }).state;
    const bob = projectContestant(state, 'b', NOW);
    expect(bob.isTeamLockedOut).toBe(true);
    expect(bob.isLockedOut).toBe(true);
  });
});
