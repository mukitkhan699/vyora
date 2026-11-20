export type ConnectionQuality = 'good' | 'poor' | 'offline';
export type ConnectionSyncState =
  | 'offline'
  | 'reconnecting'
  | 'syncing'
  | 'connected'
  | 'sync-error';
export type ConnectionNoticeKind =
  | 'offline'
  | 'reconnecting'
  | 'syncing'
  | 'sync-error'
  | 'slow'
  | 'restored';

export interface ConnectionNotice {
  kind: ConnectionNoticeKind;
  message: string;
  dismissAfterMs?: number;
}

interface ConnectionNoticeInput {
  online: boolean;
  quality: ConnectionQuality;
  state: ConnectionSyncState;
  hadConnectionIssue: boolean;
}

const NOTICE_COPY: Record<ConnectionNoticeKind, string> = {
  offline: "You're offline. Changes will sync when reconnected.",
  reconnecting: 'Connection lost. Reconnecting…',
  syncing: 'Connection restored. Syncing messages…',
  'sync-error': 'Some messages could not sync. They may be delayed.',
  slow: 'Connection is slow. Messages may take longer.',
  restored: 'Connection restored',
};

export function getConnectionNoticeTransition({
  online,
  quality,
  state,
  hadConnectionIssue,
}: ConnectionNoticeInput): { notice: ConnectionNotice | null; hadConnectionIssue: boolean } {
  if (!online || quality === 'offline') {
    return {
      notice: { kind: 'offline', message: NOTICE_COPY.offline },
      hadConnectionIssue: true,
    };
  }

  if (state === 'offline' || state === 'reconnecting') {
    return {
      notice: { kind: 'reconnecting', message: NOTICE_COPY.reconnecting },
      hadConnectionIssue: true,
    };
  }

  if (state === 'syncing') {
    return {
      notice: { kind: 'syncing', message: NOTICE_COPY.syncing },
      hadConnectionIssue: true,
    };
  }

  if (state === 'sync-error') {
    return {
      notice: {
        kind: 'sync-error',
        message: NOTICE_COPY['sync-error'],
        dismissAfterMs: 5000,
      },
      hadConnectionIssue: true,
    };
  }

  if (quality === 'poor') {
    return {
      notice: { kind: 'slow', message: NOTICE_COPY.slow, dismissAfterMs: 3000 },
      hadConnectionIssue,
    };
  }

  if (hadConnectionIssue) {
    return {
      notice: { kind: 'restored', message: NOTICE_COPY.restored, dismissAfterMs: 2500 },
      hadConnectionIssue: false,
    };
  }

  return { notice: null, hadConnectionIssue: false };
}
