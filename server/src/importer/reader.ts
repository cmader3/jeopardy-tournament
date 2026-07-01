import * as XLSX from 'xlsx';

export type CellValue = string | number | boolean | null | undefined;
export type SheetMatrix = CellValue[][];

export interface SheetData {
  name: string;
  matrix: SheetMatrix;
}

export function readSpreadsheetBuffer(buffer: Buffer): SheetData[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: false });
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
