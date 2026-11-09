import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { redactSensitiveText } from '../errors.ts';
import { getMigrationPool } from './pool.ts';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const lockId = 7_318_202_504;

export interface MigrationPool {
  connect(): Promise<PoolClient>;
}

export interface MigrationRunnerOptions {
  migrationsDir?: string;
  pool?: MigrationPool;
  lockId?: number;
  logger?: (message: string) => void;
}

class MigrationFailure extends Error {
  readonly cleanupErrors: unknown[] = [];

  constructor(
    readonly stage: string,
    readonly filename: string | undefined,
    readonly statementIndex: number | undefined,
    readonly statement: string | undefined,
    readonly originalError: unknown,
    readonly rollbackError?: unknown,
  ) {
    super(`Migration failed during ${stage}.`);
    this.name = 'MigrationFailure';
  }

  addCleanupError(error: unknown): void {
    this.cleanupErrors.push(error);
  }
}

function formatDatabaseError(error: unknown, depth = 0): string {
  if (depth > 3) return 'Additional error details omitted.';
  if (error instanceof AggregateError) {
    const causes = Array.from(error.errors, (cause) => formatDatabaseError(cause, depth + 1));
    return redactSensitiveText(
      `${error.name}: ${error.message}${causes.length ? ` (${causes.join('; ')})` : ''}`,
    );
  }
  if (!error || typeof error !== 'object') {
    return redactSensitiveText(String(error));
  }
  const fields = error as Record<string, unknown>;
  const details: string[] = [];
  for (const [field, label] of [
    ['code', 'code'],
    ['message', 'message'],
    ['detail', 'detail'],
    ['constraint', 'constraint'],
  ] as const) {
    const value = fields[field];
    if (typeof value === 'string' || typeof value === 'number') {
      details.push(`${label}: ${redactSensitiveText(String(value))}`);
    }
  }
  return details.length
    ? details.join(', ')
    : redactSensitiveText(error instanceof Error ? error.message : String(error));
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  let escapeString = false;
  let dollarTag: string | null = null;
  let blockCommentDepth = 0;
  let lineComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (char === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 1;
      } else if (char === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (quote) {
      if (quote === "'" && escapeString && char === '\\') {
        index += 1;
      } else if (char === quote && next === quote) {
        index += 1;
      } else if (char === quote) {
        quote = null;
        escapeString = false;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      lineComment = true;
      index += 1;
    } else if (char === '/' && next === '*') {
      blockCommentDepth = 1;
      index += 1;
    } else if (char === "'" || char === '"') {
      quote = char;
      escapeString =
        char === "'" &&
        /[Ee]/.test(sql[index - 1] || '') &&
        (index < 2 || !/[A-Za-z0-9_$]/.test(sql[index - 2]));
    } else if (char === '$') {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index));
      if (match) {
        dollarTag = match[0];
        index += dollarTag.length - 1;
      }
    } else if (char === ';') {
      const statement = sql.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }

  const remainder = sql.slice(start).trim();
  if (remainder) statements.push(remainder);
  return statements;
}

