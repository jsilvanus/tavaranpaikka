import pino from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { runMigrations, seedDemoData } from './migrate.js';
import { runLeaseRetentionCleanup } from './repositories/itemsRepo.js';
import { createStorage } from './storage.js';

async function main() {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const db = createDb(config.databaseUrl);

  const { applied, organizationId } = await runMigrations(db, {
    defaultOrgSlug: config.defaultOrganizationSlug,
    defaultLocale: config.defaultLocale,
  });
  if (applied.length > 0) {
    logger.info({ applied }, 'Applied database migrations');
  }

  if (config.seedDemoData) {
    const seeded = await seedDemoData(db, organizationId);
    if (seeded) {
      logger.info('Seeded demo data');
    }
  }

  const storage = createStorage({
    driver: config.storageDriver,
    localDir: config.localStorageDir,
  });

  const app = createApp({ db, config, storage, logger });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, authMode: config.authMode }, 'Tavaranpaikka server listening');
  });

  /** @type {NodeJS.Timeout | null} */
  let cleanupTimer = null;
  if (!config.cleanupDisabled) {
    const runCleanup = async () => {
      try {
        const deleted = await runLeaseRetentionCleanup(db, config.leaseRetentionDays);
        if (deleted > 0) {
          logger.info({ deleted }, 'Cleaned up expired lease records');
        }
      } catch (err) {
        logger.error({ err }, 'Lease retention cleanup failed');
      }
    };
    void runCleanup();
    cleanupTimer = setInterval(runCleanup, 86400_000);
    cleanupTimer.unref();
  }

  const shutdown = async () => {
    logger.info('Shutting down...');
    if (cleanupTimer) clearInterval(cleanupTimer);
    server.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
