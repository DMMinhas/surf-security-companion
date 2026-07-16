import type { Severity } from '../valueObjects/severity.js';

/** A parsed & schema-validated Sigma rule from /rules (source of truth). */
export interface SigmaRule {
  id: string;
  fileId: string; // e.g. "R-07"
  title: string;
  description: string;
  author: string;
  date: string;
  references: string[];
  level: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  tags: string[];
  logsource: { product?: string; service?: string; category?: string };
  detection: SigmaDetection;
  falsepositives: string[];
  owner: string;
  threatId?: string;
  compliance: string[];
  enabled: boolean;
}

export interface SigmaDetection {
  /** Named selections (everything except `condition` / `timeframe`). */
  selections: Record<string, SigmaSelection>;
  condition: string;
  timeframeMs?: number;
}

/** A selection is a conjunction of field matchers. */
export type SigmaSelection = Record<string, SigmaMatcher>;

export type SigmaMatcher =
  | { kind: 'equals'; value: string | number | boolean }
  | { kind: 'in'; values: Array<string | number | boolean> }
  | { kind: 'contains'; value: string }
  | { kind: 'containsAny'; values: string[] };

export interface RuleStats {
  ruleId: string;
  firingRate24h: number;
  precision: number | null; // resolved true-positives / total resolved, null until data exists
  lastReviewed: string | null;
  lastFired: string | null;
}

export function severityOf(rule: SigmaRule): Severity {
  return rule.level === 'informational' ? 'info' : rule.level;
}

export function attackTechniques(rule: SigmaRule): { enterprise: string[]; ics: string[] } {
  const enterprise: string[] = [];
  const ics: string[] = [];
  for (const tag of rule.tags) {
    const icsMatch = /^attack\.ics\.(t\d{4}(?:\.\d{3})?)$/i.exec(tag);
    if (icsMatch?.[1]) {
      ics.push(icsMatch[1].toUpperCase());
      continue;
    }
    const entMatch = /^attack\.(t\d{4}(?:\.\d{3})?)$/i.exec(tag);
    if (entMatch?.[1]) enterprise.push(entMatch[1].toUpperCase());
  }
  return { enterprise, ics };
}
