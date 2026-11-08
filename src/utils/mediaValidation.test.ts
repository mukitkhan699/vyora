import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
  validateImageFile,
} from './mediaValidation.ts';

function imageFile(type: string, size = 1): File {
  return new File([new Uint8Array(size)], 'image', { type });
}

test('accepts JPEG, PNG, GIF, and WebP images', () => {
  for (const mimeType of ALLOWED_IMAGE_MIME_TYPES) {
    assert.equal(validateImageFile(imageFile(mimeType)), null, `${mimeType} should be accepted`);
  }
});

test('rejects SVG and unsupported MIME types', () => {
  for (const mimeType of ['image/svg+xml', 'image/avif', 'text/plain', 'application/octet-stream']) {
    assert.equal(
      validateImageFile(imageFile(mimeType)),
      'Choose a JPEG, PNG, GIF, or WebP image.',
      `${mimeType} should be rejected`,
    );
  }
});

test('rejects empty files', () => {
  assert.equal(validateImageFile(imageFile('image/png', 0)), 'The selected image is empty.');
});

test('accepts files exactly 10 MB', () => {
  assert.equal(validateImageFile(imageFile('image/png', MAX_IMAGE_UPLOAD_BYTES)), null);
});

test('rejects files larger than 10 MB', () => {
  assert.equal(
    validateImageFile(imageFile('image/png', MAX_IMAGE_UPLOAD_BYTES + 1)),
    'Image must be 10MB or smaller.',
  );
});
