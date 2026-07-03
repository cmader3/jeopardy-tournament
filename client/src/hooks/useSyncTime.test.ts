import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSyncTime } from './useSyncTime.js';

describe('useSyncTime', () => {
  it('caches the snapshot so getSnapshot returns a stable reference between renders', async () => {
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let counter = 0;
    const { result, rerender } = renderHook(() => useSyncTime(() => ++counter, 50, 0));

    const first = result.current;
    expect(first).toBe(0);

    // Re-render without a store update should keep the same cached snapshot.
    rerender();
    expect(result.current).toBe(first);

    // Wait for the interval to fire and update the snapshot.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(result.current).toBeGreaterThan(first);

    const warningCalls = warnSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('getSnapshot should be cached')),
    );
    expect(warningCalls).toHaveLength(0);

    warnSpy.mockRestore();
  });
});
