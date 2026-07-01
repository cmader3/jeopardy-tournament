import { Fragment } from 'react';
import type { Clue, Round } from '../../api/boards.js';
import { isClueHole, rowCountForRound } from './boardHelpers.js';
import styles from './admin.module.css';

interface RoundEditorProps {
  round: Round;
  onAddCategory: () => void;
  onRemoveCategory: (categoryIndex: number) => void;
  onRenameCategory: (categoryIndex: number, title: string) => void;
  onMoveCategory: (categoryIndex: number, direction: 'left' | 'right') => void;
  onUpdateClue: (categoryIndex: number, row: number, patch: Partial<Clue>) => void;
  onMoveRow: (rowIndex: number, direction: 'up' | 'down') => void;
}

export function RoundEditor({
  round,
  onAddCategory,
  onRemoveCategory,
  onRenameCategory,
  onMoveCategory,
  onUpdateClue,
  onMoveRow,
}: RoundEditorProps) {
  const rowCount = rowCountForRound(round);
  const columnCount = round.categories.length;

  if (columnCount === 0) {
    return (
      <section className={styles.roundEditor} data-testid={`round-editor-${round.type}`}>
        <p className={styles.roundEmpty}>No categories yet.</p>
        <button type="button" className={styles.addCategoryButton} onClick={onAddCategory}>
          Add Category
        </button>
      </section>
    );
  }

  return (
    <section className={styles.roundEditor} data-testid={`round-editor-${round.type}`}>
      <header className={styles.roundEditorHeader}>
        <button type="button" className={styles.addCategoryButton} onClick={onAddCategory}>
          Add Category
        </button>
      </header>

      <div
        className={styles.editorGrid}
        style={{ gridTemplateColumns: `auto repeat(${columnCount}, minmax(140px, 1fr))` }}
      >
        <div className={styles.rowControlsHeader} aria-hidden="true" />

        {round.categories.map((category, categoryIndex) => (
          <div
            key={`${round.type}-header-${category.id ?? `order-${category.order}`}`}
            className={styles.categoryHeader}
          >
            <label htmlFor={`cat-title-${round.type}-${categoryIndex}`} className="visually-hidden">
              Category {categoryIndex + 1} title
            </label>
            <input
              id={`cat-title-${round.type}-${categoryIndex}`}
              type="text"
              className={styles.categoryTitleInput}
              value={category.title}
              onChange={(event) => onRenameCategory(categoryIndex, event.target.value)}
              placeholder="Category"
            />
            <div className={styles.categoryControls}>
              <button
                type="button"
                aria-label="Move category left"
                title="Move category left"
                disabled={categoryIndex === 0}
                onClick={() => onMoveCategory(categoryIndex, 'left')}
              >
                ←
              </button>
              <button
                type="button"
                aria-label="Move category right"
                title="Move category right"
                disabled={categoryIndex === columnCount - 1}
                onClick={() => onMoveCategory(categoryIndex, 'right')}
              >
                →
              </button>
              <button
                type="button"
                className={styles.deleteCategoryButton}
                aria-label="Remove category"
                title="Remove category"
                disabled={columnCount === 1}
                onClick={() => onRemoveCategory(categoryIndex)}
              >
                ×
              </button>
            </div>
          </div>
        ))}

        {Array.from({ length: rowCount }).map((_, rowIndex) => (
          // Row position is the stable identifier for each row's controls and cells.
          // eslint-disable-next-line @eslint-react/no-array-index-key
          <Fragment key={`${round.type}-row-${rowIndex}`}>
            <div className={styles.rowControls}>
              <button
                type="button"
                aria-label="Move row up"
                title="Move row up"
                disabled={rowIndex === 0}
                onClick={() => onMoveRow(rowIndex, 'up')}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move row down"
                title="Move row down"
                disabled={rowIndex === rowCount - 1}
                onClick={() => onMoveRow(rowIndex, 'down')}
              >
                ↓
              </button>
            </div>
            {round.categories.map((category, categoryIndex) => {
              const clue = category.clues.find((c) => c.row === rowIndex);
              if (!clue) {
                // Row position is part of the stable cell address in this row-major grid.
                // eslint-disable-next-line @eslint-react/no-array-index-key
                return <div key={`${round.type}-empty-cell-${category.id ?? `order-${category.order}`}-${rowIndex}`} className={styles.clueCell} aria-hidden="true" />;
              }
              return renderClueCell(category, categoryIndex, clue);
            })}
          </Fragment>
        ))}
      </div>
    </section>
  );

  function renderClueCell(category: Round['categories'][number], categoryIndex: number, clue: Clue) {
    const valueId = `value-${round.type}-${categoryIndex}-${clue.row}`;
    const clueId = `clue-${round.type}-${categoryIndex}-${clue.row}`;
    const answerId = `answer-${round.type}-${categoryIndex}-${clue.row}`;
    const ddId = `dd-${round.type}-${categoryIndex}-${clue.row}`;

    return (
      <div
        key={`${round.type}-cell-${category.id ?? `order-${category.order}`}-${clue.row}`}
        className={clue.isDailyDouble ? styles.clueCellDailyDouble : styles.clueCell}
      >
        <div className={styles.clueValueRow}>
          <label htmlFor={valueId} className="visually-hidden">
            Value
          </label>
          <input
            id={valueId}
            type="number"
            min={0}
            step={100}
            className={styles.clueValueInput}
            value={clue.value ?? ''}
            placeholder="Value"
            onChange={(event) =>
              onUpdateClue(categoryIndex, clue.row, {
                value: event.target.value === '' ? 0 : Number(event.target.value),
              })
            }
          />
          <label className={styles.dailyDoubleLabel} htmlFor={ddId}>
            <input
              id={ddId}
              type="checkbox"
              checked={clue.isDailyDouble}
              onChange={(event) =>
                onUpdateClue(categoryIndex, clue.row, {
                  isDailyDouble: event.target.checked,
                })
              }
            />
            Daily double
          </label>
        </div>

        <label htmlFor={clueId} className="visually-hidden">
          Clue text
        </label>
        <textarea
          id={clueId}
          className={styles.clueTextarea}
          value={clue.clueText}
          placeholder="Clue text"
          rows={2}
          onChange={(event) =>
            onUpdateClue(categoryIndex, clue.row, { clueText: event.target.value })
          }
        />

        <label htmlFor={answerId} className="visually-hidden">
          Answer
        </label>
        <textarea
          id={answerId}
          className={styles.answerTextarea}
          value={clue.answer}
          placeholder="Answer"
          rows={2}
          onChange={(event) =>
            onUpdateClue(categoryIndex, clue.row, { answer: event.target.value })
          }
        />

        {isClueHole(clue) && (
          <span
            className={styles.clueHoleMarker}
            aria-label="Clue is incomplete"
            data-testid="clue-hole-marker"
          >
            •
          </span>
        )}

        {clue.isDailyDouble && (
          <span
            className={styles.dailyDoubleIndicator}
            aria-hidden="true"
            data-testid="daily-double-indicator"
          >
            DD
          </span>
        )}
      </div>
    );
  }
}
