import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { messagingRepo } from './db/messaging.ts';
import { query, withTransaction } from './db/pool.ts';
import {
  publishConversationMessageAcrossInstances,
  publishConversationMessageEditAcrossInstances,
} from './realtime.ts';
import {
  getActiveConversationRecipients,
  lockConversationForPublication,
} from './db/conversation-membership-lock.ts';

const MAX_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 15 * 60 * 1000;
const LEGACY_MESSAGE_RETIREMENT_REASON =
  'retired: legacy message.new events are no longer published';
const DEFAULT_MAX_CONCURRENCY = 4;
const MAX_DISPATCH_CONCURRENCY = 8;

interface OutboxRecord extends QueryResultRow {
  id: string;
  event_type: string;
  conversation_id: string | null;
  created_at: number | string;
  payload: Record<string, unknown>;
  attempt_count: number;
  lease_token: string;
}

export interface RealtimeOutboxOptions {
  query: typeof query;
  withTransaction: typeof withTransaction;
  publishConversationMessage: typeof publishConversationMessageAcrossInstances;
  publishConversationMessageEdit: typeof publishConversationMessageEditAcrossInstances;
  resolveMessage: typeof messagingRepo.getMessageById;
  batchSize: number;
  maxConcurrency: number;
  leaseMs: number;
  pollIntervalMs: number;
  maxAttempts: number;
  now: () => number;
  random: () => number;
  log: (entry: Record<string, unknown>) => void;
}

const defaultLog = (entry: Record<string, unknown>) => {
  const level = entry.action === 'retry' || entry.action === 'dead-letter' || entry.action === 'error'
    ? 'error'
    : 'info';
  console[level]('[realtime-outbox]', JSON.stringify(entry));
};

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function getRealtimeOutboxOptions(): Pick<
  RealtimeOutboxOptions,
  'batchSize' | 'maxConcurrency' | 'leaseMs' | 'pollIntervalMs' | 'maxAttempts'
> {
  return {
    batchSize: boundedInteger(process.env.REALTIME_OUTBOX_BATCH_SIZE, 20, 1, 100),
    maxConcurrency: DEFAULT_MAX_CONCURRENCY,
    leaseMs: boundedInteger(process.env.REALTIME_OUTBOX_LEASE_MS, 30_000, 1_000, 300_000),
    pollIntervalMs: boundedInteger(process.env.REALTIME_OUTBOX_POLL_INTERVAL_MS, 1_000, 100, 60_000),
    maxAttempts: MAX_ATTEMPTS,
  };
}

export class RealtimeOutboxDispatcher {
  private readonly options: RealtimeOutboxOptions;
  private stopping = false;
  private loopPromise: Promise<void> | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private wakePoll: (() => void) | undefined;

  constructor(
    options: Partial<RealtimeOutboxOptions> = {},
  ) {
    this.options = {
      query: options.query ?? query,
      withTransaction: options.withTransaction ?? withTransaction,
      publishConversationMessage:
        options.publishConversationMessage ?? publishConversationMessageAcrossInstances,
      publishConversationMessageEdit:
        options.publishConversationMessageEdit ?? publishConversationMessageEditAcrossInstances,
      resolveMessage: options.resolveMessage ?? messagingRepo.getMessageById.bind(messagingRepo),
      ...getRealtimeOutboxOptions(),
      ...options,
      batchSize: Math.min(
        100,
        Math.max(1, options.batchSize ?? getRealtimeOutboxOptions().batchSize),
      ),
      maxConcurrency: Math.min(
        MAX_DISPATCH_CONCURRENCY,
        Math.max(1, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY),
      ),
      now: options.now ?? Date.now,
      random: options.random ?? Math.random,
      log: options.log ?? defaultLog,
    };
  }

  public start(): void {
    if (this.loopPromise) return;
    this.stopping = false;
    this.loopPromise = this.runLoop();
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.wakePoll?.();
    await this.loopPromise;
    this.loopPromise = undefined;
  }

