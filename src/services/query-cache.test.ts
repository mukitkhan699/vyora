import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryCache } from './queryCache.ts';

test('shares simultaneous requests for the same key', async () => {
  const cache = new QueryCache();
  let requestCount = 0;
  let resolveRequest!: (value: string) => void;
  const loader = () => {
    requestCount += 1;
    return new Promise<string>((resolve) => {
      resolveRequest = resolve;
    });
  };

  const first = cache.fetch('account-a:/feed', 1000, loader);
  const second = cache.fetch('account-a:/feed', 1000, loader);
  assert.equal(requestCount, 1);
  resolveRequest('posts');
  assert.deepEqual(await Promise.all([first, second]), ['posts', 'posts']);
});

test('serves stale data while revalidating and notifies subscribers', async () => {
  const cache = new QueryCache();
  await cache.fetch('account-a:/profile', 0, async () => 'old');

  const refreshed = new Promise<string>((resolve) => {
    const unsubscribe = cache.subscribe('account-a:/profile', () => {
      const snapshot = cache.getSnapshot<string>('account-a:/profile');
      if (snapshot.data === 'new' && !snapshot.isFetching) {
        unsubscribe();
        resolve(snapshot.data);
      }
    });
  });

  assert.equal(await cache.fetch('account-a:/profile', 1000, async () => 'new'), 'old');
  assert.equal(await refreshed, 'new');
});

test('invalidating a resource advances its version without discarding usable data', async () => {
  const cache = new QueryCache();
  await cache.fetch('account-a:/notifications', 1000, async () => ['notice']);
  cache.invalidate('account-a:/notifications');

  const snapshot = cache.getSnapshot<string[]>('account-a:/notifications');
  assert.deepEqual(snapshot.data, ['notice']);
  assert.equal(snapshot.expiresAt, 0);
  assert.equal(snapshot.invalidationVersion, 1);
});

test('updates only resources in the requested account namespace', async () => {
  const cache = new QueryCache();
  await cache.fetch('account-a:/feed', 1000, async () => ['a']);
  await cache.fetch('account-b:/feed', 1000, async () => ['b']);

  cache.updateMatching('account-a:', (key, snapshot) => ({
    ...snapshot,
    data: [...(snapshot.data as string[]), key],
  }));

  assert.deepEqual(cache.getSnapshot<string[]>('account-a:/feed').data, ['a', 'account-a:/feed']);
  assert.deepEqual(cache.getSnapshot<string[]>('account-b:/feed').data, ['b']);
});

test('does not repopulate cleared account data from an in-flight request', async () => {
  const cache = new QueryCache();
  let resolveOld!: (value: string) => void;
  const oldRequest = cache.fetch('account-a:/feed', 1000, () => new Promise((resolve) => {
    resolveOld = resolve;
  }));
  cache.clear();
  const newRequest = cache.fetch('account-a:/feed', 1000, async () => 'new account data');

  resolveOld('old account data');
  await Promise.all([oldRequest, newRequest]);
  assert.equal(cache.getSnapshot<string>('account-a:/feed').data, 'new account data');
});
