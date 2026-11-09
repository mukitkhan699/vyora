import React, { useState } from 'react';
import { Smile, Reply, Edit2, Trash2, Check, CheckCheck, Paperclip, FileText } from 'lucide-react';
import { Message } from '../../types/index.ts';
import { Avatar } from '../common/Avatar.tsx';
import { ReactionPicker } from './ReactionPicker.tsx';

interface MessageBubbleProps {
  message: Message;
  currentUserId: string;
  onReply: (message: Message) => void;
  onEdit: (messageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onReaction: (messageId: string, emoji: string) => void;
  accentBgClass: string;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  currentUserId,
  onReply,
  onEdit,
  onDelete,
  onReaction,
  accentBgClass,
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);

  const isSender = message.senderId === currentUserId || Boolean(message.isSender);
  const isDeleted = Boolean(message.isDeleted);

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editText.trim() || editText === message.text) {
      setIsEditing(false);
      return;
    }
    onEdit(message.id, editText.trim());
    setIsEditing(false);
  };

  const receipts = message.receipts || [];
  const otherReceipts = receipts.filter((r) => r.userId !== currentUserId);
  const isReadByAnyone = otherReceipts.some((r) => Boolean(r.readAt));
  const isDeliveredToAnyone = otherReceipts.some((r) => Boolean(r.deliveredAt));

  return (
    <div className={`group relative flex flex-col gap-1 max-w-[80%] ${isSender ? 'self-end items-end' : 'self-start items-start'}`}>
      {/* Reply target preview */}
      {message.replyToMessage && (
        <div
          className={`text-xs px-2.5 py-1 rounded-lg border-l-2 mb-0.5 truncate max-w-full ${
            isSender
              ? 'bg-white/10 border-cyan-400 text-neutral-300'
              : 'bg-white/5 border-neutral-500 text-neutral-400'
          }`}
        >
          <span className="font-semibold">{message.replyToMessage.senderUsername || 'Member'}: </span>
          <span>{message.replyToMessage.text}</span>
        </div>
      )}

      {/* Bubble container */}
      <div
        className={`relative p-3 rounded-2xl text-sm leading-relaxed ${
          isSender
            ? `${accentBgClass} text-black font-medium rounded-br-xs shadow-xs`
            : 'bg-[#181E2B] text-neutral-100 rounded-bl-xs border border-white/10'
        } ${isDeleted ? 'italic opacity-60' : ''}`}
      >
        {isEditing ? (
          <form onSubmit={handleEditSubmit} className="flex flex-col gap-2 min-w-48">
            <input
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="bg-black/30 border border-black/20 rounded-lg px-2.5 py-1 text-sm text-black outline-none"
              autoFocus
            />
            <div className="flex justify-end gap-1 text-xs">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-2 py-0.5 rounded text-neutral-800 hover:text-black font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-2.5 py-0.5 rounded bg-black text-white font-bold"
              >
                Save
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="break-words whitespace-pre-wrap">{message.text}</p>

            {/* Attachments */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {message.attachments.map((att) => {
                  const isImage = att.mimeType.startsWith('image/');
                  if (isImage) {
                    return (
                      <a
                        key={att.id}
                        href={att.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg overflow-hidden border border-black/10 hover:opacity-90"
                      >
                        <img src={att.url} alt={att.filename} className="max-h-60 w-auto object-cover rounded-lg" />
                      </a>
                    );
                  }
                  return (
                    <a
                      key={att.id}
                      href={att.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 p-2 rounded-lg bg-black/15 hover:bg-black/25 transition-colors text-xs"
                    >
                      <FileText className="w-4 h-4 shrink-0" />
                      <span className="truncate flex-1 font-mono">{att.filename}</span>
                    </a>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Footer info: time, edited badge, delivery receipt ticks */}
        <div className="flex items-center justify-end gap-1 mt-1 text-[10px] opacity-70 font-mono">
          {message.isEdited && <span>(edited)</span>}
          <span>
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {isSender && (
            <span title={isReadByAnyone ? 'Read' : isDeliveredToAnyone ? 'Delivered' : 'Sent'}>
              {isReadByAnyone ? (
                <CheckCheck className="w-3.5 h-3.5 text-blue-600 inline ml-0.5" />
              ) : isDeliveredToAnyone ? (
                <CheckCheck className="w-3.5 h-3.5 inline ml-0.5" />
              ) : (
                <Check className="w-3.5 h-3.5 inline ml-0.5" />
              )}
            </span>
          )}
        </div>

        {/* Floating actions (hover on desktop, always visible buttons) */}
        {!isDeleted && (
          <div
            className={`absolute top-0 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-[#0F172A] border border-white/10 rounded-full px-1.5 py-0.5 shadow-md z-20 ${
              isSender ? 'right-2' : 'left-2'
            }`}
          >
            <button
              type="button"
              onClick={() => setShowPicker(!showPicker)}
              className="p-1 hover:text-cyan-400 text-neutral-400 rounded-full transition-colors"
              title="React"
            >
              <Smile className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onReply(message)}
              className="p-1 hover:text-cyan-400 text-neutral-400 rounded-full transition-colors"
              title="Reply"
            >
              <Reply className="w-3.5 h-3.5" />
            </button>
            {isSender && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(true);
                    setEditText(message.text);
                  }}
                  className="p-1 hover:text-cyan-400 text-neutral-400 rounded-full transition-colors"
                  title="Edit"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(message.id)}
                  className="p-1 hover:text-red-400 text-neutral-400 rounded-full transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}

        {showPicker && (
          <ReactionPicker
            onSelect={(emoji) => onReaction(message.id, emoji)}
            onClose={() => setShowPicker(false)}
          />
        )}
      </div>

      {/* Reactions list */}
      {message.reactions && message.reactions.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1 mt-0.5">
          {Array.from(
            message.reactions.reduce((acc, r) => {
              acc.set(r.emoji, (acc.get(r.emoji) || 0) + 1);
              return acc;
            }, new Map<string, number>()),
          ).map(([emoji, count]) => {
            const hasUserReacted = message.reactions?.some(
              (r) => r.emoji === emoji && r.userId === currentUserId,
            );
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => onReaction(message.id, emoji)}
                className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 border transition-colors ${
                  hasUserReacted
                    ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                    : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'
                }`}
              >
                <span>{emoji}</span>
                <span className="text-[10px] font-mono">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
