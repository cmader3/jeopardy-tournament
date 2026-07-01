import { useEffect, useState } from 'react';
import type { BoardApiClient, BoardSummary, BoardWithRounds } from '../../api/boards.js';
import { createDefaultBoard } from './defaultBoard.js';
import styles from './admin.module.css';

interface AdminBoardLibraryProps {
  token: string;
  api: BoardApiClient;
  onOpenBoard: (board: BoardWithRounds) => void;
  onImport: () => void;
}

export function AdminBoardLibrary({ token, api, onOpenBoard, onImport }: AdminBoardLibraryProps) {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getBoards(token)
      .then((list) => {
        if (!cancelled) {
          setBoards(list);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load boards');
          setBoards([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, token]);

  const loadBoards = async () => {
    try {
      const list = await api.getBoards(token);
      setBoards(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load boards');
      setBoards([]);
    }
  };

  const handleCreate = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setIsCreating(true);
    try {
      const board = await api.createBoard(createDefaultBoard(), token);
      onOpenBoard(board);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create board');
    } finally {
      setIsBusy(false);
      setIsCreating(false);
    }
  };

  const handleOpen = async (summary: BoardSummary) => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      const board = await api.getBoard(summary.id, token);
      onOpenBoard(board);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open board');
    } finally {
      setIsBusy(false);
    }
  };

  const startRename = (summary: BoardSummary) => {
    setRenamingId(summary.id);
    setRenameValue(summary.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const confirmRename = async (summary: BoardSummary) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === summary.name) {
      cancelRename();
      return;
    }
    if (isBusy) return;
    setIsBusy(true);
    try {
      const board = await api.getBoard(summary.id, token);
      await api.updateBoard(summary.id, { ...board, name: trimmed }, token);
      setRenamingId(null);
      await loadBoards();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename board');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDuplicate = async (summary: BoardSummary) => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      const board = await api.getBoard(summary.id, token);
      await api.createBoard({ ...board, name: `${board.name} (copy)` }, token);
      await loadBoards();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to duplicate board');
    } finally {
      setIsBusy(false);
    }
  };

  const startDelete = (summary: BoardSummary) => {
    setDeletingId(summary.id);
  };

  const cancelDelete = () => {
    setDeletingId(null);
  };

  const confirmDelete = async (summary: BoardSummary) => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await api.deleteBoard(summary.id, token);
      setDeletingId(null);
      await loadBoards();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete board');
    } finally {
      setIsBusy(false);
    }
  };

  if (boards === null) {
    return (
      <main className={styles.library}>
        <p className={styles.loading}>Loading board library...</p>
      </main>
    );
  }

  return (
    <main className={styles.library}>
      <header className={styles.libraryHeader}>
        <h1>Board Library</h1>
        <div className={styles.libraryActions}>
          <button
            type="button"
            className={styles.importButton}
            onClick={onImport}
            disabled={isBusy}
          >
            Import Board
          </button>
          <button
            type="button"
            className={styles.createButton}
            onClick={handleCreate}
            disabled={isBusy || isCreating}
            aria-busy={isCreating}
          >
            {isCreating ? 'Creating...' : 'Create New Board'}
          </button>
        </div>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {boards.length === 0 ? (
        <section className={styles.emptyState}>
          <h2>No saved boards yet</h2>
          <p>Create a new board to start authoring clues and categories.</p>
        </section>
      ) : (
        <ul className={styles.boardList}>
          {boards.map((summary) => (
            <li key={summary.id} className={styles.boardItem}>
              {renamingId === summary.id ? (
                <form
                  className={styles.renameForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void confirmRename(summary);
                  }}
                >
                  <label htmlFor={`rename-${summary.id}`} className="visually-hidden">
                    Board name
                  </label>
                  <input
                    id={`rename-${summary.id}`}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    disabled={isBusy}
                    autoFocus
                  />
                  <button type="submit" disabled={isBusy || !renameValue.trim()}>
                    Save
                  </button>
                  <button type="button" onClick={cancelRename} disabled={isBusy}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div className={styles.boardInfo}>
                    <h2 className={styles.boardName}>{summary.name}</h2>
                    <p className={styles.boardMeta}>
                      {summary.includeDoubleJeopardy ? 'Double Jeopardy' : 'Single round'}
                      {' · '}
                      {summary.defaultTimerSeconds}s per clue
                      {' · '}
                      {summary.finalTimerSeconds}s Final
                      {' · '}
                      Last updated {new Date(summary.updatedAt).toLocaleString()}
                      {!summary.isComplete && (
                        <span className={styles.incompleteBadge}> · Incomplete</span>
                      )}
                    </p>
                  </div>
                  <div className={styles.boardActions}>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => void handleOpen(summary)}
                      disabled={isBusy}
                      aria-label={`Open ${summary.name}`}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => startRename(summary)}
                      disabled={isBusy}
                      aria-label={`Rename ${summary.name}`}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => void handleDuplicate(summary)}
                      disabled={isBusy}
                      aria-label={`Duplicate ${summary.name}`}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className={styles.deleteButton}
                      onClick={() => startDelete(summary)}
                      disabled={isBusy}
                      aria-label={`Delete ${summary.name}`}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
              {deletingId === summary.id && (
                <div className={styles.confirmDialog} role="alertdialog" aria-modal="true">
                  <p>Delete <strong>{summary.name}</strong>?</p>
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={styles.deleteButton}
                      onClick={() => void confirmDelete(summary)}
                      disabled={isBusy}
                    >
                      Confirm Delete
                    </button>
                    <button type="button" onClick={cancelDelete} disabled={isBusy}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
