#!/usr/bin/env node
//
// Umbrella generator: re-project all release-gate consumer surfaces.
//
// Owner: scripts; this generator projects the registry authority below.
// Authority: P-RELG-003 projection-only execution surfaces, P-RELG-013
// registry version discipline.
//
// Drives the per-surface generators:
//   - lint chain body in package.json scripts.lint   (W3 lands writer)
//   - CI workflow marker fences in .github/workflows  (W5 lands writer)
//
// Modes:
//   default    write projections to disk (no-op at W2; W3/W5 wire writers)
//   --check    invoke each surface's projection-drift check (read-only)
//
// Determinism: dispatcher only; per-surface generators are pure
// projection functions plus a single I/O write each. Offline-safe.

import { spawn } from 'node:child_process';
import process from 'node:process';

function parseArgs(argv) {
  const opts = { check: false };
  for (const arg of argv) {
    switch (arg) {
      case '--check':
        opts.check = true;
        break;
      case '--help':
      case '-h':
        process.stdout.write(USAGE + '\n');
        process.exit(0);
        return null;
      default:
        process.stderr.write(`unknown argument: ${arg}\n`);
        process.exit(2);
    }
  }
  return opts;
}

const USAGE = [
  'Usage: node scripts/generate-release-gate-projection-all.mjs [options]',
  '',
  'Options:',
  '  --check     Invoke each projection-drift check instead of writing',
  '              (used by nimicoding generate-spec-derived-docs --check)',
  '  --help      Print this help and exit',
  '',
  'At W2 close, the only registered drift checker is',
  '`scripts/check-release-gate-projection-drift.mjs`. W3 and W5 add',
  'concrete writers that this umbrella will dispatch to once landed.',
].join('\n');

function runChild(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.check) {
    // Drift-check mode dispatches to the W2 drift checker. W3 and W5
    // can extend the dispatch list as their writers land.
    const exit = await runChild('node', [
      'scripts/check-release-gate-projection-drift.mjs',
    ]);
    process.exit(exit);
  }

  // Write mode at W2: no writer surfaces are landed yet (lint chain
  // regen lands W3; CI fence regen lands W5). Print an explicit
  // no-op note so callers can distinguish "ran successfully with
  // nothing to project" from "silent skip".
  process.stdout.write(
    'release-gate projection: no writable surfaces at W2; W3 lands lint generator; W5 lands CI fence generator.\n'
  );
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(
    `generate-release-gate-projection-all failed: ${error.stack ?? error.message ?? String(error)}\n`
  );
  process.exit(1);
});
