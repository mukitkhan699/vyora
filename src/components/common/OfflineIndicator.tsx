import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2, WifiOff } from 'lucide-react';
import { useNetworkStatus, useConnectionQuality } from '../../hooks/useNetworkStatus.ts';
import { useSyncStatus } from '../../hooks/useSyncStatus.ts';
import { getConnectionNoticeTransition, type ConnectionNotice } from './connectionNotice.ts';

interface OfflineIndicatorProps {
  currentTab: string;
}

const NOTICE_STYLE: Record<ConnectionNotice['kind'], string> = {
  offline: 'border-red-400/25 text-red-100',
  reconnecting: 'border-amber-300/25 text-amber-100',
  syncing: 'border-amber-300/25 text-amber-100',
  'sync-error': 'border-red-400/25 text-red-100',
  slow: 'border-amber-300/25 text-amber-100',
  restored: 'border-emerald-300/25 text-emerald-100',
};

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ currentTab }) => {
  const { online } = useNetworkStatus();
  const quality = useConnectionQuality();
  const { state } = useSyncStatus();
  const [notice, setNotice] = useState<ConnectionNotice | null>(null);
  const [composerClearance, setComposerClearance] = useState<number | null>(null);
  const hadConnectionIssue = useRef(false);
  const dismissTimer = useRef<number | null>(null);
  const noticeRef = useRef<ConnectionNotice | null>(null);

  const updateNotice = (next: ConnectionNotice | null) => {
    setNotice(next);
  };

  useEffect(() => {
    const clearDismissTimer = () => {
      if (dismissTimer.current === null) return;
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    };

    const transition = getConnectionNoticeTransition({
      online,
      quality,
      state,
      hadConnectionIssue: hadConnectionIssue.current,
    });
    hadConnectionIssue.current = transition.hadConnectionIssue;
    const nextNotice = transition.notice;
    if (!nextNotice) return;

    const sameNotice = noticeRef.current?.kind === nextNotice.kind;
    if (sameNotice && (nextNotice.dismissAfterMs === undefined || dismissTimer.current !== null)) {
      return;
    }

    clearDismissTimer();
    noticeRef.current = nextNotice;
    updateNotice(nextNotice);
    if (nextNotice.dismissAfterMs !== undefined) {
      dismissTimer.current = window.setTimeout(() => {
        dismissTimer.current = null;
        noticeRef.current = null;
        updateNotice(null);
      }, nextNotice.dismissAfterMs);
    }
  }, [online, quality, state]);

  useEffect(() => () => {
    if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
  }, []);

  useEffect(() => {
    let observedComposer: Element | null = null;

    const getComposer = (): { element: HTMLElement | null; top: number | null } => {
      if (currentTab === 'messages') {
        const element = document.querySelector<HTMLElement>('[data-message-composer]');
        return { element, top: element?.getBoundingClientRect().top ?? null };
      }

      if (currentTab === 'qelari') {
        const iframe = document.querySelector<HTMLIFrameElement>(
          'iframe[title="Qelari AI workspace"]',
        );
        const dock = iframe?.contentDocument?.querySelector<HTMLElement>('#dock');
        if (iframe && dock) {
          return {
            element: dock,
            top: dock.classList.contains('hidden')
              ? null
              : iframe.getBoundingClientRect().top + dock.getBoundingClientRect().top,
          };
        }
      }

      return { element: null, top: null };
    };

    const updateComposerClearance = () => {
      const viewport = window.visualViewport;
      const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const { element, top: composerTop } = getComposer();
      if (currentTab === 'qelari') {
        const iframe = document.querySelector<HTMLIFrameElement>(
          'iframe[title="Qelari AI workspace"]',
        );
        const dock = iframe?.contentDocument?.querySelector<HTMLElement>('#dock') ?? null;
        if (dock !== observedDock) {
          dockClassObserver?.disconnect();
          observedDock = dock;
          if (observedDock) {
            dockClassObserver?.observe(observedDock, {
              attributes: true,
              attributeFilter: ['class'],
            });
          }
        }
      }
      if (element !== observedComposer) {
        if (observedComposer) resizeObserver?.unobserve(observedComposer);
        observedComposer = element;
        if (observedComposer) resizeObserver?.observe(observedComposer);
      }

      if (composerTop === null) {
        setComposerClearance(null);
        return;
      }

      const clearance = Math.max(12, visibleBottom - composerTop + 12);
      setComposerClearance((previous) =>
        previous !== null && Math.abs(previous - clearance) < 1 ? previous : clearance,
      );
    };

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateComposerClearance);
    const dockClassObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(updateComposerClearance);
    let observedDock: Element | null = null;
    const iframe = currentTab === 'qelari'
      ? document.querySelector<HTMLIFrameElement>('iframe[title="Qelari AI workspace"]')
      : null;
    const conversationMain = currentTab === 'messages'
      ? document.querySelector<HTMLElement>('main[aria-label="Conversation"]')
      : null;
    const childObserver = typeof MutationObserver === 'undefined' || !conversationMain
      ? null
      : new MutationObserver(updateComposerClearance);
    if (conversationMain) childObserver?.observe(conversationMain, { childList: true });

    iframe?.addEventListener('load', updateComposerClearance);
    window.addEventListener('resize', updateComposerClearance);
    window.visualViewport?.addEventListener('resize', updateComposerClearance);
    window.visualViewport?.addEventListener('scroll', updateComposerClearance);
    updateComposerClearance();

    return () => {
      resizeObserver?.disconnect();
      childObserver?.disconnect();
      dockClassObserver?.disconnect();
      iframe?.removeEventListener('load', updateComposerClearance);
      window.removeEventListener('resize', updateComposerClearance);
      window.visualViewport?.removeEventListener('resize', updateComposerClearance);
      window.visualViewport?.removeEventListener('scroll', updateComposerClearance);
    };
  }, [currentTab]);

  const mobileBottomClass = currentTab === 'qelari'
    ? 'bottom-20'
    : 'bottom-[calc(var(--z-mobile-nav-height)+0.75rem)]';
  const desktopBottomClass = currentTab === 'qelari' ? '' : 'sm:bottom-4';
  const Icon = notice?.kind === 'offline'
    ? WifiOff
    : notice?.kind === 'restored'
      ? CheckCircle
      : notice?.kind === 'sync-error' || notice?.kind === 'slow'
        ? AlertTriangle
        : Loader2;

  return (
    <div
      className={`pointer-events-none fixed ${mobileBottomClass} right-3 z-[60] transition-[opacity,transform] duration-200 ${desktopBottomClass} sm:right-4 ${
        notice ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
      style={composerClearance === null ? undefined : { bottom: `${composerClearance}px` }}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-hidden={!notice}
    >
      {notice && (
        <div
          className={`flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border bg-[#171A1D]/95 px-3.5 py-2 text-xs font-medium shadow-lg shadow-black/20 backdrop-blur-md ${NOTICE_STYLE[notice.kind]}`}
        >
          <Icon
            className={`h-3.5 w-3.5 shrink-0 ${
              notice.kind === 'reconnecting' || notice.kind === 'syncing'
                ? 'animate-spin'
                : ''
            }`}
            aria-hidden="true"
          />
          <span className="truncate">{notice.message}</span>
        </div>
      )}
    </div>
  );
};
