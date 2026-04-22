import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const requiredPaths = [
  'spec/kernel/index.md',
  'spec/kernel/agent-script-contract.md',
  'spec/kernel/avatar-event-contract.md',
  'spec/kernel/app-shell-contract.md',
  'spec/kernel/live2d-render-contract.md',
  'spec/kernel/mock-fixture-contract.md',
  'spec/kernel/tables/feature-matrix.yaml',
  'spec/kernel/tables/activity-mapping.yaml',
  'spec/kernel/tables/scenario-catalog.yaml',
  'spec/nimi-avatar.md',
];

const missing = requiredPaths
  .map((relativePath) => ({
    relativePath,
    absolutePath: resolve(ROOT, relativePath),
  }))
  .filter(({ absolutePath }) => !existsSync(absolutePath));

if (missing.length > 0) {
  console.error('Avatar spec consistency check failed. Missing required authority files:');
  for (const entry of missing) {
    console.error(`- ${entry.relativePath}`);
  }
  process.exitCode = 1;
} else {
  console.log('Avatar spec consistency check passed.');
  for (const relativePath of requiredPaths) {
    console.log(`- ${relativePath}`);
  }
}
