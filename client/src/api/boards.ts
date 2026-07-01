export interface BoardSummary {
  id: string;
  name: string;
  includeDoubleJeopardy: boolean;
  defaultTimerSeconds: number;
  finalTimerSeconds: number;
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Clue {
  id: string;
  categoryId: string;
  value: number | null;
  row: number;
  clueText: string;
  answer: string;
  isDailyDouble: boolean;
}

export interface Category {
  id: string;
  roundId: string;
  title: string;
  order: number;
  clues: Clue[];
}

export interface Round {
  id: string;
  boardId: string;
  type: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL';
  order: number;
  categories: Category[];
}

export interface BoardWithRounds {
  id: string;
  name: string;
  includeDoubleJeopardy: boolean;
  defaultTimerSeconds: number;
  finalTimerSeconds: number;
  createdAt: string;
  updatedAt: string;
  isComplete: boolean;
  rounds: Round[];
}

export interface ClueInput {
  value: number | null;
  row: number;
  clueText: string;
  answer: string;
  isDailyDouble?: boolean;
}

export interface CategoryInput {
  title: string;
  order: number;
  clues: ClueInput[];
}

export interface RoundInput {
  type: 'JEOPARDY' | 'DOUBLE_JEOPARDY' | 'FINAL';
  order: number;
  categories: CategoryInput[];
}

export interface CreateBoardInput {
  name: string;
  includeDoubleJeopardy?: boolean;
  defaultTimerSeconds?: number;
  finalTimerSeconds?: number;
  rounds: RoundInput[];
}

export type UpdateBoardInput = CreateBoardInput;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function handleError(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({ error: 'Request failed' }))) as {
    error?: string;
    details?: Array<{ path: string; message: string }>;
  };
  const detailMessages = body.details?.map((detail) => detail.message).join('; ') ?? '';
  const message = [body.error, detailMessages].filter(Boolean).join(': ');
  throw new Error(message || `Request failed: ${response.status}`);
}

export const boardApi = {
  async getBoards(token: string): Promise<BoardSummary[]> {
    const response = await fetch(`${API_BASE_URL}/api/boards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) await handleError(response);
    return response.json();
  },

  async getBoard(id: string, token: string): Promise<BoardWithRounds> {
    const response = await fetch(`${API_BASE_URL}/api/boards/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) await handleError(response);
    return response.json();
  },

  async createBoard(input: CreateBoardInput, token: string): Promise<BoardWithRounds> {
    const response = await fetch(`${API_BASE_URL}/api/boards`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(input),
    });
    if (!response.ok) await handleError(response);
    return response.json();
  },

  async updateBoard(id: string, input: UpdateBoardInput, token: string): Promise<BoardWithRounds> {
    const response = await fetch(`${API_BASE_URL}/api/boards/${id}`, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify(input),
    });
    if (!response.ok) await handleError(response);
    return response.json();
  },

  async deleteBoard(id: string, token: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/boards/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) await handleError(response);
  },
};

export type BoardApiClient = typeof boardApi;
