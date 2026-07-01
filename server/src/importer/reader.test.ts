import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSheets } from './parser.js';
import { readSpreadsheetBuffer } from './reader.js';

function parseBuffer(buffer: Buffer, name = 'Imported Board') {
  const sheets = readSpreadsheetBuffer(buffer);
  return parseSheets(sheets, name);
}

function getRound(board: ReturnType<typeof parseSheets>['board'], type: string) {
  return board.rounds.find((round) => round.type === type);
}

describe('readSpreadsheetBuffer', () => {
  it('decodes CSV as UTF-8 and preserves unicode, commas, quotes, and newlines', () => {
    const csv = [
      'Category,Value,Clue,Answer',
      'Café,100,"A flaky pastry, often with chocolate",Croissant',
      '北京,200,"Contains a cat, a comma, and ""quotes""","🐱, ""meow"""',
      'Emoji,300,"Line one\nLine two",🐱',
    ].join('\n');
    const buffer = Buffer.from(csv, 'utf-8');

    const result = parseBuffer(buffer, 'Unicode CSV');
    const jeopardy = getRound(result.board, 'JEOPARDY')!;

    expect(jeopardy.categories).toHaveLength(3);
    expect(jeopardy.categories[0].title).toBe('Café');
    expect(jeopardy.categories[0].clues[0]).toMatchObject({
      value: 100,
      clueText: 'A flaky pastry, often with chocolate',
      answer: 'Croissant',
    });
    expect(jeopardy.categories[1].title).toBe('北京');
    expect(jeopardy.categories[1].clues[0]).toMatchObject({
      value: 200,
      clueText: 'Contains a cat, a comma, and "quotes"',
      answer: '🐱, "meow"',
    });
    expect(jeopardy.categories[2].clues[0]).toMatchObject({
      value: 300,
      clueText: 'Line one\nLine two',
      answer: '🐱',
    });
  });

  it('strips a leading UTF-8 BOM from CSV so it does not appear in the first cell', () => {
    const csv = 'Category,Value,Clue,Answer\nCafé,100,Question,Answer';
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const buffer = Buffer.concat([bom, Buffer.from(csv, 'utf-8')]);

    const result = parseBuffer(buffer, 'BOM CSV');
    const jeopardy = getRound(result.board, 'JEOPARDY')!;

    expect(jeopardy.categories[0].title).toBe('Café');
    expect(jeopardy.categories[0].title).not.toMatch(/^\uFEFF/);
    expect(jeopardy.categories[0].clues[0].clueText).toBe('Question');
  });

  it('continues to parse XLSX workbooks with unicode and delimiters correctly', () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Category', 'Value', 'Clue', 'Answer'],
      ['Café', 100, 'A flaky pastry, often with chocolate', 'Croissant'],
      ['北京', 200, 'Contains a cat, a comma, and "quotes"', '🐱, "meow"'],
      ['Emoji', 300, 'Line one\nLine two', '🐱'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Jeopardy');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const result = parseBuffer(buffer, 'Unicode XLSX');
    const jeopardy = getRound(result.board, 'JEOPARDY')!;

    expect(jeopardy.categories).toHaveLength(3);
    expect(jeopardy.categories[0].title).toBe('Café');
    expect(jeopardy.categories[0].clues[0]).toMatchObject({
      value: 100,
      clueText: 'A flaky pastry, often with chocolate',
      answer: 'Croissant',
    });
    expect(jeopardy.categories[1].title).toBe('北京');
    expect(jeopardy.categories[1].clues[0]).toMatchObject({
      value: 200,
      clueText: 'Contains a cat, a comma, and "quotes"',
      answer: '🐱, "meow"',
    });
    expect(jeopardy.categories[2].clues[0]).toMatchObject({
      value: 300,
      clueText: 'Line one\nLine two',
      answer: '🐱',
    });
  });
});
