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
  s3ForcePathStyle: z.boolean().default(true),
  s3EnsureBucket: z.boolean().default(false),
  baseUrl: z.string().url().default('http://localhost:3000'),
  reporterHashSecret: z.string().min(1).default('dev-secret'),
  metricsBearerToken: z.string().default(''),
  seedDemoData: z.boolean().default(true),
  leaseRetentionDays: z.coerce.number().int().min(1).max(3650).default(365),
  cleanupDisabled: z.boolean().default(false),
  trustProxy: z.boolean().default(false),
  mailProvider: z.enum(['console', 'brevo', 'oidc']).default('console'),
  mailFrom: z.string().default('tavaranpaikka@riihimaenseurakunta.fi'),
  mailAdminFallback: z.array(z.string()).default([]),
  brevoApiKey: z.string().default(''),
  brevoTemplateDefaultId: z.coerce.number().int().positive().nullable().default(null),
  brevoTemplateReportId: z.coerce.number().int().positive().nullable().default(null),
  brevoTemplateExpiringId: z.coerce.number().int().positive().nullable().default(null),
  brevoTemplateInspectionId: z.coerce.number().int().positive().nullable().default(null),
  brevoTemplateDigestId: z.coerce.number().int().positive().nullable().default(null),
  oidcMailEndpoint: z.string().default(''),
  oidcMailToken: z.string().default(''),
  defaultNotifyBeforeDays: z.coerce.number().int().min(1).max(365).default(60),
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

  const mailAdminFallback = (env.MAIL_ADMIN_FALLBACK || '')
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
  const nodeEnv = env.NODE_ENV || 'development';
  const authMode = env.AUTH_MODE || 'dev';
  const sessionSecret = env.SESSION_SECRET || 'dev-session-secret';
  const reporterHashSecret = env.REPORTER_HASH_SECRET || 'dev-secret';

  if (nodeEnv === 'production') {
    if (authMode === 'dev') {
      throw new Error('AUTH_MODE=dev is not allowed when NODE_ENV=production');
    }
    if (sessionSecret === 'dev-session-secret' || reporterHashSecret === 'dev-secret') {
      throw new Error('SESSION_SECRET and REPORTER_HASH_SECRET must be set in production');
    }
  }

  return configSchema.parse({
    port: env.PORT || 3000,
    nodeEnv,
    logLevel: env.LOG_LEVEL || 'info',
    authMode,
    devDefaultRole: env.DEV_DEFAULT_ROLE || 'keeper',
    sessionSecret,
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
    s3ForcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    s3EnsureBucket: env.S3_ENSURE_BUCKET === 'true',
    baseUrl,
    reporterHashSecret,
    metricsBearerToken: env.METRICS_BEARER_TOKEN ?? '',
    seedDemoData: env.SEED_DEMO_DATA !== 'false',
    leaseRetentionDays: env.LEASE_RETENTION_DAYS || 365,
    cleanupDisabled: env.CLEANUP_DISABLED === 'true',
    trustProxy: env.TRUST_PROXY !== undefined ? env.TRUST_PROXY === 'true' : nodeEnv === 'production',
    mailProvider: env.MAIL_PROVIDER || 'console',
    mailFrom: env.MAIL_FROM || 'tavaranpaikka@riihimaenseurakunta.fi',
    mailAdminFallback,
    brevoApiKey: env.BREVO_API_KEY || '',
    brevoTemplateDefaultId: env.BREVO_TEMPLATE_DEFAULT_ID || null,
    brevoTemplateReportId: env.BREVO_TEMPLATE_REPORT_ID || env.BREVO_TEMPLATE_DEFAULT_ID || null,
    brevoTemplateExpiringId: env.BREVO_TEMPLATE_EXPIRING_ID || env.BREVO_TEMPLATE_DEFAULT_ID || null,
    brevoTemplateInspectionId:
      env.BREVO_TEMPLATE_INSPECTION_ID || env.BREVO_TEMPLATE_DEFAULT_ID || null,
    brevoTemplateDigestId: env.BREVO_TEMPLATE_DIGEST_ID || env.BREVO_TEMPLATE_DEFAULT_ID || null,
    oidcMailEndpoint: env.OIDC_MAIL_ENDPOINT || '',
    oidcMailToken: env.OIDC_MAIL_TOKEN || '',
    defaultNotifyBeforeDays: env.EXPIRY_NOTIFY_DAYS || 60,
  });
}
