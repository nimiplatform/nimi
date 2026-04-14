#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSeedanceSmokeArgs, runSeedanceSmoke } from './lib/seedance-video-smoke.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function printResult(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const options = parseSeedanceSmokeArgs({
    repoRoot,
    argv: process.argv.slice(2),
  });
  const report = await runSeedanceSmoke({ repoRoot, options });
  printResult(report);
}

main().catch((error) => {
  const payload = {
    ok: false,
    error: {
      name: error?.name || 'Error',
      status: error?.status || null,
      message: error?.message || String(error),
      payload: error?.payload || null,
    },
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
});
