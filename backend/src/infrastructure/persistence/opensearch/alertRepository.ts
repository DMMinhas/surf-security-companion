import type { Client } from '@opensearch-project/opensearch';
import type { Alert, AlertStatus } from '../../../domain/entities/alert.js';
import { alertFingerprint } from '../../../domain/entities/alert.js';
import type { AlertQuery, AlertRepository, Page } from '../../../domain/ports/repositories.js';
import { NotFoundError } from '../../../application/errors.js';
import { ALERT_INDEX } from './client.js';

/**
 * Alerts live in a single OpenSearch index so the alert list can share the
 * cluster's search performance and the detection engineers can see them in
 * OpenSearch Dashboards too. The document id is the alert id; a `fingerprint`
 * keyword field supports dedup lookups.
 */
export class OpenSearchAlertRepository implements AlertRepository {
  constructor(private readonly client: Client) {}

  async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: ALERT_INDEX });
    if (exists.body === true) return;
    await this.client.indices.create({
      index: ALERT_INDEX,
      body: {
        mappings: {
          properties: {
            ts: { type: 'date' },
            severity: { type: 'keyword' },
            ruleId: { type: 'keyword' },
            ruleTitle: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            description: { type: 'text' },
            tenantId: { type: 'keyword' },
            status: { type: 'keyword' },
            assignee: { type: 'keyword' },
            caseId: { type: 'keyword' },
            fingerprint: { type: 'keyword' },
            firstSeen: { type: 'date' },
            lastSeen: { type: 'date' },
            count: { type: 'integer' },
            'source.system': { type: 'keyword' },
            'source.host': { type: 'keyword' },
            'source.userId': { type: 'keyword' },
            'source.ip': { type: 'ip' },
          },
        },
      },
    });
  }

  async list(query: AlertQuery): Promise<Page<Alert>> {
    const must: unknown[] = [];
    if (query.status) must.push({ term: { status: query.status } });
    if (query.severity) must.push({ term: { severity: query.severity } });
    if (query.tenantId) must.push({ term: { tenantId: query.tenantId } });
    if (query.ruleId) must.push({ term: { ruleId: query.ruleId } });
    if (query.q) must.push({ simple_query_string: { query: query.q, fields: ['ruleTitle', 'description'] } });
    if (query.from || query.to) {
      must.push({ range: { ts: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } });
    }
    const from = query.cursor !== undefined ? Number.parseInt(query.cursor, 10) || 0 : 0;
    const response = await this.client.search({
      index: ALERT_INDEX,
      body: {
        query: must.length ? { bool: { must } } : { match_all: {} },
        size: query.limit,
        from,
        sort: [{ ts: 'desc' }],
        track_total_hits: true,
      },
    });
    const body = response.body as {
      hits: { total: { value: number }; hits: Array<{ _id: string; _source: Record<string, unknown> }> };
    };
    const items = body.hits.hits.map((h) => fromDoc(h._id, h._source));
    const total = body.hits.total.value;
    const next = from + items.length;
    return { items, total, ...(next < total ? { nextCursor: String(next) } : {}) };
  }

  async getById(id: string, tenantId?: string): Promise<Alert | undefined> {
    try {
      const response = await this.client.get({ index: ALERT_INDEX, id });
      const alert = fromDoc(id, (response.body as { _source: Record<string, unknown> })._source);
      if (tenantId !== undefined && alert.tenantId !== tenantId) return undefined;
      return alert;
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async upsert(alert: Alert): Promise<void> {
    await this.client.index({
      index: ALERT_INDEX,
      id: alert.id,
      body: { ...alert, fingerprint: alertFingerprint(alert.ruleId, alert.source, alert.tenantId) },
      refresh: true,
    });
  }

  async setStatus(id: string, status: AlertStatus, assignee?: string): Promise<Alert> {
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('Alert', id);
    const updated: Alert = { ...existing, status, ...(assignee !== undefined ? { assignee } : {}) };
    await this.upsert(updated);
    return updated;
  }

  async linkCase(ids: string[], caseId: string): Promise<number> {
    let affected = 0;
    for (const id of ids) {
      const existing = await this.getById(id);
      if (existing) {
        await this.upsert({ ...existing, caseId });
        affected += 1;
      }
    }
    return affected;
  }

  async assign(ids: string[], assignee: string): Promise<number> {
    let affected = 0;
    for (const id of ids) {
      const existing = await this.getById(id);
      if (existing) {
        await this.upsert({ ...existing, assignee });
        affected += 1;
      }
    }
    return affected;
  }

  async findByFingerprint(fingerprint: string, since: string): Promise<Alert | undefined> {
    const response = await this.client.search({
      index: ALERT_INDEX,
      body: {
        query: {
          bool: {
            must: [{ term: { fingerprint } }, { range: { lastSeen: { gte: since } } }],
          },
        },
        size: 1,
        sort: [{ lastSeen: 'desc' }],
      },
    });
    const hit = (response.body as { hits: { hits: Array<{ _id: string; _source: Record<string, unknown> }> } }).hits
      .hits[0];
    return hit ? fromDoc(hit._id, hit._source) : undefined;
  }

  async countByRuleSince(since: string): Promise<Map<string, number>> {
    const response = await this.client.search({
      index: ALERT_INDEX,
      body: {
        query: { range: { ts: { gte: since } } },
        size: 0,
        aggs: { by_rule: { terms: { field: 'ruleId', size: 200 } } },
      },
    });
    const buckets = (
      response.body as { aggregations?: { by_rule: { buckets: Array<{ key: string; doc_count: number }> } } }
    ).aggregations?.by_rule.buckets ?? [];
    return new Map(buckets.map((b) => [b.key, b.doc_count]));
  }
}

function fromDoc(id: string, doc: Record<string, unknown>): Alert {
  const { fingerprint: _ignored, ...rest } = doc;
  return { ...(rest as unknown as Alert), id };
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404;
}
