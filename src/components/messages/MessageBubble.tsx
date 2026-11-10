import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Edit2,
  Loader2,
  Reply,
  RotateCcw,
  Smile,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { Message, MessageAttachment as Attachment } from '../../types/index.ts';
import { Avatar } from '../common/Avatar.tsx';
import { ConfirmationDialog } from '../common/ConfirmationDialog.tsx';
import { UserBadges } from '../common/UserBadges.tsx';
import { MessageAttachment } from './MessageAttachment.tsx';
import { ReactionPicker } from './ReactionPicker.tsx';
import {
  deliveryLabel,
  formatMessageTime,
  getDeliveryState,
} from '../../utils/messaging.ts';
import { useLongPress } from '../../hooks/useLongPress.ts';
import { useMessageActions } from '../../context/MessageActionsContext.tsx';

interface MessageBubbleProps {
  message: Message;
  currentUserId: string;
  isGroup: boolean;
  expectedRecipients: number;
  showAvatar: boolean;
  showName: boolean;
  isContinuation: boolean;
  onReply: (message: Message) => void;
  onEdit: (messageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onRetry: (message: Message) => void;
  onCopy: (text: string) => void;
  onOpenImage: (message: Message, attachment: Attachment) => void;
  onJumpToMessage?: (messageId: string) => void;
  canModerate?: boolean;
  highlighted?: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  currentUserId,
  isGroup,
  expectedRecipients,
  showAvatar,
  showName,
  isContinuation,
  onReply,
  onEdit,
  onDelete,
  onReaction,
  onRetry,
  onCopy,
  onOpenImage,
  onJumpToMessage,
  canModerate = false,
  highlighted = false,
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const actionButtonsRef = useRef<HTMLButtonElement[]>([]);

  const { activeMessageId, setActiveMessageId, registerMessage, unregisterMessage } = useMessageActions();
  const isActive = activeMessageId === message.id;

  useEffect(() => {
    registerMessage(message.id);
    return () => unregisterMessage(message.id);
  }, [message.id, registerMessage, unregisterMessage]);

  const isSender = message.senderId === currentUserId || Boolean(message.isSender);
  const isDeleted = Boolean(message.isDeleted);
  const sender = message.sender;
  const senderName = sender?.name || (isSender ? 'You' : sender?.username || 'Member');
  const deliveryState = getDeliveryState(message, isGroup, expectedRecipients, currentUserId);
  const hasActions = !isDeleted && !isEditing && !message.localStatus;

  const handleOpenActions = useCallback(() => {
    setActiveMessageId(message.id);
    setShowActions(true);
    window.requestAnimationFrame(() => {
      actionButtonsRef.current[0]?.focus();
    });
  }, [message.id, setActiveMessageId]);

  const handleCloseActions = useCallback(() => {
    if (isActive) {
      setActiveMessageId(null);
    }
    setShowActions(false);
  }, [isActive, setActiveMessageId]);

  const { isLongPressTriggered, handlers } = useLongPress({
    delay: 450,
    threshold: 8,
    onLongPress: handleOpenActions,
    onCancel: handleCloseActions,
  });

  useEffect(() => {
    if (!isActive) {
      setShowActions(false);
    }
  }, [isActive]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (isActive && actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
        handleCloseActions();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (isActive && event.key === 'Escape') {
        handleCloseActions();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isActive, handleCloseActions]);

  const reactionGroups = useMemo(() => {
    const groups = new Map<string, { count: number; mine: boolean }>();
    for (const reaction of message.reactions || []) {
      const existing = groups.get(reaction.emoji) || { count: 0, mine: false };
      groups.set(reaction.emoji, {
        count: existing.count + 1,
        mine: existing.mine || reaction.userId === currentUserId,
      });
    }
    return Array.from(groups.entries());
  }, [message.reactions, currentUserId]);

  const handleEditSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = editText.trim();
    if (!next || next === message.text) {
      setIsEditing(false);
      setEditText(message.text);
      return;
    }
    onEdit(message.id, next);
    setIsEditing(false);
  };

  const handleActionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const buttons = actionButtonsRef.current;
    if (buttons.length === 0) return;

    let nextIndex = index;
    const total = buttons.length;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        nextIndex = index < total - 1 ? index + 1 : 0;
        break;
      case 'ArrowLeft':
        event.preventDefault();
        nextIndex = index > 0 ? index - 1 : total - 1;
        break;
      case 'Home':
        event.preventDefault();
        nextIndex = 0;
        break;
      case 'End':
        event.preventDefault();
        nextIndex = total - 1;
        break;
      case 'Escape':
        event.preventDefault();
        handleCloseActions();
        return;
      default:
        return;
    }

