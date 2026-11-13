import React, { useEffect, useRef, useState } from 'react';
import {
  FileText,
  Loader2,
  Music,
  Paperclip,
  Reply,
  RefreshCw,
  Send,
  Smile,
  Video as VideoIcon,
  WifiOff,
  X,
} from 'lucide-react';
import type { Message, PendingMessageAttachment } from '../../types/index.ts';
import { formatBytes } from '../../utils/format.ts';
import { isImageMime } from '../../utils/messaging.ts';

interface MessageComposerProps {
  text: string;
  onTextChange: (value: string) => void;
  onSend: () => void;
  onOpenAttachments: () => void;
  pendingAttachments: PendingMessageAttachment[];
  onRemoveAttachment: (localId: string) => void;
  onRetryAttachment: (localId: string) => void;
  replyTarget: Message | null;
  onCancelReply: () => void;
  sending: boolean;
  uploading: boolean;
  disabled?: boolean;
  connected: boolean;
  conversationName: string;
}

const EMOJIS = ['😊', '😂', '🥂', '✨', '❤️', '👍', '🙏', '🔥', '🎉', '😮', '😢', '👏', '💫', '🌿', '🤍', '🙌'];

function attachmentIcon(item: PendingMessageAttachment): React.ReactNode {
  if (isImageMime(item.mimeType) && item.previewUrl) {
    return <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />;
  }
  if (item.mimeType.startsWith('video/')) return <VideoIcon className="w-4 h-4" />;
  if (item.mimeType.startsWith('audio/')) return <Music className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({
  text,
  onTextChange,
  onSend,
  onOpenAttachments,
  pendingAttachments,
  onRemoveAttachment,
  onRetryAttachment,
  replyTarget,
  onCancelReply,
  sending,
  uploading,
  disabled = false,
  connected,
  conversationName,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const emojiButtonsRef = useRef<HTMLButtonElement[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const readyAttachments = pendingAttachments.filter((item) => item.status === 'ready').length;
  const allAttachmentsReady = pendingAttachments.every((item) => item.status === 'ready');
  const canSend =
    !disabled &&
    !sending &&
    !uploading &&
    allAttachmentsReady &&
    (text.trim().length > 0 || readyAttachments > 0);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    const next = Math.min(textarea.scrollHeight, 168);
    textarea.style.height = `${Math.max(44, next)}px`;
  }, [text]);

  useEffect(() => {
    if (!showEmoji) return;
    const handleOutside = (event: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(event.target as Node)) {
        setShowEmoji(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowEmoji(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showEmoji]);

  useEffect(() => {
    if (showEmoji) {
      const firstButton = emojiButtonsRef.current[0];
      firstButton?.focus();
    }
  }, [showEmoji]);

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    onTextChange(next);
    setShowEmoji(false);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const handleEmojiKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const buttons = emojiButtonsRef.current;
    if (buttons.length === 0) return;
    
    let nextIndex = index;
    const cols = 4;
    
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        nextIndex = index < buttons.length - 1 ? index + 1 : 0;
        break;
      case 'ArrowLeft':
        event.preventDefault();
        nextIndex = index > 0 ? index - 1 : buttons.length - 1;
        break;
      case 'ArrowDown':
        event.preventDefault();
        nextIndex = Math.min(index + cols, buttons.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        nextIndex = Math.max(index - cols, 0);
        break;
      case 'Home':
        event.preventDefault();
        nextIndex = 0;
        break;
      case 'End':
        event.preventDefault();
        nextIndex = buttons.length - 1;
        break;
      case 'Escape':
        event.preventDefault();
        setShowEmoji(false);
        const emojiButton = emojiRef.current?.querySelector('button[aria-label="Insert emoji"]') as HTMLButtonElement;
        emojiButton?.focus();
        return;
      default:
        return;
    }
    
    buttons[nextIndex]?.focus();
  };

  return (
    <div
      className="shrink-0 border-t z-border z-surface px-2.5 pt-2 sm:px-4 sm:pt-2.5"
      style={{ backgroundColor: 'var(--z-surface)' }}
    >
      {replyTarget && (
        <div className="mb-2 flex items-start gap-2 rounded-xl z-surface-2 border z-border px-3 py-2 z-fade-enter">
          <Reply className="w-3.5 h-3.5 z-accent shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold z-accent truncate">
              Replying to {replyTarget.sender?.username ? `@${replyTarget.sender.username}` : 'message'}
            </p>
            <p className="text-xs z-secondary truncate mt-0.5">
              {replyTarget.text || (replyTarget.attachments?.length ? 'Attachment' : 'Message')}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="p-1 rounded-lg z-muted hover:z-text z-focus"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto z-scroll pb-0.5" aria-label="Pending attachments">
          {pendingAttachments.map((item) => (
            <div
              key={item.localId}
              className="relative shrink-0 w-36 rounded-xl border z-border z-surface-2 p-2 flex items-center gap-2"
            >
              <div className="w-9 h-9 rounded-lg overflow-hidden z-surface-3 z-secondary flex items-center justify-center shrink-0">
                {attachmentIcon(item)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold z-text truncate">{item.name}</p>
                <p className="text-[10px] z-muted mt-0.5">
                  {item.status === 'uploading'
                    ? `${Math.round(item.progress)}%`
                    : item.status === 'ready'
                      ? formatBytes(item.size)
                      : 'Failed'}
                </p>
                {item.status === 'uploading' && (
                  <div
                    className="z-progress-track h-1 mt-1"
                    role="progressbar"
                    aria-label={`Uploading ${item.name}`}
                    aria-valuenow={Math.round(item.progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-live="polite"
                  >
                    <div className="z-progress-bar h-full" style={{ width: `${Math.max(2, item.progress)}%` }} />
                  </div>
                )}
              </div>
              {item.status === 'uploading' ? (
                <Loader2 className="w-3.5 h-3.5 z-muted animate-spin shrink-0" aria-hidden="true" />
              ) : (
                <div className="absolute -top-1.5 -right-1.5 flex items-center gap-0.5">
                  {item.status === 'failed' && (
                    <button
                      type="button"
                      onClick={() => onRetryAttachment(item.localId)}
                      aria-label={`Retry ${item.name}`}
                      className="w-5 h-5 rounded-full z-surface-3 border z-border z-secondary hover:z-text flex items-center justify-center z-focus"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(item.localId)}
                    aria-label={`Remove ${item.name}`}
                    className="w-5 h-5 rounded-full z-surface-3 border z-border z-secondary hover:z-text flex items-center justify-center z-focus"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!connected && !disabled && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] z-muted" role="status" aria-live="polite">
          <WifiOff className="w-3 h-3" aria-hidden="true" />
          Offline — messages will be queued and sent automatically when you reconnect.
        </div>
      )}

      <div className="flex items-end gap-1.5 sm:gap-2 pb-2">
        <button
          type="button"
          onClick={onOpenAttachments}
          disabled={disabled}
          aria-label="Attach a file"
          className="shrink-0 w-10 h-10 rounded-full z-secondary hover:z-text hover:z-surface-2 flex items-center justify-center transition-colors z-focus z-no-tap-highlight disabled:opacity-40"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSend) onSend();
              }
            }}
            rows={1}
            placeholder={disabled ? 'Select a conversation' : `Message ${conversationName}`}
            aria-label={`Message ${conversationName}`}
            enterKeyHint="send"
            disabled={disabled}
            className="z-input w-full resize-none rounded-2xl px-4 py-3 text-sm leading-relaxed max-h-[168px] z-scroll disabled:opacity-50"
          />
        </div>

        <div className="relative" ref={emojiRef}>
          <button
            type="button"
            onClick={() => setShowEmoji((value) => !value)}
            disabled={disabled}
            aria-label="Insert emoji"
            aria-expanded={showEmoji}
            aria-controls="emoji-picker"
            className="shrink-0 w-10 h-10 rounded-full z-secondary hover:z-text hover:z-surface-2 flex items-center justify-center transition-colors z-focus z-no-tap-highlight disabled:opacity-40"
          >
            <Smile className="w-5 h-5" />
          </button>
          {showEmoji && (
            <div
              id="emoji-picker"
              role="menu"
              aria-label="Choose an emoji"
              className="absolute bottom-full right-0 mb-2 z-surface border z-border rounded-2xl p-2 z-shadow z-pop-enter grid grid-cols-4 gap-1 w-44"
            >
              {EMOJIS.map((emoji, index) => (
                <button
                  key={emoji}
                  ref={(el) => { emojiButtonsRef.current[index] = el as HTMLButtonElement; }}
                  type="button"
                  role="menuitem"
                  onClick={() => insertEmoji(emoji)}
                  onKeyDown={(event) => handleEmojiKeyDown(event, index)}
                  aria-label={`Insert ${emoji}`}
                  className="w-9 h-9 rounded-lg hover:z-surface-2 flex items-center justify-center text-lg z-focus"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label={sending ? 'Sending message' : 'Send message'}
          className="shrink-0 w-10 h-10 rounded-full z-accent-bg flex items-center justify-center transition-transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed z-focus z-no-tap-highlight z-shadow-soft"
        >
          {sending ? (
            <>
              <Loader2 className="w-4.5 h-4.5 animate-spin" aria-hidden="true" />
              <span className="sr-only">Sending message</span>
            </>
          ) : (
            <Send className="w-4.5 h-4.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
};
