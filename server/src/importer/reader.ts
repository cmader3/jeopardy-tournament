import * as XLSX from 'xlsx';
import { cptable } from 'xlsx/dist/cpexcel.full.mjs';

XLSX.set_cptable(cptable);

export type CellValue = string | number | boolean | null | undefined;
export type SheetMatrix = CellValue[][];

export interface SheetData {
  name: string;
  matrix: SheetMatrix;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function stripUtf8Bom(buffer: Buffer): Buffer {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(UTF8_BOM)) {
    return buffer.subarray(3);
  }
  return buffer;
}

export function readSpreadsheetBuffer(buffer: Buffer): SheetData[] {
  const normalizedBuffer = stripUtf8Bom(buffer);
  const workbook = XLSX.read(normalizedBuffer, {
    type: 'buffer',
    cellFormula: false,
    codepage: 65001,
  });
  return workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    if (!worksheet) {
      return { name, matrix: [] };
    }
    const matrix = XLSX.utils.sheet_to_json<CellValue[]>(worksheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as SheetMatrix;
    return { name, matrix };
  });
}
