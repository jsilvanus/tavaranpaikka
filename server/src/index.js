import pino from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { runMigrations, seedDemoData } from './migrate.js';
import { checkAndNotifyUpcomingExpiries } from './repositories/notificationsRepo.js';
import { runPrivacyRetentionCleanup } from './repositories/privacyRepo.js';
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
    s3Endpoint: config.s3Endpoint,
    s3Region: config.s3Region,
    s3Bucket: config.s3Bucket,
    s3AccessKey: config.s3AccessKey,
    s3SecretKey: config.s3SecretKey,
    s3ForcePathStyle: config.s3ForcePathStyle,
  });

  if (config.s3EnsureBucket && storage.ensureBucket) {
    await storage.ensureBucket();
    logger.info({ bucket: config.s3Bucket }, 'Ensured S3 bucket exists');
  }

  const app = createApp({ db, config, storage, logger });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, authMode: config.authMode }, 'Tavaranpaikka server listening');
  });

  /** @type {NodeJS.Timeout | null} */
  let cleanupTimer = null;
  if (!config.cleanupDisabled) {
    const runCleanup = async () => {
      try {
        const stats = await runPrivacyRetentionCleanup(db, config);
        const expResult = await checkAndNotifyUpcomingExpiries(
          db,
          { organizationId, locale: config.defaultLocale },
          config,
          logger
        );
        const total =
          stats.clearedReportHashes +
          stats.clearedReportNames +
          stats.deletedReportVotes +
          stats.deletedReports +
          stats.deletedAuditEvents +
          stats.deletedLeases +
          expResult.created;
        if (total > 0) {
          logger.info(stats, 'Completed privacy retention cleanup');
        }
      } catch (err) {
        logger.error({ err }, 'Privacy retention cleanup failed');
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
