import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { splitSqlStatements } from './migrate.ts';

describe('migration SQL statement splitting', () => {
  test('splits ordinary statements and drops empty fragments', () => {
    const statements = splitSqlStatements(`
      -- leading comment
      CREATE TABLE a (id TEXT);
      ALTER TABLE a ADD COLUMN b TEXT;

      INSERT INTO a (id) VALUES ('semi;colon');
    `);
    assert.equal(statements.length, 3);
    assert.match(statements[0], /CREATE TABLE a/);
    assert.match(statements[1], /ALTER TABLE a/);
    assert.match(statements[2], /semi;colon/);
  });

  test('keeps semicolons inside quoted strings, comments, and dollar blocks', () => {
    const statements = splitSqlStatements(`
      SELECT 'one;two';
      SELECT "semi;colon";
      -- semicolon in a line comment; ignored
      /* block comment; ignored */
      DO $$
      BEGIN
        RAISE NOTICE 'inside;block';
      END $$;
      SELECT E'escaped\\'semi;colon';
    `);
    assert.equal(statements.length, 4);
    assert.match(statements[0], /one;two/);
    assert.match(statements[1], /semi;colon/);
    assert.match(statements[2], /inside;block/);
    assert.match(statements[3], /escaped/);
  });

  test('handles escaped dollar tags and returns a trailing statement', () => {
    const statements = splitSqlStatements(`
      DO $migration$
      BEGIN
        PERFORM 1;
      END
      $migration$;
      SELECT 1
    `);
    assert.equal(statements.length, 2);
    assert.match(statements[0], /DO \$migration\$/);
    assert.match(statements[1], /SELECT 1/);
  });
});

describe('production build migration inclusion', () => {
  test('build copies SQL migrations beside the compiled migration runner', async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const packageJson = JSON.parse(
      await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    assert.match(packageJson.scripts?.build || '', /copy-migrations\.mjs/);
    assert.match(packageJson.scripts?.['db:migrate:dist'] || '', /dist\/server\/db\/run-migrations\.js/);

    const copyScript = await readFile(
      path.join(repositoryRoot, 'scripts', 'copy-migrations.mjs'),
      'utf8',
    );
    assert.match(copyScript, /dist', 'server', 'db', 'migrations'/);
  });
});
