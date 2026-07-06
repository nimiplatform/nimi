#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const checkScript = path.join(scriptDir, 'check-test-inventory.mjs');
const result = spawnSync(process.execPath, [checkScript, '--domain', 'zhiyu', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(`ERROR: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
