import { useEffect, useRef, useSyncExternalStore } from 'react';

function subscribe(callback: () => void): () => void {
  const id = setInterval(callback, 100);
  return () => clearInterval(id);
}

export function useServerTime(serverNow: number): number {
  const offsetRef = useRef(0);
  useEffect(() => {
    offsetRef.current = serverNow - Date.now();
  }, [serverNow]);

  return useSyncExternalStore(
    subscribe,
    () => Date.now() + offsetRef.current,
    () => serverNow,
  );
}
