import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

    expect(await screen.findByText('Science')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('Water symbol?')).toBeInTheDocument();
    expect(screen.getByText('H2O')).toBeInTheDocument();
    expect(screen.getByText('Berlin Wall year?')).toBeInTheDocument();
    expect(screen.getByText('1989')).toBeInTheDocument();
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
    expect(screen.getByText('Heavy water?')).toBeInTheDocument();
    expect(screen.getByText('D2O')).toBeInTheDocument();
    expect(screen.getByText('He wrote The Hobbit')).toBeInTheDocument();
    expect(screen.getByText('J.R.R. Tolkien')).toBeInTheDocument();
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
    expect(screen.getByText('Literature')).toBeInTheDocument();
    expect(screen.getByText('He wrote The Hobbit')).toBeInTheDocument();
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

    expect(await screen.findAllByText('Science')).toHaveLength(2);
    expect(screen.getByText('Water symbol?')).toBeInTheDocument();
    expect(screen.getByText('Speed of light?')).toBeInTheDocument();
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

    expect(await screen.findByText('Café')).toBeInTheDocument();
    expect(screen.getByText('🐱, "meow"')).toBeInTheDocument();
  });

  it('returns to the library when Back to Library is clicked', async () => {
    const api = makeMockApi();
    const onBack = vi.fn();

    render(<ImportBoard token={token} api={api} onBack={onBack} />);
    const backButton = screen.getByRole('button', { name: /back to library/i });

    await userEvent.click(backButton);

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
