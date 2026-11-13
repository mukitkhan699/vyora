import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getLiveKitConfiguration } from './config.ts';

const apiKey = 'test-livekit-api-key';
const apiSecret = 'test-livekit-api-secret-value-at-least-32-characters';

function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: apiSecret,
    LIVEKIT_URL: 'wss://project.example.livekit.cloud',
    ...overrides,
  };
}

describe('LiveKit configuration', () => {
  for (const [name, variable] of [
    ['API key', 'LIVEKIT_API_KEY'],
    ['API secret', 'LIVEKIT_API_SECRET'],
    ['URL', 'LIVEKIT_URL'],
  ] as const) {
    test(`rejects a missing ${name}`, () => {
      assert.throws(
        () => getLiveKitConfiguration(validEnvironment({ [variable]: undefined })),
        new RegExp(`${variable} is required`),
      );
    });

    test(`rejects an empty or whitespace-only ${name}`, () => {
      for (const emptyValue of ['', '   \t']) {
        assert.throws(
          () => getLiveKitConfiguration(validEnvironment({ [variable]: emptyValue })),
          new RegExp(`${variable} is required`),
        );
      }
    });
  }

  test('rejects malformed URLs and URLs with embedded credentials', () => {
    assert.throws(
      () => getLiveKitConfiguration(validEnvironment({ LIVEKIT_URL: 'https://not a url' })),
      /LIVEKIT_URL must be a valid URL/,
    );
    assert.throws(
      () => getLiveKitConfiguration(validEnvironment({ LIVEKIT_URL: 'https://user:password@example.com' })),
      /must not contain embedded credentials/,
    );
  });

  test('rejects invalid hostnames', () => {
    assert.throws(
      () => getLiveKitConfiguration(validEnvironment({ LIVEKIT_URL: 'https://invalid_host.example' })),
      /must contain a valid hostname/,
    );
  });

  test('rejects unsupported URL protocols', () => {
    assert.throws(
      () => getLiveKitConfiguration(validEnvironment({ LIVEKIT_URL: 'ftp://project.example.com' })),
      /must use HTTPS or WSS/,
    );
  });

  test('rejects HTTP URLs outside explicitly enabled local development', () => {
    for (const url of ['http://project.example.com', 'http://localhost:7880']) {
      assert.throws(
        () => getLiveKitConfiguration(validEnvironment({ LIVEKIT_URL: url })),
        /only allowed for localhost in development/,
      );
    }
  });

  test('allows HTTP localhost only in development', () => {
    const config = getLiveKitConfiguration(
      validEnvironment({
        NODE_ENV: 'development',
        LIVEKIT_URL: 'http://localhost:7880',
      }),
    );
    assert.equal(config.url, 'http://localhost:7880');
  });

  test('allows a valid HTTPS LiveKit configuration', () => {
    const config = getLiveKitConfiguration(
      validEnvironment({ LIVEKIT_URL: 'https://project.example.livekit.cloud' }),
    );
    assert.deepEqual(config, {
      apiKey,
      apiSecret,
      url: 'https://project.example.livekit.cloud',
    });
  });

  test('does not include provided secrets in validation errors', () => {
    const secret = 'sensitive-test-secret-that-must-not-be-echoed';
    assert.throws(
      () =>
        getLiveKitConfiguration(
          validEnvironment({
            LIVEKIT_API_SECRET: secret,
            LIVEKIT_URL: 'not-a-url',
          }),
        ),
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes(secret) &&
        error.message.includes('LIVEKIT_URL'),
    );
  });
});
