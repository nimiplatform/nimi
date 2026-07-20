#!/usr/bin/env node
//
// Umbrella generator: re-project all release-gate consumer surfaces.
//
// Owner: scripts; this generator projects the registry authority below.
// Authority: P-RELG-003 projection-only execution surfaces, P-RELG-013
// registry version discipline.
//
// Drives the current per-surface generators:
//   - lint chain body in package.json scripts.lint
//   - CI workflow marker fences in .github/workflows
//
// Modes:
//   default    write projections to disk
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
  'Write mode runs both deterministic projection writers.',
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
    const exit = await runChild('node', [
      'scripts/check-release-gate-projection-drift.mjs',
    ]);
    process.exit(exit);
  }

  for (const [script, args] of [
    ['scripts/generate-lint-chain.mjs', []],
    ['scripts/generate-ci-workflow-steps.mjs', []],
  ]) {
    const exit = await runChild('node', [script, ...args]);
    if (exit !== 0) process.exit(exit);
  }
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(
    `generate-release-gate-projection-all failed: ${error.stack ?? error.message ?? String(error)}\n`
  );
  process.exit(1);
});
