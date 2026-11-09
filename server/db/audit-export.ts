export const MAX_AUDIT_EXPORT_ROWS = 50_000;
export const AUDIT_EXPORT_BATCH_SIZE = 1_000;
export const DEFAULT_AUDIT_EXPORT_LIMIT = 10_000;

export const AUDIT_EXPORT_CSV_HEADERS = [
  'id',
  'admin_id',
  'admin_username',
  'action',
  'target_type',
  'target_id',
  'metadata',
  'ip_address',
  'user_agent',
  'created_at',
] as const;

export interface AuditExportRecord {
  id: string;
  admin_id: string | null;
  admin_username: string | null;
  action: string;
  target_type: string;
  target_id: string;
  metadata: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: number | string;
}

export function normalizeAuditExportLimit(
  value: unknown,
  fallback = DEFAULT_AUDIT_EXPORT_LIMIT,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), MAX_AUDIT_EXPORT_ROWS));
}

export function normalizeAuditExportOffset(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Prevent spreadsheet formula injection while preserving the original text.
  // Check for formula prefixes after any leading whitespace.
  const trimmedStart = raw.replace(/^[\s\t\r\n]+/, '');
  const guarded = /^[=+\-@]/.test(trimmedStart) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function formatAuditCsvRow(log: AuditExportRecord): string {
  return [
    escapeCsvValue(log.id),
    escapeCsvValue(log.admin_id),
    escapeCsvValue(log.admin_username),
    escapeCsvValue(log.action),
    escapeCsvValue(log.target_type),
    escapeCsvValue(log.target_id),
    escapeCsvValue(log.metadata),
    escapeCsvValue(log.ip_address),
    escapeCsvValue(log.user_agent),
    escapeCsvValue(new Date(Number(log.created_at)).toISOString()),
  ].join(',');
}
