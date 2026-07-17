import type { AlertRepository, EventStore, RuleStateRepository } from '../domain/ports/repositories.js';
import type { SigmaRule } from '../domain/entities/sigmaRule.js';
import { attackTechniques, severityOf } from '../domain/entities/sigmaRule.js';
import { alertFingerprint, type Alert, type AlertSource } from '../domain/entities/alert.js';
import { RuleEvaluator, getField } from './evaluator.js';
import type { Enricher } from './enrichment.js';
import type { Logger } from 'pino';

/**
 * Enrichment applied to the event window before evaluation. `enricher` computes
 * the surf.enrichment.* flags (idempotently); `refs.observe` feeds the stateful
 * reference data (login/firmware history) from the same stream.
 */
export interface SchedulerEnrichment {
  enricher: Enricher;
  refs: { observe(event: Record<string, unknown>): void };
}

export interface SchedulerConfig {
  /** Evaluation cadence. Spec: every 60 s. */
  intervalSeconds: number;
  /** Rolling window each evaluation looks back over. Spec: 5 minutes. */
  windowSeconds: number;
  /** Alerts deduplicate per (ruleId, fingerprint) within this window. Spec: 15 minutes. */
  dedupWindowSeconds: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  intervalSeconds: 60,
  windowSeconds: 300,
  dedupWindowSeconds: 900,
};

/**
 * Correlation loop: every `intervalSeconds`, pull the rolling event window
 * from OpenSearch and run every enabled Sigma rule over it. Matches upsert
 * into the alert store with (ruleId, fingerprint, 15m) deduplication.
 */
