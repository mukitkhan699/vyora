import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { closeStorage, getClient, matchesFileSignature, sanitizeFilename } from './b2.ts';

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

test('presigned PutObject URLs omit SDK default checksum parameters', async () => {
  const environmentNames = [
    'B2_ENDPOINT',
    'B2_REGION',
    'B2_BUCKET',
    'B2_KEY_ID',
    'B2_APPLICATION_KEY',
    'AWS_REQUEST_CHECKSUM_CALCULATION',
    'AWS_RESPONSE_CHECKSUM_VALIDATION',
  ] as const;
  const previous = new Map<string, string | undefined>();
  for (const name of environmentNames) {
    previous.set(name, process.env[name]);
  }

  process.env.B2_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
  process.env.B2_REGION = 'us-west-004';
  process.env.B2_BUCKET = 'test-bucket';
  process.env.B2_KEY_ID = 'test-key-id';
  process.env.B2_APPLICATION_KEY = 'test-application-key';
  delete process.env.AWS_REQUEST_CHECKSUM_CALCULATION;
  delete process.env.AWS_RESPONSE_CHECKSUM_VALIDATION;

  try {
    const uploadUrl = await getSignedUrl(
      getClient(),
      new PutObjectCommand({
        Bucket: 'test-bucket',
        Key: 'media/test-image',
        ContentType: 'image/png',
      }),
      { expiresIn: 300 },
    );
    const parsed = new URL(uploadUrl);

    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.host, 's3.us-west-004.backblazeb2.com');
    for (const parameter of parsed.searchParams.keys()) {
      const name = parameter.toLowerCase();
      assert.equal(
        name.startsWith('x-amz-checksum-') || name.startsWith('x-amz-sdk-checksum-'),
        false,
        `Unexpected checksum parameter: ${parameter}`,
      );
    }
  } finally {
    try {
      closeStorage();
    } finally {
      for (const name of environmentNames) {
        const value = previous.get(name);
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  }
});
