import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AUDIT_EXPORT_BATCH_SIZE,
  AUDIT_EXPORT_CSV_HEADERS,
  MAX_AUDIT_EXPORT_ROWS,
  escapeCsvValue,
  formatAuditCsvRow,
  normalizeAuditExportLimit,
  normalizeAuditExportOffset,
} from './db/audit-export.ts';

describe('audit export limits', () => {
  test('enforces the 50,000 row ceiling and positive limits (minimum 1)', () => {
    assert.equal(MAX_AUDIT_EXPORT_ROWS, 50_000);
    assert.equal(normalizeAuditExportLimit(50_001), 50_000);
    assert.equal(normalizeAuditExportLimit(-10), 1);
    assert.equal(normalizeAuditExportLimit(0), 1);
    assert.equal(normalizeAuditExportLimit('abc', 12_345), 12_345);
    assert.equal(normalizeAuditExportLimit(10.9), 10);
  });

  test('normalizes offsets safely', () => {
    assert.equal(normalizeAuditExportOffset(-1), 0);
    assert.equal(normalizeAuditExportOffset('abc'), 0);
    assert.equal(normalizeAuditExportOffset(12.9), 12);
  });

  test('uses bounded database batches', () => {
    assert.ok(AUDIT_EXPORT_BATCH_SIZE > 0);
    assert.ok(AUDIT_EXPORT_BATCH_SIZE <= 1_000);
  });
});

describe('CSV escaping', () => {
  test('quotes commas, quotes, newlines, and carriage returns', () => {
    assert.equal(escapeCsvValue('plain'), 'plain');
    assert.equal(escapeCsvValue('a,b'), '"a,b"');
    assert.equal(escapeCsvValue('a"b'), '"a""b"');
    assert.equal(escapeCsvValue('line\nbreak'), '"line\nbreak"');
    assert.equal(escapeCsvValue('line\rbreak'), '"line\rbreak"');
  });

  test('neutralizes spreadsheet formula prefixes', () => {
    assert.equal(escapeCsvValue('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
    assert.equal(escapeCsvValue('+cmd'), "'+cmd");
    assert.equal(escapeCsvValue('-cmd'), "'-cmd");
    assert.equal(escapeCsvValue('@cmd'), "'@cmd");
    // Leading whitespace should not bypass protection
    assert.equal(escapeCsvValue('  =cmd'), "'  =cmd");
    assert.equal(escapeCsvValue('\t=cmd'), "'\t=cmd");
    // \r and \n trigger CSV quoting
    assert.equal(escapeCsvValue('\r=cmd'), `"'\r=cmd"`);
    assert.equal(escapeCsvValue('\n=cmd'), `"'\n=cmd"`);
  });

  test('serializes objects and empty values safely', () => {
    assert.equal(escapeCsvValue(null), '');
    assert.equal(escapeCsvValue(undefined), '');
    assert.equal(escapeCsvValue({ a: 1 }), '"{""a"":1}"');
  });

  test('formats a complete row with stable headers', () => {
    const line = formatAuditCsvRow({
      id: 'audit_1',
      admin_id: 'user_admin_1',
      admin_username: 'admin_user',
      action: 'user.verify',
      target_type: 'user',
      target_id: 'user_target',
      metadata: { previous_verified: false, new_verified: true },
      ip_address: '127.0.0.1',
      user_agent: 'test-agent',
      created_at: Date.parse('2024-01-01T00:00:00.000Z'),
    });

    assert.equal(
      line,
      'audit_1,user_admin_1,admin_user,user.verify,user,user_target,"{""previous_verified"":false,""new_verified"":true}",127.0.0.1,test-agent,2024-01-01T00:00:00.000Z',
    );
    assert.equal(AUDIT_EXPORT_CSV_HEADERS.length, 10);
  });
});
