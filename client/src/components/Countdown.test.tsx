import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Countdown } from './Countdown.js';

describe('Countdown', () => {
  it('renders the remaining seconds from the server deadline', () => {
    const serverNow = 0;
    const deadline = serverNow + 5_000;
    render(<Countdown deadline={deadline} serverNow={serverNow} />);

    expect(screen.getByTestId('countdown')).toHaveTextContent('5');
  });

  it('decrements visibly over time', () => {
    vi.useFakeTimers();
    const serverNow = 0;
    const deadline = serverNow + 5_000;
    render(<Countdown deadline={deadline} serverNow={serverNow} />);

    expect(screen.getByTestId('countdown')).toHaveTextContent('5');

    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(screen.getByTestId('countdown')).toHaveTextContent('4');

    vi.useRealTimers();
  });

  it('returns null when no deadline is set', () => {
    const { container } = render(<Countdown deadline={null} serverNow={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('resyncs to a new server projection instead of restarting locally', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Countdown deadline={5_000} serverNow={0} />);
    expect(screen.getByTestId('countdown')).toHaveTextContent('5');

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByTestId('countdown')).toHaveTextContent('2');

    // A reloaded projection arrives: the server deadline is unchanged but serverNow has advanced.
    rerender(<Countdown deadline={5_000} serverNow={3_000} />);
    expect(screen.getByTestId('countdown')).toHaveTextContent('2');

    vi.useRealTimers();
  });
});
