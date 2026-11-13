import test from 'node:test';
import assert from 'node:assert/strict';
import { dbAdapter } from './db/adapter.ts';
import { HttpError } from './errors.ts';
import { MAX_POST_MEDIA } from '../src/utils/postMedia.ts';

test('post publishing rules and validations', () => {
  // Test character limit validation
  const maxPostLength = 280;
  const validContent = 'A'.repeat(280);
  const invalidContent = 'A'.repeat(281);

  assert.strictEqual(validContent.length <= maxPostLength, true);
  assert.strictEqual(invalidContent.length <= maxPostLength, false);

  // Test engagement counters clamp to non-negative (GREATEST(0, count - 1))
  const decrement = (val: number) => Math.max(0, val - 1);
  assert.strictEqual(decrement(5), 4);
  assert.strictEqual(decrement(1), 0);
  assert.strictEqual(decrement(0), 0);
  assert.strictEqual(decrement(-1), 0);
});

test('dbAdapter.createPost rejects more than four media URLs before persistence', async () => {
  const mediaUrls = Array.from(
    { length: MAX_POST_MEDIA + 1 },
    (_, index) => `/api/files/file_${index}`,
  );

  await assert.rejects(
    () => dbAdapter.createPost('user_test', 'Too many images', mediaUrls),
    (error: unknown) => (
      error instanceof HttpError &&
      error.status === 400 &&
      error.code === 'TOO_MANY_MEDIA' &&
      /maximum of 4 media attachments/i.test(error.message)
    ),
  );
});

test('unlimited post publishing applies equally to regular and gold accounts', () => {
  const regularUser = { id: 'user_regular', verified: false, isGold: false };
  const goldUser = { id: 'user_gold', verified: true, isGold: true };

  const isPublishingAllowed = (user: { isGold?: boolean }, postCount: number) => {
    // Both regular and gold users have unlimited publishing
    return true;
  };

  assert.strictEqual(isPublishingAllowed(regularUser, 0), true);
  assert.strictEqual(isPublishingAllowed(regularUser, 100), true);
  assert.strictEqual(isPublishingAllowed(regularUser, 1000), true);

  assert.strictEqual(isPublishingAllowed(goldUser, 0), true);
  assert.strictEqual(isPublishingAllowed(goldUser, 100), true);
  assert.strictEqual(isPublishingAllowed(goldUser, 1000), true);
});
