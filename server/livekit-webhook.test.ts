import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AccessToken } from 'livekit-server-sdk';
import { describe, test } from 'node:test';
import { callingService } from './calling.ts';
import { handleRequest } from './index.ts';

const apiKey = 'webhook-test-api-key';
const apiSecret = 'webhook-test-api-secret-value-at-least-32-characters';
const body = '{ "event": "room_started", "room": { "name": "signed-room" } }\n';
const environmentKeys = ['NODE_ENV', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL'] as const;

async function createWebhookAuthorization(
  signedBody: string,
  signingSecret = apiSecret,
): Promise<string> {
  const token = new AccessToken(apiKey, signingSecret);
  token.sha256 = createHash('sha256').update(signedBody, 'utf8').digest('base64');
  return token.toJwt();
}

async function withProductionHttpHandler<T>(
  callback: (
    origin: string,
    processedEvents: Array<{ event: string; room?: { name: string } }>,
  ) => Promise<T>,
  overrides: Partial<Record<(typeof environmentKeys)[number], string | undefined>> = {},
): Promise<T> {
  const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  const originalHandleWebhook = callingService.handleWebhook;
  const processedEvents: Array<{ event: string; room?: { name: string } }> = [];
  let server: ReturnType<typeof createHttpServer> | undefined;
  try {
    process.env.NODE_ENV = 'test';
    process.env.LIVEKIT_API_KEY = apiKey;
    process.env.LIVEKIT_API_SECRET = apiSecret;
    process.env.LIVEKIT_URL = 'wss://project.example.livekit.cloud';
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    callingService.handleWebhook = async (event) => {
      processedEvents.push(event);
    };
    server = createHttpServer((req, res) => {
      void handleRequest(req, res).catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end();
        }
      });
    });
    const listeningServer = server;

    await new Promise<void>((resolve, reject) => {
      listeningServer.once('error', reject);
      listeningServer.listen(0, '127.0.0.1', resolve);
    });

    const address = listeningServer.address() as AddressInfo;
    return await callback(`http://127.0.0.1:${address.port}`, processedEvents);
  } finally {
    try {
      const closingServer = server;
      if (closingServer?.listening) {
        await new Promise<void>((resolve, reject) => {
          closingServer.close((error) => (error ? reject(error) : resolve()));
          closingServer.closeAllConnections();
        });
      }
    } finally {
      callingService.handleWebhook = originalHandleWebhook;
      for (const [key, value] of originalEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
}

async function postWebhook(
  origin: string,
  requestBody: string | Buffer,
  options: { authorization?: string; contentType?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': options.contentType ?? 'application/webhook+json',
  };
  if (options.authorization !== undefined) headers.Authorization = options.authorization;
  return fetch(`${origin}/api/calls/webhook`, {
    method: 'POST',
    headers,
    body: typeof requestBody === 'string' ? requestBody : Uint8Array.from(requestBody),
  });
}

describe('LiveKit webhook HTTP verification', { concurrency: false }, () => {
  test('accepts a valid signed raw webhook and processes its verified event exactly once', async () => {
    const authorization = await createWebhookAuthorization(body);

    await withProductionHttpHandler(async (origin, processedEvents) => {
      const response = await postWebhook(origin, body, {
        authorization,
        contentType: 'application/webhook+json; charset=utf-8',
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { received: true });
      assert.equal(processedEvents.length, 1);
      assert.equal(processedEvents[0]?.event, 'room_started');
      assert.equal(processedEvents[0]?.room?.name, 'signed-room');
    });
  });

  test('rejects a missing Authorization header without processing an event', async () => {
    await withProductionHttpHandler(async (origin, processedEvents) => {
      const response = await postWebhook(origin, body);
      assert.equal(response.status, 401);
      assert.equal(processedEvents.length, 0);
    });
  });

  test('rejects an invalid Authorization header', async () => {
    await withProductionHttpHandler(async (origin, processedEvents) => {
      const response = await postWebhook(origin, body, { authorization: 'invalid-token' });
      assert.equal(response.status, 401);
      assert.equal(processedEvents.length, 0);
    });
  });

  test('rejects a JWT signed with the wrong secret', async () => {
    const authorization = await createWebhookAuthorization(body, 'wrong-webhook-secret-value-at-least-32-characters');
    await withProductionHttpHandler(async (origin, processedEvents) => {
      const response = await postWebhook(origin, body, { authorization });
      assert.equal(response.status, 401);
      assert.equal(processedEvents.length, 0);
    });
  });

  test('rejects a valid signature paired with a modified body', async () => {
    const authorization = await createWebhookAuthorization(body);
    await withProductionHttpHandler(async (origin, processedEvents) => {
      const response = await postWebhook(origin, body.replace('signed-room', 'changed-room'), {
        authorization,
      });
      assert.equal(response.status, 401);
      assert.equal(processedEvents.length, 0);
    });
  });

  test('rejects reserialized JSON when the signed original bytes differ', async () => {
    const signedBody = '{"event":"room_started","room":{"name":"signed-room"}}';
    const authorization = await createWebhookAuthorization(signedBody);
    await withProductionHttpHandler(async (origin, processedEvents) => {
      const response = await postWebhook(
        origin,
        JSON.stringify(JSON.parse(signedBody), null, 2),
        { authorization },
      );
      assert.equal(response.status, 401);
      assert.equal(processedEvents.length, 0);
    });
  });

  test('rejects malformed JSON after verifying its signature', async () => {
    const malformedBody = '{"event":';
    const authorization = await createWebhookAuthorization(malformedBody);
    await withProductionHttpHandler(async (origin, processedEvents) => {
      const response = await postWebhook(origin, malformedBody, { authorization });
      assert.equal(response.status, 400);
      assert.equal(processedEvents.length, 0);
    });
  });

  test('rejects an empty body', async () => {
    const authorization = await createWebhookAuthorization('');
    await withProductionHttpHandler(async (origin, processedEvents) => {
      const response = await postWebhook(origin, '', { authorization });
      assert.equal(response.status, 400);
      assert.equal(processedEvents.length, 0);
    });
  });

  test('rejects an oversized body', async () => {
    await withProductionHttpHandler(async (origin, processedEvents) => {
      const response = await postWebhook(origin, Buffer.alloc(64 * 1024 + 1, 0x20), {
        authorization: 'present',
      });
      assert.equal(response.status, 413);
      assert.equal(response.headers.get('connection'), 'close');
      assert.equal(processedEvents.length, 0);
    });
  });

  test('rejects missing LiveKit configuration without exposing configuration details', async () => {
    await withProductionHttpHandler(async (origin, processedEvents) => {
      const response = await postWebhook(origin, body, { authorization: 'present' });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: 'Webhook verification is unavailable.',
        code: 'WEBHOOK_UNAVAILABLE',
      });
      assert.equal(processedEvents.length, 0);
    }, { LIVEKIT_API_SECRET: undefined });
  });

  test('rejects unsupported webhook media types and malformed UTF-8', async () => {
    await withProductionHttpHandler(async (origin, processedEvents) => {
      const wrongType = await postWebhook(origin, body, {
        authorization: 'present',
        contentType: 'application/json',
      });
      assert.equal(wrongType.status, 415);

      const invalidUtf8 = await postWebhook(origin, Buffer.from([0xc3, 0x28]), {
        authorization: 'present',
      });
      assert.equal(invalidUtf8.status, 400);
      assert.equal(processedEvents.length, 0);
    });
  });

  test('rejects duplicate, unsupported, and malformed content-type parameters', async () => {
    await withProductionHttpHandler(async (origin, processedEvents) => {
      for (const contentType of [
        'application/webhook+json; charset=utf-8; charset=utf8',
        'application/webhook+json; charset=iso-8859-1',
        'application/webhook+json; charset',
        'application/webhook+json; charset==utf-8',
        'application/webhook+json; charset=utf-8; boundary=value',
      ]) {
        const response = await postWebhook(origin, body, {
          authorization: 'present',
          contentType,
        });
        assert.equal(response.status, 415, `Expected rejection for ${contentType}`);
      }
      assert.equal(processedEvents.length, 0);
    });
  });
});
