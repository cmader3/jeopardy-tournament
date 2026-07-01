import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminBoardLibrary } from './AdminBoardLibrary.js';
import type { BoardApiClient, BoardSummary, BoardWithRounds } from '../../api/boards.js';

const token = 'test-token';

function makeSummary(overrides: Partial<BoardSummary> = {}): BoardSummary {
  return {
    id: 'board-1',
    name: 'Science Trivia',
    includeDoubleJeopardy: true,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    isComplete: true,
    createdAt: '2026-06-30T12:00:00.000Z',
    updatedAt: '2026-06-30T12:30:00.000Z',
    ...overrides,
  };
}

function makeBoardWithRounds(summary: BoardSummary): BoardWithRounds {
  return {
    ...summary,
    rounds: [
      {
        id: 'round-1',
        boardId: summary.id,
        type: 'JEOPARDY',
        order: 0,
        categories: [
          {
            id: 'cat-1',
            roundId: 'round-1',
            title: 'Science',
            order: 0,
            clues: [
              {
                id: 'clue-1',
                categoryId: 'cat-1',
                row: 0,
                value: 100,
                clueText: 'H2O',
                answer: 'Water',
                isDailyDouble: false,
              },
            ],
          },
        ],
      },
      {
        id: 'round-final',
        boardId: summary.id,
        type: 'FINAL',
        order: 1,
        categories: [
          {
            id: 'cat-final',
            roundId: 'round-final',
            title: 'Literature',
            order: 0,
            clues: [
              {
                id: 'clue-final',
                categoryId: 'cat-final',
                row: 0,
                value: null,
                clueText: 'He wrote The Hobbit',
                answer: 'J.R.R. Tolkien',
                isDailyDouble: false,
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeMockApi(): BoardApiClient {
  return {
    getBoards: vi.fn(),
    getBoard: vi.fn(),
    createBoard: vi.fn(),
    updateBoard: vi.fn(),
    deleteBoard: vi.fn(),
    importBoard: vi.fn(),
  } as unknown as BoardApiClient;
}

describe('AdminBoardLibrary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows an empty state and a create affordance when no boards exist', async () => {
    const api = makeMockApi();
    api.getBoards = vi.fn().mockResolvedValue([]);
    const onOpenBoard = vi.fn();

    render(<AdminBoardLibrary token={token} api={api} onOpenBoard={onOpenBoard} onImport={vi.fn()} />);

    expect(await screen.findByText('No saved boards yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create new board/i })).toBeEnabled();
  });

  it('lists every saved board by name with metadata', async () => {
    const api = makeMockApi();
    const boards = [makeSummary({ id: 'a', name: 'Board A' }), makeSummary({ id: 'b', name: 'Board B' })];
    api.getBoards = vi.fn().mockResolvedValue(boards);
    const onOpenBoard = vi.fn();

    render(<AdminBoardLibrary token={token} api={api} onOpenBoard={onOpenBoard} onImport={vi.fn()} />);

    expect(await screen.findByText('Board A')).toBeInTheDocument();
    expect(screen.getByText('Board B')).toBeInTheDocument();
    expect(screen.getAllByText(/10s per clue/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/30s Final/i).length).toBeGreaterThanOrEqual(1);
  });

  it('creates a board and opens it in the editor', async () => {
    const api = makeMockApi();
    api.getBoards = vi.fn().mockResolvedValue([]);
    const newBoard = makeBoardWithRounds(makeSummary({ id: 'new', name: 'New Board' }));
    api.createBoard = vi.fn().mockResolvedValue(newBoard);
    const onOpenBoard = vi.fn();

    render(<AdminBoardLibrary token={token} api={api} onOpenBoard={onOpenBoard} onImport={vi.fn()} />);
    const createButton = await screen.findByRole('button', { name: /create new board/i });

    await userEvent.click(createButton);

    await waitFor(() => expect(api.createBoard).toHaveBeenCalledTimes(1));
    expect(api.createBoard).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Board' }),
      token,
    );
    expect(onOpenBoard).toHaveBeenCalledWith(expect.objectContaining({ id: 'new', name: 'New Board' }));
  });

  it('opens an existing board when selected', async () => {
    const api = makeMockApi();
    const summary = makeSummary({ id: 'a', name: 'Board A' });
    const board = makeBoardWithRounds(summary);
    api.getBoards = vi.fn().mockResolvedValue([summary]);
    api.getBoard = vi.fn().mockResolvedValue(board);
    const onOpenBoard = vi.fn();

    render(<AdminBoardLibrary token={token} api={api} onOpenBoard={onOpenBoard} onImport={vi.fn()} />);
    const openButton = await screen.findByRole('button', { name: /open Board A/i });

    await userEvent.click(openButton);

    await waitFor(() => expect(api.getBoard).toHaveBeenCalledWith('a', token));
    expect(onOpenBoard).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', name: 'Board A' }));
  });

  it('renames a board and refreshes the list', async () => {
    const api = makeMockApi();
    const summary = makeSummary({ id: 'a', name: 'Board A' });
    const board = makeBoardWithRounds(summary);
    api.getBoards = vi.fn().mockResolvedValue([summary]);
    api.getBoard = vi.fn().mockResolvedValue(board);
    api.updateBoard = vi.fn().mockResolvedValue({ ...board, name: 'Renamed Board' });

    render(<AdminBoardLibrary token={token} api={api} onOpenBoard={vi.fn()} />);
    const renameButton = await screen.findByRole('button', { name: /rename Board A/i });

    await userEvent.click(renameButton);
    const input = screen.getByLabelText(/board name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed Board');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(api.updateBoard).toHaveBeenCalledWith('a', expect.objectContaining({ name: 'Renamed Board' }), token));
    await waitFor(() => expect(api.getBoards).toHaveBeenCalledTimes(2));
  });

  it('applies the visually-hidden utility class to the rename label', async () => {
    const api = makeMockApi();
    const summary = makeSummary({ id: 'a', name: 'Board A' });
    api.getBoards = vi.fn().mockResolvedValue([summary]);

    render(<AdminBoardLibrary token={token} api={api} onOpenBoard={vi.fn()} />);
    const renameButton = await screen.findByRole('button', { name: /rename Board A/i });

    await userEvent.click(renameButton);
    const label = screen.getByText('Board name');
    expect(label.tagName).toBe('LABEL');
    expect(label.className).toMatch(/\bvisually-hidden\b/);
  });

  it('duplicates a board with a differentiated name', async () => {
    const api = makeMockApi();
    const summary = makeSummary({ id: 'a', name: 'Board A' });
    const board = makeBoardWithRounds(summary);
    const copy = makeBoardWithRounds(makeSummary({ id: 'copy', name: 'Board A (copy)' }));
    api.getBoards = vi.fn()
      .mockResolvedValueOnce([summary])
      .mockResolvedValueOnce([summary, { ...summary, id: 'copy', name: 'Board A (copy)' }]);
    api.getBoard = vi.fn().mockResolvedValue(board);
    api.createBoard = vi.fn().mockResolvedValue(copy);

    render(<AdminBoardLibrary token={token} api={api} onOpenBoard={vi.fn()} />);
    const duplicateButton = await screen.findByRole('button', { name: /duplicate Board A/i });

    await userEvent.click(duplicateButton);

    await waitFor(() => expect(api.createBoard).toHaveBeenCalledWith(expect.objectContaining({ name: 'Board A (copy)' }), token));
    await waitFor(() => expect(api.getBoards).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Board A (copy)')).toBeInTheDocument();
  });

  it('deletes a board after confirmation and refreshes the list', async () => {
    const api = makeMockApi();
    const summary = makeSummary({ id: 'a', name: 'Board A' });
    api.getBoards = vi.fn().mockResolvedValue([summary]);
    api.deleteBoard = vi.fn().mockResolvedValue(undefined);

    render(<AdminBoardLibrary token={token} api={api} onOpenBoard={vi.fn()} />);
    const deleteButton = await screen.findByRole('button', { name: /delete Board A/i });

    await userEvent.click(deleteButton);
    await userEvent.click(screen.getByRole('button', { name: /confirm delete/i }));

    await waitFor(() => expect(api.deleteBoard).toHaveBeenCalledWith('a', token));
    await waitFor(() => expect(api.getBoards).toHaveBeenCalledTimes(2));
  });

  it('cancelling delete keeps the board intact and sends no delete request', async () => {
    const api = makeMockApi();
    const summary = makeSummary({ id: 'a', name: 'Board A' });
    api.getBoards = vi.fn().mockResolvedValue([summary]);
    api.deleteBoard = vi.fn().mockResolvedValue(undefined);

    render(<AdminBoardLibrary token={token} api={api} onOpenBoard={vi.fn()} />);
    const deleteButton = await screen.findByRole('button', { name: /delete Board A/i });

    await userEvent.click(deleteButton);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(api.deleteBoard).not.toHaveBeenCalled();
    expect(screen.getByText('Board A')).toBeInTheDocument();
  });

  it('shows an incomplete badge on boards with holes', async () => {
    const api = makeMockApi();
    const summary = makeSummary({ id: 'a', name: 'Board A', isComplete: false });
    api.getBoards = vi.fn().mockResolvedValue([summary]);

    render(<AdminBoardLibrary token={token} api={api} onOpenBoard={vi.fn()} />);

    expect(await screen.findByText(/incomplete/i)).toBeInTheDocument();
  });
});