  public async dispatchOnce(): Promise<number> {
    const claimed = await this.claimPendingEvents();
    const results = await Promise.allSettled(
      claimed.map((event) => this.publishClaimedEvent(event)),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more realtime outbox events failed.');
    }
    return claimed.length;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.dispatchOnce();
      } catch {
        this.options.log({ action: 'error', component: 'realtime-outbox', error: 'database_operation_failed' });
      }
      if (!this.stopping) await this.waitForPoll();
    }
  }

  private async waitForPoll(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.wakePoll = resolve;
      this.pollTimer = setTimeout(() => {
        this.pollTimer = undefined;
        this.wakePoll = undefined;
        resolve();
      }, this.options.pollIntervalMs);
      this.pollTimer.unref();
    });
  }

  public async claimPendingEvents(): Promise<OutboxRecord[]> {
    const now = this.options.now();
    const leaseToken = randomUUID();
    return this.options.withTransaction(async (client: PoolClient) => {
      const result = await client.query<OutboxRecord>(
        `WITH candidates AS (
           SELECT id
           FROM zunari_realtime_event_outbox
           WHERE published_at IS NULL
             AND dead_lettered_at IS NULL
             AND next_attempt_at <= $1
             AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
           ORDER BY next_attempt_at ASC, created_at ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         UPDATE zunari_realtime_event_outbox AS outbox
         SET claimed_at = $1,
             lease_expires_at = $1 + $3,
             lease_token = $4,
             attempt_count = attempt_count + 1
         FROM candidates
         WHERE outbox.id = candidates.id
         RETURNING outbox.id, outbox.event_type, outbox.conversation_id,
                   outbox.created_at, outbox.payload, outbox.attempt_count, outbox.lease_token`,
        [
          now,
          Math.min(this.options.batchSize, this.options.maxConcurrency),
          this.options.leaseMs,
          leaseToken,
        ],
      );
      return result.rows;
    });
  }

  private async publishClaimedEvent(event: OutboxRecord): Promise<void> {
    let leaseLost = false;
    let renewalInFlight: Promise<void> | undefined;
    const renewLease = async (): Promise<void> => {
      if (renewalInFlight || leaseLost) return renewalInFlight;
      renewalInFlight = (async () => {
        try {
          const now = this.options.now();
          const result = await this.options.query(
            `UPDATE zunari_realtime_event_outbox
             SET lease_expires_at = $1 + $2
             WHERE id = $3 AND lease_token = $4
               AND published_at IS NULL AND dead_lettered_at IS NULL
               AND lease_expires_at > $1`,
            [now, this.options.leaseMs, event.id, event.lease_token],
          );
          if (!result.rowCount) leaseLost = true;
        } catch {
          leaseLost = true;
        }
      })();
      await renewalInFlight;
      renewalInFlight = undefined;
    };
    const heartbeat = setInterval(() => {
      void renewLease();
    }, Math.max(100, Math.floor(this.options.leaseMs / 3)));
    heartbeat.unref();

    let message: Awaited<ReturnType<typeof this.options.resolveMessage>> | undefined;
    try {
      if (
        event.event_type === 'conversation.message' ||
        event.event_type === 'conversation.message.edit'
      ) {
        const messageId = event.payload.messageId;
        const senderId = event.payload.senderId;
        if (typeof messageId !== 'string' || typeof senderId !== 'string') {
          throw new Error('Invalid conversation message outbox payload.');
        }
        message = await this.options.resolveMessage(messageId, senderId);
        if (!message) throw new Error('Outbox message is no longer available.');
      }
    } catch (error) {
      clearInterval(heartbeat);
      await renewalInFlight;
      await this.recordFailure(event, error);
      return;
    }
    clearInterval(heartbeat);
    await renewalInFlight;
    if (leaseLost) {
      this.logLeaseLost(event);
      return;
    }

    try {
      const result = await this.options.withTransaction(async (client) => {
        let recipientIds: string[] = [];
        if (
          event.event_type === 'conversation.message' ||
          event.event_type === 'conversation.message.edit'
        ) {
          if (typeof event.conversation_id !== 'string' || !message) {
            throw new Error('Invalid conversation message outbox payload.');
          }
          const payloadRecipientIds = event.payload.recipientIds;
          if (
            !Array.isArray(payloadRecipientIds) ||
            !payloadRecipientIds.every((recipientId) => typeof recipientId === 'string')
          ) {
            throw new Error('Invalid conversation message outbox payload.');
          }
          const rawMembershipSnapshot = event.payload.recipientMemberships;
          let membershipSnapshot: Array<{ userId: string; epoch: string }> | undefined;
          if (rawMembershipSnapshot !== undefined) {
            if (
              !Array.isArray(rawMembershipSnapshot) ||
              !rawMembershipSnapshot.every((entry) =>
                entry !== null &&
                typeof entry === 'object' &&
                typeof entry.userId === 'string' &&
                typeof entry.epoch === 'string' &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.epoch),
              )
            ) {
              throw new Error('Invalid conversation membership snapshot.');
            }
            membershipSnapshot = rawMembershipSnapshot;
          } else {
            this.options.log({
              action: 'missing-membership-snapshot',
              component: 'realtime-outbox',
              eventId: event.id,
              eventType: event.event_type,
            });
          }
          await lockConversationForPublication(client, event.conversation_id);
          const renewed = await this.renewLeaseInTransaction(client, event);
          if (!renewed) return { published: false, retired: false, leaseLost: true };
          recipientIds = await getActiveConversationRecipients(
            client,
            event.conversation_id,
            payloadRecipientIds,
            membershipSnapshot,
          );
        } else if (event.event_type === 'message.new') {
          const renewed = await this.renewLeaseInTransaction(client, event);
          if (!renewed) return { published: false, retired: false, leaseLost: true };
          const retiredAt = this.options.now();
          const retired = await client.query(
            `UPDATE zunari_realtime_event_outbox
             SET dead_lettered_at = $1,
                 last_error = $2,
                 claimed_at = NULL,
                 lease_expires_at = NULL,
                 lease_token = NULL
             WHERE id = $3 AND lease_token = $4
               AND published_at IS NULL AND dead_lettered_at IS NULL
               AND lease_expires_at > $1
             RETURNING id`,
            [
              retiredAt,
              LEGACY_MESSAGE_RETIREMENT_REASON,
              event.id,
              event.lease_token,
            ],
          );
          return {
            published: false,
            retired: Boolean(retired.rowCount),
            leaseLost: !retired.rowCount,
          };
        } else {
          throw new Error('Unsupported realtime outbox event type.');
        }

        if (leaseLost) return { published: false, retired: false, leaseLost: true };
        if (recipientIds.length > 0) {
          const published = event.event_type === 'conversation.message'
            ? await this.options.publishConversationMessage({
                conversationId: event.conversation_id as string,
                message: message!,
                recipientIds,
                eventId: event.id,
              })
            : await this.options.publishConversationMessageEdit({
                conversationId: event.conversation_id as string,
                message: message!,
                recipientIds,
                eventId: event.id,
              });
          if (!published) throw new Error('Realtime publisher unavailable.');
        }

        const acknowledged = await client.query(
          `UPDATE zunari_realtime_event_outbox
           SET published_at = $1, claimed_at = NULL, lease_expires_at = NULL,
               lease_token = NULL, last_error = NULL
           WHERE id = $2 AND lease_token = $3 AND published_at IS NULL
           RETURNING id`,
          [this.options.now(), event.id, event.lease_token],
        );
        return {
          published: Boolean(acknowledged.rowCount),
          retired: false,
          leaseLost: !acknowledged.rowCount,
        };
      });

      if (result.retired) {
        this.options.log({
          action: 'retired',
          component: 'realtime-outbox',
          eventId: event.id,
          eventType: event.event_type,
          attemptCount: event.attempt_count,
        });
        return;
      }
      if (!result.published) {
        if (result.leaseLost) this.logLeaseLost(event);
        return;
      }
      this.options.log({
        action: 'published',
        component: 'realtime-outbox',
        eventId: event.id,
        eventType: event.event_type,
        attemptCount: event.attempt_count,
      });
    } catch (error) {
      await this.recordFailure(event, error);
    }
  }

  private async renewLeaseInTransaction(
    client: PoolClient,
    event: OutboxRecord,
  ): Promise<boolean> {
    const now = this.options.now();
    const result = await client.query(
      `UPDATE zunari_realtime_event_outbox
       SET lease_expires_at = $1 + $2
       WHERE id = $3 AND lease_token = $4
         AND published_at IS NULL AND dead_lettered_at IS NULL
         AND lease_expires_at > $1
       RETURNING id`,
      [now, this.options.leaseMs, event.id, event.lease_token],
    );
    return Boolean(result.rowCount);
  }

  private logLeaseLost(event: OutboxRecord): void {
    this.options.log({
      action: 'lease-lost-before-publish',
      component: 'realtime-outbox',
      eventId: event.id,
      eventType: event.event_type,
    });
  }

  private async recordFailure(event: OutboxRecord, error: unknown): Promise<void> {
    const now = this.options.now();
    const deadLetter = event.attempt_count >= this.options.maxAttempts;
    const errorCode = error instanceof Error ? error.name.slice(0, 100) : 'UnknownError';
    const retryDelay = Math.min(
      MAX_BACKOFF_MS,
      1_000 * (2 ** Math.max(0, event.attempt_count - 1)),
    );
    const jitteredDelay = Math.floor(retryDelay * (0.5 + this.options.random()));
    const result = await this.options.query(
      `UPDATE zunari_realtime_event_outbox
       SET last_error = $1,
           next_attempt_at = $2,
           dead_lettered_at = $3,
           claimed_at = NULL,
           lease_expires_at = NULL,
           lease_token = NULL
       WHERE id = $4 AND lease_token = $5 AND published_at IS NULL
       RETURNING id`,
      [
        errorCode,
        now + jitteredDelay,
        deadLetter ? now : null,
        event.id,
        event.lease_token,
      ],
    );
    if (!result.rowCount) {
      this.logLeaseLost(event);
      return;
    }
    this.options.log({
      action: deadLetter ? 'dead-letter' : 'retry',
      component: 'realtime-outbox',
      eventId: event.id,
      eventType: event.event_type,
      attemptCount: event.attempt_count,
      error: errorCode,
      nextAttemptAt: deadLetter ? undefined : now + jitteredDelay,
    });
  }
}

let activeDispatcher: RealtimeOutboxDispatcher | undefined;

export function startRealtimeOutboxDispatcher(): () => Promise<void> {
  if (activeDispatcher) return () => activeDispatcher?.stop() ?? Promise.resolve();
  const dispatcher = new RealtimeOutboxDispatcher();
  activeDispatcher = dispatcher;
  dispatcher.start();
  return async () => {
    await dispatcher.stop();
    if (activeDispatcher === dispatcher) activeDispatcher = undefined;
  };
}
