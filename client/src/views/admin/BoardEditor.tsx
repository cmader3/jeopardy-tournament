import { useState } from 'react';
import type { BoardApiClient, BoardWithRounds, Round } from '../../api/boards.js';
import {
  applyResize,
  computeBoardResizeImpact,
  deriveSettings,
  getFinalRound,
  getPlayRound,
  isAuthoredClue,
  parsePositiveInteger,
  rowCountForRound,
  setDoubleJeopardyEnabled,
  toUpdateInput,
} from './boardHelpers.js';
import styles from './admin.module.css';

interface BoardEditorProps {
  board: BoardWithRounds;
  token: string;
  api: BoardApiClient;
  onBack: () => void;
}

interface PendingResize {
  desiredCategories: number;
  desiredRows: number;
  affectedCells: number;
}

interface RoundGridPreviewProps {
  round: Round;
}

function RoundGridPreview({ round }: RoundGridPreviewProps) {
  const rows = rowCountForRound(round);
  const columnCount = round.categories.length;

  if (columnCount === 0) {
    return <p className={styles.roundEmpty}>No categories yet.</p>;
  }

  const cells: React.ReactNode[] = [];
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    for (const category of round.categories) {
      const clue = category.clues[rowIndex];
      const hasContent = clue !== undefined && isAuthoredClue(clue);
      const value = clue?.value ?? null;
      const cellKey = `${round.type}-${category.id ?? `order-${category.order}`}-${rowIndex}`;

      cells.push(
        <div key={cellKey} className={hasContent ? styles.cellFilled : styles.cellBlank}>
          <span className={styles.cellValue}>{value === null ? '—' : `$${value}`}</span>
          {hasContent && <span className={styles.cellIndicator} title="Has authored content" />}
        </div>,
      );
    }
  }

  return (
    <div
      className={styles.roundGrid}
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(120px, 1fr))` }}
      data-testid={`round-grid-${round.type}`}
    >
      {round.categories.map((category) => (
        <div
          key={`${round.type}-header-${category.id ?? `order-${category.order}`}`}
          className={styles.categoryHeader}
        >
          {category.title.trim() ? category.title : <span className={styles.placeholderTitle}>Category</span>}
        </div>
      ))}
      {cells}
    </div>
  );
}

export function BoardEditor({ board, token, api, onBack }: BoardEditorProps) {
  const [draft, setDraft] = useState<BoardWithRounds>(board);
  const [settings, setSettings] = useState(() => deriveSettings(board));
  const [pendingResize, setPendingResize] = useState<PendingResize | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const jeopardyRound = getPlayRound(draft, 'JEOPARDY');
  const currentCategoryCount = jeopardyRound?.categories.length ?? 0;
  const currentRowCount = jeopardyRound ? rowCountForRound(jeopardyRound) : 0;
  const doubleRound = getPlayRound(draft, 'DOUBLE_JEOPARDY');
  const finalRound = getFinalRound(draft);

  const clueCount = draft.rounds.reduce(
    (total, round) =>
      total + round.categories.reduce((catTotal, category) => catTotal + category.clues.length, 0),
    0,
  );

  const attemptResize = (desiredCategories: number, desiredRows: number) => {
    if (desiredCategories === currentCategoryCount && desiredRows === currentRowCount) {
      setPendingResize(null);
      return;
    }

    const impact = computeBoardResizeImpact(draft, desiredCategories, desiredRows);
    if (impact.wouldDelete) {
      setPendingResize({ desiredCategories, desiredRows, affectedCells: impact.affectedCells });
      return;
    }

    const resized = applyResize(draft, desiredCategories, desiredRows);
    setDraft(resized);
    setPendingResize(null);
    setHasChanges(true);
  };

  const confirmResize = () => {
    if (!pendingResize) return;
    const resized = applyResize(draft, pendingResize.desiredCategories, pendingResize.desiredRows);
    setDraft(resized);
    setPendingResize(null);
    setHasChanges(true);
  };

  const cancelResize = () => {
    setPendingResize(null);
    setSettings((prev) => ({
      ...prev,
      categoryCount: String(currentCategoryCount),
      rowCount: String(currentRowCount),
    }));
  };

  const handleCategoryCountChange = (value: string) => {
    setSettings((prev) => ({ ...prev, categoryCount: value }));
    const desired = parsePositiveInteger(value);
    if (desired === null) return;
    attemptResize(desired, currentRowCount);
  };

  const handleRowCountChange = (value: string) => {
    setSettings((prev) => ({ ...prev, rowCount: value }));
    const desired = parsePositiveInteger(value);
    if (desired === null) return;
    attemptResize(currentCategoryCount, desired);
  };

  const handleToggleDouble = (enabled: boolean) => {
    const updated = setDoubleJeopardyEnabled(draft, enabled);
    setDraft(updated);
    setSettings((prev) => ({ ...prev, includeDoubleJeopardy: enabled }));
    setHasChanges(true);
  };

  const handleNameChange = (name: string) => {
    setSettings((prev) => ({ ...prev, name }));
    setDraft((prev) => ({ ...prev, name }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);

    const defaultTimerValue = parsePositiveInteger(settings.defaultTimer);
    const finalTimerValue = parsePositiveInteger(settings.finalTimer);

    const payload = {
      ...toUpdateInput(draft),
      name: settings.name.trim(),
      includeDoubleJeopardy: settings.includeDoubleJeopardy,
      defaultTimerSeconds:
        defaultTimerValue ?? (settings.defaultTimer as unknown as number),
      finalTimerSeconds: finalTimerValue ?? (settings.finalTimer as unknown as number),
    };

    try {
      const updated = await api.updateBoard(board.id, payload, token);
      setDraft(updated);
      setSettings(deriveSettings(updated));
      setHasChanges(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save board');
    } finally {
      setIsSaving(false);
    }
  };

  const timerErrorClass = (value: string): string | undefined => {
    return parsePositiveInteger(value) === null ? styles.invalidInput : undefined;
  };

  return (
    <main className={styles.editor}>
      <header className={styles.editorHeader}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          Back to Library
        </button>
        <h1 className={styles.editorTitle}>{settings.name || board.name}</h1>
        <div className={styles.headerActions}>
          {hasChanges && <span className={styles.unsavedIndicator}>Unsaved changes</span>}
          <button
            type="button"
            className={styles.saveButton}
            onClick={() => void handleSave()}
            disabled={isSaving}
            aria-busy={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Board'}
          </button>
        </div>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <section className={styles.editorSummary}>
        <p className={styles.editorMeta}>
          {currentCategoryCount} {currentCategoryCount === 1 ? 'category' : 'categories'} × {currentRowCount}{' '}
          {currentRowCount === 1 ? 'row' : 'rows'} · {clueCount} {clueCount === 1 ? 'clue' : 'clues'}
        </p>
        <p className={styles.editorMeta}>
          {draft.includeDoubleJeopardy ? 'Double Jeopardy enabled' : 'Double Jeopardy disabled'} ·{' '}
          {settings.defaultTimer}s per clue · {settings.finalTimer}s Final
        </p>
        {finalRound && finalRound.categories.length > 0 && (
          <p className={styles.editorMeta}>
            Final category: {finalRound.categories[0].title.trim() || 'Final Category'}
          </p>
        )}
      </section>

      <section className={styles.settingsSection}>
        <h2 className={styles.sectionHeading}>Board Settings</h2>

        <div className={styles.settingsGrid}>
          <div className={styles.settingField}>
            <label htmlFor="board-name">Board Name</label>
            <input
              id="board-name"
              type="text"
              value={settings.name}
              onChange={(e) => handleNameChange(e.target.value)}
              disabled={isSaving}
            />
          </div>

          <div className={styles.settingField}>
            <label htmlFor="category-count">Categories</label>
            <input
              id="category-count"
              type="number"
              min={1}
              value={settings.categoryCount}
              onChange={(e) => handleCategoryCountChange(e.target.value)}
              disabled={isSaving || pendingResize !== null}
            />
          </div>

          <div className={styles.settingField}>
            <label htmlFor="row-count">Rows</label>
            <input
              id="row-count"
              type="number"
              min={1}
              value={settings.rowCount}
              onChange={(e) => handleRowCountChange(e.target.value)}
              disabled={isSaving || pendingResize !== null}
            />
          </div>

          <div className={styles.settingField}>
            <label htmlFor="default-timer">Per-clue timer (seconds)</label>
            <input
              id="default-timer"
              type="text"
              inputMode="numeric"
              className={timerErrorClass(settings.defaultTimer)}
              value={settings.defaultTimer}
              onChange={(e) => {
                setSettings((prev) => ({ ...prev, defaultTimer: e.target.value }));
                setHasChanges(true);
              }}
              disabled={isSaving}
            />
          </div>

          <div className={styles.settingField}>
            <label htmlFor="final-timer">Final Jeopardy timer (seconds)</label>
            <input
              id="final-timer"
              type="text"
              inputMode="numeric"
              className={timerErrorClass(settings.finalTimer)}
              value={settings.finalTimer}
              onChange={(e) => {
                setSettings((prev) => ({ ...prev, finalTimer: e.target.value }));
                setHasChanges(true);
              }}
              disabled={isSaving}
            />
          </div>

          <div className={styles.settingField}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={settings.includeDoubleJeopardy}
                onChange={(e) => handleToggleDouble(e.target.checked)}
                disabled={isSaving}
              />
              Include Double Jeopardy
            </label>
          </div>
        </div>
      </section>

      <section className={styles.previewSection}>
        <h2 className={styles.sectionHeading}>Jeopardy Round</h2>
        {jeopardyRound ? (
          <RoundGridPreview round={jeopardyRound} />
        ) : (
          <p className={styles.roundEmpty}>No Jeopardy round found.</p>
        )}

        {draft.includeDoubleJeopardy ? (
          <>
            <h2 className={styles.sectionHeading}>Double Jeopardy Round</h2>
            {doubleRound ? (
              <RoundGridPreview round={doubleRound} />
            ) : (
              <p className={styles.roundEmpty}>No Double Jeopardy round found.</p>
            )}
          </>
        ) : (
          <p className={styles.doubleDisabledNote}>
            Double Jeopardy round is hidden. Its content will be restored if you re-enable it.
          </p>
        )}
      </section>

      {pendingResize && (
        <div className={styles.confirmDialog} role="alertdialog" aria-modal="true">
          <p>
            Shrinking the grid will delete {pendingResize.affectedCells} authored{' '}
            {pendingResize.affectedCells === 1 ? 'cell' : 'cells'}. Are you sure?
          </p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.deleteButton}
              onClick={confirmResize}
              disabled={isSaving}
            >
              Delete & Resize
            </button>
            <button type="button" onClick={cancelResize} disabled={isSaving}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
