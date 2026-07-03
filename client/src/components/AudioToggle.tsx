import styles from './AudioToggle.module.css';

interface AudioToggleProps {
  muted: boolean;
  onToggle: () => void;
}

export function AudioToggle({ muted, onToggle }: AudioToggleProps) {
  return (
    <button
      type="button"
      className={styles.toggle}
      data-testid="audio-toggle"
      data-muted={muted}
      aria-pressed={muted}
      aria-label={muted ? 'Unmute audio' : 'Mute audio'}
      onClick={onToggle}
    >
      <span className={styles.icon} aria-hidden="true">
        {muted ? '🔇' : '🔊'}
      </span>
      <span className={styles.label}>{muted ? 'Audio muted' : 'Audio on'}</span>
    </button>
  );
}
