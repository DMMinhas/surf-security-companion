import { createHash } from 'node:crypto';
import type { SigmaRule } from '../domain/entities/sigmaRule.js';
import { attackTechniques } from '../domain/entities/sigmaRule.js';

/**
 * Content-pack builder (P2 #8). Turns the /rules roster into a versioned,
 * shippable "content pack": a manifest (with a content hash for drift/subscription
 * checks), a MITRE ATT&CK coverage map, and ATT&CK Navigator layer files
 * (enterprise + ICS) that drop straight into the Navigator tool.
 *
 * Pure and deterministic: given the same rules + options it produces byte-identical
 * output (no clock/randomness of its own — `generatedAt` is injected). That makes it
 * both CI-testable and safe to diff in a "did the pack change?" gate.
 */

export type Domain = 'enterprise-attack' | 'ics-attack';

export interface ContentPackOptions {
  /** Marketing/name of the pack, e.g. "SURF KRITIS Detection Pack". */
  name: string;
  /** Pack version, e.g. calendar "2026.07.1". Excluded from the content hash. */
  version: string;
  /** ISO timestamp; injected so builds are reproducible. Excluded from the content hash. */
  generatedAt: string;
}

export interface PackRuleEntry {
  fileId: string;
  id: string;
  title: string;
  level: SigmaRule['level'];
  status: string;
  enabled: boolean;
  enterprise: string[];
  ics: string[];
  tactics: string[];
  threatId?: string;
  complianceCount: number;
}

export interface TechniqueCoverage {
  techniqueID: string;
  domain: Domain;
  /** fileIds of the rules that cover this technique. */
  rules: string[];
}

export interface TacticCoverage {
  /** ATT&CK tactic slug, e.g. "credential_access". */
  tactic: string;
  rules: string[];
}

export interface CoverageMap {
  enterprise: TechniqueCoverage[];
  ics: TechniqueCoverage[];
  tactics: TacticCoverage[];
  /** Rules that declare a technique but no `attack.<tactic>` tag — a content-quality gap. */
  tacticUnmapped: string[];
  totals: {
    rules: number;
    enterpriseTechniques: number;
    icsTechniques: number;
    tactics: number;
  };
}

export interface NavigatorTechnique {
  techniqueID: string;
  score: number;
  comment: string;
  enabled: boolean;
  color: string;
}

export interface NavigatorLayer {
  name: string;
  versions: { attack: string; navigator: string; layer: string };
  domain: Domain;
  description: string;
  techniques: NavigatorTechnique[];
  gradient: { colors: string[]; minValue: number; maxValue: number };
  legendItems: unknown[];
  hideDisabled: boolean;
}

export interface ContentPackManifest {
  name: string;
  version: string;
  generatedAt: string;
  ruleCount: number;
  /** sha256 over the rule set only (stable across rebuilds unless a rule changes). */
  contentHash: string;
  rules: PackRuleEntry[];
}

export interface ContentPack {
  manifest: ContentPackManifest;
  coverage: CoverageMap;
  navigator: { enterprise: NavigatorLayer; ics: NavigatorLayer };
}

/** ATT&CK versions the Navigator layers target. Bump alongside the technique roster. */
const ATTACK_VERSION = '14';
const NAVIGATOR_VERSION = '4.9.1';
const LAYER_VERSION = '4.5';
/** Single-hue green ramp; darker = more rules covering the technique. */
const GRADIENT = ['#e8f5e9', '#1b5e20'];

const uniqSort = (xs: string[]): string[] => [...new Set(xs)].sort();

/**
 * Tactic tags are the `attack.<tactic>` tags that are NOT technique tags
 * (`attack.tNNNN` / `attack.ics.TNNNN`). Returns the tactic slugs, e.g.
 * "credential_access".
 */
