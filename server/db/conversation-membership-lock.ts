import type { PoolClient } from 'pg';

export async function lockConversationForMembershipChange(
  client: Pick<PoolClient, 'query'>,
  conversationId: string,
): Promise<void> {
  const result = await client.query(
    'SELECT id FROM zunari_conversations_v2 WHERE id = $1 FOR UPDATE',
    [conversationId],
  );
  if (!result.rowCount) throw new Error('Conversation not found while locking membership.');
}

export async function lockConversationForPublication(
  client: Pick<PoolClient, 'query'>,
  conversationId: string,
): Promise<void> {
  const result = await client.query(
    'SELECT id FROM zunari_conversations_v2 WHERE id = $1 FOR KEY SHARE',
    [conversationId],
  );
  if (!result.rowCount) throw new Error('Conversation not found while authorizing publication.');
}

export async function getActiveConversationRecipients(
  client: Pick<PoolClient, 'query'>,
  conversationId: string,
  candidateIds: string[],
  membershipSnapshot?: Array<{ userId: string; epoch: string }>,
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const result = await client.query<{ user_id: string; membership_epoch: string }>(
    `SELECT user_id, membership_epoch
     FROM zunari_conversation_participants
     WHERE conversation_id = $1 AND user_id = ANY($2::text[]) AND left_at IS NULL`,
    [conversationId, candidateIds],
  );
  const epochByUserId = membershipSnapshot
    ? new Map(membershipSnapshot.map(({ userId, epoch }) => [userId, epoch]))
    : undefined;
  return result.rows
    .filter((row) => {
      if (!epochByUserId) return false;
      return epochByUserId.get(row.user_id) === row.membership_epoch;
    })
    .map((row) => row.user_id);
}
