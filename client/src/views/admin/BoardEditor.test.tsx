import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardEditor } from './BoardEditor.js';
import type { BoardApiClient, BoardWithRounds, Clue } from '../../api/boards.js';

function makeClue(overrides: Partial<Clue> = {}): Clue {
  return {
    id: `clue-${overrides.row ?? 0}`,
    categoryId: 'cat-1',
    value: overrides.value !== undefined ? overrides.value : 100,
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
    isComplete: overrides.isComplete ?? true,
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
        isComplete: true,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      } as BoardWithRounds),
    ),
    deleteBoard: vi.fn(),
    importBoard: vi.fn(),
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
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByTestId('summary-categories')).toHaveTextContent(/2\s*categories/i);
    expect(screen.getByTestId('summary-rows')).toHaveTextContent(/1\s*row/i);
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

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toMatch(/confirmDialogModal/);
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

  it('rejects invalid timer values by firing the PUT and surfacing the server 400', async () => {
    const api = createMockApi(makeBoard(), {
      updateBoard: vi.fn().mockRejectedValue(
        new Error('Invalid request body: defaultTimerSeconds must be a positive integer'),
      ),
    });
    renderEditor({ api });

    const timerInput = screen.getByLabelText(/per-clue timer/i);
    await userEvent.clear(timerInput);
    await userEvent.type(timerInput, 'abc');

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    expect(api.updateBoard).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /invalid request body|defaultTimerSeconds/i,
    );
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

  it('adds a category to the Jeopardy round', async () => {
    const { api } = renderEditor();

    await userEvent.click(screen.getAllByRole('button', { name: /add category/i })[0]);
    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    const payload = api.updateBoard.mock.calls[0][1] as BoardWithRounds;
    const jeopardy = payload.rounds.find((r) => r.type === 'JEOPARDY')!;
    expect(jeopardy.categories).toHaveLength(3);
    expect(jeopardy.categories[2].title).toBe('New Category');
    expect(jeopardy.categories[2].clues).toHaveLength(1);
  });

  it('renames a category and persists the change', async () => {
    const { api } = renderEditor();

    const titleInput = screen.getByRole('textbox', { name: /category 1 title/i });
    fireEvent.change(titleInput, { target: { value: 'Natural Science' } });

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    const payload = api.updateBoard.mock.calls[0][1] as BoardWithRounds;
    const jeopardy = payload.rounds.find((r) => r.type === 'JEOPARDY')!;
    expect(jeopardy.categories[0].title).toBe('Natural Science');
  });

  it('reorders categories and keeps their clues attached', async () => {
    const { api } = renderEditor();

    const moveRightButtons = screen.getAllByRole('button', { name: /move category right/i });
    await userEvent.click(moveRightButtons[0]);

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    const payload = api.updateBoard.mock.calls[0][1] as BoardWithRounds;
    const jeopardy = payload.rounds.find((r) => r.type === 'JEOPARDY')!;
    expect(jeopardy.categories[0].title).toBe('History');
    expect(jeopardy.categories[1].title).toBe('Science');
    expect(jeopardy.categories[1].clues[0].clueText).toBe('H2O?');
  });

  it('warns before removing an authored category and removes after confirmation', async () => {
    const { api } = renderEditor();

    const deleteButtons = screen.getAllByRole('button', { name: /remove category/i });
    await userEvent.click(deleteButtons[0]);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toMatch(/confirmDialogModal/);
    expect(screen.getByText((content) => /delete/i.test(content) && /and its clues/i.test(content))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /delete category/i }));
    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    const payload = api.updateBoard.mock.calls[0][1] as BoardWithRounds;
    const jeopardy = payload.rounds.find((r) => r.type === 'JEOPARDY')!;
    expect(jeopardy.categories).toHaveLength(1);
    expect(jeopardy.categories[0].title).toBe('History');
  });

  it('edits a clue value, text, and answer distinctly', async () => {
    const { api } = renderEditor();

    const valueInputs = screen.getAllByPlaceholderText(/value/i);
    fireEvent.change(valueInputs[0], { target: { value: '150' } });

    const clueTextareas = screen.getAllByPlaceholderText(/clue text/i);
    fireEvent.change(clueTextareas[0], { target: { value: 'What is H2O?' } });

    const answerTextareas = screen.getAllByPlaceholderText(/answer/i);
    fireEvent.change(answerTextareas[0], { target: { value: 'Water is H2O' } });

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    const payload = api.updateBoard.mock.calls[0][1] as BoardWithRounds;
    const clue = payload.rounds.find((r) => r.type === 'JEOPARDY')!.categories[0].clues[0];
    expect(clue.value).toBe(150);
    expect(clue.clueText).toBe('What is H2O?');
    expect(clue.answer).toBe('Water is H2O');
  });

  it('marks and unmarks a Daily Double', async () => {
    const { api } = renderEditor();

    const checkboxes = screen.getAllByRole('checkbox', { name: /daily double/i });
    await userEvent.click(checkboxes[0]);

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    const payload = api.updateBoard.mock.calls[0][1] as BoardWithRounds;
    const clue = payload.rounds.find((r) => r.type === 'JEOPARDY')!.categories[0].clues[0];
    expect(clue.isDailyDouble).toBe(true);
  });

  it('reorders rows and updates tier values across categories', async () => {
    const { api } = renderEditor({
      board: makeBoard({
        rounds: [
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
                clues: [
                  makeClue({ row: 0, value: 100, clueText: 'Easy?', answer: 'Yes' }),
                  makeClue({ row: 1, value: 200, clueText: 'Hard?', answer: 'No' }),
                ],
              },
              {
                id: 'cat-2',
                roundId: 'round-1',
                title: 'History',
                order: 1,
                clues: [
                  makeClue({ row: 0, value: 100, clueText: 'Old?', answer: 'Rome' }),
                  makeClue({ row: 1, value: 200, clueText: 'New?', answer: 'York' }),
                ],
              },
            ],
          },
        ],
      }),
    });

    const moveDownButtons = screen.getAllByRole('button', { name: /move row down/i });
    await userEvent.click(moveDownButtons[0]);

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    const payload = api.updateBoard.mock.calls[0][1] as BoardWithRounds;
    const jeopardy = payload.rounds.find((r) => r.type === 'JEOPARDY')!;
    expect(jeopardy.categories[0].clues[0].clueText).toBe('Hard?');
    expect(jeopardy.categories[0].clues[0].value).toBe(100);
    expect(jeopardy.categories[1].clues[0].clueText).toBe('New?');
    expect(jeopardy.categories[1].clues[0].value).toBe(100);
  });

  it('edits the Double Jeopardy round independently of Jeopardy', async () => {
    const { api } = renderEditor({ board: makeBoardWithDouble() });

    const doubleEditor = screen.getByTestId('round-editor-DOUBLE_JEOPARDY');
    const doubleValueInput = doubleEditor.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(doubleValueInput, { target: { value: '400' } });

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    const payload = api.updateBoard.mock.calls[0][1] as BoardWithRounds;
    const jeopardy = payload.rounds.find((r) => r.type === 'JEOPARDY')!;
    const double = payload.rounds.find((r) => r.type === 'DOUBLE_JEOPARDY')!;
    expect(jeopardy.categories[0].clues[0].value).toBe(100);
    expect(double.categories[0].clues[0].value).toBe(400);
  });

  it('edits the Final Jeopardy category, clue, and answer without a value', async () => {
    const { api } = renderEditor();

    const finalCategoryInput = screen.getByRole('textbox', { name: /final category/i });
    fireEvent.change(finalCategoryInput, { target: { value: 'Famous Authors' } });

    const finalClueInput = screen.getByRole('textbox', { name: /final clue/i });
    fireEvent.change(finalClueInput, { target: { value: 'He wrote Moby-Dick' } });

    const finalAnswerInput = screen.getByRole('textbox', { name: /final answer/i });
    fireEvent.change(finalAnswerInput, { target: { value: 'Herman Melville' } });

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    const payload = api.updateBoard.mock.calls[0][1] as BoardWithRounds;
    const final = payload.rounds.find((r) => r.type === 'FINAL')!;
    expect(final.categories[0].title).toBe('Famous Authors');
    expect(final.categories[0].clues[0].clueText).toBe('He wrote Moby-Dick');
    expect(final.categories[0].clues[0].answer).toBe('Herman Melville');
    expect(final.categories[0].clues[0].value).toBeNull();
  });

  it('shows an incomplete indicator when the board has empty clue cells', () => {
    renderEditor({
      board: makeBoard({
        rounds: [
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
                clues: [makeClue({ clueText: '', answer: '' })],
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
      }),
    });

    expect(screen.getAllByText(/incomplete/i).length).toBeGreaterThan(0);
  });

  it('fires the PUT for a half-filled clue and surfaces the server 400 inline', async () => {
    const { api } = renderEditor({
      updateBoard: vi.fn().mockRejectedValue(
        new Error('Invalid request body: Answer cannot be blank when clue text is provided'),
      ),
    });

    const answerTextareas = screen.getAllByPlaceholderText(/answer/i);
    fireEvent.change(answerTextareas[0], { target: { value: '' } });

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    expect(api.updateBoard).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('fires the PUT for a whitespace-only category title and surfaces the server 400', async () => {
    const { api } = renderEditor({
      updateBoard: vi.fn().mockRejectedValue(
        new Error('Invalid request body: Category title cannot be blank'),
      ),
    });

    const titleInput = screen.getByRole('textbox', { name: /category 1 title/i });
    fireEvent.change(titleInput, { target: { value: '   ' } });

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    expect(api.updateBoard).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('fires the PUT for a Final with a missing answer and surfaces the server 400', async () => {
    const { api } = renderEditor({
      updateBoard: vi.fn().mockRejectedValue(
        new Error('Invalid request body: Final answer cannot be blank'),
      ),
    });

    const finalAnswerInput = screen.getByRole('textbox', { name: /final answer/i });
    fireEvent.change(finalAnswerInput, { target: { value: '' } });

    await userEvent.click(screen.getByRole('button', { name: /save board/i }));

    expect(api.updateBoard).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('registers a beforeunload handler when there are unsaved changes', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    renderEditor();

    const nameInput = screen.getByLabelText(/board name/i);
    fireEvent.change(nameInput, { target: { value: 'Changed Name' } });

    expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });
});
