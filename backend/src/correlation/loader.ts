import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { SigmaDetection, SigmaMatcher, SigmaRule, SigmaSelection } from '../domain/entities/sigmaRule.js';
import type { Logger } from 'pino';

const RULE_FILE_PATTERN = /^(R-\d{2})-.*\.ya?ml$/;

const TIMEFRAME_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export class RuleLoadError extends Error {
  constructor(file: string, cause: string) {
    super(`Failed to load rule ${file}: ${cause}`);
    this.name = 'RuleLoadError';
  }
}

/**
 * Loads Sigma rules from /rules, validates each against the SURF Sigma schema
 * (AJV), and parses detections into an executable form. Fails closed: an
 * invalid rule aborts startup rather than silently running a partial roster.
 */
export class SigmaRuleLoader {
  private readonly validate: ValidateFunction;

  constructor(
    private readonly rulesDir: string,
    schema: Record<string, unknown>,
    private readonly log: Logger,
  ) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const applyFormats = (addFormats as unknown as { default?: (a: Ajv2020) => void }).default ?? (addFormats as unknown as (a: Ajv2020) => void);
    applyFormats(ajv);
    this.validate = ajv.compile(schema);
  }

  static async loadSchema(rulesDir: string): Promise<Record<string, unknown>> {
    const raw = await readFile(path.join(rulesDir, 'schema', 'sigma-surf.json'), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  async loadAll(): Promise<SigmaRule[]> {
    const files = (await readdir(this.rulesDir)).filter((f) => RULE_FILE_PATTERN.test(f)).sort();
    const rules: SigmaRule[] = [];
    for (const file of files) {
      rules.push(await this.loadOne(file));
    }
    this.log.info({ count: rules.length }, 'Sigma rules loaded and validated');
    return rules;
  }

  async loadOne(file: string): Promise<SigmaRule> {
    const raw = await readFile(path.join(this.rulesDir, file), 'utf8');
    const doc = parseYaml(raw) as Record<string, unknown>;

    if (!this.validate(doc)) {
      const errors = (this.validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join('; ');
      throw new RuleLoadError(file, errors);
    }

    const match = RULE_FILE_PATTERN.exec(file);
    const fileId = match?.[1] ?? file;
    const detection = parseDetection(doc['detection'] as Record<string, unknown>, file);

    return {
      id: String(doc['id']),
      fileId,
      title: String(doc['title']),
      description: String(doc['description']),
      author: String(doc['author']),
      date: String(doc['date']),
      references: doc['references'] as string[],
      level: doc['level'] as SigmaRule['level'],
      ...(doc['status'] !== undefined ? { status: doc['status'] as SigmaRule['status'] } : {}),
      tags: doc['tags'] as string[],
      logsource: doc['logsource'] as SigmaRule['logsource'],
      detection,
      falsepositives: doc['falsepositives'] as string[],
      owner: String(doc['owner']),
      ...(doc['surf.threat_id'] !== undefined ? { threatId: String(doc['surf.threat_id']) } : {}),
      compliance: (doc['surf.compliance'] as string[] | undefined) ?? [],
      enabled: true,
    };
  }
}

export function parseDetection(raw: Record<string, unknown>, file: string): SigmaDetection {
  const selections: Record<string, SigmaSelection> = {};
  let timeframeMs: number | undefined;

  for (const [key, value] of Object.entries(raw)) {
    if (key === 'condition') continue;
    if (key === 'timeframe') {
      const m = /^(\d+)([smhd])$/.exec(String(value));
      if (!m || m[1] === undefined || m[2] === undefined) throw new RuleLoadError(file, `bad timeframe ${String(value)}`);
      timeframeMs = Number(m[1]) * (TIMEFRAME_MS[m[2]] ?? 60_000);
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new RuleLoadError(file, `selection ${key} must be a mapping`);
    }
    selections[key] = parseSelection(value as Record<string, unknown>);
  }

  const condition = String(raw['condition']);
  return { selections, condition, ...(timeframeMs !== undefined ? { timeframeMs } : {}) };
}

function parseSelection(raw: Record<string, unknown>): SigmaSelection {
  const selection: SigmaSelection = {};
  for (const [fieldExpr, value] of Object.entries(raw)) {
    const [field, modifier] = fieldExpr.split('|', 2);
    if (!field) continue;
    selection[field] = toMatcher(value, modifier);
  }
  return selection;
}

function toMatcher(value: unknown, modifier?: string): SigmaMatcher {
  if (modifier === 'contains') {
    if (Array.isArray(value)) return { kind: 'containsAny', values: value.map((v) => String(v)) };
    return { kind: 'contains', value: String(value) };
  }
  if (Array.isArray(value)) {
    return { kind: 'in', values: value.map((v) => v as string | number | boolean) };
  }
  return { kind: 'equals', value: value as string | number | boolean };
}
