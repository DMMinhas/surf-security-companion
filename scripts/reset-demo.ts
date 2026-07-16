/** Clears the demo event + alert indices and re-runs the seed. */
import { Client } from '@opensearch-project/opensearch';
import { spawnSync } from 'node:child_process';
import 'dotenv/config';

const client = new Client({
  node: process.env['OPENSEARCH_URL'] ?? 'https://localhost:9200',
  auth: {
    username: process.env['OPENSEARCH_USERNAME'] ?? 'admin',
    password: process.env['OPENSEARCH_PASSWORD'] ?? 'admin',
  },
  ssl: { rejectUnauthorized: false },
});

async function main(): Promise<void> {
  for (const index of ['surf-events-*', 'surf-alerts']) {
    try {
      await client.indices.delete({ index });
      console.log(`deleted ${index}`);
    } catch {
      console.log(`${index} did not exist`);
    }
  }
  const result = spawnSync('npx', ['tsx', 'scripts/seed.ts'], { stdio: 'inherit', shell: true });
  process.exit(result.status ?? 0);
}

main().catch((err) => {
  console.error('reset failed:', err);
  process.exit(1);
});
