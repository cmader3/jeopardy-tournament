import { describe, expect, it } from 'vitest';
import { createInitialState, reduce } from './index.js';
import { projectBoard, projectContestant, projectHost } from '../projections/index.js';
import type { Board, GameState, Player } from '../models/index.js';

const NOW = 1_000_000;

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    score: 0,
    seatOrder: 0,
    connected: true,
    reconnectToken: 'token-p1',
    ...overrides,
  };
}

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: 'b-full',
    name: 'Full Game Board',
    includeDoubleJeopardy: true,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    rounds: [
      {
        id: 'r-j',
        type: 'JEOPARDY',
        order: 0,
        categories: [
          { id: 'c-j1', roundId: 'r-j', title: 'Science', order: 0 },
          { id: 'c-j2', roundId: 'r-j', title: 'History', order: 1 },
        ],
        clues: [
          {
            id: 'cl-dd',
            categoryId: 'c-j1',
            row: 0,
            value: 100,
            clueText: 'This element has the symbol O',
            answer: 'Oxygen',
            isDailyDouble: true,
          },
          {
            id: 'cl-normal',
            categoryId: 'c-j2',
            row: 0,
            value: 100,
            clueText: 'This planet is closest to the Sun',
            answer: 'Mercury',
            isDailyDouble: false,
          },
        ],
      },
      {
        id: 'r-dj',
        type: 'DOUBLE_JEOPARDY',
        order: 1,
        categories: [{ id: 'c-dj', roundId: 'r-dj', title: 'Arts', order: 0 }],
        clues: [
          {
            id: 'cl-dj',
            categoryId: 'c-dj',
            row: 0,
            value: 200,
            clueText: 'This painter cut off his own ear',
            answer: 'Van Gogh',
            isDailyDouble: false,
          },
        ],
      },
      {
        id: 'r-final',
        type: 'FINAL',
        order: 2,
        categories: [{ id: 'c-final', roundId: 'r-final', title: 'Literature', order: 0 }],
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

function setupLobby(): GameState {
  const board = makeBoard();
  const players = [
    makePlayer({ id: 'p1', name: 'Alice', seatOrder: 0, reconnectToken: 't1' }),
    makePlayer({ id: 'p2', name: 'Bob', seatOrder: 1, reconnectToken: 't2' }),
    makePlayer({ id: 'p3', name: 'Carol', seatOrder: 2, reconnectToken: 't3' }),
  ];
  return { ...createInitialState('s1', 'ROOM', board), players, phase: 'LOBBY' };
}

function expectPhase(state: GameState, phase: GameState['phase']) {
  expect(state.phase).toBe(phase);
}

function scoreOf(state: GameState, playerId: string) {
  return state.players.find((p) => p.id === playerId)!.score;
}

function controllerOf(state: GameState) {
  return state.controllingPlayerId;
}

function resolveToBoardSelect(state: GameState, winnerId: string, value: number, clueId: string): GameState {
  let next = state;
  next = reduce(next, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
  next = reduce(next, { type: 'BUZZ', playerId: winnerId }, { now: NOW + 1 }).state;
  expectPhase(next, 'BUZZED');
  next = reduce(next, { type: 'RULE_CORRECT' }, { now: NOW + 2 }).state;
  expect(next.players.find((p) => p.id === winnerId)!.score).toBe(value);
  expect(next.usedClueIds).toContain(clueId);
  expectPhase(next, 'BOARD_SELECT');
  return next;
}

describe('full game end-to-end', () => {
  it('plays a complete game through Jeopardy, Daily Double, Double Jeopardy, and Final with consistent scores and secrecy', () => {
    let state = setupLobby();

    // Start the game.
    state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
    expectPhase(state, 'BOARD_SELECT');
    expect(controllerOf(state)).toBe('p1');

    // Jeopardy normal clue: p1 selects, p2 buzzes and is ruled correct.
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl-normal', selectorId: 'p1' }, { now: NOW }).state;
    expectPhase(state, 'CLUE_REVEALED');
    expect(state.currentClueId).toBe('cl-normal');

    // Secrecy: host sees the answer, board and contestants do not.
    const hostView = projectHost(state, NOW);
    const boardView = projectBoard(state, NOW);
    expect(hostView.answer).toBe('Mercury');
    expect(boardView.answer).toBeNull();
    expect(projectContestant(state, 'p2', NOW).answer).toBeNull();

    state = resolveToBoardSelect(state, 'p2', 100, 'cl-normal');
    expect(controllerOf(state)).toBe('p2');
    expect(scoreOf(state, 'p2')).toBe(100);

    // Daily Double selected by controlling player p2.
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl-dd', selectorId: 'p2' }, { now: NOW }).state;
    expectPhase(state, 'DAILY_DOUBLE_WAGER');
    expect(state.currentClueId).toBe('cl-dd');

    // Board and other contestants see no clue/answer/wager during the wager phase.
    const ddWagerBoard = projectBoard(state, NOW);
    expect(ddWagerBoard.currentClueText).toBeNull();
    expect(ddWagerBoard.answer).toBeNull();
    expect(ddWagerBoard.dailyDoubleWager).toBeNull();
    expect(projectContestant(state, 'p1', NOW).dailyDoubleWager).toBeNull();
    expect(projectContestant(state, 'p3', NOW).dailyDoubleWager).toBeNull();

    // Controlling contestant p2 submits a valid wager.
    const ddWager = reduce(state, { type: 'SUBMIT_DD_WAGER', playerId: 'p2', amount: 100 }, { now: NOW });
    expect(ddWager.effects).toContainEqual({ type: 'BROADCAST_STATE' });
    state = ddWager.state;
    expect(state.dailyDoubleWager).toBe(100);

    // Only p2 sees the wager; board and other contestants still do not.
    expect(projectContestant(state, 'p2', NOW).dailyDoubleWager).toBe(100);
    expect(projectContestant(state, 'p1', NOW).dailyDoubleWager).toBeNull();
    expect(projectBoard(state, NOW).dailyDoubleWager).toBeNull();

    // Host reveals the Daily Double clue and rules it correct.
    state = reduce(state, { type: 'REVEAL_CLUE' }, { now: NOW }).state;
    expectPhase(state, 'DAILY_DOUBLE_CLUE');
    expect(projectBoard(state, NOW).currentClueText).toBe('This element has the symbol O');
    expect(projectBoard(state, NOW).answer).toBeNull();

    state = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 1 }).state;
    expectPhase(state, 'BOARD_SELECT');
    expect(scoreOf(state, 'p2')).toBe(200);
    expect(controllerOf(state)).toBe('p2');
    expect(state.usedClueIds).toContain('cl-dd');
    expect(projectBoard(state, NOW).answer).toBe('Oxygen');

    // Jeopardy round is complete; advance to Double Jeopardy.
    expect(state.roundIndex).toBe(0);
    state = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW }).state;
    expectPhase(state, 'ROUND_TRANSITION');
    expect(state.transitionTarget).toBe('DOUBLE_JEOPARDY');

    state = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW + 1 }).state;
    expectPhase(state, 'BOARD_SELECT');
    expect(state.roundIndex).toBe(1);
    // Trailing controller (lowest score, tie broken by seat order) is p1.
    expect(controllerOf(state)).toBe('p1');
    expect(projectBoard(state, NOW).round?.type).toBe('DOUBLE_JEOPARDY');
    expect(projectBoard(state, NOW).round?.categories[0].clues[0].value).toBe(200);

    // Double Jeopardy clue: p1 selects, p3 buzzes and is ruled incorrect, then p1 buzzes and is ruled correct.
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl-dj', selectorId: 'p1' }, { now: NOW }).state;
    expectPhase(state, 'CLUE_REVEALED');

    state = reduce(state, { type: 'ARM_BUZZERS' }, { now: NOW }).state;
    state = reduce(state, { type: 'BUZZ', playerId: 'p3' }, { now: NOW + 1 }).state;
    expectPhase(state, 'BUZZED');
    state = reduce(state, { type: 'RULE_INCORRECT', playerId: 'p3' }, { now: NOW + 2 }).state;
    expectPhase(state, 'BUZZERS_ARMED');
    expect(scoreOf(state, 'p3')).toBe(-200);
    expect(state.lockedOutPlayerIds).toContain('p3');

    // A locked-out contestant cannot win the re-arm.
    const rearmBuzz = reduce(state, { type: 'BUZZ', playerId: 'p3' }, { now: NOW + 3 });
    expect(rearmBuzz.effects).toContainEqual({ type: 'INTENT_REJECTED', reason: expect.stringContaining('locked out') });

    state = reduce(state, { type: 'BUZZ', playerId: 'p1' }, { now: NOW + 4 }).state;
    expectPhase(state, 'BUZZED');
    state = reduce(state, { type: 'RULE_CORRECT' }, { now: NOW + 5 }).state;
    expectPhase(state, 'BOARD_SELECT');
    expect(scoreOf(state, 'p1')).toBe(200);

    // Double Jeopardy round complete; advance to Final Jeopardy.
    state = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW }).state;
    expectPhase(state, 'ROUND_TRANSITION');
    expect(state.transitionTarget).toBe('FINAL');
    state = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW + 1 }).state;
    expectPhase(state, 'FINAL_INTRO');
    expect(state.roundIndex).toBe(2);
    expect(projectBoard(state, NOW).round?.type).toBe('FINAL');

    // Eligibility is exactly positive scores: p1 and p2 eligible, p3 not.
    const finalIntroBoard = projectBoard(state, NOW);
    expect(finalIntroBoard.finalEligiblePlayerIds.sort()).toEqual(['p1', 'p2']);
    expect(finalIntroBoard.players.find((p) => p.id === 'p3')!.score).toBeLessThanOrEqual(0);

    // Host opens Final wagers.
    state = reduce(state, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW }).state;
    expectPhase(state, 'FINAL_WAGER');

    // Wagers are secret from board and other contestants.
    state = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: 200 }, { now: NOW }).state;
    state = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p2', amount: 150 }, { now: NOW }).state;
    expectPhase(state, 'FINAL_CLUE');
    expect(state.finalWagers).toEqual({ p1: 200, p2: 150 });

    const finalWagerBoard = projectBoard(state, NOW);
    expect(finalWagerBoard).not.toHaveProperty('finalWagers');
    expect(finalWagerBoard.finalWagerSubmissionStatus).toEqual({ p1: true, p2: true, p3: false });
    expect(finalWagerBoard).not.toHaveProperty('finalAnswers');
    expect(projectContestant(state, 'p1', NOW).myFinalWager).toBe(200);
    expect(projectContestant(state, 'p2', NOW).myFinalWager).toBe(150);
    expect(projectContestant(state, 'p3', NOW).myFinalWager).toBeNull();

    // Final answers are secret during the answer phase.
    state = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: 'Tolkien' }, { now: NOW + 1 }).state;
    state = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p2', answer: 'Rowling' }, { now: NOW + 2 }).state;
    expect(state.finalAnswers).toEqual({ p1: 'Tolkien', p2: 'Rowling' });

    const finalClueBoard = projectBoard(state, NOW);
    expect(finalClueBoard.currentClueText).toBe('He wrote The Hobbit');
    expect(finalClueBoard).not.toHaveProperty('finalAnswers');
    expect(projectContestant(state, 'p1', NOW).myFinalAnswer).toBe('Tolkien');
    expect(projectContestant(state, 'p2', NOW).myFinalAnswer).toBe('Rowling');
    expect(projectContestant(state, 'p3', NOW).myFinalAnswer).toBeNull();

    // Expire the Final clue window to enter the reveal.
    state = reduce(state, { type: 'TIME_EXPIRE' }, { now: NOW + 40_000 }).state;
    expectPhase(state, 'FINAL_REVEAL');
    // Lowest-scoring eligible players first, tie broken by seat order.
    expect(state.finalRevealOrder).toEqual(['p1', 'p2']);

    // Reveal p1 answer -> rule correct -> reveal wager.
    state = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW }).state;
    expect(state.finalRevealStep).toBe('RULE');
    expect(projectBoard(state, NOW).finalRevealedAnswers).toHaveProperty('p1', 'Tolkien');
    expect(projectBoard(state, NOW).finalRevealedWagers).toEqual({});

    state = reduce(state, { type: 'RULE_FINAL_CORRECT' }, { now: NOW + 1 }).state;
    expect(state.finalRevealStep).toBe('WAGER');
    expect(scoreOf(state, 'p1')).toBe(400);

    state = reduce(state, { type: 'REVEAL_FINAL_WAGER' }, { now: NOW + 2 }).state;
    expect(state.finalRevealIndex).toBe(1);
    expect(state.finalRevealStep).toBe('ANSWER');
    expect(projectBoard(state, NOW).finalRevealedWagers).toHaveProperty('p1', 200);

    // Reveal p2 answer -> rule incorrect -> reveal wager.
    state = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW }).state;
    state = reduce(state, { type: 'RULE_FINAL_INCORRECT' }, { now: NOW + 1 }).state;
    expect(scoreOf(state, 'p2')).toBe(50);
    expect(state.finalRevealStep).toBe('WAGER');
    expect(projectBoard(state, NOW).finalRevealedWagers).toHaveProperty('p2', 150);
    state = reduce(state, { type: 'REVEAL_FINAL_WAGER' }, { now: NOW + 2 }).state;
    expectPhase(state, 'COMPLETE');

    // Final standings are consistent across all projections.
    const finalBoard = projectBoard(state, NOW);
    const finalHost = projectHost(state, NOW);
    const finalP3 = projectContestant(state, 'p3', NOW);
    expect(finalBoard.players.map((p) => ({ id: p.id, score: p.score }))).toEqual([
      { id: 'p1', score: 400 },
      { id: 'p2', score: 50 },
      { id: 'p3', score: -200 },
    ]);
    expect(finalHost.players.map((p) => p.score)).toEqual([400, 50, -200]);
    expect(finalP3.players.map((p) => p.score)).toEqual([400, 50, -200]);
  });

  it('plays a full no-Double-Jeopardy game from single round to Final with consistent standings', () => {
    const noDjBoard: Board = {
      ...makeBoard(),
      includeDoubleJeopardy: false,
      rounds: [
        {
          id: 'r-j',
          type: 'JEOPARDY',
          order: 0,
          categories: [{ id: 'c-j', roundId: 'r-j', title: 'Science', order: 0 }],
          clues: [
            {
              id: 'cl-only',
              categoryId: 'c-j',
              row: 0,
              value: 100,
              clueText: 'This planet is closest to the Sun',
              answer: 'Mercury',
              isDailyDouble: false,
            },
          ],
        },
        {
          id: 'r-final',
          type: 'FINAL',
          order: 1,
          categories: [{ id: 'c-final', roundId: 'r-final', title: 'Literature', order: 0 }],
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
    };
    const players = [
      makePlayer({ id: 'p1', name: 'Alice', seatOrder: 0, reconnectToken: 't1' }),
      makePlayer({ id: 'p2', name: 'Bob', seatOrder: 1, reconnectToken: 't2' }),
    ];
    let state: GameState = { ...createInitialState('s2', 'NODJ', noDjBoard), players, phase: 'LOBBY' };

    state = reduce(state, { type: 'START_GAME' }, { now: NOW }).state;
    expectPhase(state, 'BOARD_SELECT');
    expect(state.board.rounds[state.roundIndex].type).toBe('JEOPARDY');

    // Play the single Jeopardy clue.
    state = reduce(state, { type: 'SELECT_CLUE', clueId: 'cl-only', selectorId: 'p1' }, { now: NOW }).state;
    state = resolveToBoardSelect(state, 'p2', 100, 'cl-only');
    expect(state.usedClueIds).toContain('cl-only');

    // Advancing the round skips any Double Jeopardy round and lands directly in Final.
    state = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW }).state;
    expectPhase(state, 'ROUND_TRANSITION');
    expect(state.transitionTarget).toBe('FINAL');
    state = reduce(state, { type: 'ADVANCE_ROUND' }, { now: NOW + 1 }).state;
    expectPhase(state, 'FINAL_INTRO');
    expect(state.roundIndex).toBeGreaterThan(0);
    expect(state.board.rounds[state.roundIndex].type).toBe('FINAL');

    // No Double Jeopardy phase ever appears.
    expect(state.phase).not.toBe('DOUBLE_JEOPARDY');
    expect(projectBoard(state, NOW).round?.type).toBe('FINAL');

    // Complete a minimal Final with two eligible contestants.
    state = reduce(state, { type: 'OPEN_FINAL_WAGERS' }, { now: NOW }).state;
    expectPhase(state, 'FINAL_WAGER');
    state = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p1', amount: 0 }, { now: NOW }).state;
    state = reduce(state, { type: 'SUBMIT_FINAL_WAGER', playerId: 'p2', amount: 100 }, { now: NOW }).state;
    expectPhase(state, 'FINAL_CLUE');

    state = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p1', answer: 'Tolkien' }, { now: NOW + 1 }).state;
    state = reduce(state, { type: 'SUBMIT_FINAL_ANSWER', playerId: 'p2', answer: 'Tolkien' }, { now: NOW + 2 }).state;
    state = reduce(state, { type: 'TIME_EXPIRE' }, { now: NOW + 40_000 }).state;
    expectPhase(state, 'FINAL_REVEAL');

    state = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW }).state;
    state = reduce(state, { type: 'RULE_FINAL_CORRECT' }, { now: NOW + 1 }).state;
    state = reduce(state, { type: 'REVEAL_FINAL_WAGER' }, { now: NOW + 2 }).state;
    state = reduce(state, { type: 'REVEAL_FINAL_ANSWER' }, { now: NOW }).state;
    state = reduce(state, { type: 'RULE_FINAL_CORRECT' }, { now: NOW + 1 }).state;
    state = reduce(state, { type: 'REVEAL_FINAL_WAGER' }, { now: NOW + 2 }).state;
    expectPhase(state, 'COMPLETE');

    const scores = projectBoard(state, NOW).players.map((p) => ({ id: p.id, score: p.score }));
    expect(scores).toContainEqual({ id: 'p2', score: 200 });
    expect(scores).toContainEqual({ id: 'p1', score: 0 });
  });
});
