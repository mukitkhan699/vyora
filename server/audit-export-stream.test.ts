import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { QueryResultRow } from 'pg';
import {
  AUDIT_EXPORT_CSV_HEADERS,
  MAX_AUDIT_EXPORT_ROWS,
  type AuditExportRecord,
} from './db/audit-export.ts';
import { streamAuditLogExport, type AuditLogBatchQuery } from './db/admin.ts';

function makeRow(index: number): AuditExportRecord {
  return {
    id: `audit_${index}`,
    admin_id: 'user_admin_1',
    admin_username: 'admin_user',
    action: 'user.verify',
    target_type: 'user',
    target_id: `user_target_${index}`,
    metadata: { index, previous_verified: false, new_verified: true },
    ip_address: '127.0.0.1',
    user_agent: 'test-agent',
    created_at: Date.parse('2024-01-01T00:00:00.000Z') + index,
  };
}

function createFakeQuery(
  totalRows: number,
  calls: Array<{ limit: number; offset: number }>,
  failAtCall?: number,
): AuditLogBatchQuery {
  return async <Row extends QueryResultRow = QueryResultRow>(
    _text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }> => {
    const limit = Number(values?.[values.length - 2] || 0);
    const offset = Number(values?.[values.length - 1] || 0);
    calls.push({ limit, offset });
    if (failAtCall && calls.length === failAtCall) {
      throw new Error('simulated export query failure');
    }
    const rows: AuditExportRecord[] = [];
    for (let index = offset; index < Math.min(offset + limit, totalRows); index += 1) {
      rows.push(makeRow(index));
    }
    return { rows: rows as unknown as Row[] };
  };
}

async function collectExport(
  format: 'csv' | 'json',
  totalRows: number,
  options: { limit?: number; offset?: number } = {},
  calls: Array<{ limit: number; offset: number }> = [],
  failAtCall?: number,
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of streamAuditLogExport(
    { format, ...options },
    { query: createFakeQuery(totalRows, calls, failAtCall) },
  )) {
    chunks.push(chunk);
  }
  return chunks.join('');
}

describe('streaming audit export (mock database)', () => {
  test('reads bounded batches and emits a complete CSV stream', async () => {
    const calls: Array<{ limit: number; offset: number }> = [];
    const output = await collectExport('csv', 2_500, { limit: 3_000 }, calls);
    assert.deepEqual(calls, [
      { limit: 1_000, offset: 0 },
      { limit: 1_000, offset: 1_000 },
      { limit: 1_000, offset: 2_000 },
    ]);
    const lines = output.trimEnd().split('\n');
    assert.equal(lines[0], AUDIT_EXPORT_CSV_HEADERS.join(','));
    assert.equal(lines.length, 2_501);
    assert.ok(output.endsWith('\n'));
  });

  test('emits valid NDJSON with proper stream termination', async () => {
    const output = await collectExport('json', 2_500, { limit: 3_000 });
    const lines = output.trimEnd().split('\n');
    assert.equal(lines.length, 2_500);
    const parsed = lines.map((line) => JSON.parse(line)) as Array<Record<string, unknown>>;
    assert.equal(parsed.length, 2_500);
    assert.equal(parsed[0]?.id, 'audit_0');
    assert.equal(parsed[2_499]?.id, 'audit_2499');
    assert.deepEqual(Object.keys(parsed[0] || {}).sort(), [
      'action',
      'admin_id',
      'admin_username',
      'created_at',
      'id',
      'ip_address',
      'metadata',
      'target_id',
      'target_type',
      'user_agent',
    ]);
  });

  test('honors offset and limit without over-reading', async () => {
    const calls: Array<{ limit: number; offset: number }> = [];
    const output = await collectExport('csv', 100, { limit: 10, offset: 5 }, calls);
    assert.deepEqual(calls, [{ limit: 10, offset: 5 }]);
    const lines = output.trimEnd().split('\n');
    assert.equal(lines.length, 11);
    assert.ok(lines[1]?.startsWith('audit_5,'));
  });

  test('caps the database function at 50,000 rows', async () => {
    const calls: Array<{ limit: number; offset: number }> = [];
    const output = await collectExport('csv', 60_000, { limit: 999_999 }, calls);
    const lines = output.trimEnd().split('\n');
    assert.equal(lines.length, MAX_AUDIT_EXPORT_ROWS + 1);
    assert.equal(calls.length, MAX_AUDIT_EXPORT_ROWS / 1_000);
    assert.deepEqual(calls.at(-1), { limit: 1_000, offset: 49_000 });
  });

  test('propagates database errors instead of silently truncating output', async () => {
    await assert.rejects(
      collectExport('json', 5_000, { limit: 5_000 }, [], 2),
      /simulated export query failure/,
    );
  });
});
