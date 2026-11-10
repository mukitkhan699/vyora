import React from 'react';
import { WifiOff, AlertTriangle } from 'lucide-react';
import { useNetworkStatus, useConnectionQuality } from '../../hooks/useNetworkStatus.ts';

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

  if (online && quality === 'good' && !wasOffline) return null;

  if (compact) {
    return (
      <div
        className={`fixed ${position === 'top' ? 'top-0' : 'bottom-0'} left-0 right-0 z-50 flex justify-center px-4 py-2 ${
          quality === 'poor' ? 'bg-yellow-600/90 text-yellow-50' : 'bg-red-600/90 text-white'
        } backdrop-blur-sm border-b ${quality === 'poor' ? 'border-yellow-500' : 'border-red-500'}`}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {quality === 'poor' ? (
            <>
              <AlertTriangle className="w-4 h-4" />
              <span>Slow connection</span>
            </>
          ) : !online ? (
            <>
              <WifiOff className="w-4 h-4" />
              <span>Offline - changes will sync when reconnected</span>
            </>
          ) : wasOffline ? (
            <>
              <AlertTriangle className="w-4 h-4" />
              <span>Reconnected - syncing...</span>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`fixed ${position === 'top' ? 'top-0' : 'bottom-0'} left-0 right-0 z-50 ${
        quality === 'poor' ? 'bg-yellow-600/95 text-yellow-50' : 'bg-red-600/95 text-white'
      } backdrop-blur-sm border-b ${quality === 'poor' ? 'border-yellow-500' : 'border-red-500'} px-4 py-2.5`}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-4xl mx-auto flex items-center justify-center gap-2 text-sm font-medium">
        {quality === 'poor' && (
          <>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>Slow connection - messages may take longer to send</span>
          </>
        )}
        {!online && (
          <>
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            <span>You're offline. Messages will be sent when you reconnect.</span>
          </>
        )}
        {online && wasOffline && quality === 'good' && (
          <>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>Reconnected - syncing messages...</span>
          </>
        )}
      </div>
    </div>
  );
};