import React from 'react';
import { WifiOff, AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { useNetworkStatus, useConnectionQuality } from '../../hooks/useNetworkStatus.ts';
import { useSyncStatus } from '../../hooks/useSyncStatus.ts';

interface OfflineIndicatorProps {
  position?: 'top' | 'bottom';
  compact?: boolean;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  position = 'top',
  compact = false,
}) => {
  const { online, wasOffline } = useNetworkStatus();
  const quality = useConnectionQuality();
  const { state, error, lastSyncedAt } = useSyncStatus();

  // Don't show anything if we're fully connected and never had issues
  if (online && quality === 'good' && !wasOffline && state === 'connected' && !error) return null;

  const getStatusContent = () => {
    switch (state) {
      case 'offline':
        return (
          <>
            <WifiOff className="w-4 h-4" />
            <span>You're offline. Changes will sync when reconnected.</span>
          </>
        );
      case 'reconnecting':
        return (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Reconnecting...</span>
          </>
        );
      case 'syncing':
        return (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Syncing messages...</span>
          </>
        );
      case 'sync-error':
        return (
          <>
            <AlertTriangle className="w-4 h-4" />
            <span>Sync failed: {error || 'Unknown error'}</span>
          </>
        );
      case 'connected':
        if (wasOffline) {
          return (
            <>
              <CheckCircle className="w-4 h-4" />
              <span>Reconnected - synced successfully</span>
            </>
          );
        }
        if (quality === 'poor') {
          return (
            <>
              <AlertTriangle className="w-4 h-4" />
              <span>Slow connection - messages may take longer to send</span>
            </>
          );
        }
        return null;
    }
  };

  const content = getStatusContent();
  if (!content) return null;

  if (compact) {
    return (
      <div
        className={`fixed ${position === 'top' ? 'top-0' : 'bottom-0'} left-0 right-0 z-50 flex justify-center px-4 py-2 ${
          state === 'sync-error' ? 'bg-red-600/90 text-white' : 
          state === 'offline' ? 'bg-red-600/90 text-white' :
          state === 'reconnecting' || state === 'syncing' ? 'bg-yellow-600/90 text-yellow-50' :
          'bg-green-600/90 text-white'
        } backdrop-blur-sm border-b ${
          state === 'sync-error' ? 'border-red-500' :
          state === 'offline' ? 'border-red-500' :
          state === 'reconnecting' || state === 'syncing' ? 'border-yellow-500' :
          'border-green-500'
        }`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`fixed ${position === 'top' ? 'top-0' : 'bottom-0'} left-0 right-0 z-50 ${
        state === 'sync-error' ? 'bg-red-600/95 text-white' : 
        state === 'offline' ? 'bg-red-600/95 text-white' :
        state === 'reconnecting' || state === 'syncing' ? 'bg-yellow-600/95 text-yellow-50' :
        'bg-green-600/95 text-white'
      } backdrop-blur-sm border-b ${
        state === 'sync-error' ? 'border-red-500' :
        state === 'offline' ? 'border-red-500' :
        state === 'reconnecting' || state === 'syncing' ? 'border-yellow-500' :
        'border-green-500'
      } px-4 py-2.5`}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-4xl mx-auto flex items-center justify-center gap-2 text-sm font-medium">
        {content}
      </div>
    </div>
  );
};