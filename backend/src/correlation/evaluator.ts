import type { SigmaMatcher, SigmaRule, SigmaSelection } from '../domain/entities/sigmaRule.js';

export interface EvaluationResult {
  matched: boolean;
  /** Indexes (into the supplied event window) of events that satisfied the condition. */
  matchingIndexes: number[];
  /** For aggregated conditions: the group keys that crossed the threshold. */
  groups: string[];
}

/**
 * Evaluates a parsed Sigma detection against an in-memory window of events.
 *
 * Supported condition grammar (covers all 15 SURF rules and the fixture tests):
 *   selection
 *   selection and not filter
 *   (selection and not filter) | count() by field > N
 *   selection | count() > N
 *   selection | count(field) by field > N            (distinct-count variant)
 *   (sel_a | count() by field >= N) and sel_b        (MFA-fatigue style)
 *
 * This is intentionally a subset of Sigma; anything beyond it must be
 * added here WITH fixtures, or expressed as ingest-time enrichment.
 */
export class RuleEvaluator {
  evaluate(rule: SigmaRule, events: Array<Record<string, unknown>>): EvaluationResult {
    const condition = rule.detection.condition.trim();

    const aggregated = /^(.+?)\s*\|\s*count\((.*?)\)\s*(?:by\s+([\w.]+)\s*)?(>=|>)\s*(\d+)$/.exec(condition);
    if (aggregated) {
      const [, baseExpr, countField, byField, op, thresholdRaw] = aggregated;
      return this.evaluateAggregated(rule, events, {
        baseExpr: (baseExpr ?? '').trim(),
        countField: (countField ?? '').trim() || undefined,
        byField: byField?.trim(),
        gte: op === '>=',
        threshold: Number(thresholdRaw),
      });
    }

    // "(sel_a | count() ... >= N) and sel_b" — conjunctive with one aggregated side.
    const conjunctive = /^\((.+\|\s*count\(.*)\)\s+and\s+([\w]+)$/.exec(condition);
    if (conjunctive && conjunctive[1] && conjunctive[2]) {
      const left = this.evaluate(
        { ...rule, detection: { ...rule.detection, condition: conjunctive[1].trim() } },
        events,
      );
      const rightSel = rule.detection.selections[conjunctive[2]];
      if (!rightSel) throw new Error(`rule ${rule.fileId}: unknown selection ${conjunctive[2]}`);
      const rightIdx = events.flatMap((e, i) => (matchesSelection(e, rightSel) ? [i] : []));
      const matched = left.matched && rightIdx.length > 0;
      return { matched, matchingIndexes: matched ? [...left.matchingIndexes, ...rightIdx] : [], groups: left.groups };
    }

    const indexes = this.matchBooleanExpr(rule, events, condition);
    return { matched: indexes.length > 0, matchingIndexes: indexes, groups: [] };
  }

  private evaluateAggregated(
    rule: SigmaRule,
    events: Array<Record<string, unknown>>,
    agg: { baseExpr: string; countField?: string | undefined; byField?: string | undefined; gte: boolean; threshold: number },
  ): EvaluationResult {
    const baseIndexes = this.matchBooleanExpr(rule, events, stripParens(agg.baseExpr));
    const groups = new Map<string, { indexes: number[]; distinct: Set<string> }>();

    for (const i of baseIndexes) {
      const event = events[i];
      if (event === undefined) continue;
      const key = agg.byField ? String(getField(event, agg.byField) ?? '∅') : '*';
      const bucket = groups.get(key) ?? { indexes: [], distinct: new Set<string>() };
      bucket.indexes.push(i);
      if (agg.countField) bucket.distinct.add(String(getField(event, agg.countField) ?? '∅'));
      groups.set(key, bucket);
    }

    const firedGroups: string[] = [];
    const matchingIndexes: number[] = [];
    for (const [key, bucket] of groups) {
      const count = agg.countField ? bucket.distinct.size : bucket.indexes.length;
      const crossed = agg.gte ? count >= agg.threshold : count > agg.threshold;
      if (crossed) {
        firedGroups.push(key);
        matchingIndexes.push(...bucket.indexes);
      }
    }
    return { matched: firedGroups.length > 0, matchingIndexes, groups: firedGroups };
  }

  /** "selection", "selection and not filter", "sel_a and not filter_b" */
  private matchBooleanExpr(rule: SigmaRule, events: Array<Record<string, unknown>>, expr: string): number[] {
    const parsed = /^([\w]+)(?:\s+and\s+not\s+([\w]+))?$/.exec(stripParens(expr).trim());
    if (!parsed || !parsed[1]) {
      throw new Error(`rule ${rule.fileId}: unsupported condition "${expr}"`);
    }
    const positive = rule.detection.selections[parsed[1]];
    if (!positive) throw new Error(`rule ${rule.fileId}: unknown selection ${parsed[1]}`);
    const negative = parsed[2] ? rule.detection.selections[parsed[2]] : undefined;
    if (parsed[2] && !negative) throw new Error(`rule ${rule.fileId}: unknown filter ${parsed[2]}`);

    return events.flatMap((event, i) =>
      matchesSelection(event, positive) && !(negative && matchesSelection(event, negative)) ? [i] : [],
    );
  }
}

function stripParens(expr: string): string {
  const t = expr.trim();
  return t.startsWith('(') && t.endsWith(')') ? t.slice(1, -1) : t;
}

export function matchesSelection(event: Record<string, unknown>, selection: SigmaSelection): boolean {
  return Object.entries(selection).every(([field, matcher]) => matchesField(getField(event, field), matcher));
}

function matchesField(value: unknown, matcher: SigmaMatcher): boolean {
  switch (matcher.kind) {
    case 'equals':
      return normalize(value) === normalize(matcher.value);
    case 'in':
      return matcher.values.some((v) => normalize(v) === normalize(value));
    case 'contains': {
      if (Array.isArray(value)) return value.some((v) => String(v).includes(matcher.value));
      return typeof value === 'string' && value.includes(matcher.value);
    }
    case 'containsAny': {
      const arr = Array.isArray(value) ? value.map((v) => String(v)) : [String(value)];
      return matcher.values.some((needle) => arr.some((v) => v.includes(needle)));
    }
  }
}

function normalize(v: unknown): unknown {
  return typeof v === 'string' ? v.toLowerCase() : v;
}

/** Dotted-path lookup supporting both nested objects and flat dotted keys. */
export function getField(event: Record<string, unknown>, path: string): unknown {
  if (path in event) return event[path];
  let cursor: unknown = event;
  for (const part of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}
