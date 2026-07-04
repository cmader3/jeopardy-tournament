import { useEffect, useState } from 'react';
import type { BoardApiClient, BoardWithRounds, Clue } from '../../api/boards.js';
import {
  applyResize,
  computeBoardResizeImpact,
  deriveSettings,
  findBoardValidationErrors,
  getFinalRound,
  getPlayRound,
  isAuthoredCategory,
  isBoardComplete,
  parsePositiveInteger,
  rowCountForRound,
  setDoubleJeopardyEnabled,
  toUpdateInput,
} from './boardHelpers.js';
import {
  addCategory,
  moveCategory,
  moveRow,
  removeCategory,
  renameCategory,
  updateClue,
  updateFinal,
} from './roundEditorHelpers.js';
import { FinalEditor } from './FinalEditor.js';
import { RoundEditor } from './RoundEditor.js';
import styles from './admin.module.css';

interface BoardEditorProps {
  board: BoardWithRounds;
  token: string;
  api: BoardApiClient;
  onBack: () => void;
  onImport?: () => void;
}

interface PendingResize {
  desiredCategories: number;
  desiredRows: number;
  affectedCells: number;
}

interface PendingDelete {
  roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY';
  categoryIndex: number;
  categoryTitle: string;
}

export function BoardEditor({ board, token, api, onBack, onImport }: BoardEditorProps) {
  const [draft, setDraft] = useState<BoardWithRounds>(board);
  const [settings, setSettings] = useState(() => deriveSettings(board));
  const [pendingResize, setPendingResize] = useState<PendingResize | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Array<{ path: string; message: string }>>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const boardComplete = isBoardComplete(draft);

  useEffect(() => {
    if (!hasChanges) return undefined;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

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

  const updateDraft = (updater: (board: BoardWithRounds) => BoardWithRounds) => {
    const updated = updater(draft);
    setDraft(updated);
    const updatedJeopardy = getPlayRound(updated, 'JEOPARDY');
    setSettings((prev) => ({
      ...prev,
      categoryCount: String(updatedJeopardy?.categories.length ?? 0),
      rowCount: String(updatedJeopardy ? rowCountForRound(updatedJeopardy) : 0),
    }));
    setHasChanges(true);
    if (validationErrors.length > 0) {
      setValidationErrors([]);
    }
  };

  const handleAddCategory = (roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY') => {
    updateDraft((board) => addCategory(board, roundType));
  };

  const handleRemoveCategory = (roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY', categoryIndex: number) => {
    const round = roundType === 'JEOPARDY' ? getPlayRound(draft, 'JEOPARDY') : getPlayRound(draft, 'DOUBLE_JEOPARDY');
    const category = round?.categories[categoryIndex];
    if (!category) return;

    if (isAuthoredCategory(category)) {
      setPendingDelete({ roundType, categoryIndex, categoryTitle: category.title });
      return;
    }

    updateDraft((board) => removeCategory(board, roundType, categoryIndex));
  };

  const confirmDeleteCategory = () => {
    if (!pendingDelete) return;
    updateDraft((board) => removeCategory(board, pendingDelete.roundType, pendingDelete.categoryIndex));
    setPendingDelete(null);
  };

  const cancelDeleteCategory = () => {
    setPendingDelete(null);
  };

  const handleRenameCategory = (roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY', categoryIndex: number, title: string) => {
    updateDraft((board) => renameCategory(board, roundType, categoryIndex, title));
  };

  const handleMoveCategory = (roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY', categoryIndex: number, direction: 'left' | 'right') => {
    updateDraft((board) => moveCategory(board, roundType, categoryIndex, direction));
  };

  const handleUpdateClue = (roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY', categoryIndex: number, row: number, patch: Partial<Clue>) => {
    updateDraft((board) => updateClue(board, roundType, categoryIndex, row, patch));
  };

  const handleMoveRow = (roundType: 'JEOPARDY' | 'DOUBLE_JEOPARDY', rowIndex: number, direction: 'up' | 'down') => {
    updateDraft((board) => moveRow(board, roundType, rowIndex, direction));
  };

  const handleUpdateFinal = (patch: { title?: string; clueText?: string; answer?: string }) => {
    updateDraft((board) => updateFinal(board, patch));
  };

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
    setValidationErrors([]);

    const defaultTimerValue = parsePositiveInteger(settings.defaultTimer);
    const finalTimerValue = parsePositiveInteger(settings.finalTimer);

    const coercedTimerValue = (value: string): number => {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    if (defaultTimerValue === null || finalTimerValue === null) {
      setError('Timer values must be positive integers');
    }

    const trimmedDraft = {
      ...draft,
      name: settings.name.trim(),
      defaultTimerSeconds: defaultTimerValue ?? coercedTimerValue(settings.defaultTimer),
      finalTimerSeconds: finalTimerValue ?? coercedTimerValue(settings.finalTimer),
    };
    const errors = findBoardValidationErrors(trimmedDraft);
    if (errors.length > 0) {
      setValidationErrors(errors);
    }

    setIsSaving(true);

    const payload = {
      ...toUpdateInput(trimmedDraft),
      name: trimmedDraft.name,
      includeDoubleJeopardy: settings.includeDoubleJeopardy,
      defaultTimerSeconds: trimmedDraft.defaultTimerSeconds,
      finalTimerSeconds: trimmedDraft.finalTimerSeconds,
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

  const handleBack = () => {
    if (hasChanges) {
      const confirmed = window.confirm('You have unsaved changes. Leave without saving?');
      if (!confirmed) return;
    }
    onBack();
  };

  const handleImport = () => {
    if (!onImport) return;
    if (hasChanges) {
      const confirmed = window.confirm('You have unsaved changes. Leave without saving?');
      if (!confirmed) return;
    }
    onImport();
  };

  const timerErrorClass = (value: string): string | undefined => {
    return parsePositiveInteger(value) === null ? styles.invalidInput : undefined;
  };

  return (
    <main className={styles.editor}>
      <header className={styles.editorHeader}>
        <button type="button" className={styles.backButton} onClick={handleBack}>
          Back to Library
        </button>
        <h1 className={styles.editorTitle}>{settings.name || board.name}</h1>
        <div className={styles.headerActions}>
          {!boardComplete && (
            <span className={styles.incompleteIndicator}>Incomplete</span>
          )}
          {hasChanges && <span className={styles.unsavedIndicator}>Unsaved changes</span>}
          {onImport && (
            <button
              type="button"
              className={styles.importButton}
              onClick={handleImport}
              disabled={isSaving}
            >
              Import (CSV or XLSX)
            </button>
          )}
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

      {validationErrors.length > 0 && (
        <div className={styles.error} role="alert" aria-live="polite">
          <p>Please fix the following errors before saving:</p>
          <ul className={styles.validationList}>
            {validationErrors.map((err) => (
              <li key={`${err.path}-${err.message}`}>{err.message}</li>
            ))}
          </ul>
        </div>
      )}

      <section className={styles.editorSummary}>
        <p className={styles.editorMeta}>
          {currentCategoryCount} {currentCategoryCount === 1 ? 'category' : 'categories'} × {currentRowCount}{' '}
          {currentRowCount === 1 ? 'row' : 'rows'} · {clueCount} {clueCount === 1 ? 'clue' : 'clues'}
          {!boardComplete && (
            <span className={styles.incompleteBadge}> · Incomplete</span>
          )}
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
          <RoundEditor
            round={jeopardyRound}
            onAddCategory={() => handleAddCategory('JEOPARDY')}
            onRemoveCategory={(index) => handleRemoveCategory('JEOPARDY', index)}
            onRenameCategory={(index, title) => handleRenameCategory('JEOPARDY', index, title)}
            onMoveCategory={(index, direction) => handleMoveCategory('JEOPARDY', index, direction)}
            onUpdateClue={(index, row, patch) => handleUpdateClue('JEOPARDY', index, row, patch)}
            onMoveRow={(rowIndex, direction) => handleMoveRow('JEOPARDY', rowIndex, direction)}
          />
        ) : (
          <p className={styles.roundEmpty}>No Jeopardy round found.</p>
        )}

        {draft.includeDoubleJeopardy ? (
          <>
            <h2 className={styles.sectionHeading}>Double Jeopardy Round</h2>
            {doubleRound ? (
              <RoundEditor
                round={doubleRound}
                onAddCategory={() => handleAddCategory('DOUBLE_JEOPARDY')}
                onRemoveCategory={(index) => handleRemoveCategory('DOUBLE_JEOPARDY', index)}
                onRenameCategory={(index, title) => handleRenameCategory('DOUBLE_JEOPARDY', index, title)}
                onMoveCategory={(index, direction) => handleMoveCategory('DOUBLE_JEOPARDY', index, direction)}
                onUpdateClue={(index, row, patch) => handleUpdateClue('DOUBLE_JEOPARDY', index, row, patch)}
                onMoveRow={(rowIndex, direction) => handleMoveRow('DOUBLE_JEOPARDY', rowIndex, direction)}
              />
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

      <section className={styles.previewSection}>
        <h2 className={styles.sectionHeading}>Final Jeopardy</h2>
        {finalRound ? (
          <FinalEditor round={finalRound} onChange={handleUpdateFinal} />
        ) : (
          <p className={styles.roundEmpty}>No Final Jeopardy round found.</p>
        )}
      </section>

      {pendingResize && (
        <div className={styles.confirmDialogModal} role="alertdialog" aria-modal="true">
          <div className={styles.confirmCard}>
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
        </div>
      )}

      {pendingDelete && (
        <div className={styles.confirmDialogModal} role="alertdialog" aria-modal="true">
          <div className={styles.confirmCard}>
            <p>
              Delete <strong>{pendingDelete.categoryTitle}</strong> and its clues?
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.deleteButton}
                onClick={confirmDeleteCategory}
                disabled={isSaving}
              >
                Delete Category
              </button>
              <button type="button" onClick={cancelDeleteCategory} disabled={isSaving}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
