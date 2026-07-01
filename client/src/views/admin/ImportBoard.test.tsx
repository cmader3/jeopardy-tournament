import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportBoard } from './ImportBoard.js';
import type { BoardApiClient, ImportPreview } from '../../api/boards.js';

const token = 'test-token';

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

function makePreview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    board: {
      name: 'Imported Board',
      includeDoubleJeopardy: false,
      defaultTimerSeconds: 10,
      finalTimerSeconds: 30,
      rounds: [
        {
          type: 'JEOPARDY',
          order: 0,
          categories: [
            {
              title: 'Science',
              order: 0,
              clues: [
                { value: 100, row: 0, clueText: 'Water symbol?', answer: 'H2O', isDailyDouble: false },
              ],
            },
            {
              title: 'History',
              order: 1,
              clues: [
                { value: 100, row: 0, clueText: 'Berlin Wall year?', answer: '1989', isDailyDouble: true },
              ],
            },
          ],
        },
      ],
    },
    warnings: [],
    confidence: 0.9,
    ...overrides,
  };
}

function makeDoubleJeopardyPreview(): ImportPreview {
  return makePreview({
    board: {
      name: 'Imported Board',
      includeDoubleJeopardy: true,
      defaultTimerSeconds: 10,
      finalTimerSeconds: 30,
      rounds: [
        {
          type: 'JEOPARDY',
          order: 0,
          categories: [
            {
              title: 'Science',
              order: 0,
              clues: [{ value: 100, row: 0, clueText: 'Water symbol?', answer: 'H2O', isDailyDouble: false }],
            },
          ],
        },
        {
          type: 'DOUBLE_JEOPARDY',
          order: 1,
          categories: [
            {
              title: 'Science',
              order: 0,
              clues: [{ value: 400, row: 0, clueText: 'Heavy water?', answer: 'D2O', isDailyDouble: false }],
            },
          ],
        },
        {
          type: 'FINAL',
          order: 2,
          categories: [
            {
              title: 'Literature',
              order: 0,
              clues: [{ value: null, row: 0, clueText: 'He wrote The Hobbit', answer: 'J.R.R. Tolkien', isDailyDouble: false }],
            },
          ],
        },
      ],
    },
  });
}

