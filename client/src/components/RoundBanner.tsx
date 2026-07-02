import styles from './RoundBanner.module.css';

interface RoundBannerProps {
  roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL';
}

const ROUND_LABELS: Record<RoundBannerProps['roundType'], string> = {
  JEOPARDY: 'Jeopardy!',
  DOUBLE_JEOPARDY: 'Double Jeopardy!',
  FINAL: 'Final Jeopardy!',
};

export function RoundBanner({ roundType }: RoundBannerProps) {
  return (
    <div className={styles.roundBanner} data-testid="round-banner">
      {ROUND_LABELS[roundType]}
    </div>
  );
}
