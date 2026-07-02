import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { prisma } from '../repo/prisma.js';
import { closeTestServer, createTestServer, TestServer } from './test-server.js';

function authRequest() {
  return testServer.agent;
}

let testServer: TestServer;

beforeAll(async () => {
  testServer = await createTestServer();
});

afterAll(async () => {
  await closeTestServer(testServer.server);
  await prisma.$disconnect();
});

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
  it('returns a parsed board preview from a CSV upload without persisting anything', async () => {
    
    const csv =
      'Category,Value,Clue,Answer\n' +
      'Science,100,Water symbol?,H2O\n' +
      'History,200,Berlin Wall year?,1989\n';

    const beforeLibrary = await authRequest().get('/api/boards').expect(200);
    const beforeCount = beforeLibrary.body.length;

    const response = await authRequest()
      .post('/api/boards/import')
      .attach('file', csvBuffer(csv), { filename: 'sample.csv', contentType: 'text/csv' })
      .expect(200);

    expect(response.body.board.name).toBe('sample');
    expect(response.body.warnings).toBeDefined();
    expect(response.body.confidence).toBeDefined();

    const jeopardy = response.body.board.rounds.find((round: { type: string }) => round.type === 'JEOPARDY');
    expect(jeopardy).toBeDefined();
    expect(jeopardy.categories).toHaveLength(2);

    const afterLibrary = await authRequest().get('/api/boards').expect(200);
    expect(afterLibrary.body).toHaveLength(beforeCount);
  });

  it('returns a parsed board preview from an XLSX upload', async () => {
    

    const response = await authRequest()
      .post('/api/boards/import')
      .attach('file', xlsxBuffer(), { filename: 'sample.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .expect(200);

    expect(response.body.board.rounds).toHaveLength(1);
    const jeopardy = response.body.board.rounds.find((round: { type: string }) => round.type === 'JEOPARDY');
    expect(jeopardy.categories[0].clues[0].answer).toBe('H2O');
  });

  it('rejects a request with no file', async () => {
    
    const response = await authRequest().post('/api/boards/import').expect(400);
    expect(response.body.error).toMatch(/no file/i);
  });

  it('rejects an unauthenticated request', async () => {
    
    const csv = 'Category,Value,Clue,Answer\nScience,100,Water symbol?,H2O\n';

    await request(testServer.server)
      .post('/api/boards/import')
      .attach('file', csvBuffer(csv), { filename: 'sample.csv', contentType: 'text/csv' })
      .expect(401);
  });

  it('rejects a malformed non-spreadsheet file', async () => {
    

    const response = await authRequest()
      .post('/api/boards/import')
      .attach('file', Buffer.from('this is not a spreadsheet'), { filename: 'bad.txt', contentType: 'text/plain' })
      .expect(400);

    expect(response.body.error).toBeDefined();
  });

  it('rejects an oversized file with a graceful error', async () => {
    
    const largeCsv = Buffer.alloc(6 * 1024 * 1024, 'x');

    const response = await authRequest()
      .post('/api/boards/import')
      .attach('file', largeCsv, { filename: 'huge.csv', contentType: 'text/csv' })
      .expect(413);

    expect(response.body.error).toMatch(/file too large|5mb/i);
  });

  it('rejects multiple files with a graceful error', async () => {
    
    const csv = Buffer.from('Category,Value,Clue,Answer\nScience,100,Q,A\n');

    const response = await authRequest()
      .post('/api/boards/import')
      .attach('file', csv, { filename: 'one.csv', contentType: 'text/csv' })
      .attach('file', csv, { filename: 'two.csv', contentType: 'text/csv' })
      .expect(400);

    expect(response.body.error).toMatch(/only one file|one file/i);
  });
});
