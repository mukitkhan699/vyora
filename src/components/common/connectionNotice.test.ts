import assert from 'node:assert/strict';
import test from 'node:test';
import { getConnectionNoticeTransition } from './connectionNotice.ts';

const connected = { online: true, quality: 'good' as const, state: 'connected' as const };

test('connection recovery advances through reconnect and sync to one timed confirmation', () => {
  const offline = getConnectionNoticeTransition({
    ...connected,
    state: 'offline',
    hadConnectionIssue: false,
  });
  assert.equal(offline.notice?.kind, 'reconnecting');
  assert.equal(offline.hadConnectionIssue, true);

  const reconnecting = getConnectionNoticeTransition({
    ...connected,
    state: 'reconnecting',
    hadConnectionIssue: offline.hadConnectionIssue,
  });
  assert.equal(reconnecting.notice?.kind, 'reconnecting');

  const syncing = getConnectionNoticeTransition({
    ...connected,
    state: 'syncing',
    hadConnectionIssue: reconnecting.hadConnectionIssue,
  });
  assert.equal(syncing.notice?.kind, 'syncing');

  const restored = getConnectionNoticeTransition({
    ...connected,
    hadConnectionIssue: syncing.hadConnectionIssue,
  });
  assert.equal(restored.notice?.kind, 'restored');
  assert.equal(restored.notice?.dismissAfterMs, 2500);
  assert.equal(restored.hadConnectionIssue, false);
});

test('repeated healthy events do not create duplicate restore notices', () => {
  const repeated = getConnectionNoticeTransition({
    ...connected,
    hadConnectionIssue: false,
  });
  assert.equal(repeated.notice, null);
});

test('a later disconnect starts a new recovery notification cycle', () => {
  const disconnected = getConnectionNoticeTransition({
    ...connected,
    online: false,
    hadConnectionIssue: false,
  });
  assert.equal(disconnected.notice?.kind, 'offline');

  const restored = getConnectionNoticeTransition({
    ...connected,
    hadConnectionIssue: disconnected.hadConnectionIssue,
  });
  assert.equal(restored.notice?.kind, 'restored');
});

test('sync failures and poor network quality produce short-lived status notices', () => {
  const syncError = getConnectionNoticeTransition({
    ...connected,
    state: 'sync-error',
    hadConnectionIssue: true,
  });
  assert.equal(syncError.notice?.kind, 'sync-error');
  assert.equal(syncError.notice?.dismissAfterMs, 5000);

  const poorConnection = getConnectionNoticeTransition({
    ...connected,
    quality: 'poor',
    hadConnectionIssue: false,
  });
  assert.equal(poorConnection.notice?.kind, 'slow');
  assert.equal(poorConnection.notice?.dismissAfterMs, 3000);
});
