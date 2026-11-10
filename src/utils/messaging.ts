import type { Conversation, ConversationParticipant, Message, User } from '../types/index.ts';
import { formatBytes } from './format.ts';

export type DeliveryState = 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export function getActiveParticipants(conversation: Conversation | null | undefined): ConversationParticipant[] {
  return (conversation?.participants || []).filter((participant) => !participant.leftAt);
}

export function getCurrentParticipant(
  conversation: Conversation | null | undefined,
  currentUserId: string,
): ConversationParticipant | undefined {
  return (conversation?.participants || []).find((participant) => participant.userId === currentUserId);
}

export function getDirectCounterpart(
  conversation: Conversation | null | undefined,
  currentUserId: string,
): User | null {
  if (!conversation || conversation.type === 'group') return null;
  return (
    conversation.participants?.find(
      (participant) => participant.userId !== currentUserId && !participant.leftAt,
    )?.user || null
  );
}

export function getConversationTitle(
  conversation: Conversation,
  currentUserId: string,
): string {
  if (conversation.type === 'group') {
    return conversation.title?.trim() || 'Untitled group';
  }
  const other = getDirectCounterpart(conversation, currentUserId);
  return other?.name || other?.username || 'Direct message';
}

export function getConversationAvatar(
  conversation: Conversation,
  currentUserId: string,
): { src?: string; name: string } {
  if (conversation.type === 'group') {
    return { src: conversation.avatarUrl || undefined, name: conversation.title || 'Group' };
  }
  const other = getDirectCounterpart(conversation, currentUserId);
  return { src: other?.avatarUrl, name: other?.name || other?.username || 'Direct message' };
}

export function getMessagePreview(message: Message | null | undefined): string {
  if (!message) return 'No messages yet';
  if (message.isDeleted) return 'Message deleted';
  const text = message.text?.trim();
  if (text) return text;
  const first = message.attachments?.[0];
  if (first) {
    if (first.mimeType.startsWith('image/')) return 'Photo';
    if (first.mimeType.startsWith('video/')) return 'Video';
    if (first.mimeType.startsWith('audio/')) return 'Audio';
    return first.filename || 'Attachment';
  }
  return 'No messages yet';
}

export function formatConversationTime(timestamp?: number | string): string {
  if (timestamp === undefined || timestamp === null || timestamp === '') return '';
  const value = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  if (!Number.isFinite(value)) return '';
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const diff = now.getTime() - value;
  if (diff < 6 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatMessageTime(value: string | number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function sameCalendarDay(a: string | number | Date, b: string | number | Date): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export function formatDateSeparator(value: string | number): string {
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameCalendarDay(date, now)) return 'Today';
  if (sameCalendarDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function getDeliveryState(
  message: Message,
  isGroup: boolean,
  expectedRecipients: number,
  currentUserId: string,
): DeliveryState {
  if (message.localStatus === 'pending') return 'pending';
  if (message.localStatus === 'sending') return 'sending';
  if (message.localStatus === 'failed') return 'failed';
  if (message.localStatus === 'sent') return 'sent';
  if (message.localStatus === 'delivered') return 'delivered';
  if (message.localStatus === 'read') return 'read';
  const receipts = (message.receipts || []).filter((receipt) => receipt.userId !== currentUserId);
  if (isGroup) {
    const expected = Math.max(1, expectedRecipients);
    const readCount = receipts.filter((receipt) => Boolean(receipt.readAt)).length;
    const deliveredCount = receipts.filter((receipt) => Boolean(receipt.deliveredAt)).length;
    if (readCount >= expected) return 'read';
    if (deliveredCount >= expected) return 'delivered';
    if (readCount > 0 || deliveredCount > 0) return 'delivered';
    return 'sent';
  }
  if (receipts.some((receipt) => Boolean(receipt.readAt))) return 'read';
  if (receipts.some((receipt) => Boolean(receipt.deliveredAt))) return 'delivered';
  return 'sent';
}

export function deliveryLabel(state: DeliveryState, isGroup: boolean): string {
  switch (state) {
    case 'pending':
      return 'Pending';
    case 'sending':
      return 'Sending';
    case 'failed':
      return 'Not sent';
    case 'sent':
      return 'Sent';
    case 'delivered':
      return isGroup ? 'Delivered to the group' : 'Delivered';
    case 'read':
      return isGroup ? 'Read by everyone' : 'Read';
    default:
      return 'Sent';
  }
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export function formatLastSeen(timestamp: number | undefined): string {
  if (!timestamp) return 'Offline';
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'Last seen just now';
  if (diff < 3_600_000) return `Last seen ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `Last seen ${Math.floor(diff / 3_600_000)}h ago`;
  return `Last seen ${new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export function isVideoMime(mime: string): boolean {
  return mime.startsWith('video/');
}

export function isAudioMime(mime: string): boolean {
  return mime.startsWith('audio/');
}

export function describeFileSize(bytes: number): string {
  return formatBytes(bytes);
}

export function supportsFileType(mime: string): boolean {
  return [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'application/pdf',
    'text/plain',
  ].includes(mime);
}

export function toMillis(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && value.trim() !== '') return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function upsertMessage<T extends { id: string; clientId?: string | null; createdAt: string | number; localStatus?: string; localError?: string }>(list: T[], incoming: T): T[] {
  const next = [...list];
  let index = next.findIndex((message) => message.id === incoming.id);
  if (index < 0 && incoming.clientId) {
    index = next.findIndex(
      (message) => Boolean(message.clientId) && message.clientId === incoming.clientId,
    );
  }
  if (index >= 0) {
    next[index] = {
      ...next[index],
      ...incoming,
      localStatus: incoming.localStatus,
      localError: incoming.localError,
    };
  } else {
    next.push(incoming);
  }
  return next.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
}

export function mergeMessages<T extends { id: string; clientId?: string | null; createdAt: string | number; localStatus?: string; localError?: string }>(current: T[], incoming: T[]): T[] {
  return incoming.reduce((list, message) => upsertMessage(list, message), current);
}

export function conversationTimestamp(conversation: { lastMessageAt?: number; lastMessage?: { createdAt?: string | number } | null }): number {
  return conversation.lastMessageAt || toMillis(conversation.lastMessage?.createdAt);
}

export function sortConversations<T extends { lastMessageAt?: number; lastMessage?: { createdAt?: string | number } | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => conversationTimestamp(b) - conversationTimestamp(a));
}
