const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09" -> "Sep 2026" */
export function monthLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** 2026 -> "FY 2026-27" (Indian fiscal year, April to March) */
export const fyLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;

export function fiscalYearOf(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

/** The 12 periods of a fiscal year, April first. */
export function fiscalMonths(fy: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    return `${m >= 4 ? fy : fy + 1}-${String(m).padStart(2, '0')}`;
  });
}

export function daysIn(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const isPeriod = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** The month before today: the usual one being worked on. */
export function defaultPeriod(now = new Date()): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function fmtScore(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(digits);
}

export function fmtNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export const humanize = (code: string) => code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Integer paise -> "₹3,300.00". Whole-number arithmetic only: money is never a floating-point value. */
export function fmtPaise(paise: number): string {
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  return `${paise < 0 ? '-' : ''}₹${rupees.toLocaleString('en-IN')}.${String(abs % 100).padStart(2, '0')}`;
}

/** "3000", "3000.5" or "-25.50" -> integer paise by string handling (no floats); null when it is not a rupee amount. */
export function rupeesToPaise(text: string, allowNegative = false): number | null {
  const m = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m || (m[1] && !allowNegative)) return null;
  const paise = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || '0');
  return m[1] ? -paise : paise;
}
