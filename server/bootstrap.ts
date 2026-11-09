import { validateServerConfiguration } from './config.ts';
import { initAuth } from './auth.ts';
import { bootstrapSuperAdmin } from './auth/admin.ts';
import { cleanupExpiredRateLimits } from './rate-limit.ts';
import { cleanupAbandonedUploads, validateStorageConfiguration } from './storage/b2.ts';
import { cleanupDeliveredOrExpiredAttachments } from './storage/attachments.ts';
import { verifyDatabase, getMigrationPool } from './db/pool.ts';
import { applyMigrations } from './db/migrate.ts';

export async function initializeBackend(): Promise<() => void> {
  validateServerConfiguration();
  validateStorageConfiguration();
  await initAuth();
  await bootstrapSuperAdmin();
  
  // Verify database schema is installed and ready on startup using pooled connection
  await verifyDatabase();
  
  await cleanupAbandonedUploads();
  await cleanupExpiredRateLimits();
  await cleanupDeliveredOrExpiredAttachments().catch(() => {});

  const cleanupTimer = setInterval(() => {
    void Promise.all([
      cleanupAbandonedUploads(),
      cleanupExpiredRateLimits(),
      cleanupDeliveredOrExpiredAttachments(),
    ]).catch(() => {
      console.error('Scheduled cleanup failed; it will be retried later.');
    });
  }, 15 * 60 * 1000);
  cleanupTimer.unref();
  return () => clearInterval(cleanupTimer);
}
