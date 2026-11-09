import { validateServerConfiguration } from './config.ts';
import { initAuth } from './auth.ts';
import { bootstrapSuperAdmin } from './auth/admin.ts';
import { cleanupExpiredRateLimits } from './rate-limit.ts';
import { cleanupAbandonedUploads, validateStorageConfiguration } from './storage/b2.ts';
import { cleanupDeliveredOrExpiredAttachments } from './storage/attachments.ts';
import { verifyDatabase } from './db/pool.ts';

export async function initializeBackend(): Promise<() => void> {
  console.info('[startup] Validating server configuration...');
  validateServerConfiguration();
  console.info('[startup] Server configuration validated.');

  console.info('[startup] Validating storage configuration...');
  validateStorageConfiguration();
  console.info('[startup] Storage configuration validated.');

  console.info('[startup] Verifying database connection and schema readiness...');
  await verifyDatabase();
  console.info('[startup] Database schema readiness verified.');

  console.info('[startup] Initializing authentication subsystem...');
  await initAuth();
  console.info('[startup] Authentication subsystem initialized.');

  console.info('[startup] Bootstrapping super admin account if configured...');
  await bootstrapSuperAdmin();
  console.info('[startup] Admin bootstrap complete.');

  console.info('[startup] Initializing scheduled maintenance tasks...');
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
  console.info('[startup] Scheduled maintenance tasks initialized.');

  return () => clearInterval(cleanupTimer);
}
