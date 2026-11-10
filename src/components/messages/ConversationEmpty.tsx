import React from 'react';
import { Lock, Users } from 'lucide-react';
import type { Conversation } from '../../types/index.ts';
import { Avatar } from '../common/Avatar.tsx';
import { UserBadges } from '../common/UserBadges.tsx';
import { GroupAvatar } from './GroupAvatar.tsx';
import { getConversationTitle, getDirectCounterpart } from '../../utils/messaging.ts';

interface ConversationEmptyProps {
  conversation: Conversation;
  currentUserId: string;
  isOnline: boolean;
}

export const ConversationEmpty: React.FC<ConversationEmptyProps> = ({
  conversation,
  currentUserId,
  isOnline,
}) => {
  const isGroup = conversation.type === 'group';
  const title = getConversationTitle(conversation, currentUserId);
  const direct = getDirectCounterpart(conversation, currentUserId);
  const memberCount = (conversation.participants || []).filter(
    (participant) => !participant.leftAt,
  ).length;

  return (
    <div className="h-full min-h-[20rem] flex flex-col items-center justify-center px-6 text-center">
      <div className="mb-4">
        {isGroup ? (
          <GroupAvatar name={title} src={conversation.avatarUrl} size="xl" />
        ) : (
          <Avatar
            src={direct?.avatarUrl}
            name={title}
            size="xl"
            isOnline={direct ? isOnline : undefined}
          />
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <h2 className="text-lg font-bold z-text z-display">{title}</h2>
        {direct && <UserBadges verified={direct.verified} isGold={direct.isGold} size="sm" />}
      </div>
      <p className="text-xs z-muted mt-1 flex items-center gap-1.5">
        {isGroup ? (
          <>
            <Users className="w-3.5 h-3.5" />
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </>
        ) : direct?.username ? (
          <>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'z-online-dot' : 'z-offline-dot'}`} />
            @{direct.username} · {isOnline ? 'Online now' : 'Offline'}
          </>
        ) : (
          'Private conversation'
        )}
      </p>
      <div className="mt-5 rounded-2xl border z-border z-surface-2 px-4 py-3 max-w-sm">
        <p className="text-sm z-secondary leading-relaxed">
          {isGroup
            ? 'This is the beginning of the group conversation. Send a message to introduce yourself.'
            : 'No messages yet. Say hello to start the conversation.'}
        </p>
        <p className="text-[10px] z-muted mt-2 flex items-center justify-center gap-1.5">
          <Lock className="w-3 h-3" />
          Messages are private to the people in this conversation.
        </p>
      </div>
    </div>
  );
};
