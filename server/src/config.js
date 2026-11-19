import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().int().min(0).max(65535).default(3000),
  nodeEnv: z.string().default('development'),
  logLevel: z.string().default('info'),
  authMode: z.enum(['dev', 'oidc']).default('dev'),
  devDefaultRole: z.enum(['member', 'keeper', 'admin', 'none']).default('keeper'),
  sessionSecret: z.string().min(1).default('dev-session-secret'),
  oidcIssuer: z.string().default(''),
  oidcClientId: z.string().default(''),
  oidcClientSecret: z.string().default(''),
  oidcRedirectUri: z.string().default(''),
  oidcScopes: z.string().default('openid profile email groups'),
  oidcGroupRoleMap: z.record(z.enum(['member', 'keeper', 'admin'])).default({}),
  databaseUrl: z.string().default(''),
  defaultOrganizationSlug: z.string().min(1).default('riihimaki'),
  defaultLocale: z.string().min(2).default('fi'),
  enabledLocales: z.array(z.string().min(2)).min(1).default(['fi']),
  storageDriver: z.enum(['local', 's3']).default('local'),
  localStorageDir: z.string().min(1).default('./data/uploads'),
  s3Endpoint: z.string().default(''),
  s3Region: z.string().default('us-east-1'),
  s3Bucket: z.string().default(''),
  s3AccessKey: z.string().default(''),
  s3SecretKey: z.string().default(''),
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

  let oidcGroupRoleMap = {};
  if (env.OIDC_GROUP_ROLE_MAP) {
    try {
      oidcGroupRoleMap = JSON.parse(env.OIDC_GROUP_ROLE_MAP);
    } catch {
      throw new Error('OIDC_GROUP_ROLE_MAP must be valid JSON');
    }
  }

  const baseUrl = env.BASE_URL || 'http://localhost:3000';

  return configSchema.parse({
    port: env.PORT || 3000,
    nodeEnv: env.NODE_ENV || 'development',
    logLevel: env.LOG_LEVEL || 'info',
    authMode: env.AUTH_MODE || 'dev',
    devDefaultRole: env.DEV_DEFAULT_ROLE || 'keeper',
    sessionSecret: env.SESSION_SECRET || 'dev-session-secret',
    oidcIssuer: env.OIDC_ISSUER || '',
    oidcClientId: env.OIDC_CLIENT_ID || '',
    oidcClientSecret: env.OIDC_CLIENT_SECRET || '',
    oidcRedirectUri: env.OIDC_REDIRECT_URI || `${baseUrl.replace(/\/+$/, '')}/api/auth/callback`,
    oidcScopes: env.OIDC_SCOPES || 'openid profile email groups',
    oidcGroupRoleMap,
    databaseUrl: env.DATABASE_URL ?? '',
    defaultOrganizationSlug: env.DEFAULT_ORGANIZATION_SLUG || 'riihimaki',
    defaultLocale: env.DEFAULT_LOCALE || 'fi',
    enabledLocales: enabledLocales.length > 0 ? enabledLocales : ['fi'],
    storageDriver: env.STORAGE_DRIVER || 'local',
    localStorageDir: env.LOCAL_STORAGE_DIR || './data/uploads',
    s3Endpoint: env.S3_ENDPOINT || '',
    s3Region: env.S3_REGION || 'us-east-1',
    s3Bucket: env.S3_BUCKET || '',
    s3AccessKey: env.S3_ACCESS_KEY || '',
    s3SecretKey: env.S3_SECRET_KEY || '',
    baseUrl,
    reporterHashSecret: env.REPORTER_HASH_SECRET || 'dev-secret',
    metricsBearerToken: env.METRICS_BEARER_TOKEN ?? '',
    seedDemoData: env.SEED_DEMO_DATA !== 'false',
    leaseRetentionDays: env.LEASE_RETENTION_DAYS || 365,
    cleanupDisabled: env.CLEANUP_DISABLED === 'true',
  });
}
