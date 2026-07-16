import type { Client } from '@opensearch-project/opensearch';
import type { EventStore } from '../../../domain/ports/repositories.js';
import { contentHash } from '../../../application/merkleChain/merkle.js';
import { EVENT_INDEX_PATTERN, eventIndexFor } from './client.js';
import { withSpan } from '../../telemetry/otel.js';

/** OpenSearch-backed read/write adapter over the surf-events-* indices. */
export class OpenSearchEventStore implements EventStore {
  constructor(private readonly client: Client) {}

  async search(params: {
    tenantId?: string;
    query: Record<string, unknown>;
    from?: string;
    to?: string;
    limit: number;
  }): Promise<Array<Record<string, unknown>>> {
    return withSpan('opensearch.search', { index: EVENT_INDEX_PATTERN }, async () => {
      const must: unknown[] = [params.query];
      if (params.tenantId !== undefined) must.push({ term: { 'surf.tenant.id': params.tenantId } });
      if (params.from !== undefined || params.to !== undefined) {
        must.push({ range: { '@timestamp': { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } } });
      }
      const response = await this.client.search({
        index: EVENT_INDEX_PATTERN,
        body: { query: { bool: { must } }, size: params.limit, sort: [{ '@timestamp': 'desc' }] },
      });
      return hitsToDocs(response.body);
    });
  }

  async pivot(field: string, value: string, tenantId?: string, limit = 200): Promise<Array<Record<string, unknown>>> {
    return this.search({
      ...(tenantId !== undefined ? { tenantId } : {}),
      query: { term: { [field]: value } },
      limit,
    });
  }

  async eventsInHour(hourStartIso: string): Promise<Array<{ id: string; contentHash: string; bytes: number }>> {
    return withSpan('opensearch.eventsInHour', { hour: hourStartIso }, async () => {
      const hourEnd = new Date(new Date(hourStartIso).getTime() + 3_600_000).toISOString();
      const leaves: Array<{ id: string; contentHash: string; bytes: number }> = [];
      let response = await this.client.search({
        index: EVENT_INDEX_PATTERN,
        scroll: '1m',
        body: {
          query: { range: { '@timestamp': { gte: hourStartIso, lt: hourEnd } } },
          size: 1000,
          sort: [{ '@timestamp': 'asc' }],
        },
      });
      for (;;) {
        const hits = (response.body as SearchBody).hits.hits;
        if (hits.length === 0) break;
        for (const hit of hits) {
          const source = hit._source;
          leaves.push({
            id: hit._id,
            contentHash: contentHash(source),
            bytes: Buffer.byteLength(JSON.stringify(source)),
          });
        }
        const scrollId = (response.body as SearchBody)._scroll_id;
        if (!scrollId) break;
        response = await this.client.scroll({ scroll_id: scrollId, scroll: '1m' });
      }
      return leaves;
    });
  }

  async eventsByIds(ids: string[]): Promise<Array<Record<string, unknown>>> {
    if (ids.length === 0) return [];
    const response = await this.client.search({
      index: EVENT_INDEX_PATTERN,
      body: { query: { ids: { values: ids } }, size: ids.length },
    });
    return hitsToDocs(response.body);
  }

  async eventsForSubject(pseudonym: string): Promise<Array<Record<string, unknown>>> {
    const response = await this.client.search({
      index: EVENT_INDEX_PATTERN,
      body: { query: { term: { 'surf.prosumer.pseudonym': pseudonym } }, size: 10_000 },
    });
    return hitsToDocs(response.body);
  }

  async ingest(events: Array<Record<string, unknown>>): Promise<void> {
    if (events.length === 0) return;
    const operations = events.flatMap((event) => {
      const ts = String(event['@timestamp'] ?? new Date().toISOString());
      const id = event['event.id'] ?? (event['event'] as Record<string, unknown> | undefined)?.['id'];
      return [{ index: { _index: eventIndexFor(ts), ...(id !== undefined ? { _id: String(id) } : {}) } }, event];
    });
    const response = await this.client.bulk({ body: operations, refresh: true });
    if ((response.body as { errors: boolean }).errors) {
      throw new Error('bulk ingest reported item-level errors');
    }
  }

  async searchWindow(since: string, until: string): Promise<Array<Record<string, unknown>>> {
    const response = await this.client.search({
      index: EVENT_INDEX_PATTERN,
      body: {
        query: { range: { '@timestamp': { gte: since, lte: until } } },
        size: 10_000,
        sort: [{ '@timestamp': 'asc' }],
      },
    });
    return hitsToDocs(response.body);
  }
}

interface SearchBody {
  _scroll_id?: string;
  hits: { hits: Array<{ _id: string; _source: Record<string, unknown> }> };
}

function hitsToDocs(body: unknown): Array<Record<string, unknown>> {
  return (body as SearchBody).hits.hits.map((h) => ({ ...h._source, _id: h._id }));
}
