import type { BoardWithRounds } from '../../api/boards.js';
import styles from './admin.module.css';

interface BoardEditorProps {
  board: BoardWithRounds;
  onBack: () => void;
}

export function BoardEditor({ board, onBack }: BoardEditorProps) {
  const jeopardyRound = board.rounds.find((round) => round.type === 'JEOPARDY');
  const finalRound = board.rounds.find((round) => round.type === 'FINAL');

  const categoryCount = jeopardyRound?.categories.length ?? 0;
  const rowCount =
    jeopardyRound?.categories.reduce((max, category) => Math.max(max, category.clues.length), 0) ?? 0;
  const clueCount = board.rounds.reduce(
    (total, round) =>
      total + round.categories.reduce((catTotal, category) => catTotal + category.clues.length, 0),
    0,
  );

  return (
    <main className={styles.editor}>
      <header className={styles.editorHeader}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          Back to Library
        </button>
        <h1 className={styles.editorTitle}>{board.name}</h1>
      </header>

      <section className={styles.editorSummary}>
        <p className={styles.editorMeta}>
          {categoryCount} {categoryCount === 1 ? 'category' : 'categories'} × {rowCount}{' '}
          {rowCount === 1 ? 'row' : 'rows'} · {clueCount} {clueCount === 1 ? 'clue' : 'clues'}
        </p>
        <p className={styles.editorMeta}>
          {board.includeDoubleJeopardy ? 'Double Jeopardy enabled' : 'Double Jeopardy disabled'} ·{' '}
          {board.defaultTimerSeconds}s per clue · {board.finalTimerSeconds}s Final
        </p>
        {finalRound && finalRound.categories.length > 0 && (
          <p className={styles.editorMeta}>
            Final category: {finalRound.categories[0].title}
          </p>
        )}
      </section>

      <section className={styles.editorPlaceholder}>
        <p>The full authoring editor (categories, clues, values, and Daily Doubles) is coming next.</p>
      </section>
    </main>
  );
}
