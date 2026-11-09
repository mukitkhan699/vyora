import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { handleMessagingRequest } from './routes/messaging.ts';

function createMockReqRes(method: string, url: string, bodyObj: Record<string, unknown> = {}) {
  const req: any = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  let statusCode = 200;
  let responseData: any = null;
  const res: any = {
    statusCode: 200,
    setHeader: () => {},
    end: (buf: Buffer) => {
      responseData = JSON.parse(buf.toString('utf8'));
    },
  };
  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (val: number) => {
      statusCode = val;
    },
  });

  const readJson = async () => bodyObj;
  const requireSessionWithCsrf = async () => {};

  return { req, res, getStatus: () => statusCode, getData: () => responseData, readJson, requireSessionWithCsrf };
}

describe('Messaging and Group API Endpoints Contract', () => {
  test('unauthenticated request returns 401', async () => {
    const { req, res, getStatus, getData, readJson, requireSessionWithCsrf } = createMockReqRes(
      'GET',
      '/api/conversations',
    );
    const handled = await handleMessagingRequest(
      req,
      res,
      new URL('http://localhost/api/conversations'),
      null,
      readJson,
      requireSessionWithCsrf,
    );

    assert.equal(handled, true);
    assert.equal(getStatus(), 401);
    assert.match(getData().error, /Authentication required/);
  });

  test('direct conversation creation requires recipientId', async () => {
    const { req, res, getStatus, getData, readJson, requireSessionWithCsrf } = createMockReqRes(
      'POST',
      '/api/conversations',
      { type: 'direct' },
    );
    const handled = await handleMessagingRequest(
      req,
      res,
      new URL('http://localhost/api/conversations'),
      'user_123',
      readJson,
      requireSessionWithCsrf,
    );

    assert.equal(handled, true);
    assert.equal(getStatus(), 400);
    assert.match(getData().error, /recipientId is required/);
  });

  test('group conversation creation requires valid title', async () => {
    const { req, res, getStatus, getData, readJson, requireSessionWithCsrf } = createMockReqRes(
      'POST',
      '/api/conversations',
      { type: 'group', title: '   ', participantIds: ['user_2'] },
    );
    await assert.rejects(
      async () => {
        await handleMessagingRequest(
          req,
          res,
          new URL('http://localhost/api/conversations'),
          'user_123',
          readJson,
          requireSessionWithCsrf,
        );
      },
      (err: any) => err.code === 'INVALID_TITLE',
    );
  });
});
