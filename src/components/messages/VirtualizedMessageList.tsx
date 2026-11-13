import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Message, MessageAttachment } from '../../types/index.ts';
import { MessageBubble } from './MessageBubble.tsx';

interface RenderedMessage {
  message: Message;
  showDate: boolean;
  dateLabel: string;
  showAvatar: boolean;
  showName: boolean;
  isContinuation: boolean;
}

export interface VirtualizedMessageListHandle {
  scrollToMessage: (messageId: string) => void;
}

interface VirtualizedMessageListProps {
  renderedMessages: RenderedMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  currentUserId: string;
  isGroup: boolean;
  expectedRecipients: number;
  onReply: (message: Message) => void;
  onEdit: (messageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onRetry: (message: Message) => void;
  onCopy: (text: string) => void;
  onOpenImage: (message: Message, selected: MessageAttachment) => void;
  onJumpToMessage: (messageId: string) => void;
  canModerate?: boolean;
  highlightedMessageId?: string | null;
  estimatedItemHeight?: number;
  overscan?: number;
}

export const VirtualizedMessageList = forwardRef<
  VirtualizedMessageListHandle,
  VirtualizedMessageListProps
>(function VirtualizedMessageList({
  renderedMessages,
  scrollRef,
  currentUserId,
  isGroup,
  expectedRecipients,
  onReply,
  onEdit,
  onDelete,
  onReaction,
  onRetry,
  onCopy,
  onOpenImage,
  onJumpToMessage,
  canModerate = false,
  highlightedMessageId,
  estimatedItemHeight = 120,
  overscan = 5,
}, ref) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // The virtualizer scrolls with the conversation pane (which also owns the
  // "load earlier" control), so the list offset must be accounted for.
  useLayoutEffect(() => {
    const list = listRef.current;
    const scrollElement = scrollRef.current;
    if (!list || !scrollElement) return;

    const measure = () => {
      const offset =
        list.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop;
      setScrollMargin((previous) => (Math.abs(previous - offset) > 0.5 ? offset : previous));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list.parentElement ?? list);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollRef, renderedMessages.length]);

  const virtualizer = useVirtualizer({
    count: renderedMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedItemHeight,
    overscan,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();

  useImperativeHandle(
    ref,
    () => ({
      scrollToMessage: (messageId: string) => {
        const index = renderedMessages.findIndex(
          (rendered) => rendered.message.id === messageId,
        );
        if (index >= 0) {
          virtualizer.scrollToIndex(index, { align: 'center' });
        }
      },
    }),
    [renderedMessages, virtualizer],
  );

  return (
    <div
      ref={listRef}
      data-message-list
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Messages"
      style={{
        height: virtualizer.getTotalSize(),
        width: '100%',
        position: 'relative',
      }}
    >
      {virtualItems.map((virtualItem) => {
        const rendered = renderedMessages[virtualItem.index];
        if (!rendered) return null;
        const isHighlighted = highlightedMessageId === rendered.message.id;

        return (
          <div
            key={rendered.message.id}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start - scrollMargin}px)`,
            }}
          >
            {rendered.showDate && (
              <div className="sticky top-0 z-10 flex justify-center py-2 pointer-events-none">
                <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide z-surface-2 border z-border z-muted backdrop-blur-sm">
                  {rendered.dateLabel}
                </span>
              </div>
            )}
            <MessageBubble
              message={rendered.message}
              currentUserId={currentUserId}
              isGroup={isGroup}
              expectedRecipients={expectedRecipients}
              showAvatar={rendered.showAvatar}
              showName={rendered.showName}
              isContinuation={rendered.isContinuation}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onReaction={onReaction}
              onRetry={onRetry}
              onCopy={onCopy}
              onOpenImage={onOpenImage}
              onJumpToMessage={onJumpToMessage}
              canModerate={canModerate}
              highlighted={isHighlighted}
            />
          </div>
        );
      })}
    </div>
  );
});
