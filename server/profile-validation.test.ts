import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildProfileUpdates,
  normalizeAppMediaUrl,
  normalizeWebsiteUrl,
} from './profile-validation.ts';

const AVATAR_PATH = '/api/files/file_00000000-0000-4000-8000-000000000000';
const BANNER_PATH = '/api/files/file_11111111-1111-4111-8111-111111111111';

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

test('normalizes absolute app media URLs to stable internal paths', () => {
  assert.equal(normalizeAppMediaUrl(`https://vyora.example${AVATAR_PATH}`), AVATAR_PATH);
  assert.equal(normalizeAppMediaUrl(AVATAR_PATH), AVATAR_PATH);
  assert.equal(
    normalizeAppMediaUrl('https://example.com/image.png'),
    'https://example.com/image.png',
  );
});

test('profile updates preserve avatars when avatarUrl is omitted', () => {
  assert.deepEqual(buildProfileUpdates({ name: 'New Name' }), [['name', 'New Name']]);
  assert.deepEqual(buildProfileUpdates({ bio: 'New bio' }), [['bio', 'New bio']]);
  assert.deepEqual(buildProfileUpdates({ name: 'New Name', avatarUrl: undefined }), [
    ['name', 'New Name'],
  ]);
});

test('explicit empty avatar clears the stored avatar', () => {
  assert.deepEqual(buildProfileUpdates({ avatarUrl: '' }), [['avatar_url', '']]);
});

test('profile updates accept internal avatar and banner references', () => {
  assert.deepEqual(buildProfileUpdates({ avatarUrl: AVATAR_PATH }), [
    ['avatar_url', AVATAR_PATH],
  ]);
  assert.deepEqual(buildProfileUpdates({ bannerUrl: BANNER_PATH }), [
    ['banner_url', BANNER_PATH],
  ]);
});

test('profile updates normalize absolute app media references before persistence', () => {
  assert.deepEqual(
    buildProfileUpdates({ avatarUrl: `https://vyora.example${AVATAR_PATH}` }),
    [['avatar_url', AVATAR_PATH]],
  );
});

test('profile updates still reject malformed website URLs', () => {
  assert.throws(
    () => buildProfileUpdates({ website: 'javascript:alert(1)' }),
    /Website must be a valid HTTP or HTTPS URL/,
  );
});
