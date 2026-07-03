import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioToggle } from './AudioToggle.js';

describe('AudioToggle', () => {
  it('renders an unmuted state and reflects it in the DOM', () => {
    render(<AudioToggle muted={false} onToggle={vi.fn()} />);

    const button = screen.getByRole('button', { name: /mute audio/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('data-muted', 'false');
  });

  it('renders a muted state and reflects it in the DOM', () => {
    render(<AudioToggle muted={true} onToggle={vi.fn()} />);

    const button = screen.getByRole('button', { name: /unmute audio/i });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('data-muted', 'true');
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    render(<AudioToggle muted={false} onToggle={onToggle} />);

    const button = screen.getByRole('button', { name: /mute audio/i });
    await userEvent.click(button);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
