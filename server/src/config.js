import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().int().min(0).max(65535).default(3000),
  nodeEnv: z.string().default('development'),
  logLevel: z.string().default('info'),
  authMode: z.enum(['dev', 'oidc']).default('dev'),
  databaseUrl: z.string().default(''),
  defaultOrganizationSlug: z.string().min(1).default('riihimaki'),
  defaultLocale: z.string().min(2).default('fi'),
  enabledLocales: z.array(z.string().min(2)).min(1).default(['fi']),
  storageDriver: z.enum(['local', 's3']).default('local'),
  localStorageDir: z.string().min(1).default('./data/uploads'),
  baseUrl: z.string().url().default('http://localhost:3000'),
  reporterHashSecret: z.string().min(1).default('dev-secret'),
  metricsBearerToken: z.string().default(''),
  seedDemoData: z.boolean().default(true),
  leaseRetentionDays: z.coerce.number().int().min(1).max(3650).default(365),
  cleanupDisabled: z.boolean().default(false),
});

/**
 * @typedef {z.infer<typeof configSchema>} AppConfig
 */

/**
 * Load and validate configuration from environment variables.
 * @param {Record<string, string | undefined>} [env]
 * @returns {AppConfig}
 */
export function loadConfig(env = process.env) {
  const enabledLocalesRaw = env.ENABLED_LOCALES ?? 'fi';
  const enabledLocales = enabledLocalesRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return configSchema.parse({
    port: env.PORT || 3000,
    nodeEnv: env.NODE_ENV || 'development',
    logLevel: env.LOG_LEVEL || 'info',
    authMode: env.AUTH_MODE || 'dev',
    databaseUrl: env.DATABASE_URL ?? '',
    defaultOrganizationSlug: env.DEFAULT_ORGANIZATION_SLUG || 'riihimaki',
    defaultLocale: env.DEFAULT_LOCALE || 'fi',
    enabledLocales: enabledLocales.length > 0 ? enabledLocales : ['fi'],
    storageDriver: env.STORAGE_DRIVER || 'local',
    localStorageDir: env.LOCAL_STORAGE_DIR || './data/uploads',
    baseUrl: env.BASE_URL || 'http://localhost:3000',
    reporterHashSecret: env.REPORTER_HASH_SECRET || 'dev-secret',
    metricsBearerToken: env.METRICS_BEARER_TOKEN ?? '',
    seedDemoData: env.SEED_DEMO_DATA !== 'false',
    leaseRetentionDays: env.LEASE_RETENTION_DAYS || 365,
    cleanupDisabled: env.CLEANUP_DISABLED === 'true',
  });
}
