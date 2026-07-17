import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { SigmaRuleLoader } from '../../src/correlation/loader.js';
import type { SigmaRule } from '../../src/domain/entities/sigmaRule.js';
import { buildContentPack, contentHash, type ContentPackOptions } from '../../src/correlation/contentPack.js';

/**
 * Content-pack / ATT&CK-coverage gate (P2 #8).
 *
 * Asserts invariants that must hold as the roster grows to 50–100 rules, rather
 * than magic counts: technique↔rule consistency, deterministic output, a
 * content hash that moves iff a rule changes, and Navigator layers that mirror
 * the coverage map. A dropped tag or a rule that stops mapping breaks this.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const rulesDir = path.resolve(here, '../../../rules');
const log = pino({ level: 'silent' });

const OPTS: ContentPackOptions = {
  name: 'SURF Test Pack',
  version: '0.0.0-test',
  generatedAt: '2026-07-16T00:00:00.000Z',
};

let rules: SigmaRule[];

beforeAll(async () => {
  const schema = await SigmaRuleLoader.loadSchema(rulesDir);
  rules = await new SigmaRuleLoader(rulesDir, schema, log).loadAll();
});

describe('content pack', () => {
  it('includes every loaded rule in the manifest, sorted by fileId', () => {
    const pack = buildContentPack(rules, OPTS);
    expect(pack.manifest.ruleCount).toBe(rules.length);
    const fileIds = pack.manifest.rules.map((r) => r.fileId);
    expect(fileIds).toEqual([...fileIds].sort());
    expect(new Set(fileIds)).toEqual(new Set(rules.map((r) => r.fileId)));
  });

  it('covers at least one enterprise and one ICS technique (sanity anchors)', () => {
    const pack = buildContentPack(rules, OPTS);
    const ent = pack.coverage.enterprise.map((t) => t.techniqueID);
    const ics = pack.coverage.ics.map((t) => t.techniqueID);
    expect(ent).toContain('T1110'); // R-01 brute force
    expect(ics).toContain('T0813'); // R-08 mass curtailment (ICS)
    expect(pack.coverage.totals.enterpriseTechniques).toBeGreaterThan(0);
    expect(pack.coverage.totals.icsTechniques).toBeGreaterThan(0);
  });

  it('coverage map and per-rule techniques are mutually consistent', () => {
    const pack = buildContentPack(rules, OPTS);
    const byFile = new Map(pack.manifest.rules.map((r) => [r.fileId, r]));

    // every covered technique names ≥1 real rule that actually carries it
    for (const cov of [...pack.coverage.enterprise, ...pack.coverage.ics]) {
      expect(cov.rules.length).toBeGreaterThan(0);
      for (const fileId of cov.rules) {
        const rule = byFile.get(fileId);
        expect(rule).toBeDefined();
        const carried = cov.domain === 'enterprise-attack' ? rule!.enterprise : rule!.ics;
        expect(carried).toContain(cov.techniqueID);
      }
    }

    // and every technique on a rule appears in the coverage map
    const entSet = new Set(pack.coverage.enterprise.map((t) => t.techniqueID));
    const icsSet = new Set(pack.coverage.ics.map((t) => t.techniqueID));
    for (const rule of pack.manifest.rules) {
      for (const t of rule.enterprise) expect(entSet.has(t)).toBe(true);
      for (const t of rule.ics) expect(icsSet.has(t)).toBe(true);
    }
  });

  it('Navigator layers mirror the coverage map and carry the right domain', () => {
    const pack = buildContentPack(rules, OPTS);
    expect(pack.navigator.enterprise.domain).toBe('enterprise-attack');
    expect(pack.navigator.ics.domain).toBe('ics-attack');
    expect(new Set(pack.navigator.enterprise.techniques.map((t) => t.techniqueID))).toEqual(
      new Set(pack.coverage.enterprise.map((t) => t.techniqueID)),
    );
    // score equals the number of covering rules
    for (const t of pack.navigator.enterprise.techniques) {
      const cov = pack.coverage.enterprise.find((c) => c.techniqueID === t.techniqueID);
      expect(t.score).toBe(cov!.rules.length);
    }
  });

  it('is deterministic: same rules + options → byte-identical output', () => {
    expect(JSON.stringify(buildContentPack(rules, OPTS))).toBe(JSON.stringify(buildContentPack(rules, OPTS)));
  });

  it('content hash ignores version/timestamp but tracks rule changes', () => {
    const a = buildContentPack(rules, OPTS).manifest.contentHash;
    const b = buildContentPack(rules, { ...OPTS, version: '9.9.9', generatedAt: '2030-01-01T00:00:00.000Z' })
      .manifest.contentHash;
    expect(a).toBe(b); // version/timestamp excluded

    const mutated = rules.map((r, i) => (i === 0 ? { ...r, tags: [...r.tags, 'attack.t1566'] } : r));
    expect(contentHash(mutated)).not.toBe(a); // a real tag change moves the hash
  });

  it('content hash tracks a change to what a selection MATCHES (values, not just field names)', () => {
    const base = contentHash(rules);
    // Change a matcher VALUE while keeping the same field name and condition.
    const revalued = rules.map((r, i) => {
      if (i !== 0) return r;
      const [selName, sel] = Object.entries(r.detection.selections)[0]!;
      const [field] = Object.entries(sel)[0]!;
      return {
        ...r,
        detection: {
          ...r.detection,
          selections: {
            ...r.detection.selections,
            [selName]: { ...sel, [field]: { kind: 'equals' as const, value: 'MUTATED_MATCH_VALUE' } },
          },
        },
      };
    });
    expect(contentHash(revalued)).not.toBe(base);
  });

  it('flags rules that declare a technique but no tactic tag', () => {
    const pack = buildContentPack(rules, OPTS);
    // structural claim, not a magic count: any unmapped entry must genuinely lack tactics
    for (const fileId of pack.coverage.tacticUnmapped) {
      const rule = pack.manifest.rules.find((r) => r.fileId === fileId);
      expect(rule!.tactics).toHaveLength(0);
      expect(rule!.enterprise.length + rule!.ics.length).toBeGreaterThan(0);
    }
  });
});
