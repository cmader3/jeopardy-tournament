import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoundEditor } from './RoundEditor.js';
import type { Category, Clue, Round } from '../../api/boards.js';

function makeClue(overrides: Partial<Clue> = {}): Clue {
  return {
    id: `clue-${overrides.row ?? 0}`,
    categoryId: 'cat-1',
    value: overrides.value !== undefined ? overrides.value : 100,
    row: overrides.row ?? 0,
    clueText: overrides.clueText ?? '',
    answer: overrides.answer ?? '',
    isDailyDouble: overrides.isDailyDouble ?? false,
  };
}

function makeCategory(title: string, order: number, clues: Clue[]): Category {
  return {
    id: `cat-${order}`,
    roundId: 'round-1',
    title,
    order,
    clues,
  };
}

function makeRound(type: Round['type'] = 'JEOPARDY', categories: Category[] = []): Round {
  return {
    id: 'round-1',
    boardId: 'board-1',
    type,
    order: type === 'JEOPARDY' ? 0 : 1,
    categories,
  };
}

function makeDefaultRound(): Round {
  return makeRound('JEOPARDY', [
    makeCategory('Science', 0, [
      makeClue({ row: 0, value: 100, clueText: 'H2O?', answer: 'Water' }),
      makeClue({ row: 1, value: 200, clueText: 'Planet?', answer: 'Mars' }),
    ]),
    makeCategory('History', 1, [
      makeClue({ row: 0, value: 100, clueText: '1776?', answer: 'Independence' }),
      makeClue({ row: 1, value: 200, clueText: 'Wall?', answer: 'Berlin' }),
    ]),
  ]);
}

function renderRoundEditor(props: Partial<Parameters<typeof RoundEditor>[0]> = {}) {
  const round = makeDefaultRound();
  const callbacks = {
    onAddCategory: vi.fn(),
    onRemoveCategory: vi.fn(),
    onRenameCategory: vi.fn(),
    onMoveCategory: vi.fn(),
    onUpdateClue: vi.fn(),
    onMoveRow: vi.fn(),
  };

  render(<RoundEditor round={round} {...callbacks} {...props} />);

  return { round, ...callbacks };
}

describe('RoundEditor', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders category headers and clue cells', () => {
    renderRoundEditor();

    expect(screen.getByRole('textbox', { name: /category 1 title/i })).toHaveValue('Science');
    expect(screen.getByRole('textbox', { name: /category 2 title/i })).toHaveValue('History');
    expect(screen.getAllByPlaceholderText(/clue text/i)).toHaveLength(4);
    expect(screen.getAllByPlaceholderText(/answer/i)).toHaveLength(4);
  });

  it('calls onAddCategory when the add button is clicked', async () => {
    const { onAddCategory } = renderRoundEditor();

    await userEvent.click(screen.getByRole('button', { name: /add category/i }));
    expect(onAddCategory).toHaveBeenCalledTimes(1);
  });

  it('calls onRemoveCategory when a category delete button is clicked', async () => {
    const { onRemoveCategory } = renderRoundEditor();

    const deleteButtons = screen.getAllByRole('button', { name: /remove category/i });
    await userEvent.click(deleteButtons[0]);
    expect(onRemoveCategory).toHaveBeenCalledWith(0);
  });

  it('calls onRenameCategory when a category title changes', () => {
    const { onRenameCategory } = renderRoundEditor();

    const titleInput = screen.getByRole('textbox', { name: /category 1 title/i });
    fireEvent.change(titleInput, { target: { value: 'Natural Science' } });

    expect(onRenameCategory).toHaveBeenCalledWith(0, 'Natural Science');
  });

  it('calls onMoveCategory with direction when move buttons are clicked', async () => {
    const { onMoveCategory } = renderRoundEditor();

    const moveRightButtons = screen.getAllByRole('button', { name: /move category right/i });
    await userEvent.click(moveRightButtons[0]);
    expect(onMoveCategory).toHaveBeenCalledWith(0, 'right');

    const moveLeftButtons = screen.getAllByRole('button', { name: /move category left/i });
    await userEvent.click(moveLeftButtons[1]);
    expect(onMoveCategory).toHaveBeenCalledWith(1, 'left');
  });

  it('calls onUpdateClue with updated clue text', () => {
    const { onUpdateClue } = renderRoundEditor();

    const clueTextareas = screen.getAllByPlaceholderText(/clue text/i);
    fireEvent.change(clueTextareas[0], { target: { value: 'What is H2O?' } });

    expect(onUpdateClue).toHaveBeenCalledWith(0, 0, { clueText: 'What is H2O?' });
  });

  it('calls onUpdateClue with updated answer', () => {
    const { onUpdateClue } = renderRoundEditor();

    const answerTextareas = screen.getAllByPlaceholderText(/answer/i);
    fireEvent.change(answerTextareas[0], { target: { value: 'Water is H2O' } });

    expect(onUpdateClue).toHaveBeenCalledWith(0, 0, { answer: 'Water is H2O' });
  });

  it('calls onUpdateClue with updated dollar value', () => {
    const { onUpdateClue } = renderRoundEditor();

    const valueInputs = screen.getAllByPlaceholderText(/value/i);
    fireEvent.change(valueInputs[0], { target: { value: '150' } });

    expect(onUpdateClue).toHaveBeenCalledWith(0, 0, { value: 150 });
  });

  it('calls onUpdateClue when the daily double checkbox is toggled', async () => {
    const { onUpdateClue } = renderRoundEditor();

    const checkboxes = screen.getAllByRole('checkbox', { name: /daily double/i });
    await userEvent.click(checkboxes[0]);

    expect(onUpdateClue).toHaveBeenCalledWith(0, 0, { isDailyDouble: true });
  });

  it('calls onMoveRow when row reorder buttons are clicked', async () => {
    const { onMoveRow } = renderRoundEditor();

    const moveDownButtons = screen.getAllByRole('button', { name: /move row down/i });
    await userEvent.click(moveDownButtons[0]);
    expect(onMoveRow).toHaveBeenCalledWith(0, 'down');

    const moveUpButtons = screen.getAllByRole('button', { name: /move row up/i });
    await userEvent.click(moveUpButtons[1]);
    expect(onMoveRow).toHaveBeenCalledWith(1, 'up');
  });

  it('shows a daily double indicator when a cell is marked', () => {
    const round = makeRound('JEOPARDY', [
      makeCategory('Science', 0, [
        makeClue({ row: 0, value: 100, clueText: 'H2O?', answer: 'Water', isDailyDouble: true }),
      ]),
    ]);

    renderRoundEditor({ round });

    expect(screen.getByTestId('daily-double-indicator')).toBeInTheDocument();
  });

  it('disables the left move button on the first category', () => {
    renderRoundEditor();

    const leftButtons = screen.getAllByRole('button', { name: /move category left/i });
    expect(leftButtons[0]).toBeDisabled();
    expect(leftButtons[1]).not.toBeDisabled();
  });

  it('disables the right move button on the last category', () => {
    renderRoundEditor();

    const rightButtons = screen.getAllByRole('button', { name: /move category right/i });
    expect(rightButtons[rightButtons.length - 1]).toBeDisabled();
    expect(rightButtons[0]).not.toBeDisabled();
  });
});