function formatMigrationFailure(error: unknown): string {
  if (!(error instanceof MigrationFailure)) {
    return `Database migration command failed: ${formatDatabaseError(error)}`;
  }

  const lines = [
    `Database migration failed during: ${error.stage}.`,
    `Migration file: ${error.filename || '(not applicable)'}.`,
  ];
  if (error.statementIndex !== undefined) {
    lines.push(`Statement: ${error.statementIndex}.`);
  }
  if (error.statement) {
    lines.push(`SQL: ${redactSensitiveText(error.statement.replace(/\s+/g, ' ').trim())}`);
  }

  if (error.originalError && typeof error.originalError === 'object') {
    const pgError = error.originalError as Record<string, unknown>;
    const fields: Array<[string, string]> = [
      ['code', 'code'],
      ['message', 'message'],
      ['detail', 'detail'],
      ['constraint', 'constraint'],
      ['schema', 'schema'],
      ['table', 'table'],
      ['column', 'column'],
      ['position', 'position'],
    ];
    for (const [field, label] of fields) {
      const value = pgError[field];
      if (typeof value === 'string' || typeof value === 'number') {
        lines.push(`${label}: ${redactSensitiveText(String(value))}`);
      }
    }
  } else {
    lines.push(
      `cause: ${redactSensitiveText(
        error.originalError instanceof Error
          ? `${error.originalError.name}: ${error.originalError.message}`
          : String(error.originalError),
      )}`,
    );
  }

  if (error.rollbackError !== undefined) {
    lines.push(`rollback error: ${formatDatabaseError(error.rollbackError)}`);
  }
  for (const cleanupError of error.cleanupErrors) {
    lines.push(`cleanup error: ${formatDatabaseError(cleanupError)}`);
  }
  return lines.join('\n');
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS zunari_schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function applyMigrations(options: MigrationRunnerOptions = {}): Promise<void> {
  const activeMigrationsDir = options.migrationsDir ?? migrationsDir;
  const activePool = options.pool ?? getMigrationPool();
  const activeLockId = options.lockId ?? lockId;
  const logger = options.logger ?? ((message: string) => console.info(message));
  let client: PoolClient | undefined;
  let lockAcquired = false;
  let transactionOpen = false;
  let stage = 'acquiring a database connection';
  let filename: string | undefined;
  let statementIndex: number | undefined;
  let statement: string | undefined;
  let migrationFailure: MigrationFailure | undefined;
  let destroyClient = false;

  try {
    client = await activePool.connect();
    stage = 'acquiring the migration advisory lock';
    await client.query('SELECT pg_advisory_lock($1)', [activeLockId]);
    lockAcquired = true;

    stage = 'creating or checking the migration ledger';
    await ensureMigrationTable(client);

    stage = 'listing migration files';
    const files = (await readdir(activeMigrationsDir))
      .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
      .sort();

    if (files.length === 0) {
      throw new Error(`No migration files were found in ${activeMigrationsDir}.`);
    }

    for (const migrationFilename of files) {
      filename = migrationFilename;
      const version = migrationFilename.slice(0, -4);
      stage = 'reading the migration file';
      const sql = await readFile(path.join(activeMigrationsDir, migrationFilename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      stage = 'checking the migration ledger';
      const applied = await client.query<{ checksum: string }>(
        'SELECT checksum FROM zunari_schema_migrations WHERE version = $1',
        [version],
      );

      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration checksum mismatch: ${version}`);
        }
        continue;
      }
      const statements = splitSqlStatements(sql);
      stage = 'starting the migration transaction';
      await client.query('BEGIN');
      transactionOpen = true;
      try {
        for (const [index, sqlStatement] of statements.entries()) {
          statementIndex = index + 1;
          statement = sqlStatement;
          stage = 'executing migration SQL';
          await client.query(sqlStatement);
        }
        statementIndex = undefined;
        statement = undefined;
        stage = 'recording the migration checksum';
        await client.query(
          'INSERT INTO zunari_schema_migrations (version, checksum) VALUES ($1, $2)',
          [version, checksum],
        );
        stage = 'committing the migration transaction';
        await client.query('COMMIT');
        transactionOpen = false;
        logger(`Applied database migration ${version}.`);
      } catch (error) {
        let rollbackError: unknown;
        if (transactionOpen) {
          try {
            await client.query('ROLLBACK');
            transactionOpen = false;
          } catch (rollbackFailure) {
            rollbackError = rollbackFailure;
            destroyClient = true;
          }
        }
        migrationFailure = new MigrationFailure(
          stage,
          filename,
          statementIndex,
          statement,
          error,
          rollbackError,
        );
        throw migrationFailure;
      }
    }
  } catch (error) {
    migrationFailure =
      error instanceof MigrationFailure
        ? error
        : new MigrationFailure(stage, filename, statementIndex, statement, error);
  } finally {
    if (client) {
      try {
        if (lockAcquired && !destroyClient) {
          stage = 'releasing the migration advisory lock';
          await client.query('SELECT pg_advisory_unlock($1)', [activeLockId]);
        }
      } catch (error) {
        destroyClient = true;
        if (migrationFailure) migrationFailure.addCleanupError(error);
        else migrationFailure = new MigrationFailure(stage, filename, undefined, undefined, error);
      } finally {
        client.release(destroyClient);
      }
    }
  }
  if (migrationFailure) throw migrationFailure;
}

export function describeMigrationFailure(error: unknown): string {
  return formatMigrationFailure(error);
}
