import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { RealtimeOutboxDispatcher } from './realtime-outbox.ts';

interface StoredEvent {
  id: string;
  event_type: string;
  conversation_id: string | null;
  payload: Record<string, unknown>;
  created_at: number;
  published_at: number | null;
  attempt_count: number;
  next_attempt_at: number;
  claimed_at: number | null;
  lease_expires_at: number | null;
  lease_token: string | null;
  last_error: string | null;
  dead_lettered_at: number | null;
}

function result<Row extends QueryResultRow>(rows: QueryResultRow[]): QueryResult<Row> {
  return {
    command: 'UPDATE',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as Row[],
  };
}

function createOutboxFixture(initial: StoredEvent[] = []) {
  const events = initial;
  let now = 100_000;
  const publishedConversationMessages: Array<{
    eventId?: string;
    recipientIds: string[];
  }> = [];
  const publishedConversationEdits: Array<{
    eventId?: string;
    recipientIds: string[];
  }> = [];
  const publishedConversationEvents: unknown[] = [];
  let activeRecipients: Set<string> | undefined;
  const membershipEpochs = new Map<string, string>();
  const defaultMembershipEpoch = '00000000-0000-4000-8000-000000000001';
  let activeRecipientsAfterMessageLoad: Set<string> | undefined;
  let publishFailure = false;
  let failPublishedUpdate = false;
  let stealLeaseOnRenewal = false;
  let resolveMessageWait: Promise<void> | undefined;
  let resolveMessageStarted: (() => void) | undefined;
  let releaseMessageResolution: (() => void) | undefined;
  let transactionTail = Promise.resolve();
  const statements: string[] = [];
  const logs: Array<Record<string, unknown>> = [];

  const execute = async (sql: string, values: unknown[] = []): Promise<QueryResultRow[]> => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    statements.push(normalized);

    if (normalized.startsWith('WITH candidates AS')) {
      assert.match(normalized, /FOR UPDATE SKIP LOCKED/);
      const requestedNow = Number(values[0]);
      const limit = Number(values[1]);
      const lease = Number(values[2]);
      const token = String(values[3]);
      const eligible = events
        .filter((event) =>
          event.published_at === null &&
          event.dead_lettered_at === null &&
          event.next_attempt_at <= requestedNow &&
          (event.lease_expires_at === null || event.lease_expires_at <= requestedNow),
        )
        .sort((a, b) => a.next_attempt_at - b.next_attempt_at || a.created_at - b.created_at)
        .slice(0, limit);
      for (const event of eligible) {
        event.claimed_at = requestedNow;
        event.lease_expires_at = requestedNow + lease;
        event.lease_token = token;
        event.attempt_count += 1;
      }
      return eligible.map((event) => ({
        id: event.id,
        event_type: event.event_type,
        conversation_id: event.conversation_id,
        created_at: event.created_at,
        payload: event.payload,
        attempt_count: event.attempt_count,
        lease_token: event.lease_token,
      }));
    }

    if (normalized.startsWith('SELECT id FROM zunari_conversations_v2')) {
      return [{ id: values[0] }];
    }

    if (normalized.startsWith('SELECT user_id, membership_epoch FROM zunari_conversation_participants')) {
      const [conversationId, candidateIds] = values as [string, string[]];
      assert.equal(conversationId, 'conversation-1');
      const activeIds = activeRecipients
        ? candidateIds.filter((candidateId) => activeRecipients?.has(candidateId))
        : candidateIds;
      return activeIds.map((user_id) => ({
        user_id,
        membership_epoch: membershipEpochs.get(user_id) ?? defaultMembershipEpoch,
      }));
    }

    if (normalized.startsWith('UPDATE zunari_realtime_event_outbox') && normalized.includes('SET lease_expires_at')) {
      const [now, leaseMs, eventId, leaseToken] = values;
      const event = events.find((entry) => entry.id === eventId && entry.lease_token === leaseToken);
      if (event && stealLeaseOnRenewal) {
        event.lease_token = 'another-worker-token';
        event.lease_expires_at = Number(now) + Number(leaseMs);
        return [];
      }
      if (!event || event.published_at !== null || event.lease_expires_at === null ||
          event.lease_expires_at <= Number(now)) return [];
      event.lease_expires_at = Number(now) + Number(leaseMs);
      return [{ id: event.id }];
    }

    if (normalized.startsWith('UPDATE zunari_realtime_event_outbox') &&
        normalized.includes('SET dead_lettered_at')) {
      const [retiredAt, reason, eventId, leaseToken] = values;
      const event = events.find((entry) =>
        entry.id === eventId &&
        entry.lease_token === leaseToken &&
        entry.published_at === null &&
        entry.dead_lettered_at === null &&
        entry.lease_expires_at !== null &&
        entry.lease_expires_at > Number(retiredAt),
      );
      if (!event) return [];
      event.dead_lettered_at = Number(retiredAt);
      event.last_error = String(reason);
      event.claimed_at = null;
      event.lease_expires_at = null;
      event.lease_token = null;
      return [{ id: event.id }];
    }

    if (normalized.startsWith('UPDATE zunari_realtime_event_outbox') && normalized.includes('SET published_at')) {
      if (failPublishedUpdate) throw new Error('simulated mark-published crash');
      const [publishedAt, eventId, leaseToken] = values;
      const event = events.find((entry) => entry.id === eventId && entry.lease_token === leaseToken);
      if (!event || event.published_at !== null) return [];
      event.published_at = Number(publishedAt);
      event.claimed_at = null;
      event.lease_expires_at = null;
      event.lease_token = null;
      event.last_error = null;
      return [{ id: event.id }];
    }

    if (normalized.startsWith('UPDATE zunari_realtime_event_outbox') && normalized.includes('SET last_error')) {
      const [lastError, nextAttemptAt, deadLetteredAt, eventId, leaseToken] = values;
      const event = events.find((entry) => entry.id === eventId && entry.lease_token === leaseToken);
      if (!event || event.published_at !== null) return [];
      event.last_error = String(lastError);
      event.next_attempt_at = Number(nextAttemptAt);
      event.dead_lettered_at = deadLetteredAt === null ? null : Number(deadLetteredAt);
      event.claimed_at = null;
      event.lease_expires_at = null;
      event.lease_token = null;
      return [{ id: event.id }];
    }

    throw new Error(`Unexpected outbox SQL: ${normalized}`);
  };

  const fakeQuery = async <Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> => result(await execute(sql, values)) as QueryResult<Row>;

  const withTransaction = async <T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> => {
    let release!: () => void;
    const previous = transactionTail;
    transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work({ query: fakeQuery } as unknown as PoolClient);
    } finally {
      release();
    }
  };

  function createDispatcher(options: { maxConcurrency?: number; leaseMs?: number } = {}) {
    return new RealtimeOutboxDispatcher({
      query: fakeQuery as typeof import('./db/pool.ts').query,
      withTransaction: withTransaction as typeof import('./db/pool.ts').withTransaction,
      publishConversationMessage: async (event) => {
        publishedConversationMessages.push({
          eventId: event.eventId,
          recipientIds: event.recipientIds,
        });
        publishedConversationEvents.push(event);
        return !publishFailure;
      },
      publishConversationMessageEdit: async (event) => {
        publishedConversationEdits.push({
          eventId: event.eventId,
          recipientIds: event.recipientIds,
        });
        publishedConversationEvents.push(event);
        return !publishFailure;
      },
      resolveMessage: async (messageId, userId) => {
        resolveMessageStarted?.();
        if (resolveMessageWait) await resolveMessageWait;
        if (activeRecipientsAfterMessageLoad) {
          activeRecipients = activeRecipientsAfterMessageLoad;
        }
        return {
          id: messageId,
          conversationId: 'conversation-1',
          senderId: userId,
          clientId: null,
          text: 'message',
          replyToMessageId: null,
          replyToMessage: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          deletedAt: null,
          createdAt: now,
          attachments: [],
          reactions: [],
          receipts: [],
        };
      },
      batchSize: 10,
      maxConcurrency: options.maxConcurrency ?? 4,
      leaseMs: options.leaseMs ?? 1_000,
      pollIntervalMs: 100,
      maxAttempts: 3,
      now: () => now,
      random: () => 0.5,
      log: (entry) => logs.push(entry),
    });
  }

  return {
    events,
    statements,
    logs,
    createDispatcher,
    setNow(value: number) {
      now = value;
    },
    setPublishFailure(value: boolean) {
      publishFailure = value;
    },
    setActiveRecipients(ids: string[]) {
      activeRecipients = new Set(ids);
    },
    setMembershipEpoch(userId: string, epoch: string) {
      membershipEpochs.set(userId, epoch);
    },
    setActiveRecipientsAfterMessageLoad(ids: string[]) {
      activeRecipientsAfterMessageLoad = new Set(ids);
    },
    setFailPublishedUpdate(value: boolean) {
      failPublishedUpdate = value;
    },
    waitForMessageResolution() {
      return new Promise<void>((resolve) => {
        resolveMessageStarted = resolve;
      });
    },
    blockMessageResolution() {
      resolveMessageWait = new Promise<void>((resolve) => {
        releaseMessageResolution = resolve;
      });
    },
    releaseMessageResolution() {
      releaseMessageResolution?.();
      resolveMessageWait = undefined;
    },
    setLeaseToken(value: string) {
      events[0].lease_token = value;
    },
    setStealLeaseOnRenewal(value: boolean) {
      stealLeaseOnRenewal = value;
    },
    publishedConversationMessages,
    publishedConversationEdits,
    publishedConversationEvents,
  };
}

function createEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  const event: StoredEvent = {
    id: '00000000-0000-4000-8000-000000000001',
    event_type: 'message.new',
    conversation_id: 'conversation-1',
    payload: { id: 'message-1', text: 'private message', recipientId: 'user-b' },
    created_at: 1,
    published_at: null,
    attempt_count: 0,
    next_attempt_at: 1,
    claimed_at: null,
    lease_expires_at: null,
    lease_token: null,
    last_error: null,
    dead_lettered_at: null,
    ...overrides,
  };
  if (
    event.event_type === 'conversation.message' &&
    !Array.isArray(event.payload.recipientMemberships) &&
    Array.isArray(event.payload.recipientIds)
  ) {
    event.payload = {
      ...event.payload,
      recipientMemberships: event.payload.recipientIds
        .filter((userId): userId is string => typeof userId === 'string')
        .map((userId) => ({
          userId,
          epoch: '00000000-0000-4000-8000-000000000001',
        })),
    };
  }
  return event;
}

describe('Realtime event outbox dispatcher', () => {
  test('retires pending legacy message events without publishing or deleting history', async () => {
    const event = createEvent();
    const fixture = createOutboxFixture([event]);
    const dispatcher = fixture.createDispatcher();

    assert.equal(await dispatcher.dispatchOnce(), 1);
    assert.equal(fixture.events[0].published_at, null);
    assert.equal(fixture.events[0].attempt_count, 1);
    assert.ok(fixture.events[0].dead_lettered_at);
    assert.equal(
      fixture.events[0].last_error,
      'retired: legacy message.new events are no longer published',
    );
    assert.equal(fixture.events[0].claimed_at, null);
    assert.equal(fixture.events[0].lease_expires_at, null);
    assert.equal(fixture.events[0].lease_token, null);
    assert.deepEqual(fixture.events[0].payload, event.payload);
    assert.equal(fixture.logs.at(-1)?.action, 'retired');
    assert.equal(fixture.statements.some((sql) => /DELETE FROM zunari_(messages|realtime_event_outbox)/i.test(sql)), false);
    assert.equal(await dispatcher.dispatchOnce(), 0, 'Retirement must be idempotent.');
  });

  test('retires retryable legacy events and expired leases when reclaimed', async () => {
    const retryable = createEvent({
      id: 'retryable-legacy-event',
      attempt_count: 2,
      next_attempt_at: 99_000,
      last_error: 'PreviousError',
    });
    const expiredLease = createEvent({
      id: 'expired-legacy-lease',
      claimed_at: 90_000,
      lease_expires_at: 99_000,
      lease_token: 'expired-token',
    });
    const fixture = createOutboxFixture([retryable, expiredLease]);
    const dispatcher = fixture.createDispatcher({ maxConcurrency: 1 });

    assert.equal(await dispatcher.dispatchOnce(), 1);
    assert.equal(await dispatcher.dispatchOnce(), 1);
    for (const event of fixture.events) {
      assert.equal(event.published_at, null);
      assert.ok(event.dead_lettered_at);
      assert.match(event.last_error || '', /^retired:/);
      assert.equal(event.claimed_at, null);
      assert.equal(event.lease_expires_at, null);
      assert.equal(event.lease_token, null);
    }
    assert.deepEqual(fixture.publishedConversationMessages, []);
  });

  test('does not retire an event after lease ownership changes', async () => {
    const event = createEvent();
    const fixture = createOutboxFixture([event]);
    fixture.setStealLeaseOnRenewal(true);
    const dispatcher = fixture.createDispatcher();

    assert.equal(await dispatcher.dispatchOnce(), 1);
    assert.equal(event.dead_lettered_at, null);
    assert.equal(event.published_at, null);
    assert.equal(event.lease_token, 'another-worker-token');
    assert.equal(fixture.logs.at(-1)?.action, 'lease-lost-before-publish');
  });

  test('does not retire an actively leased legacy event before its lease expires', async () => {
    const event = createEvent();
    const fixture = createOutboxFixture([event]);
    const dispatcher = fixture.createDispatcher();

    const [claim] = await dispatcher.claimPendingEvents();
    const activeToken = claim.lease_token;
    assert.equal(await dispatcher.dispatchOnce(), 0);
    assert.equal(event.dead_lettered_at, null);
    assert.equal(event.published_at, null);
    assert.equal(event.lease_token, activeToken);
  });

  test('does not change already-published or dead-lettered legacy events', async () => {
    const published = createEvent({
      id: 'published-legacy-event',
      published_at: 99_000,
    });
    const deadLettered = createEvent({
      id: 'dead-lettered-legacy-event',
      attempt_count: 3,
      dead_lettered_at: 98_000,
      last_error: 'Previous terminal failure',
    });
    const fixture = createOutboxFixture([published, deadLettered]);
    const dispatcher = fixture.createDispatcher();

    assert.equal(await dispatcher.dispatchOnce(), 0);
    assert.equal(published.published_at, 99_000);
    assert.equal(published.dead_lettered_at, null);
    assert.equal(deadLettered.dead_lettered_at, 98_000);
    assert.equal(deadLettered.last_error, 'Previous terminal failure');
    assert.deepEqual(fixture.publishedConversationMessages, []);
  });

  test('failed publication remains retryable with an incremented attempt and jittered backoff', async () => {
    const event = createEvent({
      event_type: 'conversation.message',
      payload: { messageId: 'message-1', senderId: 'user-a', recipientIds: ['user-a', 'user-b'] },
    });
    const fixture = createOutboxFixture([event]);
    fixture.setPublishFailure(true);
    const dispatcher = fixture.createDispatcher();

    await dispatcher.dispatchOnce();

    assert.equal(fixture.events[0].published_at, null);
    assert.equal(fixture.events[0].attempt_count, 1);
    assert.equal(fixture.events[0].next_attempt_at, 101_000);
    assert.equal(fixture.events[0].last_error, 'Error');
    assert.equal(fixture.events[0].lease_token, null);
    assert.equal(fixture.logs.at(-1)?.action, 'retry');
    assert.deepEqual(fixture.publishedConversationMessages.map(({ eventId }) => eventId), [event.id]);

    fixture.setPublishFailure(false);
    fixture.setNow(fixture.events[0].next_attempt_at);
    await dispatcher.dispatchOnce();
    assert.deepEqual(fixture.publishedConversationMessages.map(({ eventId }) => eventId), [event.id, event.id]);
  });

  test('expired claim can be recovered after a simulated crash before publication', async () => {
    const event = createEvent({
      event_type: 'conversation.message',
      payload: { messageId: 'message-1', senderId: 'user-a', recipientIds: ['user-a', 'user-b'] },
    });
    const fixture = createOutboxFixture([event]);
    const dispatcher = fixture.createDispatcher();

    const firstClaim = await dispatcher.claimPendingEvents();
    assert.equal(firstClaim.length, 1);
    assert.deepEqual(fixture.publishedConversationMessages, []);

    assert.equal(await dispatcher.dispatchOnce(), 0);
    fixture.setNow(101_000);
    assert.equal(await dispatcher.dispatchOnce(), 1);
    assert.equal(fixture.events[0].published_at, 101_000);
    assert.equal(fixture.events[0].id, event.id);
    assert.deepEqual(fixture.publishedConversationMessages.map(({ eventId }) => eventId), [event.id]);
  });

  test('crash after publication but before acknowledgement causes an at-least-once duplicate with stable event ID', async () => {
    const original = createEvent({
      event_type: 'conversation.message',
      payload: { messageId: 'message-1', senderId: 'user-a', recipientIds: ['user-a', 'user-b'] },
    });
    const fixture = createOutboxFixture([original]);
    fixture.setFailPublishedUpdate(true);
    const dispatcher = fixture.createDispatcher();

    await dispatcher.dispatchOnce();
    assert.equal(fixture.publishedConversationMessages.length, 1);
    assert.equal(fixture.events[0].published_at, null);
    assert.equal(fixture.events[0].lease_token, null);
    assert.equal(fixture.events[0].next_attempt_at, 101_000);

    fixture.setFailPublishedUpdate(false);
    fixture.setNow(101_000);
    await dispatcher.dispatchOnce();

    assert.equal(fixture.publishedConversationMessages.length, 2);
    assert.equal(fixture.events[0].published_at, 101_000);
    assert.equal(fixture.events[0].id, original.id);
    assert.deepEqual(
      fixture.publishedConversationMessages.map(({ eventId }) => eventId),
      [original.id, original.id],
    );
  });

  test('actively leased events are not claimed again', async () => {
    const fixture = createOutboxFixture([createEvent()]);
    const dispatcher = fixture.createDispatcher();

    assert.equal((await dispatcher.claimPendingEvents()).length, 1);
    assert.equal((await dispatcher.claimPendingEvents()).length, 0);
  });

  test('competing dispatcher instances do not claim the same active lease', async () => {
    const fixture = createOutboxFixture([createEvent()]);
    const first = fixture.createDispatcher();
    const second = fixture.createDispatcher();

    const [firstClaim, secondClaim] = await Promise.all([
      first.claimPendingEvents(),
      second.claimPendingEvents(),
    ]);

    assert.equal(firstClaim.length + secondClaim.length, 1);
    assert.match(fixture.statements[0], /FOR UPDATE SKIP LOCKED/);
  });

  test('permanently failing events are dead-lettered after the configured attempt bound', async () => {
    const fixture = createOutboxFixture([createEvent({
      event_type: 'conversation.message',
      payload: {
        messageId: 'message-1',
        senderId: 'user-a',
        recipientIds: ['user-a', 'user-b'],
      },
    })]);
    fixture.setPublishFailure(true);
    const dispatcher = fixture.createDispatcher();

    await dispatcher.dispatchOnce();
    fixture.setNow(fixture.events[0].next_attempt_at);
    await dispatcher.dispatchOnce();
    fixture.setNow(103_000);
    await dispatcher.dispatchOnce();

    assert.equal(fixture.events[0].attempt_count, 3);
    assert.equal(fixture.events[0].dead_lettered_at, 103_000);
    assert.equal(fixture.events[0].lease_token, null);
    assert.equal(fixture.logs.at(-1)?.action, 'dead-letter');
  });

  test('conversation messages publish the existing event payload shape', async () => {
    const storedEvent = createEvent({
      event_type: 'conversation.message',
      payload: { messageId: 'message-1', senderId: 'user-a', recipientIds: ['user-a', 'user-b'] },
    });
    const fixture = createOutboxFixture([storedEvent]);
    await fixture.createDispatcher().dispatchOnce();
    assert.deepEqual(fixture.publishedConversationEvents[0], {
      conversationId: 'conversation-1',
      message: {
        id: 'message-1',
        conversationId: 'conversation-1',
        senderId: 'user-a',
        clientId: null,
        text: 'message',
        replyToMessageId: null,
        replyToMessage: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        deletedAt: null,
        createdAt: 100_000,
        attachments: [],
        reactions: [],
        receipts: [],
      },
      recipientIds: ['user-a', 'user-b'],
      eventId: storedEvent.id,
    });
  });

  test('removal before dispatch excludes former participants but keeps active sender and recipients', async () => {
    const event = createEvent({
      event_type: 'conversation.message',
      payload: {
        messageId: 'message-1',
        senderId: 'user-a',
        recipientIds: ['user-a', 'user-b', 'user-c'],
      },
    });
    const fixture = createOutboxFixture([event]);
    fixture.setActiveRecipients(['user-a', 'user-c', 'new-member']);

    await fixture.createDispatcher().dispatchOnce();

    assert.deepEqual(fixture.publishedConversationMessages, [{
      eventId: event.id,
      recipientIds: ['user-a', 'user-c'],
    }]);
  });

  test('events with no active original recipients are acknowledged without message publication', async () => {
    const event = createEvent({
      event_type: 'conversation.message',
      payload: {
        messageId: 'message-1',
        senderId: 'user-a',
        recipientIds: ['user-a', 'user-b'],
      },
    });
    const fixture = createOutboxFixture([event]);
    fixture.setActiveRecipients([]);

    await fixture.createDispatcher().dispatchOnce();

    assert.equal(fixture.events[0].published_at, 100_000);
    assert.deepEqual(fixture.publishedConversationMessages, []);
  });

  test('removed sender is excluded while still-active original recipients receive the event', async () => {
    const event = createEvent({
      event_type: 'conversation.message',
      payload: {
        messageId: 'message-1',
        senderId: 'user-a',
        recipientIds: ['user-a', 'user-b'],
      },
    });
    const fixture = createOutboxFixture([event]);
    fixture.setActiveRecipients(['user-b']);

    await fixture.createDispatcher().dispatchOnce();

    assert.deepEqual(fixture.publishedConversationMessages, [{
      eventId: event.id,
      recipientIds: ['user-b'],
    }]);
  });

  test('a removed then rejoined recipient cannot receive an event from the previous membership epoch', async () => {
    const event = createEvent({
      event_type: 'conversation.message',
      payload: {
        messageId: 'message-1',
        senderId: 'user-a',
        recipientIds: ['user-a', 'user-b'],
      },
    });
    const fixture = createOutboxFixture([event]);
    fixture.setActiveRecipients(['user-a', 'user-b']);
    fixture.setMembershipEpoch('user-b', '00000000-0000-4000-8000-000000000002');

    await fixture.createDispatcher().dispatchOnce();

    assert.deepEqual(fixture.publishedConversationMessages, [{
      eventId: event.id,
      recipientIds: ['user-a'],
    }]);
  });

  test('legacy pending conversation events without a membership epoch snapshot fail closed', async () => {
    const event = createEvent({
      event_type: 'conversation.message',
      payload: {
        messageId: 'message-1',
        senderId: 'user-a',
        recipientIds: ['user-a', 'user-b'],
      },
    });
    delete event.payload.recipientMemberships;
    const fixture = createOutboxFixture([event]);

    await fixture.createDispatcher().dispatchOnce();

    assert.equal(fixture.events[0].published_at, 100_000);
    assert.deepEqual(fixture.publishedConversationEvents, []);
    assert.ok(fixture.logs.some((entry) => entry.action === 'missing-membership-snapshot'));
  });

  test('slow in-flight processing renews leases and cannot be reclaimed by another dispatcher', async () => {
    const event = createEvent({
      event_type: 'conversation.message',
      payload: { messageId: 'message-1', senderId: 'user-a', recipientIds: ['user-a', 'user-b'] },
    });
    const fixture = createOutboxFixture([event]);
    fixture.blockMessageResolution();
    const dispatcher = fixture.createDispatcher({ leaseMs: 300, maxConcurrency: 1 });
    const started = fixture.waitForMessageResolution();
    const dispatchPromise = dispatcher.dispatchOnce();
    await started;

    fixture.setNow(100_200);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const competingClaim = await fixture.createDispatcher({ leaseMs: 300, maxConcurrency: 1 })
      .claimPendingEvents();
    assert.equal(competingClaim.length, 0);

    fixture.releaseMessageResolution();
    await dispatchPromise;
    assert.equal(fixture.events[0].published_at, 100_200);
  });

  test('stale lease token cannot renew or publish after another worker takes ownership', async () => {
    const event = createEvent({
      event_type: 'conversation.message',
      payload: { messageId: 'message-1', senderId: 'user-a', recipientIds: ['user-a', 'user-b'] },
    });
    const fixture = createOutboxFixture([event]);
    fixture.blockMessageResolution();
    const dispatcher = fixture.createDispatcher({ leaseMs: 300, maxConcurrency: 1 });
    const started = fixture.waitForMessageResolution();
    const dispatchPromise = dispatcher.dispatchOnce();
    await started;

    fixture.setLeaseToken('replacement-lease-token');
    fixture.setNow(100_200);
    await new Promise((resolve) => setTimeout(resolve, 150));
    fixture.releaseMessageResolution();
    await dispatchPromise;

    assert.equal(fixture.events[0].lease_token, 'replacement-lease-token');
    assert.equal(fixture.events[0].published_at, null);
    assert.deepEqual(fixture.publishedConversationEvents, []);
    assert.equal(fixture.logs.at(-1)?.action, 'lease-lost-before-publish');
  });

  test('membership is checked after message loading to exclude a just-removed participant', async () => {
    const event = createEvent({
      event_type: 'conversation.message',
      payload: {
        messageId: 'message-1',
        senderId: 'user-a',
        recipientIds: ['user-a', 'user-b'],
      },
    });
    const fixture = createOutboxFixture([event]);
    fixture.setActiveRecipients(['user-a', 'user-b']);
    fixture.setActiveRecipientsAfterMessageLoad(['user-a']);

    await fixture.createDispatcher().dispatchOnce();

    assert.deepEqual(fixture.publishedConversationMessages, [{
      eventId: event.id,
      recipientIds: ['user-a'],
    }]);
  });

  test('edited messages publish only to current members from the original membership epochs', async () => {
    const event = createEvent({
      event_type: 'conversation.message.edit',
      payload: {
        messageId: 'message-1',
        senderId: 'user-a',
        recipientIds: ['user-a', 'user-b', 'user-c'],
        recipientMemberships: [
          { userId: 'user-a', epoch: '00000000-0000-4000-8000-000000000001' },
          { userId: 'user-b', epoch: '00000000-0000-4000-8000-000000000001' },
          { userId: 'user-c', epoch: '00000000-0000-4000-8000-000000000001' },
        ],
      },
    });
    const fixture = createOutboxFixture([event]);
    fixture.setActiveRecipients(['user-a', 'user-b']);
    fixture.setMembershipEpoch('user-b', '00000000-0000-4000-8000-000000000002');

    await fixture.createDispatcher().dispatchOnce();

    assert.deepEqual(fixture.publishedConversationEdits, [{
      eventId: event.id,
      recipientIds: ['user-a'],
    }]);
    assert.equal(fixture.events[0].published_at, 100_000);
  });
});
