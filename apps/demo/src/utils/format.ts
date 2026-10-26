const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtNumber(n: number, decimals = 0): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "1,250 t", "78.4 %", "4,120 ₹/t" — unit is appended with a thin space. */
export function fmtValue(value: number | undefined, unit: string, decimals = 0): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return `${fmtNumber(value, decimals)} ${unit}`;
}

export function fmtPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

/** "2026-10-22" → "22 Oct 2026" */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-10-22T06:00:00" → "22 Oct 2026, 06:00" */
export function fmtDateTime(iso: string): string {
  return `${fmtDate(iso)}, ${iso.slice(11, 16)}`;
}

/** "2026-10" → "Oct 2026" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export const monthOf = (isoDate: string) => isoDate.slice(0, 7);

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}
