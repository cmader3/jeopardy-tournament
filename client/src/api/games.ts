const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export type GameSummaryStatus = 'LOBBY' | 'IN_PROGRESS' | 'FINAL' | 'COMPLETE';

export interface GameSummary {
  roomCode: string;
  boardName: string;
  status: GameSummaryStatus;
  phase: string;
  playerCount: number;
  connectedCount: number;
  archived: boolean;
  completedAt: number | null;
  createdAt: string;
  updatedAt: string;
}

async function parseError(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({ error: 'Request failed' }))) as { error?: string };
  throw new Error(body.error ?? `Request failed: ${response.status}`);
}

export async function createGame(boardId: string, token: string): Promise<{ roomCode: string }> {
  const response = await fetch(`${API_BASE_URL}/api/games`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ boardId }),
  });

  if (!response.ok) {
    await parseError(response);
  }

  return response.json() as Promise<{ roomCode: string }>;
}

export async function listGames(token: string): Promise<GameSummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/games`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    await parseError(response);
  }

  const body = (await response.json()) as { games: GameSummary[] };
  return body.games;
}

export async function setGameArchived(roomCode: string, archived: boolean, token: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/games/${encodeURIComponent(roomCode)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ archived }),
  });

  if (!response.ok) {
    await parseError(response);
  }
}

export async function deleteGame(roomCode: string, token: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/games/${encodeURIComponent(roomCode)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    await parseError(response);
  }
}
