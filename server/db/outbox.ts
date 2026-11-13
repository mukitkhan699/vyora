import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export interface NewOutboxEvent {
  eventType: string;
  entityId?: string;
  conversationId?: string;
  payload: Record<string, unknown>;
  createdAt?: number;
}

export async function enqueueOutboxEvent(
  client: Pick<PoolClient, 'query'>,
  event: NewOutboxEvent,
): Promise<string> {
  const eventId = randomUUID();
  const createdAt = event.createdAt ?? Date.now();
  await client.query(
    `INSERT INTO zunari_realtime_event_outbox
       (id, event_type, entity_id, conversation_id, payload, created_at, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [
      eventId,
      event.eventType,
      event.entityId ?? null,
      event.conversationId ?? null,
      event.payload,
      createdAt,
    ],
  );
  return eventId;
}
