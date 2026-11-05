import { EventEmitter } from 'node:events';
import type { Message, Notification } from '../src/types/index.ts';

const events = new EventEmitter();

export interface SessionRevocation {
  tokenHash?: string;
  userId?: number;
}

export function publishMessage(message: Message): void {
  events.emit('message', message);
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
  listener: (message: Message) => void,
): () => void {
  events.on('message', listener);
  return () => events.off('message', listener);
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
