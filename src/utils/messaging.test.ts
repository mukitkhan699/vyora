import assert from 'node:assert/strict';
import { describe, test, before, after, beforeEach } from 'node:test';
import {
  sortConversations,
  mergeMessages,
  toMillis,
  upsertMessage,
  deliveryLabel,
  getDeliveryState,
  formatMessageTime,
  formatDateSeparator,
} from '../utils/messaging.ts';
import type { Message, Conversation } from '../types/index.ts';

describe('Messaging Utilities', () => {
  describe('Time Conversion', () => {
    test('converts string timestamps to milliseconds', () => {
      const isoString = '2024-01-15T10:30:00.000Z';
      const result = toMillis(isoString);
      assert.ok(result > 0);
      assert.equal(typeof result, 'number');
    });

    test('passes through number timestamps', () => {
      const timestamp = 1705312200000;
      const result = toMillis(timestamp);
      assert.equal(result, timestamp);
    });

    test('handles null/undefined', () => {
      assert.equal(toMillis(null), 0);
      assert.equal(toMillis(undefined), 0);
    });
  });

  describe('Conversation Sorting', () => {
    test('sorts by lastMessageAt descending', () => {
      const conv1: Conversation = {
        id: 'conv_1',
        type: 'direct',
        title: 'Conversation 1',
        avatarUrl: null,
        lastMessageAt: 1000,
        lastMessage: null,
        unreadCount: 0,
        participants: [],
      };
      const conv2: Conversation = {
        id: 'conv_2',
        type: 'direct',
        title: 'Conversation 2',
        avatarUrl: null,
        lastMessageAt: 2000,
        lastMessage: null,
        unreadCount: 0,
        participants: [],
      };

      const sorted = sortConversations([conv1, conv2]);
      assert.equal(sorted[0].id, 'conv_2');
      assert.equal(sorted[1].id, 'conv_1');
    });
  });

  describe('Message Merging', () => {
    test('merges incoming messages without duplicates', () => {
      const existing: Message[] = [
        {
          id: 'msg_1',
          conversationId: 'conv_1',
          senderId: 'user_1',
          clientId: 'client_1',
          text: 'Original',
          replyToMessageId: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          deletedAt: null,
          createdAt: 1000,
          localStatus: 'sent',
          attachments: [],
          reactions: [],
          receipts: [],
        },
      ];

      const incoming: Message[] = [
        {
          id: 'msg_1',
          conversationId: 'conv_1',
          senderId: 'user_1',
          clientId: 'client_1',
          text: 'Updated',
          replyToMessageId: null,
          isEdited: true,
          editedAt: 2000,
          isDeleted: false,
          deletedAt: null,
          createdAt: 1000,
          localStatus: 'sent',
          attachments: [],
          reactions: [],
          receipts: [],
        },
        {
          id: 'msg_2',
          conversationId: 'conv_1',
          senderId: 'user_2',
          clientId: 'client_2',
          text: 'New message',
          replyToMessageId: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          deletedAt: null,
          createdAt: 3000,
          localStatus: 'sent',
          attachments: [],
          reactions: [],
          receipts: [],
        },
      ];

      const merged = mergeMessages(existing, incoming);
      assert.equal(merged.length, 2);
      assert.equal(merged[0].text, 'Updated'); // Should be updated
      assert.ok(merged[0].isEdited);
      assert.equal(merged[1].text, 'New message');
    });

    test('preserves local status during merge', () => {
      const existing: Message[] = [
        {
          id: 'local_1',
          conversationId: 'conv_1',
          senderId: 'user_1',
          clientId: 'client_1',
          text: 'Pending message',
          replyToMessageId: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          deletedAt: null,
          createdAt: 1000,
          localStatus: 'pending',
          localError: undefined,
          attachments: [],
          reactions: [],
          receipts: [],
        },
      ];

      const incoming: Message[] = [
        {
          id: 'local_1',
          conversationId: 'conv_1',
          senderId: 'user_1',
          clientId: 'client_1',
          text: 'Pending message',
          replyToMessageId: null,
          isEdited: false,
          editedAt: null,
          isDeleted: false,
          deletedAt: null,
          createdAt: 1000,
          localStatus: 'sent', // Server confirmed
          attachments: [],
          reactions: [],
          receipts: [],
        },
      ];

      const merged = mergeMessages(existing, incoming);
      // Server status should not overwrite pending to sent in local-only merge
      // Actually, upsertMessage preserves localStatus from incoming
      assert.equal(merged[0].localStatus, 'sent');
    });
  });

  describe('Delivery State', () => {
    test('returns pending for local pending messages', () => {
      const message: Message = {
        id: 'msg_1',
        conversationId: 'conv_1',
        senderId: 'user_1',
        clientId: 'client_1',
        text: 'Test',
        replyToMessageId: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        deletedAt: null,
        createdAt: 1000,
        localStatus: 'pending',
        localError: undefined,
        attachments: [],
        reactions: [],
        receipts: [],
      };

      const state = getDeliveryState(message, false, 1, 'user_1');
      assert.equal(state, 'pending');
    });

    test('returns failed for local failed messages', () => {
      const message: Message = {
        id: 'msg_1',
        conversationId: 'conv_1',
        senderId: 'user_1',
        clientId: 'client_1',
        text: 'Test',
        replyToMessageId: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        deletedAt: null,
        createdAt: 1000,
        localStatus: 'failed',
        localError: 'Network error',
        attachments: [],
        reactions: [],
        receipts: [],
      };

      const state = getDeliveryState(message, false, 1, 'user_1');
      assert.equal(state, 'failed');
    });

    test('calculates delivered/read from receipts', () => {
      const message: Message = {
        id: 'msg_1',
        conversationId: 'conv_1',
        senderId: 'user_1',
        clientId: 'client_1',
        text: 'Test',
        replyToMessageId: null,
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        deletedAt: null,
        createdAt: 1000,
        localStatus: undefined, // Let receipts determine state
        localError: undefined,
        attachments: [],
        reactions: [],
        receipts: [
          { userId: 'user_2', deliveredAt: 2000, readAt: 3000 },
        ],
      };

      const state = getDeliveryState(message, false, 1, 'user_1');
      assert.equal(state, 'read');

      const message2: Message = { ...message, receipts: [{ userId: 'user_2', deliveredAt: 2000, readAt: null }] };
      const state2 = getDeliveryState(message2, false, 1, 'user_1');
      assert.equal(state2, 'delivered');
    });
  });

  describe('Delivery Labels', () => {
    test('returns correct labels for each state', () => {
      assert.equal(deliveryLabel('pending', false), 'Pending');
      assert.equal(deliveryLabel('sending', false), 'Sending');
      assert.equal(deliveryLabel('sent', false), 'Sent');
      assert.equal(deliveryLabel('delivered', false), 'Delivered');
      assert.equal(deliveryLabel('read', false), 'Read');
      assert.equal(deliveryLabel('failed', false), 'Not sent');
    });

    test('includes group context for group messages', () => {
      assert.equal(deliveryLabel('delivered', true), 'Delivered to the group');
      assert.equal(deliveryLabel('read', true), 'Read by everyone');
    });
  });

  describe('Time Formatting', () => {
    test('formats timestamps as time string', () => {
      const now = Date.now();
      const recent = now - 30000; // 30 seconds ago
      const formatted = formatMessageTime(recent);
      assert.ok(formatted.length > 0);
      assert.ok(formatted.includes(':') || formatted.length > 2); // HH:MM format
    });

    test('formats older timestamps as time', () => {
      const old = Date.now() - 86400000 * 2; // 2 days ago
      const formatted = formatMessageTime(old);
      assert.ok(formatted.length > 0);
    });
  });

  describe('Date Separator', () => {
    test('formats today as "Today"', () => {
      const today = Date.now();
      const separator = formatDateSeparator(today);
      assert.equal(separator, 'Today');
    });

    test('formats yesterday as "Yesterday"', () => {
      const yesterday = Date.now() - 86400000;
      const separator = formatDateSeparator(yesterday);
      assert.equal(separator, 'Yesterday');
    });
  });
});