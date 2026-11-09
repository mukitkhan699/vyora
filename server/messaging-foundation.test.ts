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
  onConversationMessage,
  onConversationMessageEdit,
  onConversationMessageDelete,
  onTyping,
  onReceipt,
  onReaction,
  onCallEvent,
} from './realtime-events.ts';
import { isUserOnline } from './realtime.ts';

describe('Real-time Messaging Foundation & Events', () => {
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
    };

    publishConversationMessage(mockEvent);
    unsubscribe();

    assert.ok(received);
    assert.equal(received.conversationId, 'conv_123');
    assert.equal(received.message.text, 'Hello world');
    assert.deepEqual(received.recipientIds, ['user_b']);
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
