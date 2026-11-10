import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Phone, PhoneOff, Video } from 'lucide-react';
import type { IncomingCallInfo } from './types.ts';
import { Avatar } from '../common/Avatar.tsx';

interface IncomingCallScreenProps {
  incoming: IncomingCallInfo;
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
}

export const IncomingCallScreen: React.FC<IncomingCallScreenProps> = ({
  incoming,
  onAccept,
  onDecline,
}) => {
  const [responding, setResponding] = useState<'accept' | 'decline' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const declineRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    timerRef.current = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    declineRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const container = containerRef.current;
    if (!container) return;
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    );
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleAccept = async () => {
    if (responding) return;
    setResponding('accept');
    try {
      await onAccept();
    } catch {
      setResponding(null);
    }
  };

  const handleDecline = async () => {
    if (responding) return;
    setResponding('decline');
    try {
      await onDecline();
    } finally {
      setResponding(null);
    }
  };

  const ringingHint =
    elapsed >= 45
      ? 'No answer yet — you can still answer while the caller is ringing.'
      : 'The caller is waiting for you.';

  const elapsedMinutes = Math.floor(elapsed / 60);
  const elapsedSeconds = elapsed % 60;
  const elapsedTime = `${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}`;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="incoming-call-title"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[80] flex flex-col z-safe-top z-safe-bottom outline-none"
      style={{
        backgroundColor: 'var(--z-bg-deep)',
        backgroundImage:
          'radial-gradient(ellipse at 50% 8%, var(--z-accent-soft), transparent 58%)',
      }}
    >
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] font-semibold z-accent">
          {incoming.type === 'video' ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
          Incoming {incoming.type} call
        </div>

        <div className="relative mt-8 mb-6">
          <div className="absolute inset-0 rounded-full z-call-ring" aria-hidden="true" />
          <Avatar
            src={incoming.caller.avatarUrl}
            name={incoming.caller.name || incoming.caller.username}
            size="2xl"
            className="!border-2"
          />
        </div>

        <h1 id="incoming-call-title" className="text-2xl sm:text-3xl font-bold z-text z-display">
          {incoming.title || incoming.caller.name}
        </h1>
        <p className="text-sm z-secondary mt-1.5">@{incoming.caller.username}</p>
        <p className="text-xs z-muted mt-5 max-w-xs leading-relaxed" role="status">{ringingHint}</p>
        <p className="text-xs z-muted mt-1" aria-live="polite" role="timer" aria-label={`Ringing for ${elapsedTime}`}>
          Ringing for {elapsedTime}
        </p>
        {incoming.isGroup && (
          <p className="text-[11px] z-muted mt-1">
            Group call · {incoming.participantCount || 0} participants
          </p>
        )}
        {incoming.type === 'video' && (
          <p className="text-[11px] z-muted mt-1">
            Camera permission is requested after you answer.
          </p>
        )}
      </div>

      <div className="px-8 pb-10 sm:pb-14 flex items-start justify-center gap-14 sm:gap-20">
        <div className="flex flex-col items-center gap-2.5">
          <button
            ref={declineRef}
            type="button"
            onClick={() => void handleDecline()}
            disabled={responding !== null}
            aria-label="Decline call"
            className="w-16 h-16 rounded-full flex items-center justify-center text-white transition-transform active:scale-95 z-focus disabled:opacity-60"
            style={{ backgroundColor: 'var(--z-danger)', color: 'var(--z-accent-contrast)' }}
          >
            {responding === 'decline' ? <Loader2 className="w-6 h-6 animate-spin" /> : <PhoneOff className="w-6 h-6" />}
          </button>
          <span className="text-[11px] font-semibold z-secondary">Decline</span>
        </div>

        <div className="flex flex-col items-center gap-2.5">
          <button
            type="button"
            onClick={() => void handleAccept()}
            disabled={responding !== null}
            aria-label="Accept call"
            className="w-16 h-16 rounded-full flex items-center justify-center transition-transform active:scale-95 z-focus disabled:opacity-60"
            style={{ backgroundColor: 'var(--z-success)', color: 'var(--z-accent-contrast)' }}
          >
            {responding === 'accept' ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : incoming.type === 'video' ? (
              <Video className="w-6 h-6" />
            ) : (
              <Phone className="w-6 h-6" />
            )}
          </button>
          <span className="text-[11px] font-semibold z-secondary">Accept</span>
        </div>
      </div>
    </div>
  );
};
