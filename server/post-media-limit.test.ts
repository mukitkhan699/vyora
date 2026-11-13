import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { after, mock, test } from 'node:test';
import { MAX_POST_MEDIA } from '../src/utils/postMedia.ts';

interface CreatePostCall {
  authorId: string;
  content: string;
  mediaUrls?: string[];
}

const createPostCalls: CreatePostCall[] = [];

function moduleMock(exports: Record<string, unknown>): Parameters<typeof mock.module>[1] {
  return { exports } as unknown as Parameters<typeof mock.module>[1];
}

mock.module(new URL('./auth.ts', import.meta.url).href, moduleMock({
  getAuthUser: async () => ({
    id: 1,
    username: 'test',
    email: 'test@example.com',
    emailVerified: true,
    createdAt: 0,
  }),
  handleAuthRequest: async () => false,
  requireSessionWithCsrf: async () => ({}),
  setAuthError: (
    res: ServerResponse,
    error: { status?: number; message?: string },
  ) => {
    res.statusCode = error.status || 500;
    res.end(JSON.stringify({ error: error.message || 'Request failed.' }));
  },
  readJsonBody: async () => ({}),
  validateStateChangingRequest: () => undefined,
  safeEqual: (left: unknown, right: unknown) => left === right,
  getSession: async () => null,
}));

mock.module(new URL('./db/adapter.ts', import.meta.url).href, moduleMock({
  dbAdapter: {
    syncAuthProfile: async () => ({ id: 'user_test' }),
    createPost: async (
      authorId: string,
      content: string,
      mediaUrls?: string[],
    ) => {
      createPostCalls.push({ authorId, content, mediaUrls });
      return { id: 'post_test', content, mediaUrls };
    },
  },
}));

const { handleApiRequest } = await import('./routes/api.ts');

after(() => {
  mock.restoreAll();
});

async function submitPost(body: Record<string, unknown>): Promise<{
  statusCode: number;
  body: { error?: string; code?: string };
}> {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  let responseBody = '';
  const res = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (chunk?: Buffer | string) => {
      responseBody = chunk?.toString() ?? '';
    },
  } as unknown as ServerResponse;

  const handled = await handleApiRequest(req, res, new URL('http://localhost/api/posts'));
  assert.equal(handled, true);
  return {
    statusCode: res.statusCode,
    body: JSON.parse(responseBody) as { error?: string; code?: string },
  };
}

test('post route rejects five media URLs without calling createPost', async () => {
  createPostCalls.length = 0;

  const response = await submitPost({
    content: 'Too many images',
    mediaUrls: ['one', 'two', 'three', 'four', 'five'],
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error || '', /maximum of 4 media attachments/i);
  assert.equal(createPostCalls.length, 0);
});

test('post route still accepts four media URLs', async () => {
  createPostCalls.length = 0;
  const mediaUrls = ['one', 'two', 'three', 'four'];

  const response = await submitPost({ content: 'Four images', mediaUrls });

  assert.equal(response.statusCode, 201);
  assert.equal(createPostCalls.length, 1);
  assert.equal(createPostCalls[0].authorId, 'user_test');
  assert.equal(createPostCalls[0].content, 'Four images');
  assert.deepEqual(createPostCalls[0].mediaUrls, mediaUrls);
});

test('route and shared post media limit agree', () => {
  assert.equal(MAX_POST_MEDIA, 4);
});
