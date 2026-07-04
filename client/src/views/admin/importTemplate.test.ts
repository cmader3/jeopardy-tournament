import { describe, it, expect } from 'vitest';
import { buildTemplateCsv } from './ImportBoard.js';

describe('buildTemplateCsv', () => {
  it('starts with a header row of the supported columns', () => {
    const lines = buildTemplateCsv().split('\r\n');
    expect(lines[0]).toBe('Round,Category,Value,Clue,Answer,Daily Double');
  });

  it('includes example rows for each round and a Daily Double marker', () => {
    const csv = buildTemplateCsv();
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(9);
    expect(csv).toContain('Jeopardy,Sample Category One,100,');
    expect(csv).toContain('Double Jeopardy,Sample Double Jeopardy Category,400,');
    expect(csv).toContain('Final,Final Jeopardy Category,,');
    expect(lines.some((line) => line.endsWith(',yes'))).toBe(true);
  });

  it('quotes fields that contain commas so the CSV stays valid', () => {
    expect(buildTemplateCsv()).toContain(
      '"A clue shown to players, phrased as a statement"',
    );
  });
});
