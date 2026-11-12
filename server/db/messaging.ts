import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, withTransaction } from './pool.ts';
import { HttpError } from '../errors.ts';
import { publishMessage, publishNotification } from '../realtime-events.ts';
import type { User } from '../../src/types/index.ts';

export interface ConversationParticipant {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
  leftAt: number | null;
  lastReadMessageId: string | null;
  user?: User;
}

export interface ConversationSummary {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  avatarUrl: string | null;
  createdBy: string | null;
  lastMessageAt: number;
  createdAt: number;
  updatedAt: number;
  participants: ConversationParticipant[];
  lastMessage?: MessageRecord | null;
  unreadCount: number;
}

export interface MessageAttachmentRecord {
  id: string;
  messageId: string;
  mediaAssetId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  status: 'active' | 'expired' | 'cleaned';
  expiresAt: number;
  createdAt: number;
  url: string;
  deliveries?: Array<{
    recipientId: string;
    deliveredAt: number | null;
    readAt: number | null;
    downloadedAt: number | null;
  }>;
}

export interface MessageReactionRecord {
  emoji: string;
  userId: string;
  username?: string;
  createdAt: number;
}

export interface MessageReceiptRecord {
  userId: string;
  deliveredAt: number | null;
  readAt: number | null;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string | null;
  sender?: User;
  clientId: string | null;
  text: string;
  replyToMessageId: string | null;
  replyToMessage?: {
    id: string;
    senderId: string | null;
    senderUsername?: string;
    text: string;
  } | null;
  isEdited: boolean;
  editedAt: number | null;
  isDeleted: boolean;
  deletedAt: number | null;
  createdAt: number;
  attachments: MessageAttachmentRecord[];
  reactions: MessageReactionRecord[];
  receipts: MessageReceiptRecord[];
}

const MAX_MESSAGE_TEXT_LENGTH = 4000;
const MAX_MESSAGE_ATTACHMENTS = 10;
const MAX_GROUP_PARTICIPANTS = 100;
const MAX_RECEIPT_MESSAGE_IDS = 100;

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  client_id: string | null;
  text: string;
  reply_to_message_id: string | null;
  is_edited: boolean;
  edited_at: string | number | null;
  is_deleted: boolean;
  deleted_at: string | number | null;
  created_at: string | number;
  sender_username: string | null;
  sender_name: string | null;
  sender_avatar_url: string | null;
  sender_verified: boolean | null;
  sender_is_gold: boolean | null;
  reply_sender_id: string | null;
  reply_sender_username: string | null;
  reply_text: string | null;
}

export class MessagingRepository {
  public async getConversationById(
    conversationId: string,
    currentUserId: string,
  ): Promise<ConversationSummary | null> {
    const convRes = await query<{
      id: string;
      type: 'direct' | 'group';
      title: string | null;
      avatar_url: string | null;
      created_by: string | null;
      last_message_at: string | number;
      created_at: string | number;
      updated_at: string | number;
    }>(
      `SELECT c.* FROM zunari_conversations_v2 c
       JOIN zunari_conversation_participants p
         ON p.conversation_id = c.id AND p.user_id = $2
       WHERE c.id = $1`,
      [conversationId, currentUserId],
    );
    const row = convRes.rows[0];
    if (!row) return null;

    const participants = await this.getParticipants(conversationId);
    const lastMessage = await this.getLastMessage(conversationId, currentUserId);
    const unreadCount = await this.getUnreadCount(conversationId, currentUserId);

    return {
      id: row.id,
      type: row.type,
      title: row.title,
      avatarUrl: row.avatar_url,
      createdBy: row.created_by,
      lastMessageAt: Number(row.last_message_at),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      participants,
      lastMessage,
      unreadCount,
    };
  }

  public async getParticipants(
    conversationId: string,
    includeLeft = false,
  ): Promise<ConversationParticipant[]> {
    const res = await query<{
      conversation_id: string;
      user_id: string;
      role: 'owner' | 'admin' | 'member';
      joined_at: string | number;
      left_at: string | number | null;
      last_read_message_id: string | null;
      username: string;
      name: string;
      avatar_url: string;
      verified: boolean;
      is_gold: boolean;
      followers_count: number;
      following_count: number;
    }>(
      `SELECT p.*, u.username, u.name, u.avatar_url, u.verified, u.is_gold,
              u.followers_count, u.following_count
       FROM zunari_conversation_participants p
       JOIN zunari_users u ON u.public_id = p.user_id
       WHERE p.conversation_id = $1
         ${includeLeft ? '' : 'AND p.left_at IS NULL'}
       ORDER BY p.joined_at ASC`,
      [conversationId],
    );

    return res.rows.map((r) => this.mapParticipantRow(r));
  }

  private mapParticipantRow(r: {
    user_id: string;
    role: 'owner' | 'admin' | 'member';
    joined_at: string | number;
    left_at: string | number | null;
    last_read_message_id: string | null;
    username: string;
    name: string;
    avatar_url: string;
    verified: boolean;
    is_gold: boolean;
    followers_count: number;
    following_count: number;
  }): ConversationParticipant {
    return {
      userId: r.user_id,
      role: r.role,
      joinedAt: Number(r.joined_at),
      leftAt: r.left_at ? Number(r.left_at) : null,
      lastReadMessageId: r.last_read_message_id,
      user: {
        id: r.user_id,
        username: r.username,
        name: r.name,
        avatarUrl: r.avatar_url,
        verified: r.verified,
        isGold: r.is_gold,
        followersCount: Number(r.followers_count),
        followingCount: Number(r.following_count),
        joinedDate: '',
      },
    };
  }

  private async getParticipantsForConversations(
    conversationIds: string[],
  ): Promise<Map<string, ConversationParticipant[]>> {
    const map = new Map<string, ConversationParticipant[]>();
    if (conversationIds.length === 0) return map;

    const res = await query<{
      conversation_id: string;
      user_id: string;
      role: 'owner' | 'admin' | 'member';
      joined_at: string | number;
      left_at: string | number | null;
      last_read_message_id: string | null;
      username: string;
      name: string;
      avatar_url: string;
      verified: boolean;
      is_gold: boolean;
      followers_count: number;
      following_count: number;
    }>(
      `SELECT p.*, u.username, u.name, u.avatar_url, u.verified, u.is_gold,
              u.followers_count, u.following_count
       FROM zunari_conversation_participants p
       JOIN zunari_users u ON u.public_id = p.user_id
       WHERE p.conversation_id = ANY($1::text[]) AND p.left_at IS NULL
       ORDER BY p.conversation_id, p.joined_at ASC`,
      [conversationIds],
    );

    for (const row of res.rows) {
      const list = map.get(row.conversation_id) || [];
      list.push(this.mapParticipantRow(row));
      map.set(row.conversation_id, list);
    }
    return map;
  }

