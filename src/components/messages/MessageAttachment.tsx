import React from 'react';
import { AlertTriangle, Download, FileText, Film, Music, Play } from 'lucide-react';
import type { MessageAttachment as Attachment } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { CachedImage } from '../common/CachedImage.tsx';
import { describeFileSize, isAudioMime, isImageMime, isVideoMime } from '../../utils/messaging.ts';

interface MessageAttachmentProps {
  attachment: Attachment;
  variant: 'incoming' | 'outgoing';
  onOpenImage: (attachment: Attachment) => void;
}

export const MessageAttachment: React.FC<MessageAttachmentProps> = ({
  attachment,
  variant,
  onOpenImage,
}) => {
  const unavailable = attachment.status !== 'active';
  const url = api.resolveFileUrl(attachment.url);
  const tone = variant === 'outgoing' ? 'var(--z-bubble-out-text)' : 'var(--z-bubble-in-text)';
  const soft =
    variant === 'outgoing'
      ? 'rgba(255,255,255,0.07)'
      : 'var(--z-surface-3)';

  if (unavailable) {
    return (
      <div
        className="mt-2 rounded-xl px-3 py-2.5 flex items-start gap-2.5 text-xs"
        style={{ backgroundColor: soft, color: tone }}
      >
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--z-warning)' }} />
        <div className="min-w-0">
          <p className="font-semibold truncate">{attachment.filename}</p>
          <p className="opacity-70 mt-0.5">
            This attachment is no longer available. Attachments expire after delivery or after 7 days.
          </p>
        </div>
      </div>
    );
  }

  if (isImageMime(attachment.mimeType)) {
    return (
      <button
        type="button"
        onClick={() => onOpenImage(attachment)}
        className="mt-2 block w-full overflow-hidden rounded-xl z-focus group/img"
        aria-label={`Open image ${attachment.filename}`}
      >
        <CachedImage
          assetId={attachment.mediaAssetId}
          conversationId={attachment.messageId.split('-')[0] || ''}
          src={attachment.url}
          alt={attachment.filename}
          contentType={attachment.mimeType}
          className="max-h-80 w-full object-contain bg-black/15 transition-transform duration-300 group-hover/img:scale-[1.01]"
        />
      </button>
    );
  }

  if (isVideoMime(attachment.mimeType)) {
    return (
      <div className="mt-2 rounded-xl overflow-hidden" style={{ backgroundColor: 'rgba(0,0,0,0.22)' }}>
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          className="max-h-80 w-full bg-black object-contain"
          aria-label={`Video attachment ${attachment.filename}`}
        />
        <div className="px-2.5 py-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: tone }}>
          <Film className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate flex-1">{attachment.filename}</span>
          <span className="opacity-60">{describeFileSize(attachment.byteSize)}</span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open video ${attachment.filename}`}
            className="p-1 rounded-lg hover:bg-white/10 z-focus"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    );
  }

  if (isAudioMime(attachment.mimeType)) {
    return (
      <div className="mt-2 rounded-xl px-3 py-2.5" style={{ backgroundColor: soft }}>
        <div className="flex items-center gap-2 mb-2 text-xs" style={{ color: tone }}>
          <Music className="w-4 h-4 shrink-0" />
          <span className="truncate flex-1 font-medium">{attachment.filename}</span>
          <span className="opacity-60">{describeFileSize(attachment.byteSize)}</span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open audio ${attachment.filename}`}
            className="p-1 rounded-lg hover:bg-white/10 z-focus"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
        <audio src={url} controls preload="metadata" className="w-full h-8" aria-label={`Audio attachment ${attachment.filename}`} />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={attachment.filename}
      className="mt-2 rounded-xl px-3 py-2.5 flex items-center gap-3 z-focus"
      style={{ backgroundColor: soft, color: tone }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: 'var(--z-accent-soft)', color: 'var(--z-accent)' }}
      >
        <FileText className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold truncate">{attachment.filename}</p>
        <p className="text-[11px] opacity-60 mt-0.5">{describeFileSize(attachment.byteSize)}</p>
      </div>
      <Download className="w-4 h-4 shrink-0 opacity-60" />
    </a>
  );
};

export const VideoAttachmentBadge: React.FC = () => (
  <span className="inline-flex items-center gap-1 text-[10px] font-semibold">
    <Play className="w-3 h-3" /> Video
  </span>
);
