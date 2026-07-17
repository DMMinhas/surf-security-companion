/**
 * Builds the versioned SURF detection "content pack" (P2 #8) from /rules:
 *
 *   content-pack/manifest.json            versioned pack + per-rule summary + content hash
 *   content-pack/coverage-map.json        MITRE ATT&CK coverage (enterprise + ICS + tactics)
 *   content-pack/navigator-enterprise.json  ATT&CK Navigator layer (enterprise-attack)
 *   content-pack/navigator-ics.json         ATT&CK Navigator layer (ics-attack)
 *   content-pack/COVERAGE.md              human-readable coverage report
 *
 * Reuses the portal's SigmaRuleLoader so the pack is derived from the exact same
 * validated roster the runtime loads. Pure build logic lives in
 * backend/src/correlation/contentPack.ts (unit-tested).
 *
 * Usage:
 *   npm run pack:build              write the pack
 *   npm run pack:check              fail if the committed pack is stale vs /rules
 *
 * Env: RULES_DIR, CONTENT_PACK_DIR, CONTENT_PACK_NAME, CONTENT_PACK_VERSION.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pino } from 'pino';
import { SigmaRuleLoader } from '../backend/src/correlation/loader.js';
import {
  buildContentPack,
  renderCoverageMarkdown,
  type ContentPack,
  type CoverageMap,
} from '../backend/src/correlation/contentPack.js';

const ROOT = process.cwd();
const RULES_DIR = process.env['RULES_DIR'] ?? path.join(ROOT, 'rules');
const OUT_DIR = process.env['CONTENT_PACK_DIR'] ?? path.join(ROOT, 'content-pack');
const NAME = process.env['CONTENT_PACK_NAME'] ?? 'SURF KRITIS Detection Pack';

/** Calendar version YYYY.MM.build (build defaults to 1); override with CONTENT_PACK_VERSION. */
function defaultVersion(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}.${mm}.1`;
}

async function loadRules(): Promise<Awaited<ReturnType<SigmaRuleLoader['loadAll']>>> {
  const log = pino({ level: 'silent' });
  const schema = await SigmaRuleLoader.loadSchema(RULES_DIR);
  return new SigmaRuleLoader(RULES_DIR, schema, log).loadAll();
}

function writePack(pack: ContentPack): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const write = (file: string, data: unknown): void =>
    writeFileSync(path.join(OUT_DIR, file), `${JSON.stringify(data, null, 2)}\n`);
  write('manifest.json', pack.manifest);
  write('coverage-map.json', pack.coverage);
  write('navigator-enterprise.json', pack.navigator.enterprise);
  write('navigator-ics.json', pack.navigator.ics);
  writeFileSync(path.join(OUT_DIR, 'COVERAGE.md'), `${renderCoverageMarkdown(pack)}\n`);
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const rules = await loadRules();
  const version = process.env['CONTENT_PACK_VERSION'] ?? defaultVersion(new Date());
  const pack = buildContentPack(rules, { name: NAME, version, generatedAt: new Date().toISOString() });

  if (check) {
    // Version- and timestamp-independent staleness gate for CI.
    const manifestPath = path.join(OUT_DIR, 'manifest.json');
    const coveragePath = path.join(OUT_DIR, 'coverage-map.json');
    let committedHash: string | undefined;
    let committedCoverage: CoverageMap | undefined;
    try {
      committedHash = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { contentHash?: string }).contentHash;
      committedCoverage = JSON.parse(readFileSync(coveragePath, 'utf8')) as CoverageMap;
    } catch {
      console.error(`content pack missing or unreadable in ${OUT_DIR}; run "npm run pack:build".`);
      process.exit(1);
    }
    const hashDrift = committedHash !== pack.manifest.contentHash;
    const coverageDrift = JSON.stringify(committedCoverage) !== JSON.stringify(pack.coverage);
    if (hashDrift || coverageDrift) {
      console.error('content pack is stale vs /rules; run "npm run pack:build" and commit the result.');
      if (hashDrift) console.error(`  contentHash: committed=${committedHash} current=${pack.manifest.contentHash}`);
      process.exit(1);
    }
    console.log(`content pack up to date (${pack.manifest.ruleCount} rules, hash ${pack.manifest.contentHash.slice(0, 12)}…).`);
    return;
  }

  writePack(pack);
  console.log(
    `wrote ${NAME} ${version} to ${OUT_DIR} — ${pack.manifest.ruleCount} rules, ` +
      `${pack.coverage.totals.enterpriseTechniques} enterprise + ${pack.coverage.totals.icsTechniques} ICS techniques.`,
  );
  if (pack.coverage.tacticUnmapped.length > 0) {
    console.log(`  note: ${pack.coverage.tacticUnmapped.length} rule(s) missing a tactic tag: ${pack.coverage.tacticUnmapped.join(', ')}`);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
