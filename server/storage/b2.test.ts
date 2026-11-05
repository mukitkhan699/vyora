import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesFileSignature, sanitizeFilename } from './b2.ts';

test('validates supported image signatures', () => {
  const fixtures: Array<[string, Buffer]> = [
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['image/gif', Buffer.from('GIF89a')],
    ['image/webp', Buffer.from('RIFF0000WEBP')],
  ];

  for (const [mimeType, bytes] of fixtures) {
    assert.equal(matchesFileSignature(mimeType, bytes), true, `${mimeType} should be accepted`);
  }
});

test('rejects mismatched and unsupported image signatures', () => {
  assert.equal(matchesFileSignature('image/png', Buffer.from('not an image')), false);
  assert.equal(matchesFileSignature('image/jpeg', Buffer.from([0x89, 0x50, 0x4e])), false);
  assert.equal(matchesFileSignature('image/avif', Buffer.from('ftypavif')), false);
  assert.equal(matchesFileSignature('image/svg+xml', Buffer.from('<svg></svg>')), false);
});

test('sanitizes filenames without retaining path components', () => {
  assert.equal(sanitizeFilename('../../photo.png'), '.._.._photo.png');
  assert.equal(sanitizeFilename('C:\\photos\\image.jpg'), 'C:_photos_image.jpg');
  assert.throws(() => sanitizeFilename(' \r\n '));
});
