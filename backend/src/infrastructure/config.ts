import { z } from 'zod';

/**
 * Typed configuration — the only place process.env is read. Fails fast with
 * a readable report if anything required is missing or malformed.
 */
const boolFromString = z
  .string()
  .transform((v) => v === 'true' || v === '1')
  .pipe(z.boolean());

const configSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(8080),
  nodeEnv: z.enum(['development', 'test', 'production']).default('production'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  oidc: z.object({
    issuerUrl: z.string().url(),
    audience: z.string().min(1),
    jwksUri: z.string().url(),
    tenantClaim: z.string().default('surf_tenant_id'),
  }),

  requestIdHeader: z.string().default('x-request-id'),

  postgres: z.object({
    host: z.string().min(1),
    port: z.coerce.number().int().default(5432),
    database: z.string().min(1),
    user: z.string().min(1),
    password: z.string().min(1),
    ssl: z.string().default('require'),
  }),

  opensearch: z.object({
    url: z.string().url(),
    username: z.string().min(1),
    password: z.string().min(1),
    caPath: z.string().optional(),
  }),

  wazuh: z.object({
    apiUrl: z.string().url(),
    user: z.string().min(1),
    password: z.string().min(1),
  }),

  minio: z.object({
    endpoint: z.string().min(1),
    accessKey: z.string().min(1),
    secretKey: z.string().min(1),
    bucketAudit: z.string().default('surf-audit'),
    bucketHashchain: z.string().default('surf-hashchain'),
    useSsl: boolFromString.default('false'),
    objectLockYears: z.coerce.number().int().min(1).default(1),
  }),

  hashchain: z.object({
    signingKeyPath: z.string().min(1),
    rollupIntervalMinutes: z.coerce.number().int().min(1).max(60).default(60),
  }),

  upstream: z.object({
    flexApiUrl: z.string().url(),
    flexApiToken: z.string().min(1),
    emsApiUrl: z.string().url(),
    emsApiToken: z.string().min(1),
  }),

  alerting: z.object({
    pagerdutyRoutingKey: z.string().min(1),
    slackWebhookUrl: z.string().optional(),
  }),

  playbooks: z.object({
    dryRunDefault: boolFromString.default('true'),
    massActionThreshold: z.coerce.number().int().min(1).default(10),
    requireStepUp: boolFromString.default('true'),
  }),

  rulesDir: z.string().default('/rules'),
  presignExpirySeconds: z.coerce.number().int().default(3600),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    port: env['PORT'],
    nodeEnv: env['NODE_ENV'],
    logLevel: env['LOG_LEVEL'],
    oidc: {
      issuerUrl: env['OIDC_ISSUER_URL'],
      audience: env['OIDC_AUDIENCE'],
      jwksUri: env['OIDC_JWKS_URI'],
      tenantClaim: env['TENANT_CLAIM'],
    },
    requestIdHeader: env['REQUEST_ID_HEADER'],
    postgres: {
      host: env['PG_HOST'],
      port: env['PG_PORT'],
      database: env['PG_DB'],
      user: env['PG_USER'],
      password: env['PG_PASSWORD'],
      ssl: env['PG_SSL'],
    },
    opensearch: {
      url: env['OPENSEARCH_URL'],
      username: env['OPENSEARCH_USERNAME'],
      password: env['OPENSEARCH_PASSWORD'],
      caPath: env['OPENSEARCH_CA_PATH'],
    },
    wazuh: {
      apiUrl: env['WAZUH_API_URL'],
      user: env['WAZUH_API_USER'],
      password: env['WAZUH_API_PASS'],
    },
    minio: {
      endpoint: env['MINIO_ENDPOINT'],
      accessKey: env['MINIO_ACCESS_KEY'],
      secretKey: env['MINIO_SECRET_KEY'],
      bucketAudit: env['MINIO_BUCKET_AUDIT'],
      bucketHashchain: env['MINIO_BUCKET_HASHCHAIN'],
      useSsl: env['MINIO_USE_SSL'],
      objectLockYears: env['MINIO_OBJECT_LOCK_YEARS'],
    },
    hashchain: {
      signingKeyPath: env['HASHCHAIN_SIGNING_KEY_PATH'],
      rollupIntervalMinutes: env['HASHCHAIN_ROLLUP_INTERVAL_MINUTES'],
    },
    upstream: {
      flexApiUrl: env['FLEX_API_URL'],
      flexApiToken: env['FLEX_API_TOKEN'],
      emsApiUrl: env['EMS_API_URL'],
      emsApiToken: env['EMS_API_TOKEN'],
    },
    alerting: {
      pagerdutyRoutingKey: env['PAGERDUTY_ROUTING_KEY'],
      slackWebhookUrl: env['SLACK_WEBHOOK_URL'] || undefined,
    },
    playbooks: {
      dryRunDefault: env['PLAYBOOK_DRY_RUN_DEFAULT'],
      massActionThreshold: env['PLAYBOOK_MASS_ACTION_THRESHOLD'],
      requireStepUp: env['PLAYBOOK_REQUIRE_STEPUP'],
    },
    rulesDir: env['RULES_DIR'],
    presignExpirySeconds: env['PRESIGN_EXPIRY_SECONDS'],
  });

  if (!parsed.success) {
    const report = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalid:\n${report}`);
  }
  return parsed.data;
}

/** Values that must never appear in logs. Used by the pino redaction setup. */
export function secretValues(config: AppConfig): string[] {
  return [
    config.postgres.password,
    config.opensearch.password,
    config.wazuh.password,
    config.minio.secretKey,
    config.upstream.flexApiToken,
    config.upstream.emsApiToken,
    config.alerting.pagerdutyRoutingKey,
  ].filter((v) => v.length > 0);
}
