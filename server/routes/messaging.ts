import type { IncomingMessage, ServerResponse } from 'node:http';
import { messagingRepo } from '../db/messaging.ts';
import {
  publishConversationMessageDelete,
  publishReceipt,
  publishReaction,
} from '../realtime-events.ts';
import { HttpError } from '../errors.ts';
import { evictUserFromConversation } from '../realtime.ts';

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string, code?: string): void {
  sendJson(res, status, { error: message, ...(code && { code }) });
}

export async function handleMessagingRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  currentUserId: string | null,
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>,
  requireSessionWithCsrf: (req: IncomingMessage) => Promise<unknown>,
): Promise<boolean> {
  const pathname = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  // 1. List conversations: GET /api/conversations
  if (pathname === '/api/conversations' && method === 'GET') {
    if (!currentUserId) {
      sendError(res, 401, 'Authentication required.');
      return true;
    }
    const conversations = await messagingRepo.listConversations(currentUserId);
    sendJson(res, 200, { conversations });
    return true;
  }

  // 2. Create conversation: POST /api/conversations (direct or group)
  if (pathname === '/api/conversations' && method === 'POST') {
    if (!currentUserId) {
      sendError(res, 401, 'Authentication required.');
      return true;
    }
    await requireSessionWithCsrf(req);
    const body = await readJson(req);
    const type = body.type === 'group' ? 'group' : 'direct';

    if (type === 'direct') {
      const recipientId = typeof body.recipientId === 'string' ? body.recipientId.trim() : '';
      if (!recipientId) {
        sendError(res, 400, 'recipientId is required for direct conversations.', 'INVALID_PAYLOAD');
        return true;
      }
      const conv = await messagingRepo.getOrCreateDirectConversation(currentUserId, recipientId);
      sendJson(res, 201, { conversation: conv });
      return true;
    } else {
      const title = typeof body.title === 'string' ? body.title : '';
      const participantIds = Array.isArray(body.participantIds) ? body.participantIds.map(String) : [];
      const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl : undefined;

      const conv = await messagingRepo.createGroupConversation(currentUserId, title, participantIds, avatarUrl);
      sendJson(res, 201, { conversation: conv });
      return true;
    }
  }

  // 3. Conversation detail, update, messages: /api/conversations/:id...
  const convMatch = /^\/api\/conversations\/([^/]+)$/.exec(pathname);
  if (convMatch) {
    const conversationId = convMatch[1];
    if (method === 'GET') {
      if (!currentUserId) {
        sendError(res, 401, 'Authentication required.');
        return true;
      }
      const conv = await messagingRepo.getConversationById(conversationId, currentUserId);
      if (!conv) {
        sendError(res, 404, 'Conversation not found.', 'NOT_FOUND');
        return true;
      }
      sendJson(res, 200, { conversation: conv });
      return true;
    }

    if (method === 'PATCH') {
      if (!currentUserId) {
        sendError(res, 401, 'Authentication required.');
        return true;
      }
      await requireSessionWithCsrf(req);
      const body = await readJson(req);
      const updated = await messagingRepo.updateGroupConversation(conversationId, currentUserId, {
        title: typeof body.title === 'string' ? body.title : undefined,
        avatarUrl: typeof body.avatarUrl === 'string' ? body.avatarUrl : undefined,
      });
      sendJson(res, 200, { conversation: updated });
      return true;
    }
  }

  // 4. Conversation participants: /api/conversations/:id/participants
  const participantsMatch = /^\/api\/conversations\/([^/]+)\/participants$/.exec(pathname);
  if (participantsMatch && method === 'POST') {
    if (!currentUserId) {
      sendError(res, 401, 'Authentication required.');
      return true;
    }
    await requireSessionWithCsrf(req);
    const conversationId = participantsMatch[1];
    const body = await readJson(req);
    const userIds = Array.isArray(body.userIds) ? body.userIds.map(String) : [];
    if (userIds.length === 0) {
      sendError(res, 400, 'userIds array is required.', 'INVALID_PAYLOAD');
      return true;
    }
    const participants = await messagingRepo.addGroupParticipants(conversationId, currentUserId, userIds);
    sendJson(res, 200, { participants });
    return true;
  }

  const removeParticipantMatch = /^\/api\/conversations\/([^/]+)\/participants\/([^/]+)$/.exec(pathname);
  if (removeParticipantMatch && method === 'DELETE') {
    if (!currentUserId) {
      sendError(res, 401, 'Authentication required.');
      return true;
    }
    await requireSessionWithCsrf(req);
    const [, conversationId, targetUserId] = removeParticipantMatch;
    const result = await messagingRepo.removeGroupParticipant(conversationId, currentUserId, targetUserId);
    // Revoke live access immediately instead of waiting for a reconnect.
    evictUserFromConversation(targetUserId, conversationId);
    sendJson(res, 200, result);
    return true;
  }

  // 5. Messages list & send: /api/conversations/:id/messages
  const convMessagesMatch = /^\/api\/conversations\/([^/]+)\/messages$/.exec(pathname);
  if (convMessagesMatch) {
    const conversationId = convMessagesMatch[1];
    if (method === 'GET') {
      if (!currentUserId) {
        sendError(res, 401, 'Authentication required.');
        return true;
      }
      const before = url.searchParams.get('before') || undefined;
      const limit = Number(url.searchParams.get('limit')) || 50;
      const messages = await messagingRepo.getMessages(conversationId, currentUserId, { before, limit });
      sendJson(res, 200, { messages });
      return true;
    }

    if (method === 'POST') {
      if (!currentUserId) {
        sendError(res, 401, 'Authentication required.');
        return true;
      }
      await requireSessionWithCsrf(req);
      const body = await readJson(req);
      const { message, isDuplicate } = await messagingRepo.sendMessage(
        currentUserId,
        conversationId,
        {
          text: typeof body.text === 'string' ? body.text : undefined,
          clientId: typeof body.clientId === 'string' ? body.clientId : undefined,
          replyToMessageId:
            typeof body.replyToMessageId === 'string' ? body.replyToMessageId : undefined,
          attachmentAssetIds: Array.isArray(body.attachmentAssetIds)
            ? body.attachmentAssetIds.map(String)
            : undefined,
        },
      );

      sendJson(res, isDuplicate ? 200 : 201, { message, duplicate: isDuplicate });
      return true;
    }
  }

  // 6. Message edit & delete: /api/conversations/:id/messages/:messageId
  const singleMsgMatch = /^\/api\/conversations\/([^/]+)\/messages\/([^/]+)$/.exec(pathname);
  if (singleMsgMatch) {
    const [, conversationId, messageId] = singleMsgMatch;
    if (method === 'PATCH') {
      if (!currentUserId) {
        sendError(res, 401, 'Authentication required.');
        return true;
      }
      await requireSessionWithCsrf(req);
      const body = await readJson(req);
      const text = typeof body.text === 'string' ? body.text : '';
      const updated = await messagingRepo.editMessage(conversationId, messageId, currentUserId, text);

      sendJson(res, 200, { message: updated });
      return true;
    }

    if (method === 'DELETE') {
      if (!currentUserId) {
        sendError(res, 401, 'Authentication required.');
        return true;
      }
      await requireSessionWithCsrf(req);
      const result = await messagingRepo.deleteMessage(conversationId, messageId, currentUserId);

      const participants = await messagingRepo.getParticipants(conversationId);
      publishConversationMessageDelete({
        conversationId,
        messageId,
        recipientIds: participants.filter((p) => !p.leftAt).map((p) => p.userId),
      });

      sendJson(res, 200, result);
      return true;
    }
  }

  // 7. Reactions: POST /api/conversations/:id/messages/:messageId/reactions
  const reactionMatch = /^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/reactions$/.exec(pathname);
  if (reactionMatch && method === 'POST') {
    if (!currentUserId) {
      sendError(res, 401, 'Authentication required.');
      return true;
    }
    await requireSessionWithCsrf(req);
    const [, conversationId, messageId] = reactionMatch;
    const body = await readJson(req);
    const emoji = typeof body.emoji === 'string' ? body.emoji : '';
    const result = await messagingRepo.toggleReaction(conversationId, messageId, currentUserId, emoji);

    const participants = await messagingRepo.getParticipants(conversationId);
    publishReaction({
      conversationId,
      messageId,
      userId: currentUserId,
      username: '',
      emoji: result.emoji,
      added: result.added,
      recipientIds: participants.filter((p) => !p.leftAt).map((p) => p.userId),
    });

    sendJson(res, 200, result);
    return true;
  }

  // 8. Receipts: POST /api/conversations/:id/receipts
  const receiptsMatch = /^\/api\/conversations\/([^/]+)\/receipts$/.exec(pathname);
  if (receiptsMatch && method === 'POST') {
    if (!currentUserId) {
      sendError(res, 401, 'Authentication required.');
      return true;
    }
    await requireSessionWithCsrf(req);
    const conversationId = receiptsMatch[1];
    const body = await readJson(req);
    const receiptType = body.type === 'delivered' ? 'delivered' : 'read';
    const messageIds = Array.isArray(body.messageIds) ? body.messageIds.map(String) : [];

    await messagingRepo.recordReceipts(conversationId, currentUserId, receiptType, messageIds);

    const participants = await messagingRepo.getParticipants(conversationId);
    publishReceipt({
      conversationId,
      userId: currentUserId,
      messageIds,
      receiptType,
      recipientIds: participants.filter((p) => !p.leftAt).map((p) => p.userId),
    });

    sendJson(res, 200, { success: true });
    return true;
  }

  return false;
}
