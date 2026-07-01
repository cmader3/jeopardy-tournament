import { describe, expect, it } from 'vitest';
import type { SheetData } from './reader.js';
import { parseSheets } from './parser.js';

function sheet(name: string, matrix: (string | number | null)[][]): SheetData {
  return { name, matrix: matrix.map((row) => row.map((cell) => (cell === null ? '' : cell))) };
}

function getRound(board: ReturnType<typeof parseSheets>['board'], type: string) {
  return board.rounds.find((round) => round.type === type);
}

describe('parseSheets', () => {
  it('parses a column-oriented board with categories as headers and inferred values', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Science', 'History'],
        ['Water symbol?', 'Berlin Wall year?'],
        ['Speed of light?', 'First US president?'],
      ]),
    ];

    const result = parseSheets(sheets, 'Imported Board');
    const jeopardy = getRound(result.board, 'JEOPARDY');

    expect(jeopardy).toBeDefined();
    expect(jeopardy!.categories).toHaveLength(2);
    expect(jeopardy!.categories[0].title).toBe('Science');
    expect(jeopardy!.categories[0].clues).toHaveLength(2);
    expect(jeopardy!.categories[0].clues[0]).toMatchObject({
      value: 100,
      row: 0,
      clueText: 'Water symbol?',
      answer: '',
      isDailyDouble: false,
    });
    expect(jeopardy!.categories[1].clues[1]).toMatchObject({ value: 200, row: 1 });
    expect(result.board.includeDoubleJeopardy).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('uses an explicit values row in a column-oriented board', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Science', 'History'],
        [150, 250],
        ['Water symbol?', 'Berlin Wall year?'],
        ['Speed of light?', 'First US president?'],
      ]),
    ];

    const result = parseSheets(sheets);
    const jeopardy = getRound(result.board, 'JEOPARDY');

    expect(jeopardy!.categories[0].clues[0].value).toBe(150);
    expect(jeopardy!.categories[1].clues[0].value).toBe(250);
    expect(jeopardy!.categories[0].clues[1].value).toBe(150);
  });

  it('parses a flat tabular file with standard headers', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Category', 'Value', 'Clue', 'Answer'],
        ['Science', 100, 'Water symbol?', 'H2O'],
        ['Science', 200, 'Speed of light?', '299,792,458 m/s'],
        ['History', 100, 'Berlin Wall year?', '1989'],
      ]),
    ];

    const result = parseSheets(sheets);
    const jeopardy = getRound(result.board, 'JEOPARDY');

    expect(jeopardy!.categories).toHaveLength(2);
    expect(jeopardy!.categories[0].title).toBe('Science');
    expect(jeopardy!.categories[0].clues).toHaveLength(2);
    expect(jeopardy!.categories[0].clues[0]).toMatchObject({ value: 100, clueText: 'Water symbol?', answer: 'H2O' });
    expect(jeopardy!.categories[1].clues[0]).toMatchObject({ value: 100, clueText: 'Berlin Wall year?', answer: '1989' });
  });

  it('parses a flat tabular file with reordered and renamed columns', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Question', 'Points', 'Response', 'Topic'],
        ['Water symbol?', 100, 'H2O', 'Science'],
        ['Berlin Wall year?', 200, '1989', 'History'],
      ]),
    ];

    const result = parseSheets(sheets);
    const jeopardy = getRound(result.board, 'JEOPARDY');

    expect(jeopardy!.categories).toHaveLength(2);
    expect(jeopardy!.categories[0].title).toBe('Science');
    expect(jeopardy!.categories[0].clues[0]).toMatchObject({ value: 100, clueText: 'Water symbol?', answer: 'H2O' });
    expect(jeopardy!.categories[1].title).toBe('History');
    expect(jeopardy!.categories[1].clues[0]).toMatchObject({ value: 200, clueText: 'Berlin Wall year?', answer: '1989' });
  });

  it('detects Daily Doubles from a dedicated column', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Category', 'Value', 'Clue', 'Answer', 'DD'],
        ['Science', 100, 'Water symbol?', 'H2O', ''],
        ['History', 200, 'Berlin Wall year?', '1989', 'yes'],
        ['Science', 300, 'Planets?', 'Eight', 'TRUE'],
      ]),
    ];

    const result = parseSheets(sheets);
    const jeopardy = getRound(result.board, 'JEOPARDY');
    const clues = jeopardy!.categories.flatMap((category) => category.clues);

    expect(clues[0].isDailyDouble).toBe(false);
    expect(clues[1].isDailyDouble).toBe(true);
    expect(clues[2].isDailyDouble).toBe(true);
  });

  it('detects Daily Doubles from an inline marker and strips the marker', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Category', 'Value', 'Clue', 'Answer'],
        ['Science', 100, 'What is the water symbol? [DD]', 'H2O'],
        ['History', 200, 'Berlin Wall year?', '1989'],
      ]),
    ];

    const result = parseSheets(sheets);
    const jeopardy = getRound(result.board, 'JEOPARDY');

    expect(jeopardy!.categories[0].clues[0].isDailyDouble).toBe(true);
    expect(jeopardy!.categories[0].clues[0].clueText).toBe('What is the water symbol?');
    expect(jeopardy!.categories[1].clues[0].isDailyDouble).toBe(false);
  });

  it('detects rounds from separate sheet names', () => {
    const sheets = [
      sheet('Jeopardy', [
        ['Category', 'Value', 'Clue', 'Answer'],
        ['Science', 100, 'Water symbol?', 'H2O'],
      ]),
      sheet('Double Jeopardy', [
        ['Category', 'Value', 'Clue', 'Answer'],
        ['Science', 200, 'Heavier water?', 'D2O'],
      ]),
      sheet('Final', [
        ['Category', 'Clue', 'Answer'],
        ['Literature', 'He wrote The Hobbit', 'J.R.R. Tolkien'],
      ]),
    ];

    const result = parseSheets(sheets);

    expect(result.board.includeDoubleJeopardy).toBe(true);
    expect(getRound(result.board, 'JEOPARDY')).toBeDefined();
    expect(getRound(result.board, 'DOUBLE_JEOPARDY')).toBeDefined();
    expect(getRound(result.board, 'FINAL')).toBeDefined();

    const final = getRound(result.board, 'FINAL')!;
    expect(final.categories).toHaveLength(1);
    expect(final.categories[0].clues[0]).toMatchObject({ value: null, clueText: 'He wrote The Hobbit', answer: 'J.R.R. Tolkien' });
  });

  it('detects rounds from a Round column', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Category', 'Value', 'Clue', 'Answer', 'Round'],
        ['Science', 100, 'Water symbol?', 'H2O', 'Jeopardy'],
        ['History', 200, 'Berlin Wall year?', '1989', 'Double Jeopardy'],
        ['Literature', null, 'He wrote The Hobbit', 'J.R.R. Tolkien', 'Final'],
      ]),
    ];

    const result = parseSheets(sheets);

    expect(result.board.includeDoubleJeopardy).toBe(true);
    expect(getRound(result.board, 'JEOPARDY')!.categories).toHaveLength(1);
    expect(getRound(result.board, 'DOUBLE_JEOPARDY')!.categories).toHaveLength(1);
    expect(getRound(result.board, 'FINAL')!.categories[0].clues[0].value).toBeNull();
  });

  it('represents a Final round as a single category with one valueless clue', () => {
    const sheets = [
      sheet('Final', [
        ['Category', 'Clue', 'Answer'],
        ['Final Category', 'Final clue text', 'Final answer'],
      ]),
    ];

    const result = parseSheets(sheets);
    const final = getRound(result.board, 'FINAL');

    expect(final).toBeDefined();
    expect(final!.categories).toHaveLength(1);
    expect(final!.categories[0].clues).toHaveLength(1);
    expect(final!.categories[0].clues[0]).toMatchObject({ value: null, clueText: 'Final clue text', answer: 'Final answer' });
  });

  it('preserves duplicate category names as distinct categories', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Science', 'Science', 'Science'],
        ['Water symbol?', 'Speed of light?', 'Planets?'],
      ]),
    ];

    const result = parseSheets(sheets);
    const jeopardy = getRound(result.board, 'JEOPARDY');

    expect(jeopardy!.categories).toHaveLength(3);
    expect(jeopardy!.categories.every((category) => category.title === 'Science')).toBe(true);
    expect(jeopardy!.categories[0].clues[0].clueText).toBe('Water symbol?');
    expect(jeopardy!.categories[1].clues[0].clueText).toBe('Speed of light?');
  });

  it('preserves unicode and delimiter-laden content', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Category', 'Value', 'Clue', 'Answer'],
        ['Café', 100, 'A flaky pastry, often with chocolate', 'Croissant'],
        ['Emoji', 200, 'Contains a cat, a comma, and "quotes"', '🐱, "meow"'],
      ]),
    ];

    const result = parseSheets(sheets);
    const jeopardy = getRound(result.board, 'JEOPARDY');

    expect(jeopardy!.categories[0].title).toBe('Café');
    expect(jeopardy!.categories[0].clues[0].clueText).toBe('A flaky pastry, often with chocolate');
    expect(jeopardy!.categories[1].clues[0].answer).toBe('🐱, "meow"');
  });

  it('returns warnings and low confidence for an empty sheet', () => {
    const result = parseSheets([], 'Empty');

    expect(result.board.rounds).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('warns about rows with missing categories without fabricating data', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Category', 'Value', 'Clue', 'Answer'],
        ['', 100, 'No category', 'Answer'],
        ['History', 200, 'Berlin Wall year?', '1989'],
      ]),
    ];

    const result = parseSheets(sheets);

    expect(result.warnings.some((warning) => warning.toLowerCase().includes('missing category'))).toBe(true);
    const jeopardy = getRound(result.board, 'JEOPARDY')!;
    expect(jeopardy.categories.some((category) => category.title === '')).toBe(false);
    expect(jeopardy.categories).toHaveLength(1);
  });

  it('uses a Round column over the sheet name when they conflict', () => {
    const sheets = [
      sheet('Jeopardy', [
        ['Category', 'Value', 'Clue', 'Answer', 'Round'],
        ['History', 200, 'Berlin Wall year?', '1989', 'Double Jeopardy'],
      ]),
    ];

    const result = parseSheets(sheets);

    expect(result.board.includeDoubleJeopardy).toBe(true);
    expect(getRound(result.board, 'JEOPARDY')).toBeUndefined();
    expect(getRound(result.board, 'DOUBLE_JEOPARDY')!.categories[0].title).toBe('History');
  });

  it('supports a mix of flat and column-oriented sheets', () => {
    const sheets = [
      sheet('Jeopardy', [
        ['Category', 'Value', 'Clue', 'Answer'],
        ['Science', 100, 'Water symbol?', 'H2O'],
      ]),
      sheet('Double Jeopardy', [
        ['Science', 'History'],
        ['Heavy water?', 'First president?'],
        ['Nobel gas?', 'Cold War end?'],
      ]),
    ];

    const result = parseSheets(sheets);

    expect(result.board.includeDoubleJeopardy).toBe(true);
    expect(getRound(result.board, 'JEOPARDY')!.categories[0].clues[0].answer).toBe('H2O');
    expect(getRound(result.board, 'DOUBLE_JEOPARDY')!.categories[0].title).toBe('Science');
    expect(getRound(result.board, 'DOUBLE_JEOPARDY')!.categories[0].clues[0].value).toBe(200);
  });

  it('parses dollar-formatted and comma-separated values', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Category', 'Value', 'Clue', 'Answer'],
        ['Science', '$1,000', 'Expensive element?', 'Gold'],
        ['History', '2,000', 'Old empire?', 'Rome'],
      ]),
    ];

    const result = parseSheets(sheets);
    const jeopardy = getRound(result.board, 'JEOPARDY')!;

    expect(jeopardy.categories[0].clues[0].value).toBe(1000);
    expect(jeopardy.categories[1].clues[0].value).toBe(2000);
  });

  it('ignores empty rows and trailing blanks in column-oriented sheets', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Science', 'History'],
        ['', ''],
        ['Water symbol?', 'Berlin Wall year?'],
        ['', ''],
      ]),
    ];

    const result = parseSheets(sheets);
    const jeopardy = getRound(result.board, 'JEOPARDY')!;

    expect(jeopardy.categories[0].clues).toHaveLength(1);
    expect(jeopardy.categories[0].clues[0].clueText).toBe('Water symbol?');
  });

  it('recognizes round values with mixed case and whitespace', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Category', 'Value', 'Clue', 'Answer', 'Round'],
        ['Science', 100, 'Q1', 'A1', '  double jeopardy  '],
        ['Final', null, 'FQ', 'FA', 'FINAL'],
      ]),
    ];

    const result = parseSheets(sheets);

    expect(result.board.includeDoubleJeopardy).toBe(true);
    expect(getRound(result.board, 'DOUBLE_JEOPARDY')!.categories[0].title).toBe('Science');
    expect(getRound(result.board, 'FINAL')!.categories[0].clues[0].clueText).toBe('FQ');
  });

  it('tolerates extra unknown columns in flat tables', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Category', 'Value', 'Clue', 'Answer', 'Notes', 'Author'],
        ['Science', 100, 'Q', 'A', 'note', 'Alice'],
      ]),
    ];

    const result = parseSheets(sheets);
    const jeopardy = getRound(result.board, 'JEOPARDY')!;

    expect(jeopardy.categories[0].clues[0]).toMatchObject({ value: 100, clueText: 'Q', answer: 'A' });
  });

  it('flags half-filled clues in warnings', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Category', 'Value', 'Clue', 'Answer'],
        ['Science', 100, 'Only a clue', ''],
      ]),
    ];

    const result = parseSheets(sheets);

    expect(result.warnings.some((warning) => warning.toLowerCase().includes('structural'))).toBe(true);
  });

  it('collapses multiple Final categories from a flat tabular source to one valueless clue', () => {
    const sheets = [
      sheet('Sheet1', [
        ['Category', 'Value', 'Clue', 'Answer', 'Round'],
        ['First Final', null, 'First final clue', 'First answer', 'Final'],
        ['Second Final', 100, 'Second final clue', 'Second answer', 'Final'],
      ]),
    ];

    const result = parseSheets(sheets);
    const final = getRound(result.board, 'FINAL')!;

    expect(final.categories).toHaveLength(1);
    expect(final.categories[0].title).toBe('First Final');
    expect(final.categories[0].clues).toHaveLength(1);
    expect(final.categories[0].clues[0]).toMatchObject({
      value: null,
      clueText: 'First final clue',
      answer: 'First answer',
    });
    expect(result.warnings.some((warning) => warning.toLowerCase().includes('final'))).toBe(true);
  });

  it('collapses multiple Final rows within a single category to one valueless clue', () => {
    const sheets = [
      sheet('Final', [
        ['Category', 'Clue', 'Answer'],
        ['Final Category', 'First final clue', 'First answer'],
        ['Final Category', 'Second final clue', 'Second answer'],
      ]),
    ];

    const result = parseSheets(sheets);
    const final = getRound(result.board, 'FINAL')!;

    expect(final.categories).toHaveLength(1);
    expect(final.categories[0].clues).toHaveLength(1);
    expect(final.categories[0].clues[0]).toMatchObject({
      value: null,
      clueText: 'First final clue',
      answer: 'First answer',
    });
    expect(result.warnings.some((warning) => warning.toLowerCase().includes('final'))).toBe(true);
  });

  it('collapses multiple Final categories from a column-oriented source to one valueless clue', () => {
    const sheets = [
      sheet('Final', [
        ['Final One', 'Final Two'],
        ['The first item', 'The second item'],
      ]),
    ];

    const result = parseSheets(sheets);
    const final = getRound(result.board, 'FINAL')!;

    expect(final.categories).toHaveLength(1);
    expect(final.categories[0].title).toBe('Final One');
    expect(final.categories[0].clues).toHaveLength(1);
    expect(final.categories[0].clues[0]).toMatchObject({
      value: null,
      clueText: 'The first item',
      answer: '',
    });
    expect(result.warnings.some((warning) => warning.toLowerCase().includes('final'))).toBe(true);
  });

  it('collapses multiple Final categories across sheets to one valueless clue', () => {
    const sheets = [
      sheet('Final', [
        ['Category', 'Clue', 'Answer'],
        ['Sheet Final', 'First final clue', 'First answer'],
      ]),
      sheet('Final Extra', [
        ['Category', 'Clue', 'Answer'],
        ['Extra Final', 'Second final clue', 'Second answer'],
      ]),
    ];

    const result = parseSheets(sheets);
    const final = getRound(result.board, 'FINAL')!;

    expect(final.categories).toHaveLength(1);
    expect(final.categories[0].title).toBe('Sheet Final');
    expect(final.categories[0].clues).toHaveLength(1);
    expect(final.categories[0].clues[0]).toMatchObject({
      value: null,
      clueText: 'First final clue',
      answer: 'First answer',
    });
    expect(result.warnings.some((warning) => warning.toLowerCase().includes('final'))).toBe(true);
  });
});
