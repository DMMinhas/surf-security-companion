/**
 * A faithful, minimal interpreter of the Wazuh <rule> XML that convert-sigma.ts
 * emits — used only by the portal↔Wazuh conformance test.
 *
 * It models the constructs the SURF compiler generates: a set of
 * `<field name pcre2>` conditions (all must match, `negate="yes"` inverts one),
 * an optional `frequency`/`timeframe` with an optional `<same_field>`, and
 * composite rules chained via `<if_matched_sid>`. This is not a general Wazuh
 * engine — it interprets the concrete artifact the compiler produces, so a
 * divergence found here is a real compiler-vs-portal gap.
 */
import { getField } from '../../src/correlation/evaluator.js';

export type Event = Record<string, unknown>;

interface ParsedWazuhRule {
  id?: number;
  ifMatchedSid?: number;
  frequency?: number;
  timeframeSecs: number;
  sameField?: string;
  fields: Array<{ name: string; re: RegExp; negate: boolean }>;
}

function xmlUnescape(s: string): string {
  return s
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

export function parseWazuhRule(block: string): ParsedWazuhRule {
  const idMatch = /<rule id="(\d+)"/.exec(block);
  const sidMatch = /<if_matched_sid>(\d+)<\/if_matched_sid>/.exec(block);
  const freqMatch = /frequency="(\d+)"/.exec(block);
  const tfMatch = /timeframe="(\d+)"/.exec(block);
  const sameMatch = /<same_field>([^<]+)<\/same_field>/.exec(block);

  const fields: Array<{ name: string; re: RegExp; negate: boolean }> = [];
  const fieldRe = /<field name="([^"]+)"([^>]*)>([\s\S]*?)<\/field>/g;
  for (let m = fieldRe.exec(block); m !== null; m = fieldRe.exec(block)) {
    const name = xmlUnescape(m[1] ?? '');
    const attrs = m[2] ?? '';
    const pattern = xmlUnescape(m[3] ?? '');
    fields.push({ name, re: new RegExp(pattern), negate: /\bnegate="yes"/.test(attrs) });
  }

  return {
    ...(idMatch ? { id: Number(idMatch[1]) } : {}),
    ...(sidMatch ? { ifMatchedSid: Number(sidMatch[1]) } : {}),
    ...(freqMatch ? { frequency: Number(freqMatch[1]) } : {}),
    timeframeSecs: tfMatch ? Number(tfMatch[1]) : 300,
    ...(sameMatch ? { sameField: sameMatch[1] } : {}),
    fields,
  };
}

function parseAllRules(xml: string): ParsedWazuhRule[] {
  return (xml.match(/<rule\b[\s\S]*?<\/rule>/g) ?? []).map(parseWazuhRule);
}

/** Events whose every field-condition matches (Wazuh ANDs all `<field>`s). */
function matchingEvents(rule: ParsedWazuhRule, events: Event[]): Event[] {
  return events.filter((e) =>
    rule.fields.every((f) => {
      const v = getField(e, f.name);
      const base = v !== undefined && f.re.test(String(v));
      return f.negate ? !base : base;
    }),
  );
}

const tsOf = (e: Event): number => Date.parse(String(getField(e, '@timestamp') ?? ''));

/** Max events sharing a group that fall within any `timeframe`-wide window. */
function maxWithinTimeframe(timestamps: number[], timeframeSecs: number): number {
  const sorted = [...timestamps].sort((a, b) => a - b);
  let best = 0;
  let start = 0;
  for (let end = 0; end < sorted.length; end += 1) {
    while ((sorted[end] ?? 0) - (sorted[start] ?? 0) > timeframeSecs * 1000) start += 1;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

/**
 * Timestamps of the events that make a rule fire — every matching event for a
 * plain rule, or the timestamps of the groups that crossed `frequency` within
 * the timeframe. Empty when the rule does not fire.
 */
function firingTimestamps(rule: ParsedWazuhRule, events: Event[]): number[] {
  const matches = matchingEvents(rule, events);
  if (rule.frequency === undefined) {
    return matches.length >= 1 ? matches.map(tsOf).filter((n) => !Number.isNaN(n)) : [];
  }
  const groups = new Map<string, number[]>();
  for (const e of matches) {
    const key = rule.sameField ? String(getField(e, rule.sameField) ?? '∅') : '*';
    const t = tsOf(e);
    if (!Number.isNaN(t)) {
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }
  }
  const out: number[] = [];
  for (const times of groups.values()) {
    if (maxWithinTimeframe(times, rule.timeframeSecs) >= rule.frequency) out.push(...times);
  }
  return out;
}

/** Does the compiled Wazuh ruleset (one or two chained rules) fire on this corpus? */
export function wazuhFires(xml: string, events: Event[]): boolean {
  const rules = parseAllRules(xml);
  const composite = rules.find((r) => r.ifMatchedSid !== undefined);
  if (!composite) {
    const primary = rules[0];
    return primary !== undefined && firingTimestamps(primary, events).length > 0;
  }

  // Composite: the referenced precondition must fire, and a trigger event must
  // fall within the composite's timeframe of that firing (cross-entity, matching
  // the portal — the compiler emits no <same_field> on the composite).
  const referenced = rules.find((r) => r.id === composite.ifMatchedSid);
  if (referenced === undefined) return false;
  const preTs = firingTimestamps(referenced, events);
  if (preTs.length === 0) return false;
  const tf = composite.timeframeSecs * 1000;
  const triggers = matchingEvents(composite, events)
    .map(tsOf)
    .filter((n) => !Number.isNaN(n));
  return triggers.some((t) => preTs.some((r) => Math.abs(t - r) <= tf));
}
