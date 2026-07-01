import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FinalEditor } from './FinalEditor.js';
import type { Round } from '../../api/boards.js';

function makeRound(): Round {
  return {
    id: 'round-final',
    boardId: 'board-1',
    type: 'FINAL',
    order: 2,
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
            value: null,
            row: 0,
            clueText: 'He wrote "The Hobbit"',
            answer: 'J.R.R. Tolkien',
            isDailyDouble: false,
          },
        ],
      },
    ],
  };
}

describe('FinalEditor', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Final category, clue, and answer fields', () => {
    const onChange = vi.fn();
    render(<FinalEditor round={makeRound()} onChange={onChange} />);

    expect(screen.getByRole('textbox', { name: /final category/i })).toHaveValue('Literature');
    expect(screen.getByRole('textbox', { name: /final clue/i })).toHaveValue('He wrote "The Hobbit"');
    expect(screen.getByRole('textbox', { name: /final answer/i })).toHaveValue('J.R.R. Tolkien');
  });

  it('calls onChange with the updated category title', () => {
    const onChange = vi.fn();
    render(<FinalEditor round={makeRound()} onChange={onChange} />);

    const titleInput = screen.getByRole('textbox', { name: /final category/i });
    fireEvent.change(titleInput, { target: { value: 'Famous Authors' } });

    expect(onChange).toHaveBeenCalledWith({ title: 'Famous Authors' });
  });

  it('calls onChange with the updated clue text', () => {
    const onChange = vi.fn();
    render(<FinalEditor round={makeRound()} onChange={onChange} />);

    const clueInput = screen.getByRole('textbox', { name: /final clue/i });
    fireEvent.change(clueInput, { target: { value: 'He wrote Moby-Dick' } });

    expect(onChange).toHaveBeenCalledWith({ clueText: 'He wrote Moby-Dick' });
  });

  it('calls onChange with the updated answer', () => {
    const onChange = vi.fn();
    render(<FinalEditor round={makeRound()} onChange={onChange} />);

    const answerInput = screen.getByRole('textbox', { name: /final answer/i });
    fireEvent.change(answerInput, { target: { value: 'Herman Melville' } });

    expect(onChange).toHaveBeenCalledWith({ answer: 'Herman Melville' });
  });
});
