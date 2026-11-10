import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Check,
  FileText,
  Image as ImageIcon,
  Music,
  Paperclip,
  RefreshCw,
  Trash2,
  UploadCloud,
  Video as VideoIcon,
  X,
} from 'lucide-react';
import type { PendingMessageAttachment } from '../../types/index.ts';
import { describeFileSize } from '../../utils/messaging.ts';
import { IconButton } from '../common/IconButton.tsx';

interface AttachmentPickerProps {
  isOpen: boolean;
  pending: PendingMessageAttachment[];
  onClose: () => void;
  onPickFiles: (files: File[]) => void;
  onCancel: (localId: string) => void;
  onRetry: (localId: string) => void;
  onRemove: (localId: string) => void;
}

const ACCEPT = {
  image: 'image/jpeg,image/png,image/gif,image/webp',
  video: 'video/mp4,video/webm',
  document: 'application/pdf,text/plain',
  audio: 'audio/mpeg,audio/ogg,audio/wav',
};

export const AttachmentPicker: React.FC<AttachmentPickerProps> = ({
  isOpen,
  pending,
  onClose,
  onPickFiles,
  onCancel,
  onRetry,
  onRemove,
}) => {
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dropZoneRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 30);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled])'),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  const uploading = pending.filter((item) => item.status === 'uploading').length;
  const readyCount = pending.filter((item) => item.status === 'ready').length;
  const hasFiles = pending.length > 0;

  const fileInput = (ref: React.RefObject<HTMLInputElement | null>, accept: string) => (
    <input
      ref={ref}
      type="file"
      accept={accept}
      multiple
      className="hidden"
      onChange={(event) => {
        const files = Array.from(event.target.files || []);
        if (files.length > 0) onPickFiles(files);
        event.target.value = '';
      }}
    />
  );

  const summary = useMemo(() => {
    if (uploading > 0) return `Uploading ${uploading} file${uploading === 1 ? '' : 's'}…`;
    if (readyCount > 0) return `${readyCount} ready to send`;
    return 'Photos, videos, documents and audio up to 10 MB';
  }, [uploading, readyCount]);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="absolute inset-0 z-scrim backdrop-blur-sm z-fade-enter" onClick={onClose} aria-hidden="true" />
      <div className="relative z-surface border z-border w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl z-shadow z-rise-enter max-h-[88dvh] flex flex-col z-safe-bottom">
        <div className="flex items-center justify-between px-5 py-4 border-b z-border shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-bold z-text z-display flex items-center gap-2">
              <Paperclip className="w-4 h-4 z-accent" /> Attach files
            </h2>
            <p className="text-xs z-muted mt-0.5">{summary}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close attachment picker"
            className="w-8 h-8 rounded-full flex items-center justify-center z-secondary hover:z-text hover:z-surface-2 z-focus"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto z-scroll flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <PickerTile icon={<ImageIcon className="w-5 h-5" />} label="Photo" onClick={() => imageRef.current?.click()} />
            <PickerTile icon={<VideoIcon className="w-5 h-5" />} label="Video" onClick={() => videoRef.current?.click()} />
            <PickerTile icon={<FileText className="w-5 h-5" />} label="Document" onClick={() => documentRef.current?.click()} />
            <PickerTile icon={<Music className="w-5 h-5" />} label="Audio" onClick={() => audioRef.current?.click()} />
          </div>

          {!hasFiles ? (
            <button
              ref={dropZoneRef}
              type="button"
              onClick={() => allRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  allRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                const files = Array.from(event.dataTransfer.files || []);
                if (files.length > 0) onPickFiles(files);
              }}
              className={`rounded-2xl border border-dashed p-8 text-center flex flex-col items-center gap-2 transition-colors z-focus ${
                dragActive ? 'z-accent-soft-bg border-[var(--z-accent-border)]' : 'z-border'
              }`}
              aria-label="Browse all files or drop files here"
            >
              <div className="w-12 h-12 rounded-2xl z-accent-soft-bg z-accent flex items-center justify-center">
                <UploadCloud className="w-5 h-5" />
              </div>
              <p className="text-sm font-semibold z-text">Nothing selected yet</p>
              <p className="text-xs z-muted max-w-xs leading-relaxed">
                Drop files here, choose a category above, or browse all supported files. Uploads run before sending.
              </p>
            </button>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Selected attachments">
              {pending.map((item) => (
                <li key={item.localId} className="rounded-2xl border z-border z-surface-2 p-3 flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl overflow-hidden z-surface-3 flex items-center justify-center shrink-0">
                    {item.previewUrl ? (
                      <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
                    ) : item.mimeType.startsWith('video/') ? (
                      <VideoIcon className="w-5 h-5 z-secondary" aria-hidden="true" />
                    ) : item.mimeType.startsWith('audio/') ? (
                      <Music className="w-5 h-5 z-secondary" aria-hidden="true" />
                    ) : (
                      <FileText className="w-5 h-5 z-secondary" aria-hidden="true" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold z-text truncate flex-1">{item.name}</p>
                      {item.status === 'ready' && (
                        <span className="w-5 h-5 rounded-full z-success-soft-bg z-success-text flex items-center justify-center shrink-0" aria-label="Upload complete">
                          <Check className="w-3 h-3" aria-hidden="true" />
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] z-muted mt-0.5">
                      {describeFileSize(item.size)}
                      {item.status === 'uploading' ? ` · ${Math.round(item.progress)}%` : ''}
                      {item.status === 'failed' ? ' · Upload failed' : ''}
                    </p>

                    {item.status === 'uploading' && (
                      <div
                        className="z-progress-track h-1.5 mt-2"
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
                    {item.status === 'failed' && (
                      <p className="text-[11px] mt-1" role="alert" style={{ color: 'var(--z-danger)' }}>{item.error || 'Upload failed.'}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    {item.status === 'uploading' && (
                      <button
                        type="button"
                        onClick={() => onCancel(item.localId)}
                        className="text-[11px] font-semibold z-muted hover:z-text px-2 py-1.5 rounded-lg z-focus"
                      >
                        Cancel
                      </button>
                    )}
                    {item.status === 'failed' && (
                      <IconButton
                        icon={<RefreshCw className="w-4 h-4" />}
                        label={`Retry ${item.name}`}
                        size="sm"
                        onClick={() => onRetry(item.localId)}
                      />
                    )}
                    <IconButton
                      icon={<Trash2 className="w-4 h-4" />}
                      label={`Remove ${item.name}`}
                      size="sm"
                      onClick={() => onRemove(item.localId)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 border-t z-border flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] z-muted leading-relaxed" aria-live="polite">
            {uploading > 0 ? 'Please wait for uploads to complete.' : 'Files are verified by the server before sending.'}
          </p>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading > 0}
            aria-disabled={uploading > 0}
            className="px-4 py-2 rounded-xl z-accent-bg text-sm font-bold disabled:opacity-45 disabled:cursor-not-allowed z-focus transition-opacity"
          >
            Done
          </button>
        </div>
      </div>

      {fileInput(imageRef, ACCEPT.image)}
      {fileInput(videoRef, ACCEPT.video)}
      {fileInput(documentRef, ACCEPT.document)}
      {fileInput(audioRef, ACCEPT.audio)}
      {fileInput(allRef, [...ACCEPT.image, ...ACCEPT.video, ...ACCEPT.document, ...ACCEPT.audio].join(','))}
    </div>
  );
};

const PickerTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}> = ({ icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex flex-col items-center justify-center gap-2 rounded-2xl border z-border z-surface-2 px-3 py-4 z-secondary hover:z-text hover:z-surface-3 transition-colors z-focus z-no-tap-highlight"
  >
    <span className="z-accent">{icon}</span>
    <span className="text-xs font-semibold">{label}</span>
  </button>
);
