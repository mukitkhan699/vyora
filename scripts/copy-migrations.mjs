import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repositoryRoot, 'server', 'db', 'migrations');
const targetDir = path.join(repositoryRoot, 'dist', 'server', 'db', 'migrations');

const migrationFiles = (await readdir(sourceDir))
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error(`No migration files found in ${sourceDir}.`);
}

await mkdir(targetDir, { recursive: true });
for (const filename of migrationFiles) {
  await cp(path.join(sourceDir, filename), path.join(targetDir, filename));
}

console.log(`Copied ${migrationFiles.length} migration file(s) to ${targetDir}.`);
