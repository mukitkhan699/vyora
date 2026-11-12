import { EventEmitter } from 'node:events';
import type { Notification } from '../src/types/index.ts';
import type { MessageRecord, ConversationSummary } from './db/messaging.ts';

const events = new EventEmitter();

export interface SessionRevocation {
  tokenHash?: string;
  userId?: number;
}

export interface RealtimeMessageEvent {
  conversationId: string;
  message: MessageRecord;
  recipientIds: string[];
}

export interface RealtimeTypingEvent {
  conversationId: string;
  userId: string;
  username: string;
  isTyping: boolean;
}

export interface RealtimeReceiptEvent {
  conversationId: string;
  userId: string;
  messageIds: string[];
  receiptType: 'delivered' | 'read';
  recipientIds?: string[];
}

export interface RealtimeReactionEvent {
  conversationId: string;
  messageId: string;
  userId: string;
  username: string;
  emoji: string;
  added: boolean;
  recipientIds?: string[];
}

export interface RealtimeCallEvent {
  callId: string;
  conversationId: string;
  roomName: string;
  type: 'voice' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'rejected' | 'missed';
  caller: { id: string; username: string; name: string; avatarUrl: string };
  participants: Array<{ id: string; username: string; name: string; avatarUrl: string }>;
  event: 'incoming' | 'answered' | 'rejected' | 'ended' | 'participant-joined' | 'participant-left';
  recipientIds: string[];
  joinedUserId?: string;
  leftUserId?: string;
}

export function publishMessage(message: unknown): void {
  events.emit('message', message);
}

export function publishConversationMessage(event: RealtimeMessageEvent): void {
  events.emit('conv:message', event);
}

export function publishConversationMessageEdit(event: {
  conversationId: string;
  message: MessageRecord;
  recipientIds: string[];
}): void {
  events.emit('conv:message-edit', event);
}

export function publishConversationMessageDelete(event: {
  conversationId: string;
  messageId: string;
  recipientIds: string[];
}): void {
  events.emit('conv:message-delete', event);
}

export function publishTyping(event: RealtimeTypingEvent): void {
  events.emit('conv:typing', event);
}

export function publishReceipt(event: RealtimeReceiptEvent): void {
  events.emit('conv:receipt', event);
}

export function publishReaction(event: RealtimeReactionEvent): void {
  events.emit('conv:reaction', event);
}

export function publishCallEvent(event: RealtimeCallEvent): void {
  events.emit('call:event', event);
}

export function publishSessionRevocation(revocation: SessionRevocation): void {
  events.emit('session-revocation', revocation);
}

export function publishNotification(
  recipientId: string,
  notification: Notification,
): void {
  events.emit('notification', { recipientId, notification });
}

export function onMessage(
  listener: (message: unknown) => void,
): () => void {
  events.on('message', listener);
  return () => events.off('message', listener);
}

export function onConversationMessage(
  listener: (event: RealtimeMessageEvent) => void,
): () => void {
  events.on('conv:message', listener);
  return () => events.off('conv:message', listener);
}

export function onConversationMessageEdit(
  listener: (event: { conversationId: string; message: MessageRecord; recipientIds: string[] }) => void,
): () => void {
  events.on('conv:message-edit', listener);
  return () => events.off('conv:message-edit', listener);
}

export function onConversationMessageDelete(
  listener: (event: { conversationId: string; messageId: string; recipientIds: string[] }) => void,
): () => void {
  events.on('conv:message-delete', listener);
  return () => events.off('conv:message-delete', listener);
}

export function onTyping(
  listener: (event: RealtimeTypingEvent) => void,
): () => void {
  events.on('conv:typing', listener);
  return () => events.off('conv:typing', listener);
}

export function onReceipt(
  listener: (event: RealtimeReceiptEvent) => void,
): () => void {
  events.on('conv:receipt', listener);
  return () => events.off('conv:receipt', listener);
}

export function onReaction(
  listener: (event: RealtimeReactionEvent) => void,
): () => void {
  events.on('conv:reaction', listener);
  return () => events.off('conv:reaction', listener);
}

export function onCallEvent(
  listener: (event: RealtimeCallEvent) => void,
): () => void {
  events.on('call:event', listener);
  return () => events.off('call:event', listener);
}

export function onNotification(
  listener: (event: { recipientId: string; notification: Notification }) => void,
): () => void {
  events.on('notification', listener);
  return () => events.off('notification', listener);
}

export function onSessionRevocation(
  listener: (revocation: SessionRevocation) => void,
): () => void {
  events.on('session-revocation', listener);
  return () => events.off('session-revocation', listener);
}
