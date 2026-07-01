import type { Round } from '../../api/boards.js';
import styles from './admin.module.css';

interface FinalEditorProps {
  round: Round;
  onChange: (patch: { title?: string; clueText?: string; answer?: string }) => void;
}

export function FinalEditor({ round, onChange }: FinalEditorProps) {
  const category = round.categories[0];
  const clue = category?.clues[0];

  if (!category || !clue) {
    return <p className={styles.roundEmpty}>No Final Jeopardy clue found.</p>;
  }

  return (
    <section className={styles.finalEditor}>
      <div className={styles.finalField}>
        <label htmlFor="final-category">Final category</label>
        <input
          id="final-category"
          type="text"
          value={category.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="Final Category"
        />
      </div>

      <div className={styles.finalField}>
        <label htmlFor="final-clue">Final clue</label>
        <textarea
          id="final-clue"
          value={clue.clueText}
          onChange={(event) => onChange({ clueText: event.target.value })}
          placeholder="Final Jeopardy clue"
          rows={3}
        />
      </div>

      <div className={styles.finalField}>
        <label htmlFor="final-answer">Final answer</label>
        <textarea
          id="final-answer"
          value={clue.answer}
          onChange={(event) => onChange({ answer: event.target.value })}
          placeholder="Final Jeopardy answer"
          rows={3}
        />
      </div>
    </section>
  );
}
