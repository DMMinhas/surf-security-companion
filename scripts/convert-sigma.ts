/**
 * Sigma → Wazuh converter, run by the sigma-compiler container at deploy
 * time (and by CI). Validates every rule against rules/schema/sigma-surf.json
 * first (AJV), then emits a Wazuh <group> ruleset. Simple field-equality and
 * `contains` selections translate directly; aggregated conditions
 * (count()-based) translate to <frequency>/<timeframe> rules.
 *
 * Flags:
 *   --validate-only   schema validation only, no output
 *   --dry-run         print XML to stdout instead of writing
 *
 * Wazuh rule id block 100100–100199 is reserved for SURF (see RULE_AUTHORING.md).
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const RULES_DIR = process.env['RULES_DIR'] ?? path.join(process.cwd(), 'rules');
const OUTPUT_DIR = process.env['OUTPUT_DIR'] ?? path.join(process.cwd(), 'build', 'wazuh-rules');
const BASE_RULE_ID = 100100;

const LEVEL_MAP: Record<string, number> = { critical: 15, high: 12, medium: 8, low: 5, informational: 3 };

interface SigmaDoc {
  id: string;
  title: string;
  description: string;
  level: string;
  tags: string[];
  logsource: { product?: string; service?: string };
  detection: Record<string, unknown>;
  [key: string]: unknown;
}

function xmlEscape(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function selectionToFields(selection: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [fieldExpr, value] of Object.entries(selection)) {
    const [field, modifier] = fieldExpr.split('|', 2);
    if (!field) continue;
    const values = Array.isArray(value) ? value : [value];
    const pattern = values.map((v) => xmlEscape(String(v))).join('|');
    const negate = '';
    if (modifier === 'contains') {
      lines.push(`    <field name="${xmlEscape(field)}" type="pcre2"${negate}>${pattern}</field>`);
    } else {
      lines.push(`    <field name="${xmlEscape(field)}" type="pcre2"${negate}>^(?:${pattern})$</field>`);
    }
  }
  return lines;
}

function convertRule(doc: SigmaDoc, ruleId: number): string {
  const condition = String(doc.detection['condition'] ?? 'selection');
  const timeframe = doc.detection['timeframe'] ? String(doc.detection['timeframe']) : undefined;
  const agg = /\|\s*count\((.*?)\)\s*(?:by\s+([\w.]+)\s*)?(>=|>)\s*(\d+)/.exec(condition);

  const level = LEVEL_MAP[doc.level] ?? 5;
  const mitre = doc.tags
    .filter((t) => /^attack\.(?:ics\.)?t\d{4}/i.test(t))
    .map((t) => t.replace(/^attack\.(ics\.)?/i, '').toUpperCase());

  const lines: string[] = [];
  const frequency = agg ? Number(agg[4]) + 1 : undefined;
  const timeframeSecs = timeframe ? toSeconds(timeframe) : undefined;

  lines.push(
    `  <rule id="${ruleId}" level="${level}"${frequency ? ` frequency="${frequency}" timeframe="${timeframeSecs ?? 300}"` : ''}>`,
  );
  if (doc.logsource.product) {
    lines.push(`    <decoded_as>json</decoded_as>`);
    lines.push(`    <field name="observer.product" type="pcre2">^${xmlEscape(doc.logsource.product)}$</field>`);
  }
  // primary selection (first non-filter mapping)
  for (const [key, value] of Object.entries(doc.detection)) {
    if (key === 'condition' || key === 'timeframe') continue;
    if (key.startsWith('filter')) continue; // negations are enforced by the portal-side evaluator
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      lines.push(...selectionToFields(value as Record<string, unknown>));
      break;
    }
  }
  if (agg?.[2]) lines.push(`    <same_field>${xmlEscape(agg[2])}</same_field>`);
  lines.push(`    <description>${xmlEscape(doc.title)} [Sigma ${doc.id}]</description>`);
  for (const technique of mitre) lines.push(`    <mitre><id>${technique}</id></mitre>`);
  lines.push(`    <group>surf,sigma,${xmlEscape(doc.level)}</group>`);
  lines.push('  </rule>');
  return lines.join('\n');
}

function toSeconds(timeframe: string): number {
  const m = /^(\d+)([smhd])$/.exec(timeframe);
  if (!m) return 300;
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return Number(m[1]) * mult;
}

function main(): void {
  const validateOnly = process.argv.includes('--validate-only');
  const dryRun = process.argv.includes('--dry-run');

  const schema = JSON.parse(readFileSync(path.join(RULES_DIR, 'schema', 'sigma-surf.json'), 'utf8')) as Record<string, unknown>;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const applyFormats = (addFormats as unknown as { default?: (a: Ajv2020) => void }).default ?? (addFormats as unknown as (a: Ajv2020) => void);
  applyFormats(ajv);
  const validate = ajv.compile(schema);

  const files = readdirSync(RULES_DIR).filter((f) => /^R-\d{2}-.*\.ya?ml$/.test(f)).sort();
  if (files.length === 0) {
    console.error(`no rule files found in ${RULES_DIR}`);
    process.exit(1);
  }

  const converted: string[] = [];
  let errors = 0;
  files.forEach((file, i) => {
    const doc = parseYaml(readFileSync(path.join(RULES_DIR, file), 'utf8')) as SigmaDoc;
    if (!validate(doc)) {
      errors += 1;
      console.error(`✗ ${file}:`);
      for (const err of validate.errors ?? []) console.error(`    ${err.instancePath} ${err.message}`);
      return;
    }
    console.log(`✓ ${file} valid (${doc.id})`);
    if (!validateOnly) converted.push(convertRule(doc, BASE_RULE_ID + i));
  });

  if (errors > 0) {
    console.error(`\n${errors} rule(s) failed schema validation`);
    process.exit(1);
  }
  if (validateOnly) {
    console.log(`\nall ${files.length} rules valid`);
    return;
  }

  const xml = `<!-- Generated by convert-sigma.ts — DO NOT EDIT. Source of truth: /rules/*.yml -->\n<group name="surf,">\n${converted.join('\n\n')}\n</group>\n`;
  if (dryRun) {
    console.log(xml);
    return;
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, 'surf_sigma_rules.xml');
  writeFileSync(outPath, xml);
  console.log(`\nwrote ${files.length} Wazuh rules to ${outPath}`);
}

main();