  public async listConversations(currentUserId: string): Promise<ConversationSummary[]> {
    const res = await query<{
      id: string;
      type: 'direct' | 'group';
      title: string | null;
      avatar_url: string | null;
      created_by: string | null;
      last_message_at: string | number;
      created_at: string | number;
      updated_at: string | number;
    }>(
      `SELECT c.* FROM zunari_conversations_v2 c
       JOIN zunari_conversation_participants p
         ON p.conversation_id = c.id AND p.user_id = $1 AND p.left_at IS NULL
       ORDER BY c.last_message_at DESC`,
      [currentUserId],
    );

    const conversationIds = res.rows.map((row) => row.id);
    const [participantsByConversation, lastMessages, unreadCounts] = await Promise.all([
      this.getParticipantsForConversations(conversationIds),
      this.getLastMessagesForConversations(conversationIds, currentUserId),
      this.getUnreadCountsForConversations(conversationIds, currentUserId),
    ]);

    return res.rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      avatarUrl: row.avatar_url,
      createdBy: row.created_by,
      lastMessageAt: Number(row.last_message_at),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      participants: participantsByConversation.get(row.id) || [],
      lastMessage: lastMessages.get(row.id) || null,
      unreadCount: unreadCounts.get(row.id) || 0,
    }));
  }

  public async getOrCreateDirectConversation(
    userA: string,
    userB: string,
  ): Promise<ConversationSummary> {
    if (userA === userB) {
      throw new HttpError(400, 'Cannot create direct conversation with yourself.', 'INVALID_PARTICIPANT');
    }
    const [p1, p2] = [userA, userB].sort();
    const directKey = `${p1}:${p2}`;
    const now = Date.now();

    const convId = await withTransaction(async (client) => {
      // Validate both users exist
      const usersCheck = await client.query(
        'SELECT public_id FROM zunari_users WHERE public_id = ANY($1::text[])',
        [[userA, userB]],
      );
      if (usersCheck.rowCount !== 2) {
        throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
      }

      const existing = await client.query<{ id: string }>(
        'SELECT id FROM zunari_conversations_v2 WHERE direct_key = $1',
        [directKey],
      );
      if (existing.rows[0]) {
        // If either user previously left or was removed, re-join them
        await client.query(
          `UPDATE zunari_conversation_participants
           SET left_at = NULL
           WHERE conversation_id = $1 AND user_id = ANY($2::text[])`,
          [existing.rows[0].id, [userA, userB]],
        );
        return existing.rows[0].id;
      }

      const newId = `conv_${randomUUID()}`;
      await client.query(
        `INSERT INTO zunari_conversations_v2
           (id, type, title, avatar_url, created_by, direct_key, last_message_at, created_at, updated_at)
         VALUES ($1, 'direct', NULL, NULL, $2, $3, $4, $4, $4)`,
        [newId, userA, directKey, now],
      );

      await client.query(
        `INSERT INTO zunari_conversation_participants
           (conversation_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', $3), ($1, $4, 'member', $3)`,
        [newId, userA, now, userB],
      );

      return newId;
    });

    const conv = await this.getConversationById(convId, userA);
    if (!conv) throw new Error('Failed to load created conversation.');
    return conv;
  }

  public async createGroupConversation(
    creatorId: string,
    title: string,
    participantIds: string[],
    avatarUrl?: string,
  ): Promise<ConversationSummary> {
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > 100) {
      throw new HttpError(400, 'A valid group title (1-100 characters) is required.', 'INVALID_TITLE');
    }

    const uniqueParticipants = Array.from(new Set([creatorId, ...participantIds]));
    if (uniqueParticipants.length < 2) {
      throw new HttpError(400, 'A group conversation must have at least 2 participants.', 'NOT_ENOUGH_PARTICIPANTS');
    }
    if (uniqueParticipants.length > MAX_GROUP_PARTICIPANTS) {
      throw new HttpError(
        400,
        `A group conversation cannot have more than ${MAX_GROUP_PARTICIPANTS} participants.`,
        'TOO_MANY_PARTICIPANTS',
      );
    }

    const now = Date.now();
    const convId = await withTransaction(async (client) => {
      const usersCheck = await client.query<{ public_id: string }>(
        'SELECT public_id FROM zunari_users WHERE public_id = ANY($1::text[])',
        [uniqueParticipants],
      );
      if (usersCheck.rowCount !== uniqueParticipants.length) {
        throw new HttpError(404, 'One or more users not found.', 'USER_NOT_FOUND');
      }

      const newId = `conv_${randomUUID()}`;
      await client.query(
        `INSERT INTO zunari_conversations_v2
           (id, type, title, avatar_url, created_by, direct_key, last_message_at, created_at, updated_at)
         VALUES ($1, 'group', $2, $3, $4, NULL, $5, $5, $5)`,
        [newId, cleanTitle, avatarUrl || null, creatorId, now],
      );

      for (const userId of uniqueParticipants) {
        const role = userId === creatorId ? 'owner' : 'member';
        await client.query(
          `INSERT INTO zunari_conversation_participants
             (conversation_id, user_id, role, joined_at)
           VALUES ($1, $2, $3, $4)`,
          [newId, userId, role, now],
        );
      }

      return newId;
    });

    const conv = await this.getConversationById(convId, creatorId);
    if (!conv) throw new Error('Failed to load created group conversation.');
    return conv;
  }

  public async updateGroupConversation(
    conversationId: string,
    userId: string,
    data: { title?: string; avatarUrl?: string },
  ): Promise<ConversationSummary> {
    await withTransaction(async (client) => {
      const participant = await client.query<{ role: string; left_at: number | null }>(
        `SELECT role, left_at FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, userId],
      );
      const row = participant.rows[0];
      if (!row || row.left_at) {
        throw new HttpError(403, 'You are not an active member of this conversation.', 'FORBIDDEN');
      }
      if (row.role !== 'owner' && row.role !== 'admin') {
        throw new HttpError(403, 'Only admins or owners can update group information.', 'FORBIDDEN');
      }

      const updates: string[] = [];
      const values: unknown[] = [conversationId];
      if (data.title !== undefined) {
        const cleanTitle = data.title.trim();
        if (!cleanTitle || cleanTitle.length > 100) {
          throw new HttpError(400, 'Title must be 1-100 characters.', 'INVALID_TITLE');
        }
        values.push(cleanTitle);
        updates.push(`title = $${values.length}`);
      }
      if (data.avatarUrl !== undefined) {
        values.push(data.avatarUrl.trim() || null);
        updates.push(`avatar_url = $${values.length}`);
      }
      if (updates.length > 0) {
        values.push(Date.now());
        updates.push(`updated_at = $${values.length}`);
        await client.query(
          `UPDATE zunari_conversations_v2 SET ${updates.join(', ')} WHERE id = $1`,
          values,
        );
      }
    });

    const updated = await this.getConversationById(conversationId, userId);
    if (!updated) throw new HttpError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
    return updated;
  }

  public async addGroupParticipants(
    conversationId: string,
    actorId: string,
    newParticipantIds: string[],
  ): Promise<ConversationParticipant[]> {
    const uniqueIds = Array.from(new Set(newParticipantIds)).filter((id) => id !== actorId);
    if (uniqueIds.length === 0) return this.getParticipants(conversationId);
    if (uniqueIds.length > MAX_GROUP_PARTICIPANTS) {
      throw new HttpError(
        400,
        `A group conversation cannot have more than ${MAX_GROUP_PARTICIPANTS} participants.`,
        'TOO_MANY_PARTICIPANTS',
      );
    }

    const now = Date.now();
    await withTransaction(async (client) => {
      const conv = await client.query<{ type: string }>(
        'SELECT type FROM zunari_conversations_v2 WHERE id = $1',
        [conversationId],
      );
      if (!conv.rows[0] || conv.rows[0].type !== 'group') {
        throw new HttpError(400, 'Cannot add participants to a direct conversation.', 'INVALID_CONVERSATION_TYPE');
      }

      const actor = await client.query<{ role: string; left_at: number | null }>(
        `SELECT role, left_at FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, actorId],
      );
      if (!actor.rows[0] || actor.rows[0].left_at) {
        throw new HttpError(403, 'You are not an active member of this group.', 'FORBIDDEN');
      }
      if (actor.rows[0].role !== 'owner' && actor.rows[0].role !== 'admin') {
        throw new HttpError(403, 'Only admins or owners can add participants.', 'FORBIDDEN');
      }

      const usersCheck = await client.query<{ public_id: string }>(
        'SELECT public_id FROM zunari_users WHERE public_id = ANY($1::text[])',
        [uniqueIds],
      );
      if (usersCheck.rowCount !== uniqueIds.length) {
        throw new HttpError(404, 'One or more users not found.', 'USER_NOT_FOUND');
      }

      const activeCount = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND left_at IS NULL`,
        [conversationId],
      );
      const alreadyActive = await client.query<{ user_id: string }>(
        `SELECT user_id FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND user_id = ANY($2::text[]) AND left_at IS NULL`,
        [conversationId, uniqueIds],
      );
      const additions = uniqueIds.length - (alreadyActive.rowCount || 0);
      if (Number(activeCount.rows[0]?.count || 0) + additions > MAX_GROUP_PARTICIPANTS) {
        throw new HttpError(
          400,
          `A group conversation cannot have more than ${MAX_GROUP_PARTICIPANTS} participants.`,
          'TOO_MANY_PARTICIPANTS',
        );
      }

      for (const targetId of uniqueIds) {
        await client.query(
          `INSERT INTO zunari_conversation_participants
             (conversation_id, user_id, role, joined_at, left_at)
           VALUES ($1, $2, 'member', $3, NULL)
           ON CONFLICT (conversation_id, user_id)
           DO UPDATE SET left_at = NULL, joined_at = $3`,
          [conversationId, targetId, now],
        );
      }
    });

    return this.getParticipants(conversationId);
  }

  public async removeGroupParticipant(
    conversationId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<{ success: boolean }> {
    const now = Date.now();
    return withTransaction(async (client) => {
      const conv = await client.query<{ type: string; created_by: string | null }>(
        'SELECT type, created_by FROM zunari_conversations_v2 WHERE id = $1',
        [conversationId],
      );
      if (!conv.rows[0] || conv.rows[0].type !== 'group') {
        throw new HttpError(400, 'Cannot remove participants from a direct conversation.', 'INVALID_CONVERSATION_TYPE');
      }

      const actor = await client.query<{ role: string; left_at: number | null }>(
        `SELECT role, left_at FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, actorId],
      );
      if (!actor.rows[0] || actor.rows[0].left_at) {
        throw new HttpError(403, 'You are not an active member of this group.', 'FORBIDDEN');
      }

      const target = await client.query<{ role: string; left_at: number | null }>(
        `SELECT role, left_at FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, targetUserId],
      );
      if (!target.rows[0] || target.rows[0].left_at) {
        throw new HttpError(404, 'Participant not found in group.', 'PARTICIPANT_NOT_FOUND');
      }

      const isLeaving = actorId === targetUserId;
      if (!isLeaving) {
        // Enforce role hierarchy: owner can remove anyone; admin can remove members
        if (actor.rows[0].role === 'member') {
          throw new HttpError(403, 'Members cannot remove other participants.', 'FORBIDDEN');
        }
        if (actor.rows[0].role === 'admin' && target.rows[0].role !== 'member') {
          throw new HttpError(403, 'Admins cannot remove other admins or owners.', 'FORBIDDEN');
        }
      }

      // Mark participant as left
      await client.query(
        `UPDATE zunari_conversation_participants
         SET left_at = $1
         WHERE conversation_id = $2 AND user_id = $3`,
        [now, conversationId, targetUserId],
      );

      // Keep the group manageable if the owner leaves: promote an admin first,
      // otherwise the longest-standing remaining member.
      if (isLeaving && target.rows[0].role === 'owner') {
        const successor = await client.query<{ user_id: string }>(
          `SELECT user_id FROM zunari_conversation_participants
           WHERE conversation_id = $1 AND user_id <> $2 AND left_at IS NULL
           ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, joined_at ASC
           LIMIT 1`,
          [conversationId, targetUserId],
        );
        if (successor.rows[0]) {
          await client.query(
            `UPDATE zunari_conversation_participants
             SET role = 'owner'
             WHERE conversation_id = $1 AND user_id = $2`,
            [conversationId, successor.rows[0].user_id],
          );
        }
      }

      // Reconcile pending attachment deliveries for this user
      // Recipient is removed: mark pending attachment deliveries as skipped/read to avoid blocking cleanup
      await client.query(
        `UPDATE zunari_attachment_deliveries ad
         SET delivered_at = COALESCE(delivered_at, $1)
         FROM zunari_message_attachments ma
         JOIN zunari_messages_v2 m ON m.id = ma.message_id
         WHERE ad.attachment_id = ma.id
           AND ad.recipient_id = $2
           AND m.conversation_id = $3
           AND ad.delivered_at IS NULL`,
        [now, targetUserId, conversationId],
      );

      return { success: true };
    });
  }

  public async getMessages(
    conversationId: string,
    currentUserId: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<MessageRecord[]> {
    const limit = Math.min(100, Math.max(1, options.limit || 50));

    // Ensure user has access
    const membership = await query<{ joined_at: string | number; left_at: string | number | null }>(
      `SELECT joined_at, left_at FROM zunari_conversation_participants
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, currentUserId],
    );
    const part = membership.rows[0];
    if (!part) {
      throw new HttpError(403, 'You do not have access to this conversation.', 'FORBIDDEN');
    }

    // Historical access rule: members only see messages up until their left_at (if departed)
    const maxTime = part.left_at ? Number(part.left_at) : Date.now();

    let cursorTime = maxTime + 1;
    if (options.before) {
      const cursorRes = await query<{ created_at: string | number }>(
        'SELECT created_at FROM zunari_messages_v2 WHERE id = $1 AND conversation_id = $2',
        [options.before, conversationId],
      );
      if (cursorRes.rows[0]) {
        cursorTime = Number(cursorRes.rows[0].created_at);
      }
    }

    // A `before` cursor must never expose messages newer than the member's
    // departure time, otherwise a departed member could page forward past it.
    cursorTime = Math.min(cursorTime, maxTime + 1);

    const messagesRes = await query<{
      id: string;
      conversation_id: string;
      sender_id: string | null;
      client_id: string | null;
      text: string;
      reply_to_message_id: string | null;
      is_edited: boolean;
      edited_at: string | number | null;
      is_deleted: boolean;
      deleted_at: string | number | null;
      created_at: string | number;
      sender_username: string | null;
      sender_name: string | null;
      sender_avatar_url: string | null;
      sender_verified: boolean | null;
      sender_is_gold: boolean | null;
      reply_sender_id: string | null;
      reply_sender_username: string | null;
      reply_text: string | null;
    }>(
      `SELECT m.*,
              u.username AS sender_username, u.name AS sender_name, u.avatar_url AS sender_avatar_url,
              u.verified AS sender_verified, u.is_gold AS sender_is_gold,
              rm.sender_id AS reply_sender_id, ru.username AS reply_sender_username, rm.text AS reply_text
       FROM zunari_messages_v2 m
       LEFT JOIN zunari_users u ON u.public_id = m.sender_id
       LEFT JOIN zunari_messages_v2 rm ON rm.id = m.reply_to_message_id
       LEFT JOIN zunari_users ru ON ru.public_id = rm.sender_id
       WHERE m.conversation_id = $1 AND m.created_at < $2
       ORDER BY m.created_at DESC
       LIMIT $3`,
      [conversationId, cursorTime, limit],
    );

    const messageIds = messagesRes.rows.map((r) => r.id);
    const attachmentsMap = await this.getAttachmentsForMessages(messageIds);
    const reactionsMap = await this.getReactionsForMessages(messageIds);
    const receiptsMap = await this.getReceiptsForMessages(messageIds);

    return messagesRes.rows.reverse().map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      senderId: r.sender_id,
      sender: r.sender_id && r.sender_username
        ? {
            id: r.sender_id,
            username: r.sender_username,
            name: r.sender_name || '',
            avatarUrl: r.sender_avatar_url || '',
            verified: Boolean(r.sender_verified),
            isGold: Boolean(r.sender_is_gold),
            followersCount: 0,
            followingCount: 0,
            joinedDate: '',
          }
        : undefined,
      clientId: r.client_id,
      text: r.is_deleted ? 'This message was deleted.' : r.text,
      replyToMessageId: r.reply_to_message_id,
      replyToMessage: r.reply_to_message_id
        ? {
            id: r.reply_to_message_id,
            senderId: r.reply_sender_id,
            senderUsername: r.reply_sender_username || undefined,
            text: r.reply_text || '',
          }
        : null,
      isEdited: Boolean(r.is_edited),
      editedAt: r.edited_at ? Number(r.edited_at) : null,
      isDeleted: Boolean(r.is_deleted),
      deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      createdAt: Number(r.created_at),
      attachments: attachmentsMap.get(r.id) || [],
      reactions: reactionsMap.get(r.id) || [],
      receipts: receiptsMap.get(r.id) || [],
    }));
  }

  public async sendMessage(
    senderId: string,
    conversationId: string,
    payload: {
      text?: string;
      clientId?: string;
      replyToMessageId?: string;
      attachmentAssetIds?: string[];
    },
  ): Promise<{ message: MessageRecord; isDuplicate: boolean }> {
    const text = (payload.text || '').trim();
    const clientId = payload.clientId?.trim() || null;
    const attachmentIds = payload.attachmentAssetIds || [];

    if (!text && attachmentIds.length === 0) {
      throw new HttpError(400, 'Message text or attachment is required.', 'EMPTY_MESSAGE');
    }
    if (text.length > MAX_MESSAGE_TEXT_LENGTH) {
      throw new HttpError(
        400,
        `Message text cannot exceed ${MAX_MESSAGE_TEXT_LENGTH} characters.`,
        'MESSAGE_TOO_LONG',
      );
    }
    if (attachmentIds.length > MAX_MESSAGE_ATTACHMENTS) {
      throw new HttpError(
        400,
        `A message cannot have more than ${MAX_MESSAGE_ATTACHMENTS} attachments.`,
        'TOO_MANY_ATTACHMENTS',
      );
    }

    const now = Date.now();
    const result = await withTransaction(async (client) => {
      // 1. Check sender membership
      const partCheck = await client.query<{ left_at: number | null }>(
        `SELECT left_at FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, senderId],
      );
      if (!partCheck.rows[0] || partCheck.rows[0].left_at) {
        throw new HttpError(403, 'You are not an active member of this conversation.', 'FORBIDDEN');
      }

      // 2. Check idempotency: if clientId provided, look for existing
      if (clientId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM zunari_messages_v2
           WHERE conversation_id = $1 AND sender_id = $2 AND client_id = $3`,
          [conversationId, senderId, clientId],
        );
        if (existing.rows[0]) {
          return { messageId: existing.rows[0].id, isDuplicate: true };
        }
      }

      // 3. Reply check
      if (payload.replyToMessageId) {
        const replyCheck = await client.query(
          'SELECT 1 FROM zunari_messages_v2 WHERE id = $1 AND conversation_id = $2',
          [payload.replyToMessageId, conversationId],
        );
        if (!replyCheck.rowCount) {
          throw new HttpError(404, 'Reply message not found.', 'REPLY_NOT_FOUND');
        }
      }

      // 4. Insert message. A concurrent retry with the same clientId can race
      // past the check above, so let the unique index resolve it atomically.
      const messageId = `msg_${randomUUID()}`;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO zunari_messages_v2
           (id, conversation_id, sender_id, client_id, text, reply_to_message_id, is_edited, is_deleted, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE, FALSE, $7)
         ON CONFLICT (conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [messageId, conversationId, senderId, clientId, text, payload.replyToMessageId || null, now],
      );
      if (!inserted.rows[0]) {
        const winner = await client.query<{ id: string }>(
          `SELECT id FROM zunari_messages_v2
           WHERE conversation_id = $1 AND sender_id = $2 AND client_id = $3`,
          [conversationId, senderId, clientId],
        );
        if (winner.rows[0]) {
          return { messageId: winner.rows[0].id, isDuplicate: true };
        }
        throw new Error('Failed to persist the message.');
      }

      // 5. Update conversation timestamp
      await client.query(
        'UPDATE zunari_conversations_v2 SET last_message_at = $1, updated_at = $1 WHERE id = $2',
        [now, conversationId],
      );

      // 6. Find all active recipients in conversation
      const recipientsRes = await client.query<{ user_id: string }>(
        `SELECT user_id FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND user_id <> $2 AND left_at IS NULL`,
        [conversationId, senderId],
      );

      // 7. Insert attachments & snapshot intended recipient deliveries
      if (attachmentIds.length > 0) {
        const ttlExpiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days TTL
        for (const assetId of attachmentIds) {
          const assetCheck = await client.query<{ owner_id: string }>(
            "SELECT owner_id FROM zunari_media_assets WHERE id = $1 AND status = 'ready'",
            [assetId],
          );
          if (!assetCheck.rows[0] || assetCheck.rows[0].owner_id !== senderId) {
            throw new HttpError(403, 'Invalid or unowned media asset.', 'INVALID_MEDIA_ASSET');
          }

          const attId = `att_${randomUUID()}`;
          await client.query(
            `INSERT INTO zunari_message_attachments
               (id, message_id, media_asset_id, status, expires_at, created_at)
             VALUES ($1, $2, $3, 'active', $4, $5)`,
            [attId, messageId, assetId, ttlExpiresAt, now],
          );

          // Snapshot delivery tracking per intended recipient
          for (const recipient of recipientsRes.rows) {
            await client.query(
              `INSERT INTO zunari_attachment_deliveries
                 (attachment_id, recipient_id, delivered_at, read_at, downloaded_at)
               VALUES ($1, $2, NULL, NULL, NULL)`,
              [attId, recipient.user_id],
            );
          }
        }
      }

      // 8. Auto-mark sender receipt
      await client.query(
        `INSERT INTO zunari_message_receipts (message_id, user_id, delivered_at, read_at)
         VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
        [messageId, senderId, now],
      );

      return { messageId, isDuplicate: false };
    });

    const [fullMsg] = await this.getMessages(conversationId, senderId, { limit: 1 });
    const targetMsg =
      fullMsg && fullMsg.id === result.messageId
        ? fullMsg
        : (await this.getMessageById(result.messageId, senderId))!;
    return { message: targetMsg, isDuplicate: result.isDuplicate };
  }

  public async getMessageById(messageId: string, currentUserId: string): Promise<MessageRecord | null> {
    const res = await query<{
      id: string;
      conversation_id: string;
      sender_id: string | null;
      client_id: string | null;
      text: string;
      reply_to_message_id: string | null;
      is_edited: boolean;
      edited_at: string | number | null;
      is_deleted: boolean;
      deleted_at: string | number | null;
      created_at: string | number;
      sender_username: string | null;
      sender_name: string | null;
      sender_avatar_url: string | null;
      sender_verified: boolean | null;
      sender_is_gold: boolean | null;
      reply_sender_id: string | null;
      reply_sender_username: string | null;
      reply_text: string | null;
    }>(
      `SELECT m.*,
              u.username AS sender_username, u.name AS sender_name, u.avatar_url AS sender_avatar_url,
              u.verified AS sender_verified, u.is_gold AS sender_is_gold,
              rm.sender_id AS reply_sender_id, ru.username AS reply_sender_username, rm.text AS reply_text
       FROM zunari_messages_v2 m
       JOIN zunari_conversation_participants p
         ON p.conversation_id = m.conversation_id AND p.user_id = $2
       LEFT JOIN zunari_users u ON u.public_id = m.sender_id
       LEFT JOIN zunari_messages_v2 rm ON rm.id = m.reply_to_message_id
       LEFT JOIN zunari_users ru ON ru.public_id = rm.sender_id
       WHERE m.id = $1 AND (p.left_at IS NULL OR m.created_at <= p.left_at)`,
      [messageId, currentUserId],
    );
    const r = res.rows[0];
    if (!r) return null;

    const attachmentsMap = await this.getAttachmentsForMessages([r.id]);
    const reactionsMap = await this.getReactionsForMessages([r.id]);
    const receiptsMap = await this.getReceiptsForMessages([r.id]);

    return {
      id: r.id,
      conversationId: r.conversation_id,
      senderId: r.sender_id,
      sender: r.sender_id && r.sender_username
        ? {
            id: r.sender_id,
            username: r.sender_username,
            name: r.sender_name || '',
            avatarUrl: r.sender_avatar_url || '',
            verified: Boolean(r.sender_verified),
            isGold: Boolean(r.sender_is_gold),
            followersCount: 0,
            followingCount: 0,
            joinedDate: '',
          }
        : undefined,
      clientId: r.client_id,
      text: r.is_deleted ? 'This message was deleted.' : r.text,
      replyToMessageId: r.reply_to_message_id,
      replyToMessage: r.reply_to_message_id
        ? {
            id: r.reply_to_message_id,
            senderId: r.reply_sender_id,
            senderUsername: r.reply_sender_username || undefined,
            text: r.reply_text || '',
          }
        : null,
      isEdited: Boolean(r.is_edited),
      editedAt: r.edited_at ? Number(r.edited_at) : null,
      isDeleted: Boolean(r.is_deleted),
      deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      createdAt: Number(r.created_at),
      attachments: attachmentsMap.get(r.id) || [],
      reactions: reactionsMap.get(r.id) || [],
      receipts: receiptsMap.get(r.id) || [],
    };
  }

  public async editMessage(
    conversationId: string,
    messageId: string,
    senderId: string,
    newText: string,
  ): Promise<MessageRecord> {
    const cleanText = newText.trim();
    if (!cleanText) {
      throw new HttpError(400, 'Message text cannot be empty.', 'EMPTY_MESSAGE');
    }
    const now = Date.now();
    await withTransaction(async (client) => {
      const membership = await client.query(
        `SELECT 1 FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [conversationId, senderId],
      );
      if (!membership.rowCount) {
        throw new HttpError(403, 'You are not an active member of this conversation.', 'FORBIDDEN');
      }

      const msg = await client.query<{ sender_id: string; is_deleted: boolean }>(
        'SELECT sender_id, is_deleted FROM zunari_messages_v2 WHERE id = $1 AND conversation_id = $2 FOR UPDATE',
        [messageId, conversationId],
      );
      if (!msg.rows[0]) throw new HttpError(404, 'Message not found.', 'MESSAGE_NOT_FOUND');
      if (msg.rows[0].sender_id !== senderId) {
        throw new HttpError(403, 'You can only edit your own messages.', 'FORBIDDEN');
      }
      if (msg.rows[0].is_deleted) {
        throw new HttpError(400, 'Deleted messages cannot be edited.', 'MESSAGE_DELETED');
      }

      await client.query(
        `UPDATE zunari_messages_v2
         SET text = $1, is_edited = TRUE, edited_at = $2
         WHERE id = $3`,
        [cleanText, now, messageId],
      );
    });

    const updated = await this.getMessageById(messageId, senderId);
    if (!updated) throw new Error('Failed to load edited message.');
    return updated;
  }

  public async deleteMessage(
    conversationId: string,
    messageId: string,
    actorId: string,
  ): Promise<{ success: boolean }> {
    const now = Date.now();
    await withTransaction(async (client) => {
      const msg = await client.query<{ sender_id: string; is_deleted: boolean }>(
        'SELECT sender_id, is_deleted FROM zunari_messages_v2 WHERE id = $1 AND conversation_id = $2 FOR UPDATE',
        [messageId, conversationId],
      );
      if (!msg.rows[0]) throw new HttpError(404, 'Message not found.', 'MESSAGE_NOT_FOUND');
      if (msg.rows[0].is_deleted) return;

      const actorPart = await client.query<{ role: string }>(
        `SELECT role FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [conversationId, actorId],
      );
      if (!actorPart.rows[0]) {
        throw new HttpError(403, 'You are not an active member of this conversation.', 'FORBIDDEN');
      }
      const isSender = msg.rows[0].sender_id === actorId;
      const isAdminOrOwner = actorPart.rows[0].role === 'admin' || actorPart.rows[0].role === 'owner';

      if (!isSender && !isAdminOrOwner) {
        throw new HttpError(403, 'You are not authorized to delete this message.', 'FORBIDDEN');
      }

      // Product policy: group messages can only be deleted once every active
      // recipient has received them, preventing silent retraction of unread text.
      const conversation = await client.query<{ type: string }>(
        'SELECT type FROM zunari_conversations_v2 WHERE id = $1',
        [conversationId],
      );
      if (conversation.rows[0]?.type === 'group') {
        const recipients = await client.query<{ user_id: string }>(
          `SELECT user_id FROM zunari_conversation_participants
           WHERE conversation_id = $1 AND user_id <> $2 AND left_at IS NULL`,
          [conversationId, msg.rows[0].sender_id],
        );
        const recipientIds = recipients.rows.map((row) => row.user_id);
        if (recipientIds.length > 0) {
          const delivered = await client.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM zunari_message_receipts
             WHERE message_id = $1 AND user_id = ANY($2::text[]) AND delivered_at IS NOT NULL`,
            [messageId, recipientIds],
          );
          if ((delivered.rows[0]?.count ?? 0) < recipientIds.length) {
            throw new HttpError(
              409,
              'This message can only be deleted after every recipient has received it.',
              'DELETE_TOO_EARLY',
            );
          }
        }
      }

      await client.query(
        `UPDATE zunari_messages_v2
         SET is_deleted = TRUE, deleted_at = $1, text = ''
         WHERE id = $2`,
        [now, messageId],
      );
      // Revoke access to attachments of a deleted message. Download URLs only
      // authorize attachments whose status is still 'active'.
      await client.query(
        `UPDATE zunari_message_attachments
         SET status = 'expired'
         WHERE message_id = $1 AND status = 'active'`,
        [messageId],
      );
    });
    return { success: true };
  }

  public async toggleReaction(
    conversationId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<{ added: boolean; emoji: string }> {
    const cleanEmoji = emoji.trim();
    if (!cleanEmoji || cleanEmoji.length > 16) {
      throw new HttpError(400, 'Invalid reaction emoji.', 'INVALID_EMOJI');
    }

    const now = Date.now();
    return withTransaction(async (client) => {
      // Validate access
      const part = await client.query(
        'SELECT 1 FROM zunari_conversation_participants WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL',
        [conversationId, userId],
      );
      if (!part.rowCount) throw new HttpError(403, 'Forbidden.', 'FORBIDDEN');

      const messageCheck = await client.query<{ is_deleted: boolean }>(
        'SELECT is_deleted FROM zunari_messages_v2 WHERE id = $1 AND conversation_id = $2',
        [messageId, conversationId],
      );
      if (!messageCheck.rows[0]) {
        throw new HttpError(404, 'Message not found.', 'MESSAGE_NOT_FOUND');
      }
      if (messageCheck.rows[0].is_deleted) {
        throw new HttpError(400, 'Deleted messages cannot be reacted to.', 'MESSAGE_DELETED');
      }

      const existing = await client.query(
        'DELETE FROM zunari_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING 1',
        [messageId, userId, cleanEmoji],
      );
      if (existing.rowCount) {
        return { added: false, emoji: cleanEmoji };
      }

      await client.query(
        `INSERT INTO zunari_message_reactions (message_id, user_id, emoji, created_at)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [messageId, userId, cleanEmoji, now],
      );
      return { added: true, emoji: cleanEmoji };
    });
  }

  public async recordReceipts(
    conversationId: string,
    userId: string,
    receiptType: 'delivered' | 'read',
    messageIds: string[],
  ): Promise<void> {
    if (messageIds.length === 0) return;
    const now = Date.now();

    await withTransaction(async (client) => {
      // Receipts must come from an active participant...
      const part = await client.query(
        `SELECT 1 FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [conversationId, userId],
      );
      if (!part.rowCount) return;

      // ...and may only reference messages that actually belong to the conversation.
      const uniqueIds = [...new Set(messageIds)].slice(0, MAX_RECEIPT_MESSAGE_IDS);
      const owned = await client.query<{ id: string; is_deleted: boolean }>(
        `SELECT id, is_deleted FROM zunari_messages_v2
         WHERE conversation_id = $1 AND id = ANY($2::text[])`,
        [conversationId, uniqueIds],
      );
      if (owned.rowCount !== uniqueIds.length) {
        throw new HttpError(
          400,
          'One or more receipts reference messages outside this conversation.',
          'INVALID_MESSAGE_ID',
        );
      }
      // Deleted messages no longer accept delivery/read state.
      const allowedIds = owned.rows.filter((row) => !row.is_deleted).map((row) => row.id);

      for (const msgId of allowedIds) {
        if (receiptType === 'delivered') {
          await client.query(
            `INSERT INTO zunari_message_receipts (message_id, user_id, delivered_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (message_id, user_id)
             DO UPDATE SET delivered_at = COALESCE(zunari_message_receipts.delivered_at, $3)`,
            [msgId, userId, now],
          );
          // Also update attachment delivery if applicable
          await client.query(
            `UPDATE zunari_attachment_deliveries ad
             SET delivered_at = COALESCE(ad.delivered_at, $1)
             FROM zunari_message_attachments ma
             WHERE ma.id = ad.attachment_id AND ma.message_id = $2 AND ad.recipient_id = $3`,
            [now, msgId, userId],
          );
        } else {
          await client.query(
            `INSERT INTO zunari_message_receipts (message_id, user_id, delivered_at, read_at)
             VALUES ($1, $2, $3, $3)
             ON CONFLICT (message_id, user_id)
             DO UPDATE SET delivered_at = COALESCE(zunari_message_receipts.delivered_at, $3),
                           read_at = COALESCE(zunari_message_receipts.read_at, $3)`,
            [msgId, userId, now],
          );
          await client.query(
            `UPDATE zunari_attachment_deliveries ad
             SET delivered_at = COALESCE(ad.delivered_at, $1),
                 read_at = COALESCE(ad.read_at, $1)
             FROM zunari_message_attachments ma
             WHERE ma.id = ad.attachment_id AND ma.message_id = $2 AND ad.recipient_id = $3`,
            [now, msgId, userId],
          );
        }
      }

      if (receiptType === 'read' && allowedIds.length > 0) {
        const latest = await client.query<{ id: string }>(
          `SELECT id FROM zunari_messages_v2
           WHERE conversation_id = $1 AND id = ANY($2::text[])
           ORDER BY created_at DESC LIMIT 1`,
          [conversationId, allowedIds],
        );
        if (latest.rows[0]) {
          await client.query(
            `UPDATE zunari_conversation_participants
             SET last_read_message_id = $1
             WHERE conversation_id = $2 AND user_id = $3`,
            [latest.rows[0].id, conversationId, userId],
          );
        }
      }
    });
  }

  private async getLastMessage(
    conversationId: string,
    currentUserId: string,
  ): Promise<MessageRecord | null> {
    const res = await query<{
      id: string;
      conversation_id: string;
      sender_id: string | null;
      client_id: string | null;
      text: string;
      reply_to_message_id: string | null;
      is_edited: boolean;
      edited_at: string | number | null;
      is_deleted: boolean;
      deleted_at: string | number | null;
      created_at: string | number;
    }>(
      `SELECT m.* FROM zunari_messages_v2 m
       JOIN zunari_conversation_participants p
         ON p.conversation_id = m.conversation_id AND p.user_id = $2
       WHERE m.conversation_id = $1
         AND (p.left_at IS NULL OR m.created_at <= p.left_at)
       ORDER BY m.created_at DESC LIMIT 1`,
      [conversationId, currentUserId],
    );
    const r = res.rows[0];
    if (!r) return null;

    return {
      id: r.id,
      conversationId: r.conversation_id,
      senderId: r.sender_id,
      clientId: r.client_id,
      text: r.is_deleted ? 'This message was deleted.' : r.text,
      replyToMessageId: r.reply_to_message_id,
      isEdited: Boolean(r.is_edited),
      editedAt: r.edited_at ? Number(r.edited_at) : null,
      isDeleted: Boolean(r.is_deleted),
      deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
      createdAt: Number(r.created_at),
      attachments: [],
      reactions: [],
      receipts: [],
    };
  }

  private async getUnreadCount(conversationId: string, currentUserId: string): Promise<number> {
    const res = await query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM zunari_messages_v2 m
       JOIN zunari_conversation_participants p
         ON p.conversation_id = m.conversation_id AND p.user_id = $2
       WHERE m.conversation_id = $1
         AND m.sender_id <> $2
         AND (p.left_at IS NULL OR m.created_at <= p.left_at)
         AND NOT EXISTS (
           SELECT 1 FROM zunari_message_receipts r
           WHERE r.message_id = m.id AND r.user_id = $2 AND r.read_at IS NOT NULL
         )`,
      [conversationId, currentUserId],
    );
    return Number(res.rows[0]?.count || 0);
  }

  private async getLastMessagesForConversations(
    conversationIds: string[],
    currentUserId: string,
  ): Promise<Map<string, MessageRecord | null>> {
    const map = new Map<string, MessageRecord | null>();
    if (conversationIds.length === 0) return Promise.resolve(map);

    const res = await query<{
      conversation_id: string;
      id: string;
      sender_id: string | null;
      client_id: string | null;
      text: string;
      reply_to_message_id: string | null;
      is_edited: boolean;
      edited_at: string | number | null;
      is_deleted: boolean;
      deleted_at: string | number | null;
      created_at: string | number;
    }>(
      `SELECT m.* FROM zunari_messages_v2 m
       JOIN zunari_conversation_participants p
         ON p.conversation_id = m.conversation_id AND p.user_id = $2
       WHERE m.conversation_id = ANY($1::text[])
         AND (p.left_at IS NULL OR m.created_at <= p.left_at)
       ORDER BY m.conversation_id, m.created_at DESC`,
      [conversationIds, currentUserId],
    );

    // Build map with the most recent message for each conversation
    const conversationMap = new Map<string, any>();
    for (const row of res.rows) {
      const existing = conversationMap.get(row.conversation_id);
      if (!existing || new Date(row.created_at).getTime() > new Date(existing.created_at).getTime()) {
        conversationMap.set(row.conversation_id, row);
      }
    }

    // Convert rows to MessageRecord
    for (const [conversationId, row] of conversationMap.entries()) {
      const message: MessageRecord = {
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        clientId: row.client_id,
        text: row.is_deleted ? 'This message was deleted.' : row.text,
        replyToMessageId: row.reply_to_message_id,
        isEdited: Boolean(row.is_edited),
        editedAt: row.edited_at ? Number(row.edited_at) : null,
        isDeleted: Boolean(row.is_deleted),
        deletedAt: row.deleted_at ? Number(row.deleted_at) : null,
        createdAt: Number(row.created_at),
        attachments: [],
        reactions: [],
        receipts: [],
      };
      map.set(conversationId, message);
    }

    return Promise.resolve(map);
  }

  private async getUnreadCountsForConversations(
    conversationIds: string[],
    currentUserId: string,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (conversationIds.length === 0) return Promise.resolve(map);

    const res = await query<{
      conversation_id: string;
      count: string;
    }>(
      `SELECT m.conversation_id, count(*)::text AS count
       FROM zunari_messages_v2 m
       JOIN zunari_conversation_participants p
         ON p.conversation_id = m.conversation_id AND p.user_id = $2
       WHERE m.conversation_id = ANY($1::text[])
         AND m.sender_id <> $2
         AND (p.left_at IS NULL OR m.created_at <= p.left_at)
         AND NOT EXISTS (
           SELECT 1 FROM zunari_message_receipts r
           WHERE r.message_id = m.id AND r.user_id = $2 AND r.read_at IS NOT NULL
         )
       GROUP BY m.conversation_id`,
      [conversationIds, currentUserId],
    );

    for (const row of res.rows) {
      map.set(row.conversation_id, Number(row.count || 0));
    }

    return Promise.resolve(map);
  }

  private async getAttachmentsForMessages(
    messageIds: string[],
  ): Promise<Map<string, MessageAttachmentRecord[]>> {
    const map = new Map<string, MessageAttachmentRecord[]>();
    if (messageIds.length === 0) return map;

    const res = await query<{
      id: string;
      message_id: string;
      media_asset_id: string;
      filename: string;
      mime_type: string;
      byte_size: string | number;
      status: 'active' | 'expired' | 'cleaned';
      expires_at: string | number;
      created_at: string | number;
    }>(
      `SELECT ma.id, ma.message_id, ma.media_asset_id, ma.status, ma.expires_at, ma.created_at,
              asset.filename, asset.mime_type, asset.byte_size
       FROM zunari_message_attachments ma
       JOIN zunari_media_assets asset ON asset.id = ma.media_asset_id
       JOIN zunari_messages_v2 msg ON msg.id = ma.message_id
       WHERE ma.message_id = ANY($1::text[]) AND msg.is_deleted = FALSE`,
      [messageIds],
    );

    for (const r of res.rows) {
      const list = map.get(r.message_id) || [];
      list.push({
        id: r.id,
        messageId: r.message_id,
        mediaAssetId: r.media_asset_id,
        filename: r.filename,
        mimeType: r.mime_type,
        byteSize: Number(r.byte_size),
        status: r.status,
        expiresAt: Number(r.expires_at),
        createdAt: Number(r.created_at),
        url: `/api/files/${r.media_asset_id}`,
      });
      map.set(r.message_id, list);
    }
    return map;
  }

  private async getReactionsForMessages(
    messageIds: string[],
  ): Promise<Map<string, MessageReactionRecord[]>> {
    const map = new Map<string, MessageReactionRecord[]>();
    if (messageIds.length === 0) return map;

    const res = await query<{
      message_id: string;
      emoji: string;
      user_id: string;
      username: string;
      created_at: string | number;
    }>(
      `SELECT mr.message_id, mr.emoji, mr.user_id, mr.created_at, u.username
       FROM zunari_message_reactions mr
       JOIN zunari_users u ON u.public_id = mr.user_id
       WHERE mr.message_id = ANY($1::text[])
       ORDER BY mr.created_at ASC`,
      [messageIds],
    );

    for (const r of res.rows) {
      const list = map.get(r.message_id) || [];
      list.push({
        emoji: r.emoji,
        userId: r.user_id,
        username: r.username,
        createdAt: Number(r.created_at),
      });
      map.set(r.message_id, list);
    }
    return map;
  }

  private async getReceiptsForMessages(
    messageIds: string[],
  ): Promise<Map<string, MessageReceiptRecord[]>> {
    const map = new Map<string, MessageReceiptRecord[]>();
    if (messageIds.length === 0) return map;

    const res = await query<{
      message_id: string;
      user_id: string;
      delivered_at: string | number | null;
      read_at: string | number | null;
    }>(
      `SELECT message_id, user_id, delivered_at, read_at
       FROM zunari_message_receipts
       WHERE message_id = ANY($1::text[])`,
      [messageIds],
    );

    for (const r of res.rows) {
      const list = map.get(r.message_id) || [];
      list.push({
        userId: r.user_id,
        deliveredAt: r.delivered_at ? Number(r.delivered_at) : null,
        readAt: r.read_at ? Number(r.read_at) : null,
      });
      map.set(r.message_id, list);
    }
    return map;
  }
}

export const messagingRepo = new MessagingRepository();
