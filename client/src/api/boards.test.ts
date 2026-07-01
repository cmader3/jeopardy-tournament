import { describe, expect, it, vi } from 'vitest';
import { boardApi } from './boards.js';

describe('boardApi', () => {
  it('surfaces server response details in the thrown error message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: 'Invalid request body',
          details: [
            { path: 'defaultTimerSeconds', message: 'Number must be greater than 0' },
            { path: 'rounds.0.categories.0.clues.0.answer', message: 'Answer cannot be blank' },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      boardApi.updateBoard('board-1', { name: 'Test', rounds: [] }, 'token'),
    ).rejects.toThrow('Invalid request body: Number must be greater than 0; Answer cannot be blank');

    vi.unstubAllGlobals();
  });
});
