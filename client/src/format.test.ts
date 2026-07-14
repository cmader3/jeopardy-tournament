import { describe, expect, it } from 'vitest';
import { formatScore } from './format.js';

describe('formatScore', () => {
  it('prefixes positive amounts with a dollar sign', () => {
    expect(formatScore(400)).toBe('$400');
  });

  it('renders zero as $0', () => {
    expect(formatScore(0)).toBe('$0');
  });

  it('places the minus sign before the dollar sign for negatives', () => {
    expect(formatScore(-100)).toBe('-$100');
  });

  it('truncates fractional values and avoids negative zero', () => {
    expect(formatScore(199.9)).toBe('$199');
    expect(formatScore(-0.5)).toBe('$0');
  });

  it('falls back to $0 for non-finite values', () => {
    expect(formatScore(Number.NaN)).toBe('$0');
  });
});
