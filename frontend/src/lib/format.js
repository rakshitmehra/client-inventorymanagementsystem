/** Display helpers shared across every screen. */

const numberFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const currencyFormat = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function num(value, places) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  if (places !== undefined) {
    return n.toLocaleString('en-IN', {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    });
  }
  return numberFormat.format(n);
}

export function money(value) {
  const n = Number(value ?? 0);
  return currencyFormat.format(Number.isFinite(n) ? n : 0);
}

/** Quantity plus its unit, e.g. "12.5 kg". */
export function qty(value, unit) {
  return `${num(value)}${unit ? ` ${unit}` : ''}`;
}

/** The API returns ISO 8601 with an offset; render it in the local zone. */
function parse(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function date(value) {
  const d = parse(value);
  if (!d) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateTime(value) {
  const d = parse(value);
  if (!d) return '-';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "3 hours ago" style, falling back to a date beyond a week. */
export function relative(value) {
  const d = parse(value);
  if (!d) return '-';
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return date(value);
}

/** An input[type=date] value for today, or N days back. */
export function isoDate(daysBack = 0) {
  const d = new Date(Date.now() - daysBack * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Combine a date input value with the current time for the API. */
export function withCurrentTime(isoDay) {
  if (!isoDay) return undefined;
  const now = new Date();
  const [year, month, day] = isoDay.split('-').map(Number);
  const stamp = new Date(
    year,
    month - 1,
    day,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  );
  return stamp.toISOString();
}

export function initials(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** SCREAMING_SNAKE codes into readable labels. */
export function humanise(code) {
  if (!code) return '';
  return String(code)
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export const STOCK_STATUS = {
  OK: { label: 'In stock', tone: 'green' },
  LOW: { label: 'Low', tone: 'amber' },
  OUT: { label: 'Out of stock', tone: 'red' },
};

export const MOVEMENT_LABELS = {
  PURCHASE_RECEIPT: { label: 'Goods receipt', tone: 'green' },
  TRANSFER_IN: { label: 'Transfer in', tone: 'blue' },
  TRANSFER_OUT: { label: 'Transfer out', tone: 'violet' },
  PRODUCTION_CONSUMPTION: { label: 'Production', tone: 'amber' },
  WASTAGE: { label: 'Wastage', tone: 'red' },
  ADJUSTMENT_INCREASE: { label: 'Adjustment +', tone: 'gray' },
  ADJUSTMENT_DECREASE: { label: 'Adjustment -', tone: 'gray' },
  OPENING_BALANCE: { label: 'Opening', tone: 'gray' },
};

export const WASTAGE_REASONS = [
  'EXPIRED',
  'DAMAGED',
  'SPOILED',
  'SPILLAGE',
  'OVER_PRODUCTION',
  'QUALITY_REJECT',
  'OTHER',
];

export const ADJUSTMENT_REASONS = [
  'STOCK_COUNT',
  'DATA_ENTRY_ERROR',
  'FOUND_STOCK',
  'MISSING_STOCK',
  'OPENING_BALANCE',
  'OTHER',
];
