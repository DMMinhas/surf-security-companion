import pg from 'pg';
import type { AppConfig } from '../../config.js';

export function createPool(config: AppConfig): pg.Pool {
  return new pg.Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
    ssl: config.postgres.ssl === 'disable' ? false : { rejectUnauthorized: config.postgres.ssl === 'verify-full' },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'surf-companion-backend',
  });
}
