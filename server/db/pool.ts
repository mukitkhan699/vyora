import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

let pool: Pool | undefined;
let migrationPool: Pool | undefined;

function getDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.');
  }
  return connectionString;
}

function getDirectDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL_DIRECT?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL_DIRECT is required to run database migrations.');
  }
  return connectionString;
}

function createPool(connectionString: string): Pool {
  const newPool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: true },
  });
  newPool.on('error', () => {
    console.error('Unexpected error from an idle PostgreSQL connection.');
  });
  return newPool;
}

export function getPool(): Pool {
  if (!pool) {
    pool = createPool(getDatabaseUrl());
  }
  return pool;
}

export function getMigrationPool(): Pool {
  if (!migrationPool) {
    migrationPool = createPool(getDirectDatabaseUrl());
  }
  return migrationPool;
}

export function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<Row>> {
  return getPool().query<Row>(text, values);
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyDatabase(): Promise<void> {
  await query('SELECT 1');
  const schema = await query<{ ready: boolean }>(
    `SELECT
       to_regclass('public.zunari_users') IS NOT NULL
       AND to_regclass('public.zunari_sessions') IS NOT NULL
       AND to_regclass('public.zunari_posts') IS NOT NULL
       AND to_regclass('public.zunari_notifications') IS NOT NULL
       AND to_regclass('public.zunari_messages') IS NOT NULL
       AND to_regclass('public.zunari_media_assets') IS NOT NULL AS ready`,
  );
  if (!schema.rows[0]?.ready) {
    throw new Error('Zunari database schema is not installed. Run the approved migration command.');
  }
}

export async function closeDatabase(): Promise<void> {
  const activePools = [pool, migrationPool].filter((activePool): activePool is Pool =>
    Boolean(activePool),
  );
  pool = undefined;
  migrationPool = undefined;
  const results = await Promise.allSettled(activePools.map((activePool) => activePool.end()));
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length) {
    throw new AggregateError(failures, 'Unable to close all PostgreSQL connection pools.');
  }
}
