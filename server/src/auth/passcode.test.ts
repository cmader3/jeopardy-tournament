import { describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { constantTimeCompare } from './passcode.js';

describe('constantTimeCompare', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeCompare('jeopardy', 'jeopardy')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(constantTimeCompare('jeopardy', 'jeopard!')).toBe(false);
  });

  it('returns false for strings with different lengths', () => {
    expect(constantTimeCompare('jeopardy', 'jeopardy!')).toBe(false);
  });

  it('uses crypto.timingSafeEqual for equal-length strings', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual').mockReturnValue(true);
    constantTimeCompare('a', 'a');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
