import { Client } from '@opensearch-project/opensearch';
import { readFileSync } from 'node:fs';
import type { AppConfig } from '../../config.js';

export const EVENT_INDEX_PATTERN = 'surf-events-*';
export const EVENT_INDEX_PREFIX = 'surf-events';
export const ALERT_INDEX = 'surf-alerts';

export function createOpenSearchClient(config: AppConfig): Client {
  const ca = config.opensearch.caPath ? tryReadCa(config.opensearch.caPath) : undefined;
  return new Client({
    node: config.opensearch.url,
    auth: { username: config.opensearch.username, password: config.opensearch.password },
    ssl: ca ? { ca } : { rejectUnauthorized: false }, // dev self-signed; prod mounts the CA
  });
}

function tryReadCa(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

/** Daily event index name for a timestamp, e.g. surf-events-2026.07.14 */
export function eventIndexFor(ts: string): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${EVENT_INDEX_PREFIX}-${y}.${m}.${day}`;
}
