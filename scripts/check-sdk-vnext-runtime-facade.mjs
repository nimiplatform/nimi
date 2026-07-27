#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSdkVnextRuntimeFacadeCandidate,
  validateSdkVnextRuntimeFacadeCandidate,
} from './lib/sdk-vnext-runtime-facade-check.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function main() {
  if (process.argv.length > 2) {
    process.stderr.write('usage: check-sdk-vnext-runtime-facade.mjs\n');
    process.exitCode = 1;
    return;
  }
  const candidate = loadSdkVnextRuntimeFacadeCandidate(repoRoot);
  const issues = validateSdkVnextRuntimeFacadeCandidate(candidate);
  if (issues.length > 0) {
    process.stderr.write('SDK vNext Runtime facade check failed:\n');
    for (const item of issues) process.stderr.write(`- ${item.code}: ${item.reason} (${item.target})\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('SDK vNext Runtime facade check passed\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`check-sdk-vnext-runtime-facade failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