describe('ImportBoard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders an upload control that accepts spreadsheet files', () => {
    const api = makeMockApi();
    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);

    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute('accept', '.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv');
    expect(fileInput).toHaveAttribute('type', 'file');
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
  });

  it('calls importBoard when a file is selected and upload is clicked', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makePreview());
    const file = new File(['csv content'], 'sample.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    await waitFor(() => expect(api.importBoard).toHaveBeenCalledWith(file, token));
  });

  it('renders a preview with correct categories, values, clues, and answers', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makePreview());
    const file = new File(['csv content'], 'sample.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    expect(await screen.findByText('Science', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('History', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Water symbol?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('H2O')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Berlin Wall year?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1989')).toBeInTheDocument();
  });

  it('flags Daily Double clues in the preview', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makePreview());
    const file = new File(['csv content'], 'sample.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    expect(await screen.findAllByTestId('daily-double-indicator')).toHaveLength(1);
  });

  it('renders Double Jeopardy and Final rounds when detected', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makeDoubleJeopardyPreview());
    const file = new File(['xlsx content'], 'sample.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    expect(await screen.findByText('Jeopardy Round')).toBeInTheDocument();
    expect(screen.getByText('Double Jeopardy Round')).toBeInTheDocument();
    expect(screen.getByText('Final Jeopardy Round')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Heavy water?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('D2O')).toBeInTheDocument();
    expect(screen.getByDisplayValue('He wrote The Hobbit')).toBeInTheDocument();
    expect(screen.getByDisplayValue('J.R.R. Tolkien')).toBeInTheDocument();
  });

  it('shows a Final clue with no dollar value', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makeDoubleJeopardyPreview());
    const file = new File(['xlsx content'], 'sample.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    expect(await screen.findByText('Final Jeopardy Round')).toBeInTheDocument();
    expect(screen.getByText('Literature', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('He wrote The Hobbit')).toBeInTheDocument();
    expect(screen.queryByText(/\$200/)).not.toBeInTheDocument();
  });

  it('surfaces warnings for ambiguous input without fabricating data', async () => {
    const api = makeMockApi();
    const preview = makePreview({
      warnings: ['No round information detected; all content assumed to be the Jeopardy round.', '1 row(s) missing category were skipped.'],
    });
    api.importBoard = vi.fn().mockResolvedValue(preview);
    const file = new File(['csv content'], 'ambiguous.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    expect(await screen.findByText(/no round information detected/i)).toBeInTheDocument();
    expect(screen.getByText(/missing category were skipped/i)).toBeInTheDocument();
  });

  it('displays a clear error when the file is malformed', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockRejectedValue(new Error('Unable to read the uploaded file. Please upload a CSV or XLSX spreadsheet.'));
    const file = new File(['not a spreadsheet'], 'bad.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(/unable to read the uploaded file/i);
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
  });

  it('displays a clear error when the file is empty', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockRejectedValue(new Error('No usable spreadsheet content was found.'));
    const file = new File([''], 'empty.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no usable spreadsheet content/i);
  });

  it('preserves duplicate category names as distinct categories', async () => {
    const api = makeMockApi();
    const preview = makePreview({
      board: {
        ...makePreview().board,
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [
              {
                title: 'Science',
                order: 0,
                clues: [{ value: 100, row: 0, clueText: 'Water symbol?', answer: 'H2O', isDailyDouble: false }],
              },
              {
                title: 'Science',
                order: 1,
                clues: [{ value: 200, row: 0, clueText: 'Speed of light?', answer: '299,792,458 m/s', isDailyDouble: false }],
              },
            ],
          },
        ],
      },
    });
    api.importBoard = vi.fn().mockResolvedValue(preview);
    const file = new File(['csv content'], 'duplicates.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    expect(await screen.findAllByText('Science', { selector: 'div' })).toHaveLength(2);
    expect(screen.getByDisplayValue('Water symbol?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Speed of light?')).toBeInTheDocument();
  });

  it('preserves unicode and delimiter-laden content in the correct cells', async () => {
    const api = makeMockApi();
    const preview = makePreview({
      board: {
        ...makePreview().board,
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [
              {
                title: 'Café',
                order: 0,
                clues: [{ value: 100, row: 0, clueText: 'A flaky pastry', answer: 'Croissant', isDailyDouble: false }],
              },
              {
                title: 'Emoji',
                order: 1,
                clues: [{ value: 200, row: 0, clueText: 'Contains a cat', answer: '🐱, "meow"', isDailyDouble: false }],
              },
            ],
          },
        ],
      },
    });
    api.importBoard = vi.fn().mockResolvedValue(preview);
    const file = new File(['csv content'], 'unicode.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    expect(await screen.findByText('Café', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('🐱, "meow"')).toBeInTheDocument();
  });

  it('renders multiline clue and answer text with newlines preserved in the preview', async () => {
    const api = makeMockApi();
    const preview = makePreview({
      board: {
        ...makePreview().board,
        rounds: [
          {
            type: 'JEOPARDY',
            order: 0,
            categories: [
              {
                title: 'Poetry',
                order: 0,
                clues: [
                  {
                    value: 100,
                    row: 0,
                    clueText: 'Roses are red\nViolets are blue',
                    answer: 'Sugar is sweet\nAnd so are you',
                    isDailyDouble: false,
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    api.importBoard = vi.fn().mockResolvedValue(preview);
    const file = new File(['csv content'], 'multiline.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    const clueTextarea = await screen.findByLabelText(/clue text/i);
    const answerTextarea = screen.getByLabelText(/answer/i);
    expect(clueTextarea.tagName).toBe('TEXTAREA');
    expect(answerTextarea.tagName).toBe('TEXTAREA');
    expect(clueTextarea).toHaveValue('Roses are red\nViolets are blue');
    expect(answerTextarea).toHaveValue('Sugar is sweet\nAnd so are you');
  });

  it('keeps a newline in an edited clue and answer when saving', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makePreview());
    api.createBoard = vi.fn().mockResolvedValue({
      id: 'saved-board-id',
      ...makePreview().board,
      createdAt: 'now',
      updatedAt: 'now',
      isComplete: true,
    });
    const file = new File(['csv content'], 'sample.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} onSave={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    await screen.findByText('Science', { selector: 'div' });
    const clueTextareas = screen.getAllByLabelText(/clue text/i);
    const answerTextareas = screen.getAllByLabelText(/answer/i);

    fireEvent.change(clueTextareas[0], { target: { value: 'First line\nSecond line' } });
    fireEvent.change(answerTextareas[0], { target: { value: 'Answer line 1\nAnswer line 2' } });

    const saveButton = screen.getByRole('button', { name: /save board/i });
    await userEvent.click(saveButton);

    await waitFor(() => expect(api.createBoard).toHaveBeenCalled());
    const payload = api.createBoard.mock.calls[0][0];
    expect(payload.rounds[0].categories[0].clues[0].clueText).toBe('First line\nSecond line');
    expect(payload.rounds[0].categories[0].clues[0].answer).toBe('Answer line 1\nAnswer line 2');
  });

  it('returns to the library when Back to Library is clicked', async () => {
    const api = makeMockApi();
    const onBack = vi.fn();

    render(<ImportBoard token={token} api={api} onBack={onBack} />);
    const backButton = screen.getByRole('button', { name: /back to library/i });

    await userEvent.click(backButton);

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders a Save Board button in the preview', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makePreview());
    const file = new File(['csv content'], 'sample.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    expect(await screen.findByRole('button', { name: /save board/i })).toBeInTheDocument();
  });

  it('saves the edited board via createBoard and notifies the parent', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makePreview());
    const savedBoard = {
      id: 'saved-board-id',
      ...makePreview().board,
      createdAt: 'now',
      updatedAt: 'now',
      isComplete: true,
    };
    api.createBoard = vi.fn().mockResolvedValue(savedBoard);
    const onSave = vi.fn();
    const file = new File(['csv content'], 'sample.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} onSave={onSave} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    const nameInput = await screen.findByLabelText(/board name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Edited Imported Board');

    const saveButton = screen.getByRole('button', { name: /save board/i });
    await userEvent.click(saveButton);

    await waitFor(() => expect(api.createBoard).toHaveBeenCalled());
    const payload = api.createBoard.mock.calls[0][0];
    expect(payload.name).toBe('Edited Imported Board');
    expect(payload.defaultTimerSeconds).toBe(10);
    expect(payload.finalTimerSeconds).toBe(30);
    expect(payload.rounds[0].categories[0].clues[0].answer).toBe('H2O');

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(savedBoard));
  });

  it('reflects a changed value in the saved board payload', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makePreview());
    api.createBoard = vi.fn().mockResolvedValue({
      id: 'saved-board-id',
      ...makePreview().board,
      createdAt: 'now',
      updatedAt: 'now',
      isComplete: true,
    });
    const file = new File(['csv content'], 'sample.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} onSave={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    await screen.findByText('Science', { selector: 'div' });
    const valueInputs = screen.getAllByLabelText(/value/i);
    await userEvent.clear(valueInputs[0]);
    await userEvent.type(valueInputs[0], '250');

    const saveButton = screen.getByRole('button', { name: /save board/i });
    await userEvent.click(saveButton);

    await waitFor(() => expect(api.createBoard).toHaveBeenCalled());
    const payload = api.createBoard.mock.calls[0][0];
    expect(payload.rounds[0].categories[0].clues[0].value).toBe(250);
  });

  it('reflects an edited answer in the saved board payload', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makePreview());
    api.createBoard = vi.fn().mockResolvedValue({
      id: 'saved-board-id',
      ...makePreview().board,
      createdAt: 'now',
      updatedAt: 'now',
      isComplete: true,
    });
    const file = new File(['csv content'], 'sample.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} onSave={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    await screen.findByText('Science', { selector: 'div' });
    const answerInputs = screen.getAllByLabelText(/answer/i);
    await userEvent.clear(answerInputs[0]);
    await userEvent.type(answerInputs[0], 'Dihydrogen monoxide');

    const saveButton = screen.getByRole('button', { name: /save board/i });
    await userEvent.click(saveButton);

    await waitFor(() => expect(api.createBoard).toHaveBeenCalled());
    const payload = api.createBoard.mock.calls[0][0];
    expect(payload.rounds[0].categories[0].clues[0].answer).toBe('Dihydrogen monoxide');
  });

  it('reassigns a clue to a different category in the saved payload', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makePreview());
    api.createBoard = vi.fn().mockResolvedValue({
      id: 'saved-board-id',
      ...makePreview().board,
      createdAt: 'now',
      updatedAt: 'now',
      isComplete: true,
    });
    const file = new File(['csv content'], 'sample.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} onSave={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    await screen.findByText('Science', { selector: 'div' });
    const categorySelects = screen.getAllByLabelText(/category/i);
    await userEvent.selectOptions(categorySelects[0], 'History');

    const saveButton = screen.getByRole('button', { name: /save board/i });
    await userEvent.click(saveButton);

    await waitFor(() => expect(api.createBoard).toHaveBeenCalled());
    const payload = api.createBoard.mock.calls[0][0];
    expect(payload.rounds[0].categories[0].clues).toHaveLength(0);
    const historyCategory = payload.rounds[0].categories[1];
    expect(historyCategory.clues).toHaveLength(2);
    expect(historyCategory.clues[1].clueText).toBe('Water symbol?');
  });

  it('does not call createBoard when the default timer is invalid', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makePreview());
    api.createBoard = vi.fn().mockResolvedValue({
      id: 'saved-board-id',
      ...makePreview().board,
      createdAt: 'now',
      updatedAt: 'now',
      isComplete: true,
    });
    const file = new File(['csv content'], 'sample.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} onSave={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    await screen.findByLabelText(/board name/i);
    const timerInput = screen.getByLabelText(/per-clue timer/i);
    await userEvent.clear(timerInput);
    await userEvent.type(timerInput, '0');

    const saveButton = screen.getByRole('button', { name: /save board/i });
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/timer must be a positive integer/i);
    });
    expect(api.createBoard).not.toHaveBeenCalled();
  });

  it('toggles Double Jeopardy and includes it in the saved payload', async () => {
    const api = makeMockApi();
    api.importBoard = vi.fn().mockResolvedValue(makePreview());
    api.createBoard = vi.fn().mockResolvedValue({
      id: 'saved-board-id',
      ...makePreview().board,
      includeDoubleJeopardy: true,
      createdAt: 'now',
      updatedAt: 'now',
      isComplete: true,
    });
    const file = new File(['csv content'], 'sample.csv', { type: 'text/csv' });

    render(<ImportBoard token={token} api={api} onBack={vi.fn()} onSave={vi.fn()} />);
    const fileInput = screen.getByLabelText(/upload a spreadsheet/i);
    const uploadButton = screen.getByRole('button', { name: /upload/i });

    await userEvent.upload(fileInput, file);
    await userEvent.click(uploadButton);

    await screen.findByLabelText(/board name/i);
    const toggle = screen.getByLabelText(/include double jeopardy/i);
    await userEvent.click(toggle);

    const saveButton = screen.getByRole('button', { name: /save board/i });
    await userEvent.click(saveButton);

    await waitFor(() => expect(api.createBoard).toHaveBeenCalled());
    const payload = api.createBoard.mock.calls[0][0];
    expect(payload.includeDoubleJeopardy).toBe(true);
  });
});
