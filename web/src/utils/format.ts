/** Formats numeric quantities for compact dashboard tables. */
export function formatAmount(val: number | string): string {
  const n = Number(val);
  if (Number.isNaN(n) || n === 0) return '0';
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  if (Math.abs(n) < 1) return n.toFixed(6).replace(/\.?0+$/, '');
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/** Maps catalog validation statuses to their presentation classes. */
export function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'VERIFIED':
    case 'APPROVED':
      return 'status-badge-verified';
    case 'VERIFIED_DERIVED':
    case 'CALCULATED':
      return 'status-badge-derived';
    case 'PROXY':
    case 'RESIDUAL':
    case 'ASSUMPTION':
      return 'status-badge-proxy';
    case 'DATA_GAP':
      return 'status-badge-gap';
    case 'PENDING_QC':
      return 'status-badge-pending';
    case 'REJECTED':
    case 'OUT':
    default:
      return 'status-badge-out';
  }
}

/** Returns true when a value is a non-empty HTTP or HTTPS URL. */
export function isHttpUrl(url: string | undefined): url is string {
  return Boolean(url && /^https?:\/\//i.test(url));
}

/** Copies plain text to the clipboard using the async API with a DOM fallback. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback to execCommand when clipboard permission is denied
    }
  }
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

/** Escapes a single CSV cell according to RFC 4180. */
function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Serializes header and data rows to a CRLF-delimited CSV string. */
export function toCsvString(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>
): string {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n');
}

/** Triggers a browser download of a UTF-8 CSV file with a BOM for Excel compatibility. */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>
): void {
  const csvContent = '\uFEFF' + toCsvString(headers, rows);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
