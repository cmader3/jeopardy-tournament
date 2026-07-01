const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

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
    const body = (await response.json().catch(() => ({ error: 'Request failed' }))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<{ roomCode: string }>;
}
