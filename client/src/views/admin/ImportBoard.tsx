import { useState } from 'react';
import type { BoardApiClient, ImportPreview, RoundInput } from '../../api/boards.js';
import styles from './admin.module.css';

interface ImportBoardProps {
  token: string;
  api: BoardApiClient;
  onBack: () => void;
}

interface ImportPreviewProps {
  preview: ImportPreview;
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

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) {
    return '';
  }
  return `$${value}`;
}

function ImportPreviewPanel({ preview }: ImportPreviewProps) {
  const { board } = preview;

  return (
    <div className={styles.importPreview} data-testid="import-preview">
      <header className={styles.importPreviewHeader}>
        <h2 className={styles.previewBoardName}>{board.name}</h2>
        <p className={styles.previewMeta}>
          {board.includeDoubleJeopardy ? 'Double Jeopardy' : 'Single round'}
          {' · '}
          {board.defaultTimerSeconds}s per clue
          {' · '}
          {board.finalTimerSeconds}s Final
          {preview.confidence < 1 && (
            <span className={styles.previewConfidence}>
              {' · '}
              Confidence: {Math.round(preview.confidence * 100)}%
            </span>
          )}
        </p>
      </header>

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

      <div className={styles.previewRounds}>
        {board.rounds.map((round) => {
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
                    round.categories.map((category) => {
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

                      return (
                        <div key={`${round.type}-cell-${category.order}-${clue.row}`} className={cellClass}>
                          {!isFinal && clue.value !== null && (
                            <span className={styles.previewValue}>{formatCurrency(clue.value)}</span>
                          )}
                          {clue.isDailyDouble && (
                            <span
                              className={styles.dailyDoubleIndicator}
                              data-testid="daily-double-indicator"
                            >
                              DD
                            </span>
                          )}
                          <span className={styles.previewClue}>{clue.clueText}</span>
                          <span className={styles.previewAnswer}>{clue.answer}</span>
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
    </div>
  );
}

export function ImportBoard({ token, api, onBack }: ImportBoardProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file to upload.');
      return;
    }

    setIsUploading(true);
    setError(null);
    setPreview(null);

    try {
      const result = await api.importBoard(file, token);
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setIsUploading(false);
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
            disabled={isUploading}
          />
          <button
            type="button"
            className={styles.createButton}
            onClick={() => void handleUpload()}
            disabled={isUploading || !file}
            aria-busy={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </section>

      {preview && <ImportPreviewPanel preview={preview} />}
    </main>
  );
}
