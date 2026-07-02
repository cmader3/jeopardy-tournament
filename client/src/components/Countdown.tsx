import { useServerTime } from '../hooks/useServerTime.js';
import styles from './Countdown.module.css';

interface CountdownProps {
  deadline: number | null;
  serverNow: number;
}

export function Countdown({ deadline, serverNow }: CountdownProps) {
  const now = useServerTime(serverNow);
  if (deadline == null) return null;

  const remaining = Math.max(0, deadline - now);
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div className={styles.countdown} data-testid="countdown">
      {seconds}
    </div>
  );
}
