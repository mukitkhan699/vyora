import React from 'react';
import { Check, Pin } from 'lucide-react';
import type { Conversation } from '../../types/index.ts';
import { Avatar } from '../common/Avatar.tsx';
import { UserBadges } from '../common/UserBadges.tsx';
import { GroupAvatar } from './GroupAvatar.tsx';
import {
  formatConversationTime,
  getConversationTitle,
  getDirectCounterpart,
  getMessagePreview,
} from '../../utils/messaging.ts';

interface ConversationListItemProps {
  conversation: Conversation;
  currentUserId: string;
  onlineUserIds: Set<string>;
  isSelected: boolean;
  onSelect: (conversation: Conversation) => void;
}

export const ConversationListItem: React.FC<ConversationListItemProps> = ({
  conversation,
  currentUserId,
  onlineUserIds,
  isSelected,
  onSelect,
}) => {
  const isGroup = conversation.type === 'group';
  const direct = getDirectCounterpart(conversation, currentUserId);
  const title = getConversationTitle(conversation, currentUserId);
  const lastMessage = conversation.lastMessage;
  const preview = getMessagePreview(lastMessage);
  const isOwnLast = Boolean(lastMessage?.senderId && lastMessage.senderId === currentUserId);
  const online = direct ? onlineUserIds.has(direct.id) : false;
  const memberCount = (conversation.participants || []).filter((participant) => !participant.leftAt).length;

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation)}
      aria-current={isSelected ? 'true' : undefined}
      className={`w-full text-left px-3 sm:px-4 py-3 flex items-center gap-3 transition-colors z-focus z-no-tap-highlight border-l-2 ${
        isSelected
          ? 'z-surface-2 border-l-[var(--z-accent)]'
          : 'border-l-transparent hover:z-surface-2'
      }`}
    >
      {isGroup ? (
        <GroupAvatar name={title} src={conversation.avatarUrl} size="md" />
      ) : (
        <Avatar src={direct?.avatarUrl} name={title} size="md" isOnline={direct ? online : undefined} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] sm:text-sm font-semibold z-text truncate flex items-center gap-1 min-w-0">
            <span className="truncate">{title}</span>
            {direct && <UserBadges verified={direct.verified} isGold={direct.isGold} size="xs" />}
          </span>
          {direct?.username && (
            <span className="hidden sm:inline text-[10px] z-muted font-mono truncate max-w-[6.5rem]">
              @{direct.username}
            </span>
          )}
          <span className="ml-auto text-[10px] z-muted shrink-0 tabular-nums">
            {formatConversationTime(conversation.lastMessageAt || lastMessage?.createdAt)}
          </span>
        </div>

        <div className="flex items-center gap-1.5 mt-0.5">
          {isGroup && (
            <span className="text-[10px] z-muted shrink-0">{memberCount} members</span>
          )}
          {isGroup && preview !== 'No messages yet' && (
            <span className="w-0.5 h-0.5 rounded-full bg-[var(--z-text-muted)] shrink-0" />
          )}
          {isOwnLast && <Check className="w-3 h-3 z-muted shrink-0" aria-label="Your last message" />}
          <span className={`text-xs truncate flex-1 ${conversation.unreadCount > 0 ? 'z-text font-medium' : 'z-secondary'}`}>
            {isOwnLast ? 'You: ' : ''}
            {preview}
          </span>
          {conversation.unreadCount > 0 && (
            <span
              className="ml-1 shrink-0 min-w-[18px] h-[18px] px-1 rounded-full z-accent-bg text-[10px] font-extrabold flex items-center justify-center"
              aria-label={`${conversation.unreadCount > 99 ? '99+' : conversation.unreadCount} unread messages`}
            >
              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

export const PinnedBadge: React.FC = () => (
  <span className="inline-flex items-center gap-1 text-[10px] z-muted">
    <Pin className="w-3 h-3" /> Pinned
  </span>
);