    buttons[nextIndex]?.focus();
  };

  return (
    <div
      id={`message-${message.id}`}
      data-message-id={message.id}
      className={`group flex w-full gap-2 scroll-mt-24 ${isSender ? 'justify-end' : 'justify-start'} ${
        isContinuation ? 'mt-1' : 'mt-3'
      } z-message-enter ${highlighted ? 'z-message-highlight' : ''}`}
      {...handlers}
    >
      {!isSender && (
        <div className="w-8 shrink-0 flex items-end pb-1">
          {showAvatar && (
            <Avatar src={sender?.avatarUrl} name={senderName} size="sm" />
          )}
        </div>
      )}

      <div
        className={`flex flex-col min-w-0 max-w-[86vw] sm:max-w-[min(74%,34rem)] ${
          isSender ? 'items-end' : 'items-start'
        }`}
      >
        {isGroup && !isSender && showName && (
          <div className="flex items-center gap-1 px-1 mb-1">
            <span className="text-[11px] font-semibold z-accent">{senderName}</span>
            <UserBadges verified={sender?.verified} isGold={sender?.isGold} size="xs" />
          </div>
        )}

        {message.replyToMessage && (
          <button
            type="button"
            onClick={() => onJumpToMessage?.(message.replyToMessage!.id)}
            className={`mb-1 max-w-full text-left px-2.5 py-1.5 rounded-lg border-l-2 z-surface-2 hover:z-surface-3 transition-colors z-focus ${
              isSender ? 'border-[var(--z-accent-border)]' : 'border-[var(--z-border-strong)]'
            }`}
            aria-label="Jump to replied message"
          >
            <p className="text-[10px] font-semibold z-accent truncate">
              {message.replyToMessage.senderUsername
                ? `@${message.replyToMessage.senderUsername}`
                : 'Earlier message'}
            </p>
            <p className="text-[11px] z-secondary truncate mt-0.5">
              {message.replyToMessage.text || 'Attachment'}
            </p>
          </button>
        )}

        <div className="relative max-w-full">
          {hasActions && (
            <div
              ref={actionsRef}
              className={`absolute -top-3.5 z-20 flex items-center gap-0.5 rounded-full border z-border z-surface-2 px-1 py-0.5 z-shadow-soft transition-opacity duration-150 z-message-actions ${
                isSender ? 'right-1' : 'left-1'
              } ${isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
              role="group"
              aria-label="Message actions"
              tabIndex={0}
            >
              <ActionButton
                label="React to message"
                onClick={() => {
                  setShowPicker((value) => !value);
                  handleCloseActions();
                }}
                icon={<Smile className="w-3.5 h-3.5" />}
                ref={(el) => { actionButtonsRef.current[0] = el as HTMLButtonElement; }}
                onKeyDown={(e) => handleActionKeyDown(e, 0)}
              />
              <ActionButton
                label="Reply to message"
                onClick={() => {
                  onReply(message);
                  handleCloseActions();
                }}
                icon={<Reply className="w-3.5 h-3.5" />}
                ref={(el) => { actionButtonsRef.current[1] = el as HTMLButtonElement; }}
                onKeyDown={(e) => handleActionKeyDown(e, 1)}
              />
              {message.text?.trim() && (
                <ActionButton
                  label="Copy message text"
                  onClick={() => {
                    onCopy(message.text);
                    handleCloseActions();
                  }}
                  icon={<Copy className="w-3.5 h-3.5" />}
                  ref={(el) => { actionButtonsRef.current[2] = el as HTMLButtonElement; }}
                  onKeyDown={(e) => handleActionKeyDown(e, 2)}
                />
              )}
              {isSender && (
                <ActionButton
                  label="Edit message"
                  onClick={() => {
                    setIsEditing(true);
                    setEditText(message.text);
                    handleCloseActions();
                  }}
                  icon={<Edit2 className="w-3.5 h-3.5" />}
                  ref={(el) => { actionButtonsRef.current[3] = el as HTMLButtonElement; }}
                  onKeyDown={(e) => handleActionKeyDown(e, 3)}
                />
              )}
              {(isSender || canModerate) && (
                <ActionButton
                  label={isSender ? 'Delete message' : 'Delete message for everyone'}
                  onClick={() => {
                    setConfirmDelete(true);
                    handleCloseActions();
                  }}
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                  danger
                  ref={(el) => { actionButtonsRef.current[4] = el as HTMLButtonElement; }}
                  onKeyDown={(e) => handleActionKeyDown(e, 4)}
                />
              )}
            </div>
          )}

          <div
            className={`relative rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
              isSender ? 'z-bubble-out rounded-br-md' : 'z-bubble-in rounded-bl-md'
            } ${isDeleted ? 'italic opacity-65' : ''}`}
          >
            {isEditing ? (
              <form onSubmit={handleEditSubmit} className="flex flex-col gap-2 min-w-[15rem]">
                <textarea
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                  className="z-input rounded-xl px-3 py-2 text-sm resize-none z-scroll"
                  rows={2}
                  autoFocus
                  aria-label="Edit message text"
                />
                <div className="flex justify-end gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setEditText(message.text);
                    }}
                    className="px-2.5 py-1 rounded-lg z-secondary hover:z-text z-focus"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 rounded-lg z-accent-bg font-bold z-focus"
                  >
                    Save
                  </button>
                </div>
              </form>
            ) : (
              <>
                {message.text?.trim() && (
                  <p className="break-words whitespace-pre-wrap">{message.text}</p>
                )}

                {message.attachments?.map((attachment) => (
                  <MessageAttachment
                    key={attachment.id}
                    attachment={attachment}
                    variant={isSender ? 'outgoing' : 'incoming'}
                    onOpenImage={(selected) => onOpenImage(message, selected)}
                  />
                ))}

                <div
                  className={`flex items-center justify-end gap-1.5 mt-1.5 text-[10px] ${
                    isSender ? 'opacity-70' : 'z-muted'
                  }`}
                >
                  {message.isEdited && <span className="italic">edited</span>}
                  <span>{formatMessageTime(message.createdAt)}</span>
                  {isSender && (
                    <span aria-label={deliveryLabel(deliveryState, isGroup)}>
                      {deliveryState === 'pending' ? (
                        <>
                          <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--z-warning)', color: 'var(--z-accent-contrast)' }}>
                            <Clock className="w-3 h-3" aria-hidden="true" />
                          </span>
                          <span className="sr-only">{deliveryLabel(deliveryState, isGroup)}</span>
                        </>
                      ) : deliveryState === 'sending' ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          <span className="sr-only">{deliveryLabel(deliveryState, isGroup)}</span>
                        </>
                      ) : deliveryState === 'failed' ? (
                        <>
                          <AlertCircle className="w-3.5 h-3.5" style={{ color: 'var(--z-danger)' }} aria-hidden="true" />
                          <span className="sr-only">{deliveryLabel(deliveryState, isGroup)}</span>
                        </>
                      ) : deliveryState === 'read' ? (
                        <>
                          <CheckCheck className="w-3.5 h-3.5" style={{ color: 'var(--z-accent)' }} aria-hidden="true" />
                          <span className="sr-only">{deliveryLabel(deliveryState, isGroup)}</span>
                        </>
                      ) : deliveryState === 'delivered' ? (
                        <>
                          <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                          <span className="sr-only">{deliveryLabel(deliveryState, isGroup)}</span>
                        </>
                      ) : deliveryState === 'sent' ? (
                        <>
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          <span className="sr-only">{deliveryLabel(deliveryState, isGroup)}</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          <span className="sr-only">{deliveryLabel(deliveryState, isGroup)}</span>
                        </>
                      )}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {deliveryState === 'failed' && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--z-danger)' }}>
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{message.localError || 'Message not sent.'}</span>
              <button
                type="button"
                onClick={() => onRetry(message)}
                className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 z-focus rounded"
              >
                <RotateCcw className="w-3 h-3" /> Retry
              </button>
              <button
                type="button"
                onClick={() => onDelete(message.id)}
                className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 z-focus rounded"
              >
                <Trash2 className="w-3 h-3" /> Discard
              </button>
            </div>
          )}

          {showPicker && (
            <ReactionPicker
              onSelect={(emoji) => {
                onReaction(message.id, emoji);
                setShowPicker(false);
              }}
              onClose={() => setShowPicker(false)}
              align={isSender ? 'right' : 'left'}
            />
          )}
        </div>

        {reactionGroups.length > 0 && (
          <div
            className="flex flex-wrap gap-1 px-1 mt-1"
            role="group"
            aria-label="Message reactions"
            tabIndex={0}
          >
            {reactionGroups.map(([emoji, group]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReaction(message.id, emoji)}
                aria-label={`${group.mine ? 'Remove' : 'Add'} ${emoji} reaction`}
                aria-pressed={group.mine}
                className={`text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 border transition-colors z-focus ${
                  group.mine
                    ? 'z-accent-soft-bg border-[var(--z-accent-border)] z-accent'
                    : 'z-surface-2 z-border z-secondary hover:z-text'
                }`}
              >
                <span>{emoji}</span>
                <span className="font-mono text-[10px]">{group.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <ConfirmationDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete(message.id);
        }}
        title="Delete message?"
        description="This will remove the message for everyone in the conversation. This action cannot be undone."
        confirmLabel="Delete message"
        isDestructive
      />
    </div>
  );
};

const ActionButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}> = ({ label, icon, onClick, danger, ref, onKeyDown }) => (
  <button
    ref={ref}
    type="button"
    onClick={onClick}
    onKeyDown={onKeyDown}
    aria-label={label}
    title={label}
    className={`p-1.5 rounded-full transition-colors z-focus ${
      danger ? 'z-danger-text hover:z-danger-soft-bg' : 'z-secondary hover:z-text hover:z-surface-3'
    }`}
  >
    {icon}
  </button>
);
