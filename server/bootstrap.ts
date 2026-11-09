import { validateServerConfiguration } from './config.ts';
import { initAuth } from './auth.ts';
import { bootstrapSuperAdmin } from './auth/admin.ts';
import { cleanupExpiredRateLimits } from './rate-limit.ts';
import { cleanupAbandonedUploads, validateStorageConfiguration } from './storage/b2.ts';
import { verifyDatabase, getMigrationPool } from './db/pool.ts';
import { applyMigrations } from './db/migrate.ts';

export async function initializeBackend(): Promise<() => void> {
  validateServerConfiguration();
  validateStorageConfiguration();
  await initAuth();
  await bootstrapSuperAdmin();
  
  // Verify database schema and migrations on startup
  await verifyDatabase();
  const migrationPool = getMigrationPool();
  await applyMigrations({ pool: migrationPool, logger: (msg) => console.info(`[migration] ${msg}`) });
  
  await cleanupAbandonedUploads();
  await cleanupExpiredRateLimits();

  const cleanupTimer = setInterval(() => {
    void Promise.all([cleanupAbandonedUploads(), cleanupExpiredRateLimits()]).catch(() => {
      console.error('Scheduled cleanup failed; it will be retried later.');
    });
  }, 15 * 60 * 1000);
  cleanupTimer.unref();
  return () => clearInterval(cleanupTimer);
}