export function tacticsOf(rule: SigmaRule): string[] {
  const tactics: string[] = [];
  for (const tag of rule.tags) {
    if (!tag.startsWith('attack.')) continue;
    if (/^attack\.(ics\.)?t\d{4}(\.\d{3})?$/i.test(tag)) continue; // technique, not tactic
    tactics.push(tag.slice('attack.'.length));
  }
  return uniqSort(tactics);
}

function toPackRule(rule: SigmaRule): PackRuleEntry {
  const { enterprise, ics } = attackTechniques(rule);
  return {
    fileId: rule.fileId,
    id: rule.id,
    title: rule.title,
    level: rule.level,
    status: rule.status ?? 'unknown',
    enabled: rule.enabled,
    enterprise: uniqSort(enterprise),
    ics: uniqSort(ics),
    tactics: tacticsOf(rule),
    ...(rule.threatId !== undefined ? { threatId: rule.threatId } : {}),
    complianceCount: rule.compliance.length,
  };
}

/**
 * Content hash: sha256 over a canonical projection of each rule (identity +
 * detection-relevant fields), independent of pack version/timestamp and of key
 * ordering. Two builds hash equal iff the rules that matter are unchanged.
 */
export function contentHash(rules: SigmaRule[]): string {
  const projection = rules
    .map((r) => ({
      fileId: r.fileId,
      id: r.id,
      title: r.title,
      description: r.description,
      level: r.level,
      status: r.status ?? 'unknown',
      tags: uniqSort(r.tags),
      condition: r.detection.condition,
      fields: uniqSort(Object.values(r.detection.selections).flatMap((s) => Object.keys(s))),
    }))
    .sort((a, b) => a.fileId.localeCompare(b.fileId));
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}

function techniqueCoverage(entries: PackRuleEntry[], domain: Domain): TechniqueCoverage[] {
  const pick = (e: PackRuleEntry): string[] => (domain === 'enterprise-attack' ? e.enterprise : e.ics);
  const byTechnique = new Map<string, string[]>();
  for (const e of entries) {
    for (const t of pick(e)) {
      const rules = byTechnique.get(t) ?? [];
      rules.push(e.fileId);
      byTechnique.set(t, rules);
    }
  }
  return [...byTechnique.entries()]
    .map(([techniqueID, rules]) => ({ techniqueID, domain, rules: uniqSort(rules) }))
    .sort((a, b) => a.techniqueID.localeCompare(b.techniqueID));
}

function buildCoverage(entries: PackRuleEntry[]): CoverageMap {
  const enterprise = techniqueCoverage(entries, 'enterprise-attack');
  const ics = techniqueCoverage(entries, 'ics-attack');

  const byTactic = new Map<string, string[]>();
  for (const e of entries) {
    for (const t of e.tactics) {
      const rules = byTactic.get(t) ?? [];
      rules.push(e.fileId);
      byTactic.set(t, rules);
    }
  }
  const tactics: TacticCoverage[] = [...byTactic.entries()]
    .map(([tactic, rules]) => ({ tactic, rules: uniqSort(rules) }))
    .sort((a, b) => a.tactic.localeCompare(b.tactic));

  const tacticUnmapped = entries
    .filter((e) => (e.enterprise.length > 0 || e.ics.length > 0) && e.tactics.length === 0)
    .map((e) => e.fileId)
    .sort();

  return {
    enterprise,
    ics,
    tactics,
    tacticUnmapped,
    totals: {
      rules: entries.length,
      enterpriseTechniques: enterprise.length,
      icsTechniques: ics.length,
      tactics: tactics.length,
    },
  };
}

