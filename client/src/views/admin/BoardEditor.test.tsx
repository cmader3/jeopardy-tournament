import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardEditor } from './BoardEditor.js';
import type { BoardApiClient, BoardWithRounds, Clue } from '../../api/boards.js';

function makeClue(overrides: Partial<Clue> = {}): Clue {
  return {
    id: `clue-${overrides.row ?? 0}`,
    categoryId: 'cat-1',
    value: overrides.value ?? 100,
    row: overrides.row ?? 0,
    clueText: overrides.clueText ?? '',
    answer: overrides.answer ?? '',
    isDailyDouble: false,
  };
}

function makeBoard(overrides: Partial<BoardWithRounds> = {}): BoardWithRounds {
  return {
    id: 'board-1',
    name: 'Science Trivia',
    includeDoubleJeopardy: overrides.includeDoubleJeopardy ?? false,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    createdAt: '2026-06-30T12:00:00.000Z',
    updatedAt: '2026-06-30T12:30:00.000Z',
    rounds: overrides.rounds ?? [
      {
        id: 'round-1',
        boardId: 'board-1',
        type: 'JEOPARDY',
        order: 0,
        categories: [
          {
            id: 'cat-1',
            roundId: 'round-1',
            title: 'Science',
            order: 0,
            clues: [makeClue({ clueText: 'H2O?', answer: 'Water' })],
          },
          {
            id: 'cat-2',
            roundId: 'round-1',
            title: 'History',
            order: 1,
            clues: [makeClue({ row: 0, clueText: '1776?', answer: 'Independence' })],
          },
        ],
      },
      {
        id: 'round-final',
        boardId: 'board-1',
        type: 'FINAL',
        order: 1,
        categories: [
          {
            id: 'cat-final',
            roundId: 'round-final',
            title: 'Final Category',
            order: 0,
            clues: [makeClue({ row: 0, value: null, clueText: 'Final?', answer: 'Yes' })],
          },
        ],
      },
    ],
  };
}

function makeBoardWithDouble(): BoardWithRounds {
  const base = makeBoard({ includeDoubleJeopardy: true });
  return {
    ...base,
    includeDoubleJeopardy: true,
    rounds: [
      ...base.rounds.filter((round) => round.type !== 'FINAL'),
      {
        id: 'round-double',
        boardId: 'board-1',
        type: 'DOUBLE_JEOPARDY',
        order: 1,
        categories: [
          {
            id: 'cat-double',
            roundId: 'round-double',
            title: 'Art',
            order: 0,
            clues: [makeClue({ clueText: 'Painter?', answer: 'Monet' })],
          },
        ],
      },
      {
        id: 'round-final',
        boardId: 'board-1',
        type: 'FINAL',
        order: 2,
        categories: [
          {
            id: 'cat-final',
            roundId: 'round-final',
            title: 'Final Category',
            order: 0,
            clues: [makeClue({ row: 0, value: null, clueText: 'Final?', answer: 'Yes' })],
          },
        ],
      },
    ],
  };
}

function createMockApi(board: BoardWithRounds, updates: Partial<BoardApiClient> = {}): BoardApiClient {
  return {
    getBoards: vi.fn(),
    getBoard: vi.fn(),
    createBoard: vi.fn(),
    updateBoard: vi.fn().mockImplementation((_id, input) =>
      Promise.resolve({
        ...input,
        id: board.id,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      } as BoardWithRounds),
    ),
    deleteBoard: vi.fn(),
    ...updates,
  } as BoardApiClient;
}

function renderEditor(props: Partial<Parameters<typeof BoardEditor>[0]> = {}) {
  const board = makeBoard();
  const onBack = vi.fn();
  const api = createMockApi(board);

  render(
    <BoardEditor
      board={board}
      token="test-token"
      api={api}
      onBack={onBack}
      {...props}
    />,
  );

  return { board, onBack, api };
}

