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

  it('renders a shrinking countdown bar whose width is based on remaining time', () => {
    const serverNow = 0;
    const deadline = serverNow + 5_000;
    render(<Countdown deadline={deadline} serverNow={serverNow} showBar />);

    const bar = screen.getByTestId('countdown-bar');
    expect(bar).toHaveAttribute('data-width-percent', '100');
  });

  it('updates the bar width as time advances', () => {
    vi.useFakeTimers();
    const serverNow = 0;
    const deadline = serverNow + 5_000;
    render(<Countdown deadline={deadline} serverNow={serverNow} showBar />);

    act(() => {
      vi.advanceTimersByTime(2_500);
    });

    const bar = screen.getByTestId('countdown-bar');
    const width = Number(bar.getAttribute('data-width-percent'));
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(100);

    vi.useRealTimers();
  });

  it('resets the bar width when the deadline changes to a larger remaining value', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Countdown deadline={5_000} serverNow={0} showBar />);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    let bar = screen.getByTestId('countdown-bar');
    expect(Number(bar.getAttribute('data-width-percent'))).toBeLessThan(100);

    // Re-arm with a fresh deadline: 10 seconds from the new serverNow.
    rerender(<Countdown deadline={13_000} serverNow={3_000} showBar />);
    bar = screen.getByTestId('countdown-bar');
    expect(Number(bar.getAttribute('data-width-percent'))).toBe(100);

    vi.useRealTimers();
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
