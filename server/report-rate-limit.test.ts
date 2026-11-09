import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { IncomingMessage } from 'node:http';
import {
  buildReportRateLimitRules,
  enforceRateLimits,
  getClientIp,
  hashRateLimitSubject,
  type RateLimitRule,
  type RateLimitStore,
} from './rate-limit.ts';
import { HttpError } from './errors.ts';

class MemoryRateLimitStore implements RateLimitStore {
  readonly counts = new Map<string, number>();

  async increment(scope: string, subject: string, windowStart: number): Promise<number> {
    const key = `${scope}\u0000${subject}\u0000${windowStart}`;
    const next = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, next);
    return next;
  }
}

function makeRequest(remoteAddress: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers,
  } as unknown as IncomingMessage;
}

function noopLog(): void {
  // Keep expected rate-limit tests quiet.
}

async function expectRateLimited(promise: Promise<void>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpError);
    return error;
  }
  assert.fail('Expected a rate-limit error.');
}

describe('report rate limiting (mock store)', () => {
  test('allows the per-user limit boundary and rejects the next attempt with 429', async () => {
    const store = new MemoryRateLimitStore();
    const now = 1_700_000_000_000;
    const rules = buildReportRateLimitRules('user_auth_101', '203.0.113.10');
    const userRule = rules.find((rule) => rule.name === 'report-user');

    assert.ok(userRule);
    for (let attempt = 1; attempt <= userRule.limit; attempt += 1) {
      await enforceRateLimits(rules, { now, store, log: noopLog });
    }

    const error = await expectRateLimited(
      enforceRateLimits(rules, { now, store, log: noopLog }),
    );
    assert.equal(error.status, 429);
    assert.equal(error.code, 'RATE_LIMITED');
    assert.ok(Number(error.headers['Retry-After']) >= 1);
  });

  test('limits are keyed by authenticated user id, not by report payload', async () => {
    const store = new MemoryRateLimitStore();
    const now = 1_700_000_000_000;
    const rules = buildReportRateLimitRules('user_auth_202', '203.0.113.10');
    const userRule = rules.find((rule) => rule.name === 'report-user');

    assert.ok(userRule);
    assert.equal(userRule.subject, 'user_auth_202');

    for (let attempt = 1; attempt <= userRule.limit; attempt += 1) {
      await enforceRateLimits(rules, { now, store, log: noopLog });
    }

    const error = await expectRateLimited(
      enforceRateLimits(rules, { now, store, log: noopLog }),
    );
    assert.equal(error.status, 429);
  });

  test('different users on the same IP have independent user counters', async () => {
    const store = new MemoryRateLimitStore();
    const now = 1_700_000_000_000;
    const firstUser = buildReportRateLimitRules('user_auth_301', '203.0.113.20');
    const secondUser = buildReportRateLimitRules('user_auth_302', '203.0.113.20');
    const firstRule = firstUser.find((rule) => rule.name === 'report-user');

    assert.ok(firstRule);
    for (let attempt = 1; attempt <= firstRule.limit; attempt += 1) {
      await enforceRateLimits(firstUser, { now, store, log: noopLog });
    }
    await expectRateLimited(enforceRateLimits(firstUser, { now, store, log: noopLog }));

    await assert.doesNotReject(
      enforceRateLimits(secondUser, { now, store, log: noopLog }),
    );
  });

  test('IP counter blocks distributed users after the IP boundary', async () => {
    const store = new MemoryRateLimitStore();
    const now = 1_700_000_000_000;
    const ip = '203.0.113.30';
    const probe = buildReportRateLimitRules('user_probe', ip);
    const ipRule = probe.find((rule) => rule.name === 'report-ip');

    assert.ok(ipRule);
    for (let attempt = 1; attempt <= ipRule.limit; attempt += 1) {
      const rules = buildReportRateLimitRules(`user_${attempt}`, ip);
      await enforceRateLimits(rules, { now, store, log: noopLog });
    }

    const rules = buildReportRateLimitRules('user_over_ip_limit', ip);
    const error = await expectRateLimited(
      enforceRateLimits(rules, { now, store, log: noopLog }),
    );
    assert.equal(error.status, 429);
  });

  test('Retry-After reflects the remaining window time', async () => {
    const store = new MemoryRateLimitStore();
    const rules: RateLimitRule[] = [
      {
        name: 'custom',
        scope: 'test:custom',
        subject: 'subject',
        limit: 1,
        windowMs: 60_000,
      },
    ];
    const now = 1_000;
    await enforceRateLimits(rules, { now, store, log: noopLog });
    const error = await expectRateLimited(enforceRateLimits(rules, { now, store, log: noopLog }));
    assert.equal(error.headers['Retry-After'], '59');
  });

  test('counters reset in the next window', async () => {
    const store = new MemoryRateLimitStore();
    const rules: RateLimitRule[] = [
      {
        name: 'custom',
        scope: 'test:window',
        subject: 'subject',
        limit: 1,
        windowMs: 1_000,
      },
    ];
    await enforceRateLimits(rules, { now: 1_000, store, log: noopLog });
    await expectRateLimited(enforceRateLimits(rules, { now: 1_000, store, log: noopLog }));
    await assert.doesNotReject(
      enforceRateLimits(rules, { now: 2_000, store, log: noopLog }),
    );
  });

  test('simulated application instances share the same database-backed counters', async () => {
    const sharedStore = new MemoryRateLimitStore();
    const now = 1_700_000_000_000;
    const instanceA = buildReportRateLimitRules('user_shared_401', '203.0.113.40');
    const instanceB = buildReportRateLimitRules('user_shared_401', '203.0.113.40');
    const userRule = instanceA.find((rule) => rule.name === 'report-user');

    assert.ok(userRule);
    for (let attempt = 1; attempt <= userRule.limit; attempt += 1) {
      const rules = attempt % 2 === 0 ? instanceA : instanceB;
      await enforceRateLimits(rules, { now, store: sharedStore, log: noopLog });
    }

    const error = await expectRateLimited(
      enforceRateLimits(instanceB, { now, store: sharedStore, log: noopLog }),
    );
    assert.equal(error.status, 429);
    assert.equal(error.code, 'RATE_LIMITED');
  });
});

describe('client IP resolution', () => {
  test('ignores spoofable X-Forwarded-For by default', () => {
    const req = makeRequest('198.51.100.7', { 'x-forwarded-for': '1.2.3.4' });
    assert.equal(getClientIp(req), '198.51.100.7');
  });

  test('uses the configured trusted proxy hop when enabled', () => {
    const req = makeRequest('10.0.0.2', {
      'x-forwarded-for': '1.2.3.4, 198.51.100.7',
    });
    assert.equal(getClientIp(req, 1), '198.51.100.7');
    assert.equal(getClientIp(req, 2), '1.2.3.4');
    assert.equal(getClientIp(req, 3), '10.0.0.2');
  });

  test('normalizes IPv4 ports and bracketed IPv6 addresses', () => {
    assert.equal(getClientIp(makeRequest('198.51.100.9:8123')), '198.51.100.9');
    assert.equal(getClientIp(makeRequest('[2001:db8::1]:443')), '2001:db8::1');
  });

  test('hashes IP subjects so raw addresses are not stored in the counter table', () => {
    const hashed = hashRateLimitSubject('198.51.100.7');
    assert.equal(hashed.length, 32);
    assert.notEqual(hashed, '198.51.100.7');
    assert.equal(hashed, hashRateLimitSubject('198.51.100.7'));
  });
});
