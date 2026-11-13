import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { describe, test } from 'node:test';
import type { Pool, QueryResult } from 'pg';
import { Server as SocketServer } from 'socket.io';
import { getRealtimeAdapterPool } from './db/pool.ts';
import { attachPostgresRealtimeAdapter } from './realtime-adapter.ts';

const okResult = { rows: [], rowCount: 0 } as unknown as QueryResult;

class FakeAdapterClient extends EventEmitter {
  public readonly queries: string[] = [];
  public readonly releaseCalls: Array<boolean | undefined> = [];

  constructor(public listenError?: Error) {
    super();
  }

  async query(text: string): Promise<QueryResult> {
    this.queries.push(text);
    if (typeof text === 'string' && text.trim().toUpperCase().startsWith('LISTEN ')) {
      if (this.listenError) throw this.listenError;
    }
    return okResult;
  }

  release(destroy?: boolean): void {
    this.releaseCalls.push(destroy);
  }
}

function createFakePool(failListen = false) {
  const clients: FakeAdapterClient[] = [];
  const pool = {
    connect: async () => {
      const client = new FakeAdapterClient(failListen ? new Error('LISTEN failed') : undefined);
      clients.push(client);
      return client;
    },
    query: async () => okResult,
  };
  return { pool: pool as unknown as Pool, clients };
}

function createIo(): { io: SocketServer; close: () => Promise<void> } {
  const httpServer = createServer();
  const io = new SocketServer(httpServer, { serveClient: false });
  return {
    io,
    close: () => new Promise<void>((resolve) => io.close(() => resolve())),
  };
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for adapter state.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function withDeterministicReconnect<T>(work: () => Promise<T>): Promise<T> {
  const original = Math.random;
  Math.random = () => 0;
  try {
    return await work();
  } finally {
    Math.random = original;
  }
}

test('realtime adapter requires a direct, non-pooled PostgreSQL URL', () => {
  const original = process.env.DATABASE_URL_DIRECT;
  try {
    delete process.env.DATABASE_URL_DIRECT;
    assert.throws(getRealtimeAdapterPool, /DATABASE_URL_DIRECT is required for PostgreSQL realtime/);

    process.env.DATABASE_URL_DIRECT =
      'postgresql://user:password@ep-example-pooler.us-east-1.aws.neon.tech/neondb';
    assert.throws(getRealtimeAdapterPool, /must use a direct PostgreSQL connection/);

    process.env.DATABASE_URL_DIRECT = 'https://database.example.invalid';
    assert.throws(getRealtimeAdapterPool, /must use the PostgreSQL protocol/);
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL_DIRECT;
    else process.env.DATABASE_URL_DIRECT = original;
  }
});

describe('PostgreSQL realtime adapter lifecycle', { concurrency: 1 }, () => {
  test('initial successful LISTEN marks the adapter ready and releases on close', async () => {
    const { pool, clients } = createFakePool();
    const { io } = createIo();
    let readyChanges = 0;
    let handle: Awaited<ReturnType<typeof attachPostgresRealtimeAdapter>> | undefined;
    try {
      handle = await attachPostgresRealtimeAdapter(
        io,
        pool,
        () => { readyChanges += 1; },
        { startupTimeoutMs: 500 },
      );
      assert.equal(handle.isReady(), true);
      assert.ok(readyChanges >= 1);
      assert.equal(clients.length, 1);
      await handle.close();
      assert.deepEqual(clients[0]?.releaseCalls, [false]);
    } finally {
      await handle?.close().catch(() => {});
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  });

  test('initial LISTEN failure releases and destroys the acquired client', async () => {
    const { pool, clients } = createFakePool(true);
    const { io } = createIo();
    try {
      await assert.rejects(
        attachPostgresRealtimeAdapter(
          io,
          pool,
          () => {},
          { startupTimeoutMs: 100 },
        ),
        /Timed out waiting for the PostgreSQL realtime adapter/,
      );
      assert.equal(clients.length, 1);
      assert.deepEqual(clients[0]?.releaseCalls, [true]);
    } finally {
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  });

  test('listener disconnection marks unavailable and successful reconnection restores readiness', async () => {
    await withDeterministicReconnect(async () => {
      const { pool, clients } = createFakePool();
      const { io } = createIo();
      let handle: Awaited<ReturnType<typeof attachPostgresRealtimeAdapter>> | undefined;
      const readiness: boolean[] = [];
      try {
        handle = await attachPostgresRealtimeAdapter(
          io,
          pool,
          (ready) => readiness.push(ready),
          { startupTimeoutMs: 500 },
        );
        assert.equal(handle.isReady(), true);
        clients[0]!.emit('end');
        await waitUntil(() => !handle!.isReady(), 500);
        await waitUntil(() => handle!.isReady() && clients.length >= 2, 3_000);
        assert.equal(handle.isReady(), true);
        assert.deepEqual(readiness.slice(0, 3), [true, false, true]);
      } finally {
        await handle?.close().catch(() => {});
        await new Promise<void>((resolve) => io.close(() => resolve()));
      }
    });
  });

  test('shutdown during reconnection prevents a replacement connection', async () => {
    await withDeterministicReconnect(async () => {
      const { pool, clients } = createFakePool();
      const { io } = createIo();
      let handle: Awaited<ReturnType<typeof attachPostgresRealtimeAdapter>> | undefined;
      try {
        handle = await attachPostgresRealtimeAdapter(
          io,
          pool,
          () => {},
          { startupTimeoutMs: 500 },
        );
        clients[0]!.emit('end');
        await waitUntil(() => !handle!.isReady(), 500);
        await handle.close();
        await new Promise((resolve) => setTimeout(resolve, 1_300));
        assert.equal(clients.length, 1);
      } finally {
        await handle?.close().catch(() => {});
        await new Promise<void>((resolve) => io.close(() => resolve()));
      }
    });
  });

  test('startup failure clears the adapter reconnection timer', async () => {
    await withDeterministicReconnect(async () => {
      const { pool, clients } = createFakePool(true);
      const { io } = createIo();
      try {
        await assert.rejects(
          attachPostgresRealtimeAdapter(
            io,
            pool,
            () => {},
            { startupTimeoutMs: 100 },
          ),
          /Timed out waiting for the PostgreSQL realtime adapter/,
        );
        await new Promise((resolve) => setTimeout(resolve, 1_300));
        assert.equal(clients.length, 1);
      } finally {
        await new Promise<void>((resolve) => io.close(() => resolve()));
      }
    });
  });
});
