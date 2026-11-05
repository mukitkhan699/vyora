import { validateServerConfiguration } from './config.ts';
import { initAuth } from './auth.ts';
import { cleanupAbandonedUploads, validateStorageConfiguration } from './storage/b2.ts';

export async function initializeBackend(): Promise<() => void> {
  validateServerConfiguration();
  validateStorageConfiguration();
  await initAuth();
  await cleanupAbandonedUploads();

  const cleanupTimer = setInterval(() => {
    void cleanupAbandonedUploads().catch(() => {
      console.error('Scheduled media cleanup failed; it will be retried later.');
    });
  }, 15 * 60 * 1000);
  cleanupTimer.unref();
  return () => clearInterval(cleanupTimer);
}
