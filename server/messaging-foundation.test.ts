import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  publishConversationMessage,
  publishConversationMessageEdit,
  publishConversationMessageDelete,
  publishTyping,
  publishReceipt,
  publishReaction,
  publishCallEvent,
  publishNotification,
  onConversationMessage,
  onConversationMessageEdit,
  onConversationMessageDelete,
  onTyping,
  onReceipt,
  onReaction,
  onCallEvent,
  onNotification,
} from './realtime-events.ts';
import type { MessageRecord } from './db/messaging.ts';
import {
  emitConversationMessageToUsers,
  isUserOnline,
} from './realtime.ts';

describe('Real-time Messaging Foundation & Events', () => {
  test('notification subscribers remain wired', () => {
    let received: { recipientId: string; notification: unknown } | undefined;
    const unsubscribe = onNotification((event) => {
      received = event;
    });

    const notification = {
      id: 'notification-1',
      type: 'follow' as const,
      sender: {
        id: 'sender',
        username: 'sender',
        name: 'Sender',
        avatarUrl: '',
        bannerUrl: '',
        bio: '',
        location: '',
        website: '',
        joinedDate: '',
        verified: false,
        isGold: false,
        followersCount: 0,
        followingCount: 0,
      },
      createdAt: '2026-11-13T00:00:00.000Z',
      read: false,
    };
    publishNotification('recipient', notification);
    unsubscribe();

    assert.deepEqual(received, { recipientId: 'recipient', notification });
  });

  test('dispatches conversation message events to subscribers', async () => {
    let received: any = null;
    const unsubscribe = onConversationMessage((event) => {
      received = event;
    });

    const mockEvent = {
      conversationId: 'conv_123',
      message: {
        id: 'msg_1',
        conversationId: 'conv_123',
        senderId: 'user_a',
        clientId: 'client_token_1',
        text: 'Hello world',
        replyToMessageId: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        deletedAt: null,
        createdAt: Date.now(),
        attachments: [],
        reactions: [],
        receipts: [],
      },
      recipientIds: ['user_b'],
      eventId: '00000000-0000-4000-8000-000000000001',
    };

    publishConversationMessage(mockEvent);
    unsubscribe();

    assert.ok(received);
    assert.equal(received.conversationId, 'conv_123');
    assert.equal(received.message.text, 'Hello world');
    assert.deepEqual(received.recipientIds, ['user_b']);
    assert.equal(received.eventId, '00000000-0000-4000-8000-000000000001');
  });

  test('dispatches edited message events with stable outbox metadata', () => {
    let received: unknown;
    const unsubscribe = onConversationMessageEdit((event) => {
      received = event;
    });
    const event = {
      conversationId: 'conv_123',
      message: {
        id: 'msg_1',
        conversationId: 'conv_123',
        senderId: 'user_a',
        clientId: null,
        text: 'edited',
        replyToMessageId: null,
        replyToMessage: null,
        isEdited: true,
        editedAt: 123,
        isDeleted: false,
        deletedAt: null,
        createdAt: 1,
        attachments: [],
        reactions: [],
        receipts: [],
      } satisfies MessageRecord,
      recipientIds: ['user_b'],
      eventId: 'stable-edit-event',
    };

    assert.equal(publishConversationMessageEdit(event), true);
    unsubscribe();
    assert.deepEqual(received, event);
  });

  test('conversation messages are sent only to authorized user rooms with backward-compatible metadata', () => {
    const message = {
      id: 'msg_1',
      conversationId: 'conv_123',
      senderId: 'user_a',
      clientId: null,
      text: 'Hello world',
      replyToMessageId: null,
      replyToMessage: null,
      isEdited: false,
      editedAt: null,
      isDeleted: false,
      deletedAt: null,
      createdAt: 1,
      attachments: [],
      reactions: [],
      receipts: [],
    };
    const deliveries: Array<{ userId: string; eventName: string; args: unknown[] }> = [];

    emitConversationMessageToUsers(
      {
        conversationId: 'conv_123',
        message,
        recipientIds: ['user_a', 'user_c'],
        eventId: 'stable-event-id',
      },
      (userId, eventName, ...args) => deliveries.push({ userId, eventName, args }),
    );

    assert.deepEqual(deliveries.map(({ userId, eventName }) => [userId, eventName]), [
      ['user_a', 'conversation:message'],
      ['user_a', 'conversation:message-notification'],
      ['user_c', 'conversation:message'],
      ['user_c', 'conversation:message-notification'],
    ]);
    assert.deepEqual(deliveries[0].args, [message, { eventId: 'stable-event-id' }]);
    assert.deepEqual(deliveries[1].args, [
      { conversationId: 'conv_123', message },
      { eventId: 'stable-event-id' },
    ]);
  });

  test('dispatches typing and receipt events', async () => {
    let typingReceived: any = null;
    let receiptReceived: any = null;

    const unsubTyping = onTyping((event) => {
      typingReceived = event;
    });
    const unsubReceipt = onReceipt((event) => {
      receiptReceived = event;
    });

    publishTyping({
      conversationId: 'conv_123',
      userId: 'user_a',
      username: 'alice',
      isTyping: true,
    });

    publishReceipt({
      conversationId: 'conv_123',
      userId: 'user_b',
      messageIds: ['msg_1'],
      receiptType: 'read',
    });

    unsubTyping();
    unsubReceipt();

    assert.ok(typingReceived);
    assert.equal(typingReceived.isTyping, true);
    assert.equal(typingReceived.username, 'alice');

    assert.ok(receiptReceived);
    assert.equal(receiptReceived.receiptType, 'read');
    assert.deepEqual(receiptReceived.messageIds, ['msg_1']);
  });

  test('dispatches reaction and call events', async () => {
    let reactionReceived: any = null;
    let callReceived: any = null;

    const unsubReaction = onReaction((e) => (reactionReceived = e));
    const unsubCall = onCallEvent((e) => (callReceived = e));

    publishReaction({
      conversationId: 'conv_123',
      messageId: 'msg_1',
      userId: 'user_b',
      username: 'bob',
      emoji: '👍',
      added: true,
    });

    publishCallEvent({
      callId: 'call_1',
      conversationId: 'conv_123',
      roomName: 'room_call_1',
      type: 'video',
      status: 'ringing',
      caller: { id: 'user_a', username: 'alice', name: 'Alice', avatarUrl: '' },
      participants: [],
      event: 'incoming',
      recipientIds: ['user_b'],
    });

    unsubReaction();
    unsubCall();

    assert.ok(reactionReceived);
    assert.equal(reactionReceived.emoji, '👍');
    assert.equal(reactionReceived.added, true);

    assert.ok(callReceived);
    assert.equal(callReceived.callId, 'call_1');
    assert.equal(callReceived.type, 'video');
    assert.equal(callReceived.event, 'incoming');
  });

  test('presence helper returns false when no active sockets for user', () => {
    assert.equal(isUserOnline('unknown_user_123'), false);
  });
});
