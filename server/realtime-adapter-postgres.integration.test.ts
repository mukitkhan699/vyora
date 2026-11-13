import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { describe, test } from 'node:test';
import { Server as SocketServer } from 'socket.io';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Pool as PgPool } from 'pg';
import type { MessageRecord } from './db/messaging.ts';
import {
  attachPostgresRealtimeAdapter,
  type RealtimeAdapterHandle,
} from './realtime-adapter.ts';
import {
  getClusterOnlineUserIds,
  installRealtimeEventPropagation,
  publishConversationMessageEditToCluster,
  publishConversationMessageToCluster,
} from './realtime.ts';
import {
  publishCallEvent,
  publishConversationMessageDelete,
  publishNotification,
  publishReaction,
  publishReceipt,
  publishSessionRevocation,
  publishTyping,
} from './realtime-events.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();
const directApplicationDatabaseUrl = process.env.DATABASE_URL_DIRECT?.trim();
const skipReason =
  !testDatabaseUrl || process.env.RUN_POSTGRES_INTEGRATION !== '1'
    ? 'Set TEST_DATABASE_URL and RUN_POSTGRES_INTEGRATION=1 for PostgreSQL realtime adapter integration tests.'
    : testDatabaseUrl === applicationDatabaseUrl ||
        testDatabaseUrl === directApplicationDatabaseUrl
      ? 'Refusing to run realtime adapter integration tests against an application database URL.'
      : undefined;

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function connectClient(
  url: string,
  userId: string,
  extraAuth: Record<string, unknown> = {},
): Promise<ClientSocket> {
  const client = createSocketClient(url, {
    auth: { userId, ...extraAuth },
    transports: ['websocket'],
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
  return client;
}

async function waitForEvent<T>(
  socket: ClientSocket,
  eventName: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}.`)), 3_000);
    socket.once(eventName, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for realtime adapter state.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForClusterPeer(server: SocketServer, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await server.serverSideEmitWithAck('zunari:realtime:adapter-probe');
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function expectNoEvent(
  socket: ClientSocket,
  eventName: string,
  windowMs = 400,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      resolve();
    }, windowMs);
    const handler = () => {
      clearTimeout(timer);
      socket.off(eventName, handler);
      reject(new Error(`Unexpected ${eventName} event received.`));
    };
    socket.on(eventName, handler);
  });
}

async function waitForDisconnect(socket: ClientSocket): Promise<string> {
  if (socket.disconnected) return 'already-disconnected';
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for disconnect.')), 3_000);
    socket.once('disconnect', (reason: string) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

describe('Socket.IO PostgreSQL adapter (real PostgreSQL)', {
  skip: skipReason,
  concurrency: 1,
}, () => {
  test('cross-instance events reach only the intended sockets and survive reconnection', async () => {
    assert.ok(testDatabaseUrl);
    const { Pool } = await import('pg');
    const adminPool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
    const schema = `zunari_socket_io_it_${randomUUID().replaceAll('-', '')}`;
    let schemaPool: PgPool | undefined;
    let poolA: PgPool | undefined;
    let poolB: PgPool | undefined;
    let httpA: ReturnType<typeof createServer> | undefined;
    let httpB: ReturnType<typeof createServer> | undefined;
    let ioA: SocketServer | undefined;
    let ioB: SocketServer | undefined;
    let adapterA: RealtimeAdapterHandle | undefined;
    let adapterB: RealtimeAdapterHandle | undefined;
    let propagationA: ReturnType<typeof installRealtimeEventPropagation> | undefined;
    let propagationB: ReturnType<typeof installRealtimeEventPropagation> | undefined;
    let authorizedClientA: ClientSocket | undefined;
    let authorizedClient: ClientSocket | undefined;
    let removedClient: ClientSocket | undefined;
    let rejoinedClient: ClientSocket | undefined;
    let sessionClient: ClientSocket | undefined;

    try {
      await adminPool.query(`CREATE SCHEMA ${schema}`);
      schemaPool = new Pool({
        connectionString: testDatabaseUrl,
        options: `-c search_path=${schema}`,
        max: 2,
      });
      const migration = await readFile(
        new URL('./db/migrations/009_socket_io_postgres_adapter.sql', import.meta.url),
        'utf8',
      );
      await schemaPool.query(migration);

      const poolOptions = {
        connectionString: testDatabaseUrl,
        options: `-c search_path=${schema}`,
        max: 4,
      };
      poolA = new Pool({ ...poolOptions, application_name: `${schema}_a` });
      poolB = new Pool({ ...poolOptions, application_name: `${schema}_b` });
      httpA = createServer();
      httpB = createServer();
      ioA = new SocketServer(httpA, { serveClient: false });
      ioB = new SocketServer(httpB, { serveClient: false });

      for (const io of [ioA, ioB]) {
        io.on('zunari:realtime:adapter-probe', (ack: () => void) => ack());
        io.on('connection', (socket) => {
          const auth = socket.handshake.auth as {
            userId?: unknown;
            sessionToken?: unknown;
            authUserId?: unknown;
          };
          if (typeof auth.userId === 'string') socket.join(`user:${auth.userId}`);
          socket.join('conv:conv-cross');
          if (typeof auth.sessionToken === 'string') {
            socket.join(`session:${auth.sessionToken}`);
          }
          if (typeof auth.authUserId === 'number') {
            socket.join(`auth-user:${auth.authUserId}`);
          }
        });
      }
      propagationA = installRealtimeEventPropagation(ioA, () => adapterA!.isReady());
      propagationB = installRealtimeEventPropagation(ioB, () => adapterB!.isReady(), {
        localPublishers: false,
      });

      [adapterA, adapterB] = await Promise.all([
        attachPostgresRealtimeAdapter(ioA, poolA),
        attachPostgresRealtimeAdapter(ioB, poolB),
      ]);
      await Promise.all([
        adapterA.waitForCluster(),
        adapterB.waitForCluster(),
      ]);

      await adminPool.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE application_name = $1 AND pid <> pg_backend_pid()`,
        [`${schema}_b`],
      );
      await waitUntil(() => !adapterB!.isReady(), 2_000);
      await waitUntil(() => adapterB!.isReady(), 5_000);
      await Promise.all([waitForClusterPeer(ioA), waitForClusterPeer(ioB)]);

      const urlA = await listen(httpA);
      const urlB = await listen(httpB);
      authorizedClientA = await connectClient(urlA, 'authorized');
      authorizedClient = await connectClient(urlB, 'authorized');
      removedClient = await connectClient(urlB, 'removed');
      rejoinedClient = await connectClient(urlB, 'rejoined');
      sessionClient = await connectClient(urlB, 'authorized', {
        sessionToken: 'revoked-session',
      });

      let localMessageCount = 0;
      let remoteMessageCount = 0;
      authorizedClientA.on('conversation:message', () => { localMessageCount += 1; });
      authorizedClient.on('conversation:message', () => { remoteMessageCount += 1; });

      const messageEvent = {
        conversationId: 'conv-cross',
        message: {
          id: 'cross-instance-message',
          text: 'message body',
        } as unknown as MessageRecord,
        recipientIds: ['authorized'],
        eventId: randomUUID(),
      };
      const authorizedMessageA = waitForEvent<{ id: string; text: string }>(
        authorizedClientA,
        'conversation:message',
      );
      const authorizedMessage = waitForEvent<{ id: string; text: string }>(
        authorizedClient,
        'conversation:message',
      );
      const removedMessage = expectNoEvent(removedClient, 'conversation:message');
      const rejoinedMessage = expectNoEvent(rejoinedClient, 'conversation:message');
      await publishConversationMessageToCluster(
        ioA,
        () => adapterA!.isReady(),
        messageEvent,
      );

      assert.deepEqual(await authorizedMessageA, messageEvent.message);
      assert.deepEqual(await authorizedMessage, messageEvent.message);
      await removedMessage;
      await rejoinedMessage;
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(localMessageCount, 1);
      assert.equal(remoteMessageCount, 1);

      const editEvent = {
        conversationId: 'conv-cross',
        message: {
          id: 'cross-instance-message',
          text: 'edited body',
        } as unknown as MessageRecord,
        recipientIds: ['authorized'],
        eventId: randomUUID(),
      };
      const authorizedEditA = waitForEvent<{ id: string; text: string }>(
        authorizedClientA,
        'conversation:message-edit',
      );
      const authorizedEdit = waitForEvent<{ id: string; text: string }>(
        authorizedClient,
        'conversation:message-edit',
      );
      const removedEdit = expectNoEvent(removedClient, 'conversation:message-edit');
      const rejoinedEdit = expectNoEvent(rejoinedClient, 'conversation:message-edit');
      await publishConversationMessageEditToCluster(
        ioA,
        () => adapterA!.isReady(),
        editEvent,
      );

      assert.deepEqual(await authorizedEditA, editEvent.message);
      assert.deepEqual(await authorizedEdit, editEvent.message);
      await removedEdit;
      await rejoinedEdit;

      const presence = await getClusterOnlineUserIds(ioA, [
        'authorized',
        'removed',
        'rejoined',
      ]);
      assert.deepEqual(
        new Set(presence),
        new Set(['authorized', 'removed', 'rejoined']),
      );

      await ioA.serverSideEmitWithAck('zunari:realtime:evict-conversation', {
        userId: 'removed',
        conversationId: 'conv-cross',
      });

      const typingEvent = {
        conversationId: 'conv-cross',
        userId: 'authorized',
        username: 'authorized',
        isTyping: true,
      };
      const typingA = waitForEvent<typeof typingEvent>(
        authorizedClientA,
        'conversation:typing',
      );
      const typingB = waitForEvent<typeof typingEvent>(
        authorizedClient,
        'conversation:typing',
      );
      const typingRejoined = waitForEvent<typeof typingEvent>(
        rejoinedClient,
        'conversation:typing',
      );
      const typingRemoved = expectNoEvent(removedClient, 'conversation:typing');
      publishTyping(typingEvent);
      assert.deepEqual(await typingA, typingEvent);
      assert.deepEqual(await typingB, typingEvent);
      assert.deepEqual(await typingRejoined, typingEvent);
      await typingRemoved;

      const deleteEvent = {
        conversationId: 'conv-cross',
        messageId: 'cross-instance-message',
        recipientIds: ['authorized'],
      };
      const deleteA = waitForEvent<{ conversationId: string; messageId: string }>(
        authorizedClientA,
        'conversation:message-delete',
      );
      const deleteB = waitForEvent<{ conversationId: string; messageId: string }>(
        authorizedClient,
        'conversation:message-delete',
      );
      const deleteRemoved = expectNoEvent(removedClient, 'conversation:message-delete');
      publishConversationMessageDelete(deleteEvent);
      assert.deepEqual(await deleteA, {
        conversationId: deleteEvent.conversationId,
        messageId: deleteEvent.messageId,
      });
      assert.deepEqual(await deleteB, {
        conversationId: deleteEvent.conversationId,
        messageId: deleteEvent.messageId,
      });
      await deleteRemoved;

      const receiptEvent = {
        conversationId: 'conv-cross',
        userId: 'authorized',
        messageIds: ['cross-instance-message'],
        receiptType: 'read' as const,
        recipientIds: ['authorized'],
      };
      const receiptA = waitForEvent<Record<string, unknown>>(
        authorizedClientA,
        'conversation:receipt',
      );
      const receiptB = waitForEvent<Record<string, unknown>>(
        authorizedClient,
        'conversation:receipt',
      );
      const receiptRemoved = expectNoEvent(removedClient, 'conversation:receipt');
      publishReceipt(receiptEvent);
      assert.deepEqual(await receiptA, {
        conversationId: receiptEvent.conversationId,
        userId: receiptEvent.userId,
        messageIds: receiptEvent.messageIds,
        receiptType: receiptEvent.receiptType,
      });
      assert.deepEqual(await receiptB, {
        conversationId: receiptEvent.conversationId,
        userId: receiptEvent.userId,
        messageIds: receiptEvent.messageIds,
        receiptType: receiptEvent.receiptType,
      });
      await receiptRemoved;

      const reactionEvent = {
        conversationId: 'conv-cross',
        messageId: 'cross-instance-message',
        userId: 'authorized',
        username: 'authorized',
        emoji: 'thumbs-up',
        added: true,
        recipientIds: ['authorized'],
      };
      const reactionA = waitForEvent<Record<string, unknown>>(
        authorizedClientA,
        'conversation:reaction',
      );
      const reactionB = waitForEvent<Record<string, unknown>>(
        authorizedClient,
        'conversation:reaction',
      );
      const reactionRemoved = expectNoEvent(removedClient, 'conversation:reaction');
      publishReaction(reactionEvent);
      assert.deepEqual(await reactionA, {
        conversationId: reactionEvent.conversationId,
        messageId: reactionEvent.messageId,
        userId: reactionEvent.userId,
        username: reactionEvent.username,
        emoji: reactionEvent.emoji,
        added: reactionEvent.added,
      });
      assert.deepEqual(await reactionB, {
        conversationId: reactionEvent.conversationId,
        messageId: reactionEvent.messageId,
        userId: reactionEvent.userId,
        username: reactionEvent.username,
        emoji: reactionEvent.emoji,
        added: reactionEvent.added,
      });
      await reactionRemoved;

      const callEvent = {
        callId: 'call-cross',
        conversationId: 'conv-cross',
        roomName: 'room-cross',
        type: 'voice' as const,
        status: 'ringing' as const,
        caller: { id: 'authorized', username: 'authorized', name: 'Authorized', avatarUrl: '' },
        participants: [
          { id: 'authorized', username: 'authorized', name: 'Authorized', avatarUrl: '' },
        ],
        event: 'incoming' as const,
        recipientIds: ['authorized'],
      };
      const callA = waitForEvent<typeof callEvent>(authorizedClientA, 'call:incoming');
      const callB = waitForEvent<typeof callEvent>(authorizedClient, 'call:incoming');
      const callRemoved = expectNoEvent(removedClient, 'call:incoming');
      publishCallEvent(callEvent);
      assert.deepEqual(await callA, callEvent);
      assert.deepEqual(await callB, callEvent);
      await callRemoved;

      const notification = {
        id: 'notification-cross',
        type: 'message' as const,
        title: 'Notification',
        body: 'Body',
        read: false,
        createdAt: Date.now(),
      };
      const notificationA = waitForEvent<typeof notification>(
        authorizedClientA,
        'notification:new',
      );
      const notificationB = waitForEvent<typeof notification>(
        authorizedClient,
        'notification:new',
      );
      const notificationRemoved = expectNoEvent(removedClient, 'notification:new');
      publishNotification('authorized', notification as never);
      assert.deepEqual(await notificationA, notification);
      assert.deepEqual(await notificationB, notification);
      await notificationRemoved;

      const sessionDisconnect = waitForDisconnect(sessionClient);
      publishSessionRevocation({ tokenHash: 'revoked-session' });
      await sessionDisconnect;

    } finally {
      propagationA?.stop();
      propagationB?.stop();
      authorizedClientA?.disconnect();
      authorizedClient?.disconnect();
      removedClient?.disconnect();
      rejoinedClient?.disconnect();
      sessionClient?.disconnect();
      await Promise.all([
        adapterA
          ? adapterA.close()
          : ioA
            ? new Promise<void>((resolve) => ioA?.close(() => resolve()))
            : Promise.resolve(),
        adapterB
          ? adapterB.close()
          : ioB
            ? new Promise<void>((resolve) => ioB?.close(() => resolve()))
            : Promise.resolve(),
      ]);
      await Promise.all([poolA?.end(), poolB?.end(), schemaPool?.end()]);
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await adminPool.end();
    }
  });
});
