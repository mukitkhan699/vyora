import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeWebsiteUrl } from './profile-validation.ts';

test('normalizes profile website URLs to HTTP or HTTPS', () => {
  assert.equal(normalizeWebsiteUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeWebsiteUrl('http://example.com'), 'http://example.com/');
  assert.equal(normalizeWebsiteUrl('  '), null);
});

test('rejects unsafe and malformed profile website URLs', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hi', 'https://user@example.com', 'https://']) {
    assert.throws(() => normalizeWebsiteUrl(value));
  }
});
