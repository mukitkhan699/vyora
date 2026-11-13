import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, test } from 'node:test';
import { handleApiRequest } from './routes/api.ts';

async function request(method: string, pathname: string) {
  const req = { method, headers: {} } as IncomingMessage;
  let responseBody = '';
  const res = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (body?: Buffer | string) => {
      responseBody = body?.toString() ?? '';
    },
  } as unknown as ServerResponse;

  const handled = await handleApiRequest(req, res, new URL(`http://localhost${pathname}`));
  return {
    handled,
    statusCode: res.statusCode,
    body: JSON.parse(responseBody) as { error?: string },
  };
}

describe('Legacy direct messaging retirement', () => {
  test('legacy repository, frontend, and realtime APIs have no active callers', () => {
    const adapter = readFileSync(new URL('./db/adapter.ts', import.meta.url), 'utf8');
    const routes = readFileSync(new URL('./routes/api.ts', import.meta.url), 'utf8');
    const frontend = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');
    const realtime = readFileSync(new URL('./realtime.ts', import.meta.url), 'utf8');
    const realtimeEvents = readFileSync(new URL('./realtime-events.ts', import.meta.url), 'utf8');
    const dispatcher = readFileSync(new URL('./realtime-outbox.ts', import.meta.url), 'utf8');
    const messagingRoutes = readFileSync(new URL('./routes/messaging.ts', import.meta.url), 'utf8');

    assert.doesNotMatch(adapter, /public async (?:getMessages|sendMessage)\(/);
    assert.doesNotMatch(routes, /dbAdapter\.(?:getMessages|sendMessage)\(/);
    assert.doesNotMatch(messagingRoutes, /\/api\/messages(?:\/|['"`])/);
    assert.doesNotMatch(frontend, /public (?:getMessages|sendMessage)\(/);
    assert.doesNotMatch(realtime, /message:new|\bonMessage\b|emitLegacyMessageToUsers/);
    assert.doesNotMatch(realtimeEvents, /\bpublishMessage\b|\bonMessage\b/);
    assert.doesNotMatch(dispatcher, /this\.options\.publishMessage/);
  });

  test('GET /api/messages/:recipientId returns 410 without accessing the repository', async () => {
    const response = await request('GET', '/api/messages/recipient-1');

    assert.equal(response.handled, true);
    assert.equal(response.statusCode, 410);
    assert.deepEqual(response.body, {
      error: 'Legacy direct messaging has been retired. Use conversation messaging.',
    });
  });

  test('POST /api/messages returns the same 410 response without reading the body', async () => {
    const response = await request('POST', '/api/messages');

    assert.equal(response.handled, true);
    assert.equal(response.statusCode, 410);
    assert.deepEqual(response.body, {
      error: 'Legacy direct messaging has been retired. Use conversation messaging.',
    });
  });
});
