#!/usr/bin/env node
/**
 * Read-only migration ledger diagnostic.
 * Uses DATABASE_URL_DIRECT from environment.
 * Prints migration versions and timestamps.
 * Exits 0 on success, 1 on connection/ledger errors.
 * Never prints credentials.
 */

import { getMigrationPool } from '../dist/server/db/pool.js';

async function checkMigrations() {
  let pool;
  try {
    pool = getMigrationPool();
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT version, checksum, applied_at
        FROM zunari_schema_migrations
        ORDER BY version
      `);
      if (result.rows.length === 0) {
        console.log('Migration ledger exists but is empty (no migrations applied).');
      } else {
        console.log('Applied migrations:');
        console.table(result.rows.map(r => ({
          version: r.version,
          applied_at: r.applied_at,
          checksum: r.checksum.slice(0, 16) + '...'
        })));
      }
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.code === '42P01') {
      console.error('ERROR: Migration ledger table "zunari_schema_migrations" does not exist.');
      console.error('No migrations have been applied to this database.');
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.error('ERROR: Cannot connect to database. Check DATABASE_URL_DIRECT.');
    } else {
      console.error('ERROR:', error.message);
    }
    process.exitCode = 1;
  } finally {
    if (pool) {
      await pool.end().catch(() => {});
    }
  }
}

checkMigrations();