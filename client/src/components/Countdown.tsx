import { useServerTime } from '../hooks/useServerTime.js';
import styles from './Countdown.module.css';

interface CountdownProps {
  deadline: number | null;
  serverNow: number;
  showBar?: boolean;
}

export function Countdown({ deadline, serverNow, showBar }: CountdownProps) {
  const now = useServerTime(serverNow);

  if (deadline == null) return null;

  const remaining = Math.max(0, deadline - now);
  const seconds = Math.ceil(remaining / 1000);

  // The total duration is the server-projected window from the latest projection.
  const totalDuration = Math.max(0, deadline - serverNow);
  const widthPercent = totalDuration > 0 ? Math.round((remaining / totalDuration) * 100) : 0;

  return (
    <div className={styles.countdown} data-testid="countdown">
      {showBar && (
        <div className={styles.barTrack} data-testid="countdown-bar-track">
          <div
            className={styles.barFill}
            data-testid="countdown-bar"
            data-width-percent={widthPercent}
            style={{ width: `${widthPercent}%` }}
          />
        </div>
      )}
      <span className={styles.numeric} data-testid="countdown-numeric">
        {seconds}
      </span>
    </div>
  );
}
