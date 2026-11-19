// Generate deployment configuration using actual operator-selected Cloudflare resources.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const [output] = process.argv.slice(2);
const db = process.env.CLOUDFLARE_HOSTED_WEB_DATABASE_ID,
  account = process.env.CLOUDFLARE_ACCOUNT_ID,
  bucket = process.env.CLOUDFLARE_HOSTED_WEB_BUCKET;
if (
  !output ||
  !/^[a-f0-9]{32}$/i.test(account ?? '') ||
  !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(db ?? '') ||
  !bucket
)
  throw new Error('Provide a config output, account ID, hosted D1 ID and R2 bucket.');
writeFileSync(
  output,
  JSON.stringify(
    {
      name: 'nimi-hosted-web',
      main: path.join(root, 'worker.mjs'),
      account_id: account,
      compatibility_date: '2026-11-01',
      workers_dev: false,
      preview_urls: false,
      routes: [{ pattern: 'https://*.nimi.xyz/*', zone_name: 'nimi.xyz' }],
      vars: { NIMI_REALM_URL: 'https://realm.nimi.ai' },
      d1_databases: [{ binding: 'DB', database_name: 'nimi-hosted-web', database_id: db }],
      r2_buckets: [{ binding: 'ASSETS_BUCKET', bucket_name: bucket }],
    },
    null,
    2,
  ),
);
