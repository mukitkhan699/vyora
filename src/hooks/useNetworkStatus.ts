import { useEffect, useState } from 'react';

// Network Information API types (not in all TypeScript libs)
interface NetworkInformation extends EventTarget {
  readonly downlink: number;
  readonly effectiveType: 'slow-2g' | '2g' | '3g' | '4g';
  readonly rtt: number;
  readonly saveData: boolean;
  addEventListener(type: 'change', listener: (this: NetworkInformation, ev: Event) => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: 'change', listener: (this: NetworkInformation, ev: Event) => void, options?: boolean | EventListenerOptions): void;
}

export interface NetworkStatus {
  online: boolean;
  wasOffline: boolean;
  lastOnlineAt: number | null;
  lastOfflineAt: number | null;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    wasOffline: false,
    lastOnlineAt: typeof navigator !== 'undefined' && navigator.onLine ? Date.now() : null,
    lastOfflineAt: null,
  });

  useEffect(() => {
    const handleOnline = () => {
      setStatus((prev) => ({
        online: true,
        wasOffline: true,
        lastOnlineAt: Date.now(),
        lastOfflineAt: prev.lastOfflineAt,
      }));
    };

    const handleOffline = () => {
      setStatus((prev) => ({
        online: false,
        wasOffline: true,
        lastOnlineAt: prev.lastOnlineAt,
        lastOfflineAt: Date.now(),
      }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return status;
}

export function useConnectionQuality(): 'good' | 'poor' | 'offline' {
  const [quality, setQuality] = useState<'good' | 'poor' | 'offline'>(
    typeof navigator !== 'undefined' && navigator.onLine ? 'good' : 'offline'
  );

  useEffect(() => {
    if (typeof navigator === 'undefined') return;

    const connection = (navigator as Navigator & {
      connection?: NetworkInformation & EventTarget;
    }).connection;
    if (!connection) return;

    const updateQuality = () => {
      if (!navigator.onLine) {
        setQuality('offline');
        return;
      }
      const effectiveType = connection.effectiveType || '4g';
      const rtt = connection.rtt || 0;
      if (effectiveType === 'slow-2g' || effectiveType === '2g' || rtt > 300) {
        setQuality('poor');
      } else {
        setQuality('good');
      }
    };

    updateQuality();
    connection.addEventListener('change', updateQuality);
    window.addEventListener('online', updateQuality);
    window.addEventListener('offline', updateQuality);

    return () => {
      connection.removeEventListener('change', updateQuality);
      window.removeEventListener('online', updateQuality);
      window.removeEventListener('offline', updateQuality);
    };
  }, []);

  return quality;
}