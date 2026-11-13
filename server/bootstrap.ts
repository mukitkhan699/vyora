import { validateServerConfiguration } from './config.ts';
import { initAuth } from './auth.ts';
import { bootstrapSuperAdmin } from './auth/admin.ts';
import { cleanupExpiredRateLimits } from './rate-limit.ts';
import { cleanupAbandonedUploads, validateStorageConfiguration } from './storage/b2.ts';
import { cleanupDeliveredOrExpiredAttachments } from './storage/attachments.ts';
import { verifyDatabase } from './db/pool.ts';

export async function initializeBackend(): Promise<() => Promise<void>> {
  console.info('[startup] Validating configuration...');
  validateServerConfiguration();
  validateStorageConfiguration();
  console.info('[startup] Configuration validated.');

  console.info('[startup] Initializing authentication...');
  await initAuth();
  console.info('[startup] Authentication initialized.');

  console.info('[startup] Bootstrapping super admin...');
  await bootstrapSuperAdmin();
  console.info('[startup] Super admin bootstrapped.');

  console.info('[startup] Verifying database schema...');
  await verifyDatabase();
  console.info('[startup] Database schema verified.');

  console.info('[startup] Cleaning up abandoned uploads...');
  await cleanupAbandonedUploads();
  console.info('[startup] Cleaning up expired rate limits...');
  await cleanupExpiredRateLimits();
  console.info('[startup] Cleaning up delivered or expired attachments...');
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
  return async () => {
    clearInterval(cleanupTimer);
  };
}
