export type ExportRow = Record<string, string | number | null | undefined>;

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ExportRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(cell).join(',')];
  for (const r of rows) lines.push(headers.map((h) => cell(r[h])).join(','));
  return lines.join('\r\n');
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename: string, rows: ExportRow[]) {
  // BOM so Excel opens ₹ / UTF-8 text correctly.
  save(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
}

/** Real .xlsx via SheetJS, loaded on demand so it stays out of the main bundle. */
export async function downloadXlsx(filename: string, sheetName: string, rows: ExportRow[]) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
