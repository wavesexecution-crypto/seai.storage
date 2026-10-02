import { pathToFileURL } from 'node:url';
import { getConfig } from './config/env.js';
import { getPool, closePool } from './db/pool.js';
import { createProviderFromConfig } from './providers/index.js';
import { createApp } from './app.js';
import { getLogger } from './utils/logger.js';

async function start(): Promise<void> {
  const cfg = getConfig();
  const logger = getLogger();
  const db = getPool();
  const provider = createProviderFromConfig(cfg);
  const app = createApp({ cfg, db, provider });

  const server = app.listen(cfg.PORT, '0.0.0.0', () => {
    logger.info(
      { port: cfg.PORT, provider: provider.name, scannerEnabled: cfg.SCANNER_ENABLED },
      `seai.storage listening on ${cfg.PORT} (provider=${provider.name})`,
    );
    if (!cfg.SCANNER_ENABLED) {
      logger.warn('Malware scanning is NOT enabled — uploads land READY with scanStatus=PENDING (see docs/MALWARE_SCANNING.md)');
    }
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down...`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  start().catch((err) => {
    getLogger().error({ err }, 'Failed to start seai.storage');
    process.exit(1);
  });
}
