import { useState } from 'react';
import { PasscodeGate } from '../components/PasscodeGate.js';
import { useHostAuth } from '../auth/useHostAuth.js';
import { AdminBoardLibrary } from '../views/admin/AdminBoardLibrary.js';
import { BoardEditor } from '../views/admin/BoardEditor.js';
import { boardApi } from '../api/boards.js';
import type { BoardWithRounds } from '../api/boards.js';

function AdminContent() {
  const { token } = useHostAuth();
  const [selectedBoard, setSelectedBoard] = useState<BoardWithRounds | null>(null);

  if (!token) {
    return null;
  }

  if (selectedBoard) {
    return (
      <BoardEditor
        board={selectedBoard}
        token={token}
        api={boardApi}
        onBack={() => setSelectedBoard(null)}
      />
    );
  }

  return (
    <AdminBoardLibrary
      token={token}
      api={boardApi}
      onOpenBoard={setSelectedBoard}
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
