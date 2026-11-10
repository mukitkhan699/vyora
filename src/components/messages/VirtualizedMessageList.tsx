import React, { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Message } from '../../types/index.ts';
import { MessageBubble } from './MessageBubble.tsx';
import { toMillis } from '../../utils/messaging.ts';

interface RenderedMessage {
  message: Message;
  showDate: boolean;
  dateLabel: string;
  showAvatar: boolean;
  showName: boolean;
  isContinuation: boolean;
}

interface VirtualizedMessageListProps {
  renderedMessages: RenderedMessage[];
  currentUserId: string;
  isGroup: boolean;
  expectedRecipients: number;
  onReply: (message: Message) => void;
  onEdit: (messageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onReaction: (messageId: string, emoji: string) => void;
  onRetry: (message: Message) => void;
  onCopy: (text: string) => void;
  onOpenImage: (message: Message, selected: any) => void;
  onJumpToMessage: (messageId: string) => void;
  canModerate?: boolean;
  highlightedMessageId?: string | null;
  estimatedItemHeight?: number;
  overscan?: number;
}

export const VirtualizedMessageList: React.FC<VirtualizedMessageListProps> = ({
  renderedMessages,
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
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [itemHeights, setItemHeights] = useState<Map<number, number>>(new Map());
  const measuredIndicesRef = useRef<Set<number>>(new Set());

  const measureItemHeight = useCallback((index: number, element: HTMLElement | null) => {
    if (!element) return;
    
    // Only measure once per index to prevent infinite loops
    if (measuredIndicesRef.current.has(index)) return;
    
    const height = element.getBoundingClientRect().height;
    // Only update if height differs from estimate
    if (Math.abs(height - estimatedItemHeight) > 2) {
      measuredIndicesRef.current.add(index);
      setItemHeights((prev) => {
        const next = new Map(prev);
        next.set(index, height);
        return next;
      });
    } else {
      measuredIndicesRef.current.add(index);
    }
  }, [estimatedItemHeight]);

  // Reset measured indices when renderedMessages changes
  useEffect(() => {
    measuredIndicesRef.current.clear();
  }, [renderedMessages.length]);

  const virtualizer = useVirtualizer({
    count: renderedMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index: number) => itemHeights.get(index) ?? estimatedItemHeight,
    overscan,
  });

  const virtualItems = virtualizer.getVirtualItems();

  const handleScroll = useCallback(() => {
    // Scroll handling is automatic with react-virtual
  }, []);

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      data-message-list
      className="flex-1 min-h-0 overflow-y-auto z-scroll px-3 sm:px-5 py-3"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Messages"
      style={{
        minHeight: 0,
        height: '100%',
        position: 'relative',
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const rendered = renderedMessages[virtualItem.index];
          const isHighlighted = highlightedMessageId === rendered.message.id;

          return (
            <div
              key={rendered.message.id}
              ref={(el) => measureItemHeight(virtualItem.index, el)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualItem.size,
                transform: `translateY(${virtualItem.start}px)`,
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
    </div>
  );
};