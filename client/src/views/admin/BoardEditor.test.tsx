import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardEditor } from './BoardEditor.js';
import type { BoardWithRounds } from '../../api/boards.js';

function makeBoard(): BoardWithRounds {
  return {
    id: 'board-1',
    name: 'Science Trivia',
    includeDoubleJeopardy: true,
    defaultTimerSeconds: 10,
    finalTimerSeconds: 30,
    createdAt: '2026-06-30T12:00:00.000Z',
    updatedAt: '2026-06-30T12:30:00.000Z',
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
    ],
  };
}

describe('BoardEditor', () => {
  it('renders the board name and metadata', () => {
    const board = makeBoard();
    const onBack = vi.fn();

    render(<BoardEditor board={board} onBack={onBack} />);

    expect(screen.getByRole('heading', { name: board.name })).toBeInTheDocument();
    expect(screen.getByText(/1 category/i)).toBeInTheDocument();
    expect(screen.getByText(/1 clue/i)).toBeInTheDocument();
  });

  it('calls onBack when the back button is activated', async () => {
    const board = makeBoard();
    const onBack = vi.fn();

    render(<BoardEditor board={board} onBack={onBack} />);
    await userEvent.click(screen.getByRole('button', { name: /back to library/i }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
