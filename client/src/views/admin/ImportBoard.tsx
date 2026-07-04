import { useState } from 'react';
import type { BoardApiClient, BoardWithRounds, ImportPreview, RoundInput } from '../../api/boards.js';
import styles from './admin.module.css';
import {
  createEditableBoard,
  moveClueToCategory,
  parsePositiveInteger,
  setIncludeDoubleJeopardy,
  updateBoardName,
  updateClueAnswer,
  updateClueText,
  updateClueValue,
  updateDefaultTimer,
  updateFinalTimer,
  type EditableBoard,
} from './importHelpers.js';

interface ImportBoardProps {
  token: string;
  api: BoardApiClient;
  onBack: () => void;
  onSave?: (board: BoardWithRounds) => void;
}

const TEMPLATE_FILENAME = 'jeopardy-board-template.csv';

const TEMPLATE_ROWS: string[][] = [
  ['Round', 'Category', 'Value', 'Clue', 'Answer', 'Daily Double'],
  ['Jeopardy', 'Sample Category One', '100', 'A clue shown to players, phrased as a statement', 'What is the correct response?', ''],
  ['Jeopardy', 'Sample Category One', '200', 'Another clue in this category', 'What is ...?', ''],
  ['Jeopardy', 'Sample Category One', '300', 'A clue that happens to be a Daily Double', 'What is ...?', 'yes'],
  ['Jeopardy', 'Sample Category Two', '100', 'The first clue in the second category', 'What is ...?', ''],
  ['Jeopardy', 'Sample Category Two', '200', 'The second clue in the second category', 'What is ...?', ''],
  ['Double Jeopardy', 'Sample Double Jeopardy Category', '400', 'A Double Jeopardy clue', 'What is ...?', ''],
  ['Double Jeopardy', 'Sample Double Jeopardy Category', '800', 'Another Double Jeopardy clue', 'What is ...?', ''],
  ['Final', 'Final Jeopardy Category', '', 'The single Final Jeopardy clue', 'What is ...?', ''],
];

