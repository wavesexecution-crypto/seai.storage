import { getConfig } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';
import { getLogger } from '../src/utils/logger.js';

// Ensure env is loaded before migration code reads it.
getConfig();

runMigrations()
  .then(() => getLogger().info('Migrations complete'))
  .catch((err) => {
    getLogger().error({ err }, 'Migration failed');
    process.exitCode = 1;
  })
  .finally(() => closePool());