function navigatorLayer(
  entries: PackRuleEntry[],
  domain: Domain,
  coverage: TechniqueCoverage[],
  opts: ContentPackOptions,
): NavigatorLayer {
  const titleByFile = new Map(entries.map((e) => [e.fileId, e.title]));
  const maxScore = coverage.reduce((m, c) => Math.max(m, c.rules.length), 1);
  const techniques: NavigatorTechnique[] = coverage.map((c) => ({
    techniqueID: c.techniqueID,
    score: c.rules.length,
    comment: c.rules.map((f) => `${f}: ${titleByFile.get(f) ?? ''}`.trim()).join('\n'),
    enabled: true,
    color: '',
  }));
  return {
    name: `${opts.name} ${opts.version} (${domain === 'enterprise-attack' ? 'Enterprise' : 'ICS'})`,
    versions: { attack: ATTACK_VERSION, navigator: NAVIGATOR_VERSION, layer: LAYER_VERSION },
    domain,
    description: `MITRE ATT&CK coverage for ${opts.name} ${opts.version} — generated from /rules tags.`,
    techniques,
    gradient: { colors: GRADIENT, minValue: 0, maxValue: maxScore },
    legendItems: [],
    hideDisabled: true,
  };
}

export function buildContentPack(rules: SigmaRule[], opts: ContentPackOptions): ContentPack {
  const entries = rules.map(toPackRule).sort((a, b) => a.fileId.localeCompare(b.fileId));
  const coverage = buildCoverage(entries);
  return {
    manifest: {
      name: opts.name,
      version: opts.version,
      generatedAt: opts.generatedAt,
      ruleCount: entries.length,
      contentHash: contentHash(rules),
      rules: entries,
    },
    coverage,
    navigator: {
      enterprise: navigatorLayer(entries, 'enterprise-attack', coverage.enterprise, opts),
      ics: navigatorLayer(entries, 'ics-attack', coverage.ics, opts),
    },
  };
}

const prettyTactic = (slug: string): string =>
  slug.replace(/\./g, ' / ').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Human-readable coverage report for `content-pack/COVERAGE.md`. */
export function renderCoverageMarkdown(pack: ContentPack): string {
  const { manifest, coverage } = pack;
  const lines: string[] = [];
  lines.push(`# ${manifest.name} — ATT&CK coverage`);
  lines.push('');
  lines.push(`- **Version:** ${manifest.version}`);
  lines.push(`- **Generated:** ${manifest.generatedAt}`);
  lines.push(`- **Rules:** ${manifest.ruleCount}`);
  lines.push(`- **Content hash:** \`${manifest.contentHash}\``);
  lines.push(
    `- **Techniques:** ${coverage.totals.enterpriseTechniques} enterprise · ${coverage.totals.icsTechniques} ICS · ${coverage.totals.tactics} tactics`,
  );
  lines.push('');
  lines.push('> Generated by `npm run pack:build` from the ATT&CK tags on each rule. Do not edit by hand.');
  lines.push('');

  const techTable = (title: string, rows: TechniqueCoverage[]): void => {
    lines.push(`## ${title}`);
    lines.push('');
    if (rows.length === 0) {
      lines.push('_None._');
      lines.push('');
      return;
    }
    lines.push('| Technique | Rules |');
    lines.push('| --- | --- |');
    for (const r of rows) lines.push(`| ${r.techniqueID} | ${r.rules.join(', ')} |`);
    lines.push('');
  };
  techTable('ATT&CK Enterprise', coverage.enterprise);
  techTable('ATT&CK for ICS', coverage.ics);

  lines.push('## Tactic coverage');
  lines.push('');
  if (coverage.tactics.length === 0) {
    lines.push('_No tactic tags found._');
  } else {
    lines.push('| Tactic | Rules |');
    lines.push('| --- | --- |');
    for (const t of coverage.tactics) lines.push(`| ${prettyTactic(t.tactic)} | ${t.rules.join(', ')} |`);
  }
  lines.push('');

  if (coverage.tacticUnmapped.length > 0) {
    lines.push('## Content gaps');
    lines.push('');
    lines.push(
      `These rules declare an ATT&CK technique but no \`attack.<tactic>\` tag, so they are absent from the tactic view — add a tactic tag: **${coverage.tacticUnmapped.join(', ')}**.`,
    );
    lines.push('');
  }
  return lines.join('\n');
}
