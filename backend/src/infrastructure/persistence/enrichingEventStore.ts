import type { EventStore } from '../../domain/ports/repositories.js';
import type { Enricher, Event } from '../../correlation/enrichment.js';
import type { DefaultReferenceData } from '../../correlation/enrichmentReferenceData.js';

/**
 * Decorates an EventStore so every event is enriched at the write boundary —
 * the point the data model designates for computing `surf.enrichment.*`. Reads
 * pass straight through to the inner store; only `ingest()` is intercepted.
 *
 * Events in a batch are processed oldest-first so stateful reference data
 * (login history, firmware inventory) reflects what was known at each event's
 * instant. Each event is enriched against prior state, then contributes its own.
 */
export class EnrichingEventStore implements EventStore {
  constructor(
    private readonly inner: EventStore,
    private readonly enricher: Enricher,
    private readonly refs: DefaultReferenceData,
  ) {}

  async ingest(events: Array<Record<string, unknown>>): Promise<void> {
    const ordered = [...events].sort(
      (a, b) => Date.parse(String(a['@timestamp'] ?? 0)) - Date.parse(String(b['@timestamp'] ?? 0)),
    );
    const enriched: Event[] = [];
    for (const event of ordered) {
      enriched.push(this.enricher.enrich(event));
      this.refs.observe(event);
    }
    await this.inner.ingest(enriched);
  }

  // ---- reads delegate unchanged
  search(params: Parameters<EventStore['search']>[0]): ReturnType<EventStore['search']> {
    return this.inner.search(params);
  }
  pivot(field: string, value: string, tenantId?: string, limit?: number): ReturnType<EventStore['pivot']> {
    return this.inner.pivot(field, value, tenantId, limit);
  }
  eventsInHour(hourStartIso: string): ReturnType<EventStore['eventsInHour']> {
    return this.inner.eventsInHour(hourStartIso);
  }
  eventsByIds(ids: string[]): ReturnType<EventStore['eventsByIds']> {
    return this.inner.eventsByIds(ids);
  }
  eventsForSubject(pseudonym: string): ReturnType<EventStore['eventsForSubject']> {
    return this.inner.eventsForSubject(pseudonym);
  }
  searchWindow(since: string, until: string): ReturnType<EventStore['searchWindow']> {
    return this.inner.searchWindow(since, until);
  }
}
