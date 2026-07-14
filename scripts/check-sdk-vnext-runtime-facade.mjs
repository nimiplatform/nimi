#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSdkVnextRuntimeFacadeCandidate,
  runSdkVnextRuntimeFacadeNegativeFixtures,
  validateSdkVnextRuntimeFacadeCandidate,
} from './lib/sdk-vnext-runtime-facade-check.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function main() {
  const fixtureReport = process.argv.length === 3 && process.argv[2] === '--fixture-report-json';
  if (process.argv.length > (fixtureReport ? 3 : 2)) {
    process.stderr.write('usage: check-sdk-vnext-runtime-facade.mjs [--fixture-report-json]\n');
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
  const fixtures = runSdkVnextRuntimeFacadeNegativeFixtures(candidate);
  if (fixtureReport) {
    process.stdout.write(`${JSON.stringify({ fixtures }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`SDK vNext Runtime facade check passed (${fixtures.length} negative admission fixtures)\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`check-sdk-vnext-runtime-facade failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