function escapeCsvField(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function buildTemplateCsv(): string {
  return TEMPLATE_ROWS.map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
}

interface EditablePreviewProps {
  preview: ImportPreview;
  board: EditableBoard;
  onChange: (board: EditableBoard) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  error: string | null;
}

function ConfidenceIndicator({ confidence }: { confidence: number }) {
  if (confidence >= 1) return null;
  const percentage = Math.round(confidence * 100);
  return (
    <span className={styles.lowConfidenceIndicator} data-testid="low-confidence-indicator">
      Low confidence: {percentage}%
    </span>
  );
}

function roundTitle(type: RoundInput['type']): string {
  switch (type) {
    case 'JEOPARDY':
      return 'Jeopardy Round';
    case 'DOUBLE_JEOPARDY':
      return 'Double Jeopardy Round';
    case 'FINAL':
      return 'Final Jeopardy Round';
    default:
      return 'Round';
  }
}

function findValidationErrors(board: EditableBoard): string[] {
  const errors: string[] = [];

  if (board.name.trim().length === 0) {
    errors.push('Board name cannot be blank');
  }

  if (board.defaultTimerSeconds === undefined || board.defaultTimerSeconds <= 0) {
    errors.push('Per-clue timer must be a positive integer');
  }

  if (board.finalTimerSeconds === undefined || board.finalTimerSeconds <= 0) {
    errors.push('Final timer must be a positive integer');
  }

  for (const round of board.rounds) {
    if (round.type === 'DOUBLE_JEOPARDY' && !board.includeDoubleJeopardy) continue;

    for (const category of round.categories) {
      if (category.title.trim().length === 0) {
        errors.push(`${roundTitle(round.type)} category title cannot be blank`);
      }

      for (const clue of category.clues) {
        const text = clue.clueText.trim();
        const answer = clue.answer.trim();
        const hasContent = text.length > 0 || answer.length > 0;
        if (hasContent && (text.length === 0 || answer.length === 0)) {
          const missing = text.length === 0 ? 'clue text' : 'answer';
          errors.push(`Clue in "${category.title}" is missing ${missing}`);
        }
        if (round.type !== 'FINAL') {
          if (clue.value === null || clue.value <= 0) {
            errors.push(`Clue in "${category.title}" must have a positive value`);
          }
        }
      }
    }
  }

  return errors;
}

function EditablePreview({ preview, board, onChange, onSave, onCancel, isSaving, error }: EditablePreviewProps) {
  const validationErrors = findValidationErrors(board);
  const hasErrors = validationErrors.length > 0;

  const handleNameChange = (name: string) => {
    onChange(updateBoardName(board, name));
  };

  const handleDefaultTimerChange = (value: string) => {
    const parsed = parsePositiveInteger(value);
    onChange(updateDefaultTimer(board, parsed ?? 0));
  };

  const handleFinalTimerChange = (value: string) => {
    const parsed = parsePositiveInteger(value);
    onChange(updateFinalTimer(board, parsed ?? 0));
  };

  const handleToggleDouble = (enabled: boolean) => {
    onChange(setIncludeDoubleJeopardy(board, enabled));
  };

  return (
    <div className={styles.importPreview} data-testid="import-preview">
      <header className={styles.importPreviewHeader}>
        <div className={styles.previewHeaderFields}>
          <div className={styles.settingField}>
            <label htmlFor="preview-board-name">Board Name</label>
            <input
              id="preview-board-name"
              type="text"
              value={board.name}
              onChange={(event) => handleNameChange(event.target.value)}
              disabled={isSaving}
            />
          </div>
          <div className={styles.settingField}>
            <label htmlFor="preview-default-timer">Per-clue timer (seconds)</label>
            <input
              id="preview-default-timer"
              type="text"
              inputMode="numeric"
              value={board.defaultTimerSeconds}
              onChange={(event) => handleDefaultTimerChange(event.target.value)}
              disabled={isSaving}
              className={(board.defaultTimerSeconds ?? 0) <= 0 ? styles.invalidInput : undefined}
            />
          </div>
          <div className={styles.settingField}>
            <label htmlFor="preview-final-timer">Final timer (seconds)</label>
            <input
              id="preview-final-timer"
              type="text"
              inputMode="numeric"
              value={board.finalTimerSeconds}
              onChange={(event) => handleFinalTimerChange(event.target.value)}
              disabled={isSaving}
              className={(board.finalTimerSeconds ?? 0) <= 0 ? styles.invalidInput : undefined}
            />
          </div>
          <div className={styles.settingField}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={board.includeDoubleJeopardy}
                onChange={(event) => handleToggleDouble(event.target.checked)}
                disabled={isSaving}
              />
              Include Double Jeopardy
            </label>
          </div>
        </div>
        <div className={styles.previewConfidenceRow}>
          <ConfidenceIndicator confidence={preview.confidence} />
        </div>
      </header>

      {hasErrors && (
        <div className={styles.error} role="alert">
          <p>Please fix the following errors before saving:</p>
          <ul className={styles.validationList}>
            {validationErrors.map((message, index) => (
              // Errors are recomputed each render; index is stable enough for a simple list.
              // eslint-disable-next-line @eslint-react/no-array-index-key
              <li key={`error-${index}`}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.warnings.length > 0 && (
        <div className={styles.importWarnings} role="region" aria-label="Import warnings">
          <h3>Warnings</h3>
          <ul>
            {preview.warnings.map((warning, index) => (
              // Warnings are a stable list returned by the server; index is safe here.
              // eslint-disable-next-line @eslint-react/no-array-index-key
              <li key={`warning-${index}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.previewRounds}>
        {board.rounds.map((round) => {
          if (round.type === 'DOUBLE_JEOPARDY' && !board.includeDoubleJeopardy) return null;

          const columnCount = round.categories.length;
          const rowCount = round.categories.reduce(
            (max, category) => Math.max(max, category.clues.length),
            0,
          );

          return (
            <section key={round.type} className={styles.previewRound}>
              <h3 className={styles.sectionHeading}>{roundTitle(round.type)}</h3>
              {columnCount === 0 ? (
                <p className={styles.roundEmpty}>No categories in this round.</p>
              ) : (
                <div
                  className={styles.previewGrid}
                  style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(160px, 1fr))` }}
                >
                  {round.categories.map((category) => (
                    <div
                      key={`${round.type}-cat-${category.order}`}
                      className={styles.previewCategoryHeader}
                    >
                      {category.title}
                    </div>
                  ))}

                  {Array.from({ length: rowCount }).map((_, rowIndex) =>
                    round.categories.map((category, categoryIndex) => {
                      const clue = category.clues[rowIndex];
                      if (!clue) {
                        // Row position is part of the stable cell address in this row-major grid.
                        // eslint-disable-next-line @eslint-react/no-array-index-key
                        return <div key={`${round.type}-empty-${category.order}-${rowIndex}`} className={styles.previewCell} />;
                      }

                      const isFinal = round.type === 'FINAL';
                      const cellClass = isFinal
                        ? styles.previewCellFinal
                        : clue.isDailyDouble
                          ? styles.previewCellDailyDouble
                          : styles.previewCell;

                      const handleCategoryChange = (targetCategoryIndex: number) => {
                        onChange(moveClueToCategory(board, round.type, categoryIndex, rowIndex, targetCategoryIndex));
                      };

                      const handleValueChange = (value: string) => {
                        const parsed = value === '' ? null : Number(value);
                        if (value === '' || (parsed !== null && Number.isInteger(parsed))) {
                          onChange(updateClueValue(board, round.type, categoryIndex, rowIndex, parsed));
                        }
                      };

                      const handleTextChange = (clueText: string) => {
                        onChange(updateClueText(board, round.type, categoryIndex, rowIndex, clueText));
                      };

                      const handleAnswerChange = (answer: string) => {
                        onChange(updateClueAnswer(board, round.type, categoryIndex, rowIndex, answer));
                      };

                      return (
                        <div key={`${round.type}-cell-${category.order}-${clue.row}`} className={cellClass}>
                          <label className={styles.previewEditLabel}>
                            Category
                            <select
                              aria-label="Category"
                              value={categoryIndex}
                              onChange={(event) => handleCategoryChange(Number(event.target.value))}
                              disabled={isSaving}
                              className={styles.previewCategorySelect}
                            >
                              {round.categories.map((cat, index) => (
                                <option key={`${round.type}-opt-${cat.order}`} value={index}>
                                  {cat.title}
                                </option>
                              ))}
                            </select>
                          </label>

                          {!isFinal && (
                            <label className={styles.previewEditLabel}>
                              Value
                              <input
                                type="number"
                                aria-label="Value"
                                value={clue.value ?? ''}
                                onChange={(event) => handleValueChange(event.target.value)}
                                disabled={isSaving}
                                className={styles.previewEditInput}
                              />
                            </label>
                          )}

                          <label className={styles.previewEditLabel}>
                            Clue
                            <textarea
                              aria-label="Clue text"
                              value={clue.clueText}
                              onChange={(event) => handleTextChange(event.target.value)}
                              disabled={isSaving}
                              className={styles.previewEditTextarea}
                              rows={2}
                            />
                          </label>

                          <label className={styles.previewEditLabel}>
                            Answer
                            <textarea
                              aria-label="Answer"
                              value={clue.answer}
                              onChange={(event) => handleAnswerChange(event.target.value)}
                              disabled={isSaving}
                              className={styles.previewEditTextarea}
                              rows={2}
                            />
                          </label>

                          {clue.isDailyDouble && (
                            <span
                              className={styles.dailyDoubleIndicator}
                              data-testid="daily-double-indicator"
                            >
                              DD
                            </span>
                          )}
                        </div>
                      );
                    }),
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className={styles.stickyPreviewActions} data-testid="import-preview-actions">
        <button
          type="button"
          className={styles.backButton}
          onClick={() => void onCancel()}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.saveButton}
          onClick={() => void onSave()}
          disabled={isSaving || hasErrors}
          aria-busy={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Board'}
        </button>
      </div>
    </div>
  );
}

export function ImportBoard({ token, api, onBack, onSave }: ImportBoardProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [editableBoard, setEditableBoard] = useState<EditableBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file to upload.');
      return;
    }

    setIsUploading(true);
    setError(null);
    setPreview(null);
    setEditableBoard(null);

    try {
      const result = await api.importBoard(file, token);
      setPreview(result);
      setEditableBoard(createEditableBoard(result.board));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = TEMPLATE_FILENAME;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!editableBoard) return;

    const validationErrors = findValidationErrors(editableBoard);
    if (validationErrors.length > 0) {
      setError('Please fix the validation errors before saving.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const saved = await api.createBoard(editableBoard, token);
      onSave?.(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save board');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className={styles.library}>
      <header className={styles.libraryHeader}>
        <h1>Import Board</h1>
        <button type="button" className={styles.backButton} onClick={onBack}>
          Back to Library
        </button>
      </header>

      <section className={styles.importUpload}>
        <p className={styles.importDescription}>
          Upload a CSV or XLSX spreadsheet to preview it as a Jeopardy board. Nothing is saved
          until you confirm the preview.
        </p>
        <p className={styles.importDescription}>
          Each row is one clue, using the columns <strong>Round, Category, Value, Clue, Answer,
          Daily Double</strong>. Repeat the category on each of its clue rows, leave Value blank
          for Final Jeopardy, and put <strong>yes</strong> in the Daily Double column to mark one.
          Download the template to get started.
        </p>

        <div className={`${styles.importControls} ${styles.importTemplateActions}`}>
          <button
            type="button"
            className={styles.importButton}
            onClick={handleDownloadTemplate}
          >
            Download CSV Template
          </button>
        </div>

        <div className={styles.importControls}>
          <label htmlFor="import-file" className={styles.importFileLabel}>
            Upload a spreadsheet
          </label>
          <input
            id="import-file"
            type="file"
            accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(event) => {
              const selectedFile = event.target.files?.[0] ?? null;
              setFile(selectedFile);
              setError(null);
            }}
            disabled={isUploading || isSaving}
          />
          <button
            type="button"
            className={styles.createButton}
            onClick={() => void handleUpload()}
            disabled={isUploading || !file || isSaving}
            aria-busy={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>

        {error && !editableBoard && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </section>

      {preview && editableBoard && (
        <EditablePreview
          preview={preview}
          board={editableBoard}
          onChange={setEditableBoard}
          onSave={handleSave}
          onCancel={onBack}
          isSaving={isSaving}
          error={error}
        />
      )}
    </main>
  );
}
