/**
 * Standalone auditor tool: recomputes Merkle roots straight from OpenSearch,
 * verifies Ed25519 signatures and prev-root linkage against BOTH the Postgres
 * ledger and the MinIO WORM copies. Exit code 0 = clean, 1 = tampering or gap.
 *
 * Usage: npm run verify:hashchain -- --from 2026-07-01T00:00Z --to 2026-07-14T00:00Z
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { Client as OsClient } from '@opensearch-project/opensearch';
import * as Minio from 'minio';
import * as ed from '@noble/ed25519';
import 'dotenv/config';

interface LedgerRow {
  hour: Date;
  root: string;
  sig: string;
  prev_hour: Date | null;
  prev_root: string | null;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

const LEAF = Buffer.from([0x00]);
const NODE = Buffer.from([0x01]);

function merkleRoot(leaves: Array<{ id: string; hash: string }>): string {
  if (leaves.length === 0) return createHash('sha256').update('').digest('hex');
  let level = [...leaves]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((l) => createHash('sha256').update(LEAF).update(`${l.id}:${l.hash}`).digest());
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      next.push(right ? createHash('sha256').update(NODE).update(left).update(right).digest() : left);
    }
    level = next;
  }
  return level[0]!.toString('hex');
}

async function main(): Promise<void> {
  const from = arg('from') ?? new Date(Date.now() - 86_400_000).toISOString();
  const to = arg('to') ?? new Date().toISOString();

  const pool = new pg.Pool({
    host: process.env['PG_HOST'] ?? 'localhost',
    port: Number(process.env['PG_PORT'] ?? 5432),
    database: process.env['PG_DB'] ?? 'surf_soc',
    user: process.env['PG_USER'] ?? 'soc_app',
    password: process.env['PG_PASSWORD'] ?? '',
    ssl: false,
  });
  const os = new OsClient({
    node: process.env['OPENSEARCH_URL'] ?? 'https://localhost:9200',
    auth: {
      username: process.env['OPENSEARCH_USERNAME'] ?? 'admin',
      password: process.env['OPENSEARCH_PASSWORD'] ?? 'admin',
    },
    ssl: { rejectUnauthorized: false },
  });
  const [mHost, mPort] = (process.env['MINIO_ENDPOINT'] ?? 'localhost:9000').split(':');
  const minio = new Minio.Client({
    endPoint: mHost ?? 'localhost',
    port: Number(mPort ?? 9000),
    useSSL: process.env['MINIO_USE_SSL'] === 'true',
    accessKey: process.env['MINIO_ACCESS_KEY'] ?? '',
    secretKey: process.env['MINIO_SECRET_KEY'] ?? '',
  });

  const keyHex = readFileSync(process.env['HASHCHAIN_SIGNING_KEY_PATH'] ?? './secrets/hashchain-ed25519.key', 'utf8').trim();
  const publicKey = await ed.getPublicKeyAsync(Uint8Array.from(Buffer.from(keyHex, 'hex')));

  const { rows } = await pool.query<LedgerRow>(
    'SELECT hour, root, sig, prev_hour, prev_root FROM hashchain_ledger WHERE hour >= $1 AND hour <= $2 ORDER BY hour',
    [from, to],
  );
  console.log(`verifying ${rows.length} ledger entries from ${from} to ${to}`);

  let failures = 0;
  let prev: LedgerRow | undefined;
  for (const row of rows) {
    const hourIso = row.hour.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const hourEnd = new Date(row.hour.getTime() + 3_600_000).toISOString();

    // 1. recompute root from OpenSearch
    const search = await os.search({
      index: 'surf-events-*',
      body: { query: { range: { '@timestamp': { gte: hourIso, lt: hourEnd } } }, size: 10_000 },
    });
    const hits = (search.body as { hits: { hits: Array<{ _id: string; _source: Record<string, unknown> }> } }).hits.hits;
    const recomputed = merkleRoot(
      hits.map((h) => ({ id: h._id, hash: createHash('sha256').update(canonicalJson(h._source)).digest('hex') })),
    );
    if (recomputed !== row.root) {
      console.error(`✗ ${hourIso}: ROOT MISMATCH (ledger=${row.root.slice(0, 12)}… recomputed=${recomputed.slice(0, 12)}…)`);
      failures += 1;
    }

    // 2. verify signature
    const message = new TextEncoder().encode(`${hourIso}:${row.root}:${row.prev_root ?? ''}`);
    const sigOk = await ed.verifyAsync(Uint8Array.from(Buffer.from(row.sig, 'hex')), message, publicKey).catch(() => false);
    if (!sigOk) {
      console.error(`✗ ${hourIso}: INVALID SIGNATURE`);
      failures += 1;
    }

    // 3. chain linkage
    if (prev && row.prev_root !== prev.root) {
      console.error(`✗ ${hourIso}: BROKEN CHAIN (prev_root does not match previous entry)`);
      failures += 1;
    }

    // 4. WORM copy agrees
    try {
      const key = `rollups/${hourIso.replaceAll(':', '-')}.json`;
      const stream = await minio.getObject(process.env['MINIO_BUCKET_HASHCHAIN'] ?? 'surf-hashchain', key);
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      const worm = JSON.parse(Buffer.concat(chunks).toString()) as { root: string };
      if (worm.root !== row.root) {
        console.error(`✗ ${hourIso}: WORM COPY DISAGREES with Postgres ledger`);
        failures += 1;
      }
    } catch {
      console.error(`✗ ${hourIso}: WORM COPY MISSING`);
      failures += 1;
    }

    if (failures === 0) console.log(`✓ ${hourIso}: root, signature, linkage, WORM copy OK (${hits.length} events)`);
    prev = row;
  }

  await pool.end();
  if (failures > 0) {
    console.error(`\nVERIFICATION FAILED: ${failures} problem(s) — see runbook RB-05`);
    process.exit(1);
  }
  console.log('\nhash chain verifies clean ✓');
}

main().catch((err) => {
  console.error('verify failed:', err);
  process.exit(1);
});
