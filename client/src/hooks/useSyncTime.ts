import { useCallback, useRef, useSyncExternalStore } from 'react';

interface TimeSnapshot {
  now: number;
}

/**
 * Cached-sync-external-store time hook.
 *
 * React warns when `useSyncExternalStore` getSnapshot returns a fresh value on
 * every call. We keep a single mutable snapshot object and update it only when
 * the interval fires, so getSnapshot returns a stable reference between ticks.
 */
export function useSyncTime(
  getTime: () => number,
  intervalMs: number,
  serverSnapshot: number,
): number {
  const snapshotRef = useRef<TimeSnapshot>({ now: serverSnapshot });

  const subscribe = useCallback(
    (callback: () => void) => {
      const id = setInterval(() => {
        snapshotRef.current = { now: getTime() };
        callback();
      }, intervalMs);
      return () => clearInterval(id);
    },
    [getTime, intervalMs],
  );

  const getSnapshot = useCallback(() => snapshotRef.current, []);
  const getServerSnapshot = useCallback(() => snapshotRef.current, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).now;
}
