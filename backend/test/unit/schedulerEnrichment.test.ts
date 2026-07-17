import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { SigmaRuleLoader } from '../../src/correlation/loader.js';
import { CorrelationScheduler, DEFAULT_SCHEDULER_CONFIG } from '../../src/correlation/scheduler.js';
import { RuleEvaluator } from '../../src/correlation/evaluator.js';
import { Enricher } from '../../src/correlation/enrichment.js';
import { DefaultReferenceData, DEMO_REFERENCE_CONFIG } from '../../src/correlation/enrichmentReferenceData.js';
import type { SigmaRule } from '../../src/domain/entities/sigmaRule.js';
import type { AlertRepository, EventStore, RuleStateRepository } from '../../src/domain/ports/repositories.js';
import type { Alert } from '../../src/domain/entities/alert.js';

/**
 * Proves the enrichment engine runs where live telemetry actually reaches it —
 * the correlation read/eval boundary. Raw shippers write un-enriched events to
 * OpenSearch, so surf.enrichment.* must be computed as the scheduler reads the
 * window. R-02 (impossible travel) must fire only once the second login enters
 * the window and is paired against the first login observed on an earlier tick.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const rulesDir = path.resolve(here, '../../../rules');
const log = pino({ level: 'silent' });

function login(id: string, ip: string, ts: string): Record<string, unknown> {
  return {
    'event.id': id,
    'event.action': 'LOGIN',
    'event.outcome': 'success',
    'user.name': 'dirk.dso',
    'source.ip': ip,
    'observer.product': 'keycloak',
    'observer.service': 'events',
    '@timestamp': ts,
  };
}

describe('scheduler read-time enrichment', () => {
  let rules: SigmaRule[];
  beforeAll(async () => {
    const schema = await SigmaRuleLoader.loadSchema(rulesDir);
    rules = await new SigmaRuleLoader(rulesDir, schema, log).loadAll();
  });

  it('fires R-02 only once the impossible-travel login enters the window', async () => {
    const r02 = rules.filter((r) => r.fileId === 'R-02');
    expect(r02).toHaveLength(1);

    let window: Array<Record<string, unknown>> = [];
    const events = { searchWindow: async () => window } as unknown as EventStore;
    const ruleState = { isEnabled: async () => true } as unknown as RuleStateRepository;
    const emitted: Alert[] = [];
    const alerts = {
      findByFingerprint: async () => undefined,
      upsert: async (a: Alert) => {
        emitted.push(a);
      },
    } as unknown as AlertRepository;

    const refs = new DefaultReferenceData(DEMO_REFERENCE_CONFIG);
    const scheduler = new CorrelationScheduler(
      () => r02,
      ruleState,
      events,
      alerts,
      new RuleEvaluator(),
      DEFAULT_SCHEDULER_CONFIG,
      log,
      undefined,
      { enricher: new Enricher(refs), refs },
    );

    const A = login('a1', '198.51.100.7', '2026-07-16T10:00:00Z'); // Frankfurt
    const B = login('b1', '203.0.113.5', '2026-07-16T10:03:00Z'); // Singapore (~9000 km)

    // Tick 1: only the first login is visible → no impossible travel, but it is observed.
    window = [A];
    expect(await scheduler.tick(new Date('2026-07-16T10:01:00Z'))).toBe(0);
    expect(emitted).toHaveLength(0);

    // Tick 2: the second login arrives; enrichment pairs it with the observed
    // first login (>500 km within 30 min) and R-02 fires exactly once.
    window = [A, B];
    expect(await scheduler.tick(new Date('2026-07-16T10:04:00Z'))).toBe(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.ruleId).toBe(r02[0]!.id);
  });

  it('does not enrich when no enrichment is wired (feature is opt-in)', async () => {
    const r02 = rules.filter((r) => r.fileId === 'R-02');
    const events = {
      searchWindow: async () => [login('a1', '198.51.100.7', '2026-07-16T10:00:00Z')],
    } as unknown as EventStore;
    const ruleState = { isEnabled: async () => true } as unknown as RuleStateRepository;
    const emitted: Alert[] = [];
    const alerts = {
      findByFingerprint: async () => undefined,
      upsert: async (a: Alert) => {
        emitted.push(a);
      },
    } as unknown as AlertRepository;

    // No enrichment argument → the window passes through raw, so R-02 (which needs
    // surf.enrichment.impossible_travel) cannot match.
    const scheduler = new CorrelationScheduler(
      () => r02,
      ruleState,
      events,
      alerts,
      new RuleEvaluator(),
      DEFAULT_SCHEDULER_CONFIG,
      log,
    );
    expect(await scheduler.tick(new Date('2026-07-16T10:01:00Z'))).toBe(0);
    expect(emitted).toHaveLength(0);
  });
});
