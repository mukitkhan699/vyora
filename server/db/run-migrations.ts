import '../config.ts';
import { closeDatabase } from './pool.ts';
import { applyMigrations, describeMigrationFailure } from './migrate.ts';

let migrationError: unknown;
let closeError: unknown;

try {
  await applyMigrations();
} catch (error) {
  migrationError = error;
}

try {
  await closeDatabase();
} catch (error) {
  closeError = error;
}

if (migrationError || closeError) {
  const errors = [
    migrationError ? describeMigrationFailure(migrationError) : '',
    closeError ? `Database pool cleanup failed: ${describeMigrationFailure(closeError)}` : '',
  ].filter(Boolean);
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
