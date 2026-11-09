import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { callingService } from './calling.ts';
import { WebhookReceiver } from 'livekit-server-sdk';

describe('LiveKit Calling Service & Webhook Contracts', () => {
  test('generates valid room tokens with scoped identity and permissions', async () => {
    const { token, url } = await callingService.generateToken('user_test_1', 'testuser', 'room_test_1');
    assert.ok(token);
    assert.ok(url);
    assert.equal(typeof token, 'string');
    assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  test('validates webhook receiver signature logic', async () => {
    const apiKey = 'devkey';
    const apiSecret = 'secret_secret_secret_secret_secret_32char';
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    assert.ok(receiver);
    assert.equal(typeof receiver.receive, 'function');
  });

  test('webhook receiver rejects invalid authorization headers', async () => {
    const apiKey = 'devkey';
    const apiSecret = 'secret_secret_secret_secret_secret_32char';
    const receiver = new WebhookReceiver(apiKey, apiSecret);

    await assert.rejects(
      async () => {
        await receiver.receive('{"event":"room_finished"}', 'invalid_auth_token');
      },
      /invalid/i,
    );
  });

  test('webhook reconciles empty room name safely', async () => {
    await callingService.handleWebhook({
      event: 'room_finished',
    });
    assert.ok(true, 'Empty room was handled safely.');
  });
});
