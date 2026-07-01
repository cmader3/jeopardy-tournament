import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { createApp } from './app.js';
import { prisma } from '../repo/prisma.js';
import { mintHostToken } from '../auth/token.js';

function authHeader() {
  return `Bearer ${mintHostToken()}`;
}

function authRequest(app: Parameters<typeof request>[0]) {
  return request.agent(app).set('Authorization', authHeader());
}

function csvBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf8');
}

function xlsxBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Category', 'Value', 'Clue', 'Answer'],
    ['Science', 100, 'Water symbol?', 'H2O'],
    ['History', 200, 'Berlin Wall year?', '1989'],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Jeopardy');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('POST /api/boards/import', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns a parsed board preview from a CSV upload without persisting anything', async () => {
    const app = createApp();
    const csv =
      'Category,Value,Clue,Answer\n' +
      'Science,100,Water symbol?,H2O\n' +
      'History,200,Berlin Wall year?,1989\n';

    const response = await authRequest(app)
      .post('/api/boards/import')
      .attach('file', csvBuffer(csv), { filename: 'sample.csv', contentType: 'text/csv' })
      .expect(200);

    expect(response.body.board.name).toBe('sample');
    expect(response.body.warnings).toBeDefined();
    expect(response.body.confidence).toBeDefined();

    const jeopardy = response.body.board.rounds.find((round: { type: string }) => round.type === 'JEOPARDY');
    expect(jeopardy).toBeDefined();
    expect(jeopardy.categories).toHaveLength(2);

    const library = await authRequest(app).get('/api/boards').expect(200);
    expect(library.body).toHaveLength(0);
  });

  it('returns a parsed board preview from an XLSX upload', async () => {
    const app = createApp();

    const response = await authRequest(app)
      .post('/api/boards/import')
      .attach('file', xlsxBuffer(), { filename: 'sample.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .expect(200);

    expect(response.body.board.rounds).toHaveLength(1);
    const jeopardy = response.body.board.rounds.find((round: { type: string }) => round.type === 'JEOPARDY');
    expect(jeopardy.categories[0].clues[0].answer).toBe('H2O');
  });

  it('rejects a request with no file', async () => {
    const app = createApp();
    const response = await authRequest(app).post('/api/boards/import').expect(400);
    expect(response.body.error).toMatch(/no file/i);
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp();
    const csv = 'Category,Value,Clue,Answer\nScience,100,Water symbol?,H2O\n';

    await request(app)
      .post('/api/boards/import')
      .attach('file', csvBuffer(csv), { filename: 'sample.csv', contentType: 'text/csv' })
      .expect(401);
  });

  it('rejects a malformed non-spreadsheet file', async () => {
    const app = createApp();

    const response = await authRequest(app)
      .post('/api/boards/import')
      .attach('file', Buffer.from('this is not a spreadsheet'), { filename: 'bad.txt', contentType: 'text/plain' })
      .expect(400);

    expect(response.body.error).toBeDefined();
  });
});
