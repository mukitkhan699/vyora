import React from 'react';
import {
  ArrowLeft,
  Info,
  Loader2,
  LogOut,
  MailCheck,
  MoreVertical,
  Phone,
  UserPlus,
  UserRound,
  Video,
} from 'lucide-react';
import type { Conversation, User } from '../../types/index.ts';
import { Avatar } from '../common/Avatar.tsx';
import { UserBadges } from '../common/UserBadges.tsx';
import { DropdownMenu } from '../common/DropdownMenu.tsx';
import { GroupAvatar } from './GroupAvatar.tsx';
import {
  formatLastSeen,
  getConversationTitle,
  getDirectCounterpart,
} from '../../utils/messaging.ts';

interface ConversationHeaderProps {
  conversation: Conversation;
  currentUserId: string;
  onlineUserIds: Set<string>;
  lastSeenByUser: Map<string, number>;
  typingLabel?: string;
  callStarting: 'voice' | 'video' | null;
  callBusy: boolean;
  onBack: () => void;
  onOpenDetails: () => void;
  onOpenProfile: (username: string) => void;
  onStartCall: (type: 'voice' | 'video') => void;
  onMarkRead: () => void;
  onLeaveGroup: () => void;
}

export const ConversationHeader: React.FC<ConversationHeaderProps> = ({
  conversation,
  currentUserId,
  onlineUserIds,
  lastSeenByUser,
  typingLabel,
  callStarting,
  callBusy,
  onBack,
  onOpenDetails,
  onOpenProfile,
  onStartCall,
  onMarkRead,
  onLeaveGroup,
}) => {
  const isGroup = conversation.type === 'group';
  const direct = getDirectCounterpart(conversation, currentUserId);
  const title = getConversationTitle(conversation, currentUserId);
  const memberCount = (conversation.participants || []).filter((participant) => !participant.leftAt).length;
  const online = direct ? onlineUserIds.has(direct.id) : false;
  const lastSeen = direct ? lastSeenByUser.get(direct.id) : undefined;

  const subtitle = typingLabel
    ? typingLabel
    : isGroup
      ? `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`
      : online
        ? direct?.username
          ? `@${direct.username} · Online`
          : 'Online'
        : direct?.username
          ? `@${direct.username} · ${formatLastSeen(lastSeen)}`
          : formatLastSeen(lastSeen);

  const menuItems = [
    ...(!isGroup && direct
      ? [
          {
            id: 'profile',
            label: 'View profile',
            icon: <UserRound className="w-4 h-4" />,
            onClick: () => onOpenProfile(direct.username),
          },
        ]
      : []),
    ...(isGroup
      ? [
          {
            id: 'details',
            label: 'Group information',
            icon: <Info className="w-4 h-4" />,
            onClick: onOpenDetails,
          },
        ]
      : []),
    {
      id: 'mark-read',
      label: 'Mark as read',
      icon: <MailCheck className="w-4 h-4" />,
      onClick: onMarkRead,
    },
    ...(isGroup
      ? [
          {
            id: 'add-members',
            label: 'Add members',
            icon: <UserPlus className="w-4 h-4" />,
            onClick: onOpenDetails,
          },
          {
            id: 'leave',
            label: 'Leave group',
            icon: <LogOut className="w-4 h-4" />,
            danger: true,
            onClick: onLeaveGroup,
          },
        ]
      : []),
  ];

  return (
    <header className="shrink-0 z-surface border-b z-border px-2.5 sm:px-4 py-2 flex items-center gap-2 z-safe-top">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to conversations"
        className="sm:hidden p-2 -ml-1 rounded-xl z-secondary hover:z-text hover:z-surface-2 z-focus z-no-tap-highlight"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={isGroup ? onOpenDetails : () => direct && onOpenProfile(direct.username)}
        className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-xl z-focus"
        aria-label={isGroup ? 'Open group information' : `View ${title}'s profile`}
      >
        {isGroup ? (
          <GroupAvatar name={title} src={conversation.avatarUrl} size="md" />
        ) : (
          <Avatar src={direct?.avatarUrl} name={title} size="md" isOnline={direct ? online : undefined} />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-sm font-bold z-text truncate z-display">{title}</span>
            {direct && <UserBadges verified={direct.verified} isGold={direct.isGold} size="xs" />}
          </div>
          <p className={`text-[11px] truncate ${typingLabel ? 'z-accent font-medium' : 'z-muted'}`}>
            {subtitle}
          </p>
        </div>
      </button>

      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        <CallButton
          label={callBusy ? 'A call is already in progress' : 'Start voice call'}
          onClick={() => onStartCall('voice')}
          disabled={callBusy}
          loading={callStarting === 'voice'}
          icon={<Phone className="w-4.5 h-4.5" />}
        />
        <CallButton
          label={callBusy ? 'A call is already in progress' : 'Start video call'}
          onClick={() => onStartCall('video')}
          disabled={callBusy}
          loading={callStarting === 'video'}
          icon={<Video className="w-4.5 h-4.5" />}
        />
        <DropdownMenu
          align="right"
          items={menuItems}
          trigger={
            <button
              type="button"
              aria-label="Conversation menu"
              title="Conversation menu"
              className="w-9 h-9 rounded-xl z-secondary hover:z-text hover:z-surface-2 flex items-center justify-center z-focus z-no-tap-highlight"
            >
              <MoreVertical className="w-4.5 h-4.5" />
            </button>
          }
        />
      </div>
    </header>
  );
};

const CallButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  icon: React.ReactNode;
}> = ({ label, onClick, disabled, loading, icon }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || loading}
    aria-label={label}
    className="w-9 h-9 rounded-xl z-secondary hover:z-text hover:z-surface-2 flex items-center justify-center transition-colors z-focus z-no-tap-highlight disabled:opacity-40 disabled:cursor-not-allowed"
  >
    {loading ? <Loader2 className="w-4.5 h-4.5 animate-spin" aria-hidden="true" /> : icon}
  </button>
);
