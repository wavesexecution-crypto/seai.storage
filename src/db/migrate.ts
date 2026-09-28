import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as path from 'node:path';
import { getPool, closePool } from './pool.js';
import { getLogger } from '../utils/logger.js';

export async function runMigrations(): Promise<void> {
  const logger = getLogger();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(here, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const pool = getPool();
  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), 'utf8');
    logger.info({ migration: file }, 'Applying migration');
    await pool.query(sql);
  }
}

if (Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
    .then(() => {
      getLogger().info('Migrations complete');
    })
    .catch((err) => {
      getLogger().error({ err }, 'Migration failed');
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
