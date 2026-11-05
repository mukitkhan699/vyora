import { seedDemoAccounts } from '../auth.ts';
import { closeDatabase, verifyDatabase } from './pool.ts';
import { dbAdapter } from './adapter.ts';

try {
  await verifyDatabase();
  await seedDemoAccounts();
  await dbAdapter.seedDemoData();
  console.info('Demo accounts and sample social content were added where absent.');
} catch {
  console.error('Demo data seeding failed. Existing records were not overwritten.');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
