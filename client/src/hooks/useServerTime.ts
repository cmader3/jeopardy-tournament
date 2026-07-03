import { useCallback, useEffect, useRef } from 'react';
import { useSyncTime } from './useSyncTime.js';

export function useServerTime(serverNow: number): number {
  const offsetRef = useRef(0);
  useEffect(() => {
    offsetRef.current = serverNow - Date.now();
  }, [serverNow]);

  // Keep the offset ref fresh without re-creating the getTime callback.
  const getTime = useCallback(() => Date.now() + offsetRef.current, []);

  return useSyncTime(getTime, 100, serverNow);
}