describe('BoardEditor', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the board name and metadata', () => {
    renderEditor();

    expect(screen.getByRole('heading', { name: 'Science Trivia' })).toBeInTheDocument();
    expect(screen.getByText(/2 categories/i)).toBeInTheDocument();
    expect(screen.getByText(/1 row/i)).toBeInTheDocument();
  });

  it('calls onBack when the back button is activated', async () => {
    const { onBack } = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: /back to library/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('saves the updated board name', async () => {
    const { api } = renderEditor();

    const nameInput = screen.getByLabelText(/board name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated Name');

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    expect(api.updateBoard).toHaveBeenCalledTimes(1);
    const payload = api.updateBoard.mock.calls[0][1] as { name: string };
    expect(payload.name).toBe('Updated Name');
  });

  it('increases the grid size and adds blank cells', async () => {
    const { api } = renderEditor();

    const categoryInput = screen.getByLabelText(/categories/i);
    await userEvent.clear(categoryInput);
    await userEvent.type(categoryInput, '3');

    const rowInput = screen.getByLabelText(/rows/i);
    await userEvent.clear(rowInput);
    await userEvent.type(rowInput, '2');

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    expect(api.updateBoard).toHaveBeenCalledTimes(1);
    const payload = api.updateBoard.mock.calls[0][1] as BoardWithRounds;
    const jeopardy = payload.rounds.find((r) => r.type === 'JEOPARDY')!;
    expect(jeopardy.categories).toHaveLength(3);
    expect(jeopardy.categories[0].clues).toHaveLength(2);
    expect(jeopardy.categories[0].clues[0].clueText).toBe('H2O?');
    expect(jeopardy.categories[2].clues[0].clueText).toBe('');
  });

  it('warns before shrinking the grid over authored cells', async () => {
    const { api } = renderEditor();

    const categoryInput = screen.getByLabelText(/categories/i);
    await userEvent.clear(categoryInput);
    await userEvent.type(categoryInput, '1');

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/delete .* authored/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(api.updateBoard).not.toHaveBeenCalled();
    expect(categoryInput).toHaveValue(2);
  });

  it('confirms shrinking the grid and deletes exactly the affected cells', async () => {
    const { api } = renderEditor();

    const categoryInput = screen.getByLabelText(/categories/i);
    await userEvent.clear(categoryInput);
    await userEvent.type(categoryInput, '1');

    await userEvent.click(await screen.findByRole('button', { name: /delete & resize/i }));
    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    expect(api.updateBoard).toHaveBeenCalledTimes(1);
    const payload = api.updateBoard.mock.calls[0][1] as BoardWithRounds;
    const jeopardy = payload.rounds.find((r) => r.type === 'JEOPARDY')!;
    expect(jeopardy.categories).toHaveLength(1);
    expect(jeopardy.categories[0].title).toBe('Science');
  });

  it('rejects invalid timer values and surfaces an error', async () => {
    const api = createMockApi(makeBoard(), {
      updateBoard: vi.fn().mockRejectedValue(new Error('Invalid request body')),
    });
    renderEditor({ api });

    const timerInput = screen.getByLabelText(/per-clue timer/i);
    await userEvent.clear(timerInput);
    await userEvent.type(timerInput, 'abc');

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    expect(api.updateBoard).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid request body/i);
  });

  it('toggles Double Jeopardy on and off', async () => {
    const { api } = renderEditor({ board: makeBoardWithDouble() });

    expect(screen.getByRole('heading', { name: /double jeopardy round/i })).toBeInTheDocument();

    const toggle = screen.getByLabelText(/include double jeopardy/i);
    await userEvent.click(toggle);

    expect(screen.queryByRole('heading', { name: /double jeopardy round/i })).not.toBeInTheDocument();
    expect(screen.getByText(/double jeopardy round is hidden/i)).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByRole('heading', { name: /double jeopardy round/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));
    expect(api.updateBoard).toHaveBeenCalledTimes(1);
    const payload = api.updateBoard.mock.calls[0][1] as { includeDoubleJeopardy: boolean };
    expect(payload.includeDoubleJeopardy).toBe(true);
  });
});
