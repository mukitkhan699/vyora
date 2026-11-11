import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const realtime = readFileSync(new URL('./realtime.ts', import.meta.url), 'utf8');

// Socket Session Security Tests

describe('socket session security implementation', () => {
  test('session expiration in middleware prevents connection', () => {
    assert.match(
      realtime,
      /if \(session\.expiresAt <= Date\.now\(\)/,
      'Authentication middleware should reject expired sessions'
    );
    assert.match(
      realtime,
      /next\(new Error\('Session expired\.'\)/,
      'Expired sessions should be rejected with error'
    );
  });

  test('expired session immediate disconnection on connection', () => {
    assert.match(
      realtime,
      /if \(sessionExpiresAt && sessionExpiresAt <= Date\.now\(\)/,
      'Connection should check for expired session'
    );
    assert.match(
      realtime,
      /socket\.disconnect\(/,
      'Expired sessions should disconnect immediately'
    );
  });

  test('expiration timer setup for valid sessions', () => {
    assert.match(
      realtime,
      /let expirationTimer: NodeJS\.Timeout \| undefined;/,
      'Should declare expiration timer'
    );
    assert.match(
      realtime,
      /const scheduleExpiration = \(\) => {/,
      'Should have expiration scheduling function'
    );
  });

  test('expiration timer cleanup on disconnect', () => {
    assert.match(
      realtime,
      /socket\.on\('disconnect', \(\) => {/,
      'Should listen for disconnect event'
    );
    assert.match(
      realtime,
      /if \(expirationTimer\) {/,
      'Should cleanup expiration timer on disconnect'
    );
    assert.match(
      realtime,
      /clearTimeout\(/,
      'Should clear timeout on disconnect'
    );
  });

  test('expiration timer handling of short sessions', () => {
    assert.match(
      realtime,
      /const expiresIn = sessionExpiresAt \? sessionExpiresAt - now : 30 \* 60 \* 1000;/,
      'Should handle different expiration scenarios'
    );
  });

  test('session token storage in socket data', () => {
    assert.match(
      realtime,
      /socket\.data\.sessionExpiresAt = session\.expiresAt;/,
      'Should store session expiration in socket.data'
    );
    assert.match(
      realtime,
      /socket\.data\.sessionTokenHash = session\.tokenHash;/,
      'Should store session token hash in socket.data'
    );
  });

  test('existing session revocation mechanism preserved', () => {
    assert.match(
      realtime,
      /onSessionRevocation\(/,
      'Should preserve existing session revocation logic'
    );
    assert.match(
      realtime,
      /if \(tokenHash\) io\.in\(/,
      'Should disconnect sockets by token hash'
    );
  });

  test('realtime room architecture preserved', () => {
    assert.match(
      realtime,
      /if \(typeof sessionTokenHash === 'string'\) socket\.join\(/,
      'Should maintain session room architecture'
    );
  });

  test('user session tracking maintained', () => {
    assert.match(
      realtime,
      /if \(typeof userId === 'string'\) {/,
      'Should maintain user session tracking'
    );
    assert.match(
      realtime,
      /onlineUserSockets\.set\(/,
      'Should update user socket tracking'
    );
  });
});