export class CorrelationScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  /** event.id → observed-at epoch ms, so each event feeds history exactly once across overlapping windows. */
  private readonly observed = new Map<string, number>();

  constructor(
    private readonly rules: () => SigmaRule[],
    private readonly ruleState: RuleStateRepository,
    private readonly events: EventStore,
    private readonly alerts: AlertRepository,
    private readonly evaluator: RuleEvaluator,
    private readonly config: SchedulerConfig,
    private readonly log: Logger,
    private readonly onRuleFired?: (ruleId: string, count: number) => void,
    private readonly enrichment?: SchedulerEnrichment,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((err) => this.log.error({ err }, 'correlation tick failed'));
    }, this.config.intervalSeconds * 1000);
    this.timer.unref();
    this.log.info(this.config, 'correlation scheduler started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<number> {
    if (this.running) {
      this.log.warn('previous correlation tick still running; skipping');
      return 0;
    }
    this.running = true;
    try {
      const until = now.toISOString();
      const since = new Date(now.getTime() - this.config.windowSeconds * 1000).toISOString();
      const window = await this.events.searchWindow(since, until);
      if (window.length === 0) return 0;
      const events = this.enrichWindow(window, now);

      let fired = 0;
      for (const rule of this.rules()) {
        if (!(await this.ruleState.isEnabled(rule.id))) continue;
        const scoped = this.filterByLogsource(rule, events);
        if (scoped.length === 0) continue;
        try {
          const result = this.evaluator.evaluate(rule, scoped);
          if (result.matched) {
            fired += await this.emitAlerts(rule, scoped, result.matchingIndexes, now);
          }
        } catch (err) {
          this.log.error({ err, rule: rule.fileId }, 'rule evaluation error (rule skipped this tick)');
        }
      }
      return fired;
    } finally {
      this.running = false;
    }
  }

  /**
   * Enriches the window in-memory before evaluation, so rules that match
   * surf.enrichment.* fire on whatever landed in OpenSearch — regardless of
   * which writer produced it (shippers write raw). Events are processed oldest
   * first so history builds in order, each event is observed once across
   * overlapping windows, and enrich() leaves already-enriched events untouched.
   */
  private enrichWindow(
    window: Array<Record<string, unknown>>,
    now: Date,
  ): Array<Record<string, unknown>> {
    const enr = this.enrichment;
    if (!enr) return window;

    // Keep the observed-id map bounded: an event only reappears for as long as
    // it stays inside the rolling window, so drop ids older than two windows.
    const horizon = now.getTime() - this.config.windowSeconds * 2000;
    for (const [id, ts] of this.observed) {
      if (ts < horizon) this.observed.delete(id);
    }

    const tsOf = (e: Record<string, unknown>): number => Date.parse(String(getField(e, '@timestamp') ?? ''));
    const idOf = (e: Record<string, unknown>): string | undefined => {
      const v = getField(e, 'event.id') ?? getField(e, '_id');
      return v === undefined ? undefined : String(v);
    };

    return [...window]
      .sort((a, b) => (tsOf(a) || 0) - (tsOf(b) || 0))
      .map((e) => {
        const enriched = enr.enricher.enrich(e); // idempotent; computes against history-so-far
        const id = idOf(e);
        if (id !== undefined && !this.observed.has(id)) {
          enr.refs.observe(e);
          const t = tsOf(e);
          this.observed.set(id, Number.isNaN(t) ? now.getTime() : t);
        }
        return enriched;
      });
  }

  private filterByLogsource(rule: SigmaRule, window: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const { product, service } = rule.logsource;
    return window.filter((e) => {
      const eventProduct = getField(e, 'observer.product') ?? getField(e, 'event.module');
      const eventService = getField(e, 'observer.service') ?? getField(e, 'event.dataset');
      if (product && String(eventProduct ?? '') !== product) return false;
      if (service && String(eventService ?? '') !== service) return false;
      return true;
    });
  }

  private async emitAlerts(
    rule: SigmaRule,
    events: Array<Record<string, unknown>>,
    matchingIndexes: number[],
    now: Date,
  ): Promise<number> {
    // Group matching events by fingerprint so one rule can raise per-entity alerts.
    const byFingerprint = new Map<string, { source: AlertSource; tenantId?: string; eventIds: string[] }>();
    for (const i of matchingIndexes) {
      const event = events[i];
      if (event === undefined) continue;
      const source: AlertSource = {
        system: String(getField(event, 'observer.product') ?? 'unknown'),
        ...(getField(event, 'host.name') !== undefined ? { host: String(getField(event, 'host.name')) } : {}),
        ...(getField(event, 'user.name') !== undefined ? { userId: String(getField(event, 'user.name')) } : {}),
        ...(getField(event, 'source.ip') !== undefined ? { ip: String(getField(event, 'source.ip')) } : {}),
      };
      const tenantId = getField(event, 'surf.tenant.id');
      const fp = alertFingerprint(rule.id, source, tenantId !== undefined ? String(tenantId) : undefined);
      const bucket = byFingerprint.get(fp) ?? {
        source,
        ...(tenantId !== undefined ? { tenantId: String(tenantId) } : {}),
        eventIds: [],
      };
      const eventId = getField(event, 'event.id') ?? getField(event, '_id');
      if (eventId !== undefined) bucket.eventIds.push(String(eventId));
      byFingerprint.set(fp, bucket);
    }

    let emitted = 0;
    const dedupSince = new Date(now.getTime() - this.config.dedupWindowSeconds * 1000).toISOString();
    for (const [fingerprint, group] of byFingerprint) {
      const existing = await this.alerts.findByFingerprint(fingerprint, dedupSince);
      if (existing) {
        await this.alerts.upsert({
          ...existing,
          count: existing.count + 1,
          lastSeen: now.toISOString(),
          correlatedEventIds: [...new Set([...existing.correlatedEventIds, ...group.eventIds])],
        });
        continue; // dedup hit — not a new alert
      }
      const attack = attackTechniques(rule);
      const alert: Alert = {
        id: crypto.randomUUID(),
        ts: now.toISOString(),
        severity: severityOf(rule),
        ruleId: rule.id,
        ruleTitle: rule.title,
        description: rule.description,
        source: group.source,
        ...(group.tenantId !== undefined ? { tenantId: group.tenantId } : {}),
        attack: {
          ...(attack.enterprise.length ? { enterprise: attack.enterprise } : {}),
          ...(attack.ics.length ? { ics: attack.ics } : {}),
        },
        artifacts: [],
        correlatedEventIds: group.eventIds,
        status: 'NEW',
        count: 1,
        firstSeen: now.toISOString(),
        lastSeen: now.toISOString(),
      };
      await this.alerts.upsert(alert);
      emitted += 1;
    }
    if (emitted > 0) {
      this.onRuleFired?.(rule.fileId, emitted);
      this.log.info({ rule: rule.fileId, emitted }, 'rule fired');
    }
    return emitted;
  }
}
