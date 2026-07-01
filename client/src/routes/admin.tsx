import { useState } from 'react';
import { PasscodeGate } from '../components/PasscodeGate.js';
import { useHostAuth } from '../auth/useHostAuth.js';
import { AdminBoardLibrary } from '../views/admin/AdminBoardLibrary.js';
import { BoardEditor } from '../views/admin/BoardEditor.js';
import { ImportBoard } from '../views/admin/ImportBoard.js';
import { boardApi } from '../api/boards.js';
import type { BoardWithRounds } from '../api/boards.js';

type AdminView = 'library' | 'editor' | 'import';

function AdminContent() {
  const { token } = useHostAuth();
  const [selectedBoard, setSelectedBoard] = useState<BoardWithRounds | null>(null);
  const [view, setView] = useState<AdminView>('library');

  if (!token) {
    return null;
  }

  if (view === 'import') {
    return <ImportBoard token={token} api={boardApi} onBack={() => setView('library')} />;
  }

  if (selectedBoard) {
    return (
      <BoardEditor
        board={selectedBoard}
        token={token}
        api={boardApi}
        onBack={() => {
          setSelectedBoard(null);
          setView('library');
        }}
      />
    );
  }

  return (
    <AdminBoardLibrary
      token={token}
      api={boardApi}
      onOpenBoard={(board) => {
        setSelectedBoard(board);
        setView('editor');
      }}
      onImport={() => setView('import')}
    />
  );
}

export function AdminRoute() {
  return (
    <PasscodeGate>
      <AdminContent />
    </PasscodeGate>
  );
}
