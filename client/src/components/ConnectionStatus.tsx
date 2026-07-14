import { useEffect, useRef, useState } from 'react';
import type { SocketStatus } from '../socket/useSocket.js';
import styles from './ConnectionStatus.module.css';

interface ConnectionStatusProps {
  status: SocketStatus | undefined;
}

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const [showReconnected, setShowReconnected] = useState(false);
  const prevRef = useRef<SocketStatus | undefined>(status);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = status;
    if (prev === 'reconnecting' && status === 'connected') {
      setShowReconnected(true);
      const id = setTimeout(() => setShowReconnected(false), 2500);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [status]);

  if (status === 'reconnecting') {
    return (
      <div
        className={styles.banner}
        role="status"
        aria-live="polite"
        data-testid="connection-reconnecting"
      >
        <span className={styles.spinner} aria-hidden="true" />
        Connection lost. Reconnecting…
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div
        className={`${styles.banner} ${styles.reconnected}`}
        role="status"
        aria-live="polite"
        data-testid="connection-reconnected"
      >
        Reconnected
      </div>
    );
  }

  return null;
}
