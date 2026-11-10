import { useEffect } from 'react';

interface SyncManager {
  register(tag: string): Promise<void>;
}

interface PeriodicSyncManager {
  register(tag: string, options?: { minInterval: number }): Promise<void>;
}

interface ExtendedServiceWorkerRegistration extends ServiceWorkerRegistration {
  sync?: SyncManager;
  periodicSync?: PeriodicSyncManager;
}

export function useServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        // Handle updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version available
                console.log('New version available, please refresh');
                // Could dispatch a custom event or use a context to notify the user
              }
            });
          }
        });

        // Register for background sync
        const extRegistration = registration as ExtendedServiceWorkerRegistration;
        if (extRegistration.sync) {
          try {
            await extRegistration.sync.register('send-messages');
            console.log('Background sync registered');
          } catch (error) {
            console.warn('Background sync registration failed:', error);
          }
        }

        // Periodic sync (if supported)
        if (extRegistration.periodicSync) {
          try {
            await extRegistration.periodicSync.register('sync-conversations', {
              minInterval: 60 * 60 * 1000, // 1 hour
            });
            console.log('Periodic sync registered');
          } catch (error) {
            console.warn('Periodic sync not supported or registration failed:', error);
          }
        }
      } catch (error) {
        console.error('Service worker registration failed:', error);
      }
    };

    // Register after page load to not block initial render
    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW, { once: true });
    }

    return () => {
      window.removeEventListener('load', registerSW);
    };
  }, []);
}

export function requestBackgroundSync(tag = 'send-messages'): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.reject(new Error('Background sync not supported'));
  }

  return navigator.serviceWorker.ready.then((registration) => {
    const extRegistration = registration as ExtendedServiceWorkerRegistration;
    if (!extRegistration.sync) {
      return Promise.reject(new Error('Background sync not supported'));
    }
    return extRegistration.sync.register(tag);
  });
}

export function notifyServiceWorker(type: string, payload?: unknown): void {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker.controller) return;

  navigator.serviceWorker.controller.postMessage({ type, payload });
}