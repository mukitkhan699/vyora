import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { MessageRecord } from './db/messaging.ts';
import { MessagingRepository } from './db/messaging.ts';
import { RealtimeOutboxDispatcher } from './realtime-outbox.ts';
import {
  getActiveConversationRecipients,
  lockConversationForMembershipChange,
  lockConversationForPublication,
} from './db/conversation-membership-lock.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();
const skipReason =
  !testDatabaseUrl || process.env.RUN_POSTGRES_INTEGRATION !== '1'
    ? 'Set TEST_DATABASE_URL and RUN_POSTGRES_INTEGRATION=1 for PostgreSQL outbox integration tests.'
    : applicationDatabaseUrl === testDatabaseUrl
      ? 'Refusing to run outbox integration tests against DATABASE_URL.'
      : undefined;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('realtime outbox PostgreSQL locking (real PostgreSQL)', {
  skip: skipReason,
  concurrency: 1,
}, () => {
  test('message creation serializes sender authorization with membership removal', async () => {
    assert.ok(testDatabaseUrl);
    const { Pool } = await import('pg');
    const adminPool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
    const schema = `zunari_send_it_${randomUUID().replaceAll('-', '')}`;
    let scopedPool: InstanceType<typeof Pool> | undefined;

    try {
      await adminPool.query(`CREATE SCHEMA ${schema}`);
      scopedPool = new Pool({
        connectionString: testDatabaseUrl,
        options: `-c search_path=${schema}`,
        max: 8,
      });
      await scopedPool.query(`
        CREATE TABLE zunari_conversations_v2 (
          id text PRIMARY KEY,
          type text NOT NULL,
          last_message_at bigint NOT NULL DEFAULT 0,
          updated_at bigint NOT NULL DEFAULT 0
        );
        CREATE TABLE zunari_conversation_participants (
          conversation_id text NOT NULL,
          user_id text NOT NULL,
          role text NOT NULL DEFAULT 'member',
          joined_at bigint NOT NULL DEFAULT 0,
          left_at bigint,
          PRIMARY KEY (conversation_id, user_id)
        );
        CREATE TABLE zunari_messages_v2 (
          id text PRIMARY KEY,
          conversation_id text NOT NULL,
          sender_id text,
          client_id text,
          text text NOT NULL DEFAULT '',
          reply_to_message_id text,
          is_edited boolean NOT NULL DEFAULT false,
          is_deleted boolean NOT NULL DEFAULT false,
          created_at bigint NOT NULL
        );
        CREATE UNIQUE INDEX zunari_messages_v2_client_id_unique
          ON zunari_messages_v2(conversation_id, sender_id, client_id)
          WHERE client_id IS NOT NULL;
        CREATE TABLE zunari_message_receipts (
          message_id text NOT NULL,
          user_id text NOT NULL,
          delivered_at bigint,
          read_at bigint,
          PRIMARY KEY (message_id, user_id)
        );
        CREATE TABLE zunari_realtime_event_outbox (
          id uuid PRIMARY KEY,
          event_type text NOT NULL,
          entity_id text,
          conversation_id text,
          payload jsonb NOT NULL,
          created_at bigint NOT NULL,
          published_at bigint,
          attempt_count integer NOT NULL DEFAULT 0,
          next_attempt_at bigint NOT NULL,
          claimed_at bigint,
          lease_expires_at bigint,
          lease_token uuid,
          last_error text,
          dead_lettered_at bigint
        );
      `);
      const membershipMigration = await readFile(
        new URL('./db/migrations/008_conversation_membership_epochs.sql', import.meta.url),
        'utf8',
      );
      await scopedPool.query(membershipMigration);

      const withTransaction = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
        const client = await scopedPool!.connect();
        try {
          await client.query('BEGIN');
          const result = await work(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      };

      const repositoryFor = (
        conversationId: string,
        transaction = withTransaction,
      ) => new MessagingRepository({
        withTransaction: transaction,
        loadSentMessage: async (id, senderId): Promise<MessageRecord> => ({
          id,
          conversationId,
          senderId,
          clientId: 'task-4a-client',
          text: 'message',
          replyToMessageId: null,
          replyToMessage: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          deletedAt: null,
          createdAt: Date.now(),
          attachments: [],
          reactions: [],
          receipts: [],
        }),
        loadEditedMessage: async (id, senderId): Promise<MessageRecord> => ({
          id,
          conversationId,
          senderId,
          clientId: null,
          text: 'edited message',
          replyToMessageId: null,
          replyToMessage: null,
          isEdited: true,
          editedAt: Date.now(),
          isDeleted: false,
          deletedAt: null,
          createdAt: Date.now(),
          attachments: [],
          reactions: [],
          receipts: [],
        }),
      });

      const seedConversation = async (id: string, type: 'direct' | 'group') => {
        await scopedPool!.query(
          'INSERT INTO zunari_conversations_v2 (id, type) VALUES ($1, $2)',
          [id, type],
        );
        await scopedPool!.query(
          `INSERT INTO zunari_conversation_participants (conversation_id, user_id)
           VALUES ($1, 'sender'), ($1, 'recipient')`,
          [id],
        );
      };

      for (const type of ['direct', 'group'] as const) {
        const dedupeId = `${type}-dedupe`;
        await seedConversation(dedupeId, type);
        const dedupeRepository = repositoryFor(dedupeId);
        const firstSend = await dedupeRepository.sendMessage('sender', dedupeId, {
          text: 'first attempt',
          clientId: 'task-4a-client',
        });
        const duplicateSend = await dedupeRepository.sendMessage('sender', dedupeId, {
          text: 'retry',
          clientId: 'task-4a-client',
        });
        assert.equal(firstSend.isDuplicate, false);
        assert.equal(duplicateSend.isDuplicate, true);
        const dedupeEvents: QueryResult<{ count: string }> = await scopedPool.query<{ count: string }>(
          'SELECT count(*) FROM zunari_realtime_event_outbox WHERE conversation_id = $1',
          [dedupeId],
        );
        assert.equal(dedupeEvents.rows[0]?.count, '1');

        const removalWinsId = `${type}-removal-wins`;
        await seedConversation(removalWinsId, type);
        await withTransaction(async (client) => {
          await lockConversationForMembershipChange(client, removalWinsId);
          await client.query(
            `UPDATE zunari_conversation_participants SET left_at = $1
             WHERE conversation_id = $2 AND user_id = 'sender'`,
            [Date.now(), removalWinsId],
          );
        });

        await assert.rejects(
          repositoryFor(removalWinsId).sendMessage('sender', removalWinsId, {
            text: 'must be rejected',
            clientId: 'task-4a-client',
          }),
          (error: unknown) =>
            error instanceof Error && 'status' in error && error.status === 403,
        );
        const rejectedCounts: QueryResult<{
          messages: string;
          receipts: string;
          events: string;
        }> = await scopedPool.query<{
          messages: string;
          receipts: string;
          events: string;
        }>(
          `SELECT
             (SELECT count(*) FROM zunari_messages_v2 WHERE conversation_id = $1) AS messages,
             (SELECT count(*) FROM zunari_message_receipts WHERE message_id IN
               (SELECT id FROM zunari_messages_v2 WHERE conversation_id = $1)) AS receipts,
             (SELECT count(*) FROM zunari_realtime_event_outbox WHERE conversation_id = $1) AS events`,
          [removalWinsId],
        );
        assert.deepEqual(rejectedCounts.rows[0], { messages: '0', receipts: '0', events: '0' });

        const sendWinsId = `${type}-send-wins`;
        await seedConversation(sendWinsId, type);
        let notifySendWorkComplete!: () => void;
        let releaseSendCommit!: () => void;
        const sendWorkComplete = new Promise<void>((resolve) => { notifySendWorkComplete = resolve; });
        const sendCommitGate = new Promise<void>((resolve) => { releaseSendCommit = resolve; });
        const holdCommit = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
          const client = await scopedPool!.connect();
          try {
            await client.query('BEGIN');
            const result = await work(client);
            notifySendWorkComplete();
            await sendCommitGate;
            await client.query('COMMIT');
            return result;
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        };
        const sendPromise = repositoryFor(sendWinsId, holdCommit).sendMessage(
          'sender',
          sendWinsId,
          { text: 'commits before removal', clientId: 'task-4a-client' },
        );
        await sendWorkComplete;

        let removalCommitted = false;
        const removalPromise = withTransaction(async (client) => {
          await lockConversationForMembershipChange(client, sendWinsId);
          await client.query(
            `UPDATE zunari_conversation_participants SET left_at = $1
             WHERE conversation_id = $2 AND user_id = 'sender'`,
            [Date.now(), sendWinsId],
          );
        }).then(() => { removalCommitted = true; });
        const removalBlockedBySend = await Promise.race([
          removalPromise.then(() => false),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 100)),
        ]);
        releaseSendCommit();
        const [sent] = await Promise.all([sendPromise, removalPromise]);
        assert.equal(removalBlockedBySend, true);
        assert.equal(sent.isDuplicate, false);

        const committedCounts: QueryResult<{
          messages: string;
          receipts: string;
          events: string;
        }> = await scopedPool.query<{
          messages: string;
          receipts: string;
          events: string;
        }>(
          `SELECT
             (SELECT count(*) FROM zunari_messages_v2 WHERE conversation_id = $1) AS messages,
             (SELECT count(*) FROM zunari_message_receipts WHERE message_id IN
               (SELECT id FROM zunari_messages_v2 WHERE conversation_id = $1)) AS receipts,
             (SELECT count(*) FROM zunari_realtime_event_outbox WHERE conversation_id = $1) AS events`,
          [sendWinsId],
        );
        assert.deepEqual(committedCounts.rows[0], { messages: '1', receipts: '1', events: '1' });
        assert.equal(removalCommitted, true);
      }

      const editWinsId = 'edit-removal-wins';
      await seedConversation(editWinsId, 'direct');
      await scopedPool.query(
        `INSERT INTO zunari_messages_v2 (id, conversation_id, sender_id, text, created_at)
         VALUES ('edit-message', $1, 'sender', 'before', $2)`,
        [editWinsId, Date.now()],
      );
      let notifyEditWorkComplete!: () => void;
      let releaseEditCommit!: () => void;
      const editWorkComplete = new Promise<void>((resolve) => { notifyEditWorkComplete = resolve; });
      const editCommitGate = new Promise<void>((resolve) => { releaseEditCommit = resolve; });
      const holdEditCommit = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
        const client = await scopedPool!.connect();
        try {
          await client.query('BEGIN');
          const result = await work(client);
          notifyEditWorkComplete();
          await editCommitGate;
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      };
      const editPromise = repositoryFor(editWinsId, holdEditCommit).editMessage(
        editWinsId,
        'edit-message',
        'sender',
        'after',
      );
      await editWorkComplete;

      const editRemovalPromise = withTransaction(async (client) => {
        await lockConversationForMembershipChange(client, editWinsId);
        await client.query(
          `UPDATE zunari_conversation_participants SET left_at = $1
           WHERE conversation_id = $2 AND user_id = 'sender'`,
          [Date.now(), editWinsId],
        );
      });
      const removalBlockedByEdit = await Promise.race([
        editRemovalPromise.then(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 100)),
      ]);
      releaseEditCommit();
      await Promise.all([editPromise, editRemovalPromise]);
      assert.equal(removalBlockedByEdit, true);

      const editOutcome = await scopedPool.query<{
        text: string;
        event_type: string;
        recipient_ids: string[];
      }>(
        `SELECT m.text, outbox.event_type, outbox.payload->'recipientIds' AS recipient_ids
         FROM zunari_messages_v2 m
         JOIN zunari_realtime_event_outbox outbox ON outbox.entity_id = m.id
         WHERE m.id = 'edit-message'`,
      );
      assert.equal(editOutcome.rows[0]?.text, 'after');
      assert.equal(editOutcome.rows[0]?.event_type, 'conversation.message.edit');
      assert.deepEqual(editOutcome.rows[0]?.recipient_ids, ['sender', 'recipient']);

      const editRemovalWinsId = 'edit-removal-wins-first';
      await seedConversation(editRemovalWinsId, 'direct');
      await scopedPool.query(
        `INSERT INTO zunari_messages_v2 (id, conversation_id, sender_id, text, created_at)
         VALUES ('removed-edit-message', $1, 'sender', 'before', $2)`,
        [editRemovalWinsId, Date.now()],
      );
      await withTransaction(async (client) => {
        await lockConversationForMembershipChange(client, editRemovalWinsId);
        await client.query(
          `UPDATE zunari_conversation_participants SET left_at = $1
           WHERE conversation_id = $2 AND user_id = 'sender'`,
          [Date.now(), editRemovalWinsId],
        );
      });
      await assert.rejects(
        repositoryFor(editRemovalWinsId).editMessage(
          editRemovalWinsId,
          'removed-edit-message',
          'sender',
          'must not be applied',
        ),
        (error: unknown) =>
          error instanceof Error && 'status' in error && error.status === 403,
      );
      const rejectedEdit = await scopedPool.query<{ text: string; events: string }>(
        `SELECT
           (SELECT text FROM zunari_messages_v2 WHERE id = 'removed-edit-message') AS text,
           (SELECT count(*) FROM zunari_realtime_event_outbox WHERE conversation_id = $1) AS events`,
        [editRemovalWinsId],
      );
      assert.deepEqual(rejectedEdit.rows[0], { text: 'before', events: '0' });
    } finally {
      await scopedPool?.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await adminPool.end();
    }
  });

  test('membership changes serialize with authorized publication and active leases renew under slow work', async () => {
    assert.ok(testDatabaseUrl);
    const { Pool } = await import('pg');
    const adminPool = new Pool({ connectionString: testDatabaseUrl, max: 2 });
    const schema = `zunari_outbox_it_${randomUUID().replaceAll('-', '')}`;
    let scopedPool: InstanceType<typeof Pool> | undefined;

    try {
      await adminPool.query(`CREATE SCHEMA ${schema}`);
      scopedPool = new Pool({
        connectionString: testDatabaseUrl,
        options: `-c search_path=${schema}`,
        max: 8,
      });
      await scopedPool.query(`
        CREATE TABLE zunari_conversations_v2 (
          id text PRIMARY KEY,
          type text NOT NULL,
          last_message_at bigint NOT NULL DEFAULT 0,
          updated_at bigint NOT NULL DEFAULT 0
        );
        CREATE TABLE zunari_conversation_participants (
          conversation_id text NOT NULL,
          user_id text NOT NULL,
          role text NOT NULL DEFAULT 'member',
          joined_at bigint NOT NULL DEFAULT 0,
          left_at bigint,
          PRIMARY KEY (conversation_id, user_id)
        );
        CREATE TABLE zunari_messages_v2 (
          id text PRIMARY KEY,
          conversation_id text NOT NULL,
          sender_id text,
          client_id text,
          text text NOT NULL DEFAULT '',
          reply_to_message_id text,
          is_edited boolean NOT NULL DEFAULT false,
          is_deleted boolean NOT NULL DEFAULT false,
          created_at bigint NOT NULL
        );
        CREATE UNIQUE INDEX zunari_messages_v2_client_id_unique
          ON zunari_messages_v2(conversation_id, sender_id, client_id)
          WHERE client_id IS NOT NULL;
        CREATE TABLE zunari_message_receipts (
          message_id text NOT NULL,
          user_id text NOT NULL,
          delivered_at bigint,
          read_at bigint,
          PRIMARY KEY (message_id, user_id)
        );
        CREATE TABLE zunari_realtime_event_outbox (
          id uuid PRIMARY KEY,
          event_type text NOT NULL,
          conversation_id text,
          payload jsonb NOT NULL,
          created_at bigint NOT NULL,
          published_at bigint,
          attempt_count integer NOT NULL DEFAULT 0,
          next_attempt_at bigint NOT NULL,
          claimed_at bigint,
          lease_expires_at bigint,
          lease_token uuid,
          last_error text,
          dead_lettered_at bigint
        );
      `);
      const membershipMigration = await readFile(
        new URL('./db/migrations/008_conversation_membership_epochs.sql', import.meta.url),
        'utf8',
      );
      await scopedPool.query(membershipMigration);

      const withTransaction = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
        const client = await scopedPool!.connect();
        try {
          await client.query('BEGIN');
          const result = await work(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      };

      const membershipSnapshotFor = async (conversationId: string, userIds: string[]) => {
        const result = await scopedPool!.query<{ user_id: string; membership_epoch: string }>(
          `SELECT user_id, membership_epoch
           FROM zunari_conversation_participants
           WHERE conversation_id = $1 AND user_id = ANY($2::text[])`,
          [conversationId, userIds],
        );
        return result.rows.map((row) => ({ userId: row.user_id, epoch: row.membership_epoch }));
      };

      for (const conversationType of ['direct', 'group']) {
        const conversationId = `${conversationType}-conversation`;
        await scopedPool.query(
          'INSERT INTO zunari_conversations_v2 (id, type) VALUES ($1, $2)',
          [conversationId, conversationType],
        );
        await scopedPool.query(
          `INSERT INTO zunari_conversation_participants (conversation_id, user_id)
           VALUES ($1, 'sender'), ($1, 'removed'), ($1, 'remaining'), ($1, 'new-member')`,
          [conversationId],
        );
        const recipientSnapshot = await membershipSnapshotFor(
          conversationId,
          ['sender', 'removed', 'remaining'],
        );

        let removalLocked!: () => void;
        let allowRemovalCommit!: () => void;
        const removalHasLock = new Promise<void>((resolve) => { removalLocked = resolve; });
        const allowCommit = new Promise<void>((resolve) => { allowRemovalCommit = resolve; });
        const removal = withTransaction(async (client) => {
          await lockConversationForMembershipChange(client, conversationId);
          await client.query(
            `UPDATE zunari_conversation_participants SET left_at = 1
             WHERE conversation_id = $1 AND user_id = 'removed'`,
            [conversationId],
          );
          removalLocked();
          await allowCommit;
        });
        await removalHasLock;

        let dispatchFinished = false;
        const deliveries: string[][] = [];
        const dispatch = withTransaction(async (client) => {
          await lockConversationForPublication(client, conversationId);
          const authorized = await getActiveConversationRecipients(
            client,
            conversationId,
            ['sender', 'removed', 'remaining'],
            recipientSnapshot,
          );
          deliveries.push(authorized);
          dispatchFinished = true;
        });
        await sleep(100);
        assert.equal(dispatchFinished, false, 'Publication authorization must wait for uncommitted removal.');
        allowRemovalCommit();
        await Promise.all([removal, dispatch]);
        assert.deepEqual(deliveries, [['sender', 'remaining']]);

        await scopedPool.query(
          `UPDATE zunari_conversation_participants
           SET left_at = NULL, joined_at = 20
           WHERE conversation_id = $1 AND user_id = 'removed'`,
          [conversationId],
        );
        const afterRejoin = await withTransaction(async (client) => {
          await lockConversationForPublication(client, conversationId);
          return getActiveConversationRecipients(
            client,
            conversationId,
            ['sender', 'removed', 'remaining', 'new-member'],
            recipientSnapshot,
          );
        });
        assert.deepEqual(afterRejoin.sort(), ['remaining', 'sender']);
      }

      const conversationId = 'group-publication-first';
      await scopedPool.query(
        'INSERT INTO zunari_conversations_v2 (id, type) VALUES ($1, $2)',
        [conversationId, 'group'],
      );
      await scopedPool.query(
        `INSERT INTO zunari_conversation_participants (conversation_id, user_id)
         VALUES ($1, 'sender'), ($1, 'recipient')`,
        [conversationId],
      );
      const publicationSnapshot = await membershipSnapshotFor(
        conversationId,
        ['sender', 'recipient'],
      );
      const published: string[][] = [];
      let publicationLocked!: () => void;
      let allowPublicationCommit!: () => void;
      const publicationHasLock = new Promise<void>((resolve) => { publicationLocked = resolve; });
      const allowPublication = new Promise<void>((resolve) => { allowPublicationCommit = resolve; });
      const publication = withTransaction(async (client) => {
        await lockConversationForPublication(client, conversationId);
        const recipients = await getActiveConversationRecipients(
          client,
          conversationId,
          ['sender', 'recipient'],
          publicationSnapshot,
        );
        published.push(recipients);
        publicationLocked();
        await allowPublication;
      });
      await publicationHasLock;
      let removalCommitted = false;
      const removal = withTransaction(async (client) => {
        await lockConversationForMembershipChange(client, conversationId);
        await client.query(
          `UPDATE zunari_conversation_participants SET left_at = 2
           WHERE conversation_id = $1 AND user_id = 'recipient'`,
          [conversationId],
        );
      }).then(() => { removalCommitted = true; });
      await sleep(100);
      assert.equal(removalCommitted, false, 'Removal must wait while authorized publication holds its lock.');
      allowPublicationCommit();
      await Promise.all([publication, removal]);
      assert.deepEqual(published, [['sender', 'recipient']]);
      assert.equal(removalCommitted, true);

      const leaseConversationId = 'lease-conversation';
      await scopedPool.query(
        'INSERT INTO zunari_conversations_v2 (id, type) VALUES ($1, $2)',
        [leaseConversationId, 'direct'],
      );
      await scopedPool.query(
        `INSERT INTO zunari_conversation_participants (conversation_id, user_id)
         VALUES ($1, 'sender'), ($1, 'recipient')`,
        [leaseConversationId],
      );
      const leaseMembershipSnapshot = await membershipSnapshotFor(
        leaseConversationId,
        ['sender', 'recipient'],
      );
      const eventId = randomUUID();
      await scopedPool.query(
        `INSERT INTO zunari_realtime_event_outbox
           (id, event_type, conversation_id, payload, created_at, next_attempt_at)
         VALUES ($1, 'conversation.message', $2, $3, $4, $4)`,
        [
          eventId,
          leaseConversationId,
          {
            messageId: 'message-1',
            senderId: 'sender',
            recipientIds: ['sender', 'recipient'],
            recipientMemberships: leaseMembershipSnapshot,
          },
          Date.now(),
        ],
      );

      const query = async <Row extends QueryResultRow = QueryResultRow>(
        sql: string,
        values?: unknown[],
      ) => scopedPool!.query<Row>(sql, values);
      let resolveStarted!: () => void;
      let releaseResolve!: () => void;
      const resolverStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
      const resolverGate = new Promise<void>((resolve) => { releaseResolve = resolve; });
      const deliveries: string[] = [];
      const options = {
        query,
        withTransaction,
        publishConversationMessage: async (event: { eventId?: string; recipientIds: string[] }) => {
          deliveries.push(event.eventId || '');
          assert.deepEqual(event.recipientIds, ['sender', 'recipient']);
          return true;
        },
        resolveMessage: async () => {
          resolveStarted();
          await resolverGate;
          return {
            id: 'message-1',
            conversationId: leaseConversationId,
            senderId: 'sender',
            clientId: null,
            text: 'message',
            replyToMessageId: null,
            replyToMessage: null,
            isEdited: false,
            editedAt: null,
            isDeleted: false,
            deletedAt: null,
            createdAt: Date.now(),
            attachments: [],
            reactions: [],
            receipts: [],
          };
        },
        batchSize: 1,
        maxConcurrency: 1,
        leaseMs: 300,
        pollIntervalMs: 1_000,
        maxAttempts: 3,
        now: Date.now,
        random: () => 0.5,
        log: () => undefined,
      };
      const dispatcher = new RealtimeOutboxDispatcher(options);
      const competingDispatcher = new RealtimeOutboxDispatcher({
        ...options,
        resolveMessage: async () => null,
      });
      const dispatchPromise = dispatcher.dispatchOnce();
      await resolverStarted;
      await sleep(700);
      assert.deepEqual(await competingDispatcher.claimPendingEvents(), []);
      releaseResolve();
      await dispatchPromise;
      assert.deepEqual(deliveries, [eventId]);
      const outbox = await scopedPool.query(
        'SELECT published_at, attempt_count FROM zunari_realtime_event_outbox WHERE id = $1',
        [eventId],
      );
      assert.ok(outbox.rows[0]?.published_at);
      assert.equal(outbox.rows[0]?.attempt_count, 1);

      await scopedPool.query(`
        CREATE TABLE zunari_messages (id text PRIMARY KEY, text text NOT NULL);
      `);
      await scopedPool.query(
        'INSERT INTO zunari_messages (id, text) VALUES ($1, $2)',
        ['legacy-history-1', 'historical text'],
      );
      const retirementNow = Date.now();
      const legacyEventIds = {
        pending: randomUUID(),
        retryable: randomUUID(),
        expiredLease: randomUUID(),
        activeLease: randomUUID(),
        deadLettered: randomUUID(),
        alreadyPublished: randomUUID(),
      };
      const activeLeaseToken = randomUUID();
      await scopedPool.query(
        `INSERT INTO zunari_realtime_event_outbox
           (id, event_type, conversation_id, payload, created_at, next_attempt_at,
            attempt_count, claimed_at, lease_expires_at, lease_token, last_error,
            dead_lettered_at, published_at)
         VALUES
           ($1, 'message.new', NULL, '{"id":"legacy-history-1"}', $7, $7, 0, NULL, NULL, NULL, NULL, NULL, NULL),
           ($2, 'message.new', NULL, '{"id":"legacy-history-1"}', $7, $7, 2, NULL, NULL, NULL, 'retrying', NULL, NULL),
           ($3, 'message.new', NULL, '{"id":"legacy-history-1"}', $7, $7, 1, $8, $9, $10, NULL, NULL, NULL),
           ($4, 'message.new', NULL, '{"id":"legacy-history-1"}', $7, $7, 1, $8, $11, $12, NULL, NULL, NULL),
           ($5, 'message.new', NULL, '{"id":"legacy-history-1"}', $7, $7, 3, NULL, NULL, NULL, 'prior failure', $7, NULL),
           ($6, 'message.new', NULL, '{"id":"legacy-history-1"}', $7, $7, 1, NULL, NULL, NULL, NULL, NULL, $7)`,
        [
          legacyEventIds.pending,
          legacyEventIds.retryable,
          legacyEventIds.expiredLease,
          legacyEventIds.activeLease,
          legacyEventIds.deadLettered,
          legacyEventIds.alreadyPublished,
          retirementNow,
          retirementNow - 1_000,
          retirementNow - 1,
          randomUUID(),
          retirementNow + 60_000,
          activeLeaseToken,
        ],
      );

      const retirementDispatcher = new RealtimeOutboxDispatcher({
        ...options,
        resolveMessage: async () => null,
        batchSize: 10,
        maxConcurrency: 4,
      });
      const deliveriesBeforeRetirement = [...deliveries];
      assert.equal(await retirementDispatcher.dispatchOnce(), 3);
      assert.deepEqual(deliveries, deliveriesBeforeRetirement);
      const legacyStatuses = await scopedPool.query<{
        id: string;
        payload: Record<string, unknown>;
        published_at: string | null;
        dead_lettered_at: string | null;
        last_error: string | null;
        claimed_at: string | null;
        lease_expires_at: string | null;
        lease_token: string | null;
      }>(
        `SELECT id, payload, published_at, dead_lettered_at, last_error, claimed_at,
                lease_expires_at, lease_token
         FROM zunari_realtime_event_outbox
         WHERE id = ANY($1::uuid[])`,
        [Object.values(legacyEventIds)],
      );
      const statusById = new Map(legacyStatuses.rows.map((row) => [row.id, row]));
      for (const id of [
        legacyEventIds.pending,
        legacyEventIds.retryable,
        legacyEventIds.expiredLease,
      ]) {
        const status = statusById.get(id);
        assert.equal(status?.published_at, null);
        assert.ok(status?.dead_lettered_at);
        assert.match(status?.last_error || '', /^retired:/);
        assert.equal(status?.claimed_at, null);
        assert.equal(status?.lease_expires_at, null);
        assert.equal(status?.lease_token, null);
        assert.deepEqual(status?.payload, { id: 'legacy-history-1' });
      }
      const activeLeaseStatus = statusById.get(legacyEventIds.activeLease);
      assert.equal(activeLeaseStatus?.published_at, null);
      assert.equal(activeLeaseStatus?.dead_lettered_at, null);
      assert.equal(activeLeaseStatus?.claimed_at, String(retirementNow - 1_000));
      assert.equal(activeLeaseStatus?.lease_expires_at, String(retirementNow + 60_000));
      assert.equal(activeLeaseStatus?.lease_token, activeLeaseToken);
      assert.equal(statusById.get(legacyEventIds.deadLettered)?.last_error, 'prior failure');
      assert.equal(
        statusById.get(legacyEventIds.deadLettered)?.dead_lettered_at,
        String(retirementNow),
      );
      assert.equal(
        statusById.get(legacyEventIds.alreadyPublished)?.published_at,
        String(retirementNow),
      );
      const history = await scopedPool.query(
        'SELECT id, text FROM zunari_messages WHERE id = $1',
        ['legacy-history-1'],
      );
      assert.deepEqual(history.rows, [{ id: 'legacy-history-1', text: 'historical text' }]);
    } finally {
      await scopedPool?.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await adminPool.end();
    }
  });
});
