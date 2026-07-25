#!/usr/bin/env node
// Runs every `check:*` package script and reports which are red.
//
// Existence rationale: P1-P4 each claimed "all gates green" while eight
// static gates were red on HEAD, because no pass ever ran them all. Any
// commit message asserting green gates must be backed by a run of this.
//
// Gates needing a built workspace, a live service, or network are excluded
// by name below - they are not "skipped silently", they are reported.

import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 300_000;

// Gates excluded from the static sweep, each with the reason it cannot run
// from a clean checkout without prior build/service/network state.
const NON_STATIC = new Map([
  ['check:runtime-targeted', 'runs the Go compliance suite'],
  ['check:runtime-owner-batch', 'runs the Go compliance suite'],
  ['check:sdk-consumer-smoke', 'builds and packs the SDK into a temp consumer'],
  ['check:bundle-size', 'requires a production renderer build'],
  ['check:runtime-go-coverage', 'runs the Go test suite for coverage thresholds'],
  ['check:runtime-ai-scenario-coverage', 'runs the Go AI scenario suite'],
  ['check:runtime-govulncheck', 'queries the upstream vulnerability database'],
  ['check:runtime-goreleaser-snapshot', 'runs a full goreleaser snapshot build'],
  ['check:runtime-release-signing', 'needs release signing material'],
  ['check:secrets', 'needs the detect-secrets Python hook on PATH'],
  ['check:live-smoke-gate', 'needs a live Runtime service'],
  ['check:kit-visual-audit', 'renders kit surfaces in a browser'],
  ['check:realm-contract-lock', 'requires --realm-root <realm-checkout>'],
  ['check:realm-contract-current', 'requires --realm-root <realm-checkout>'],
  ['check:dev-kernel-checkpoint-acceptance', 'requires --manifest <candidate-manifest.yaml>'],
  ['check:zhiyu-bootstrap', 'launches the Zhiyu Electron acceptance suite'],
  ['check:zhiyu-acceptance', 'launches the Zhiyu Electron acceptance suite'],
]);

const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts ?? {};
const keys = Object.keys(scripts).filter((key) => key.startsWith('check:'));
const selected = keys.filter((key) => !NON_STATIC.has(key));

// A red gate that CI enforces is a broken build; a red gate no workflow can
// reach is an accounting item. Reporting the tier keeps the two from being
// read as the same thing.
function ciReachableKeys() {
  const workflowsDir = path.join(repoRoot, '.github/workflows');
  let workflowText = '';
  for (const name of readdirSync(workflowsDir)) {
    workflowText += readFileSync(path.join(workflowsDir, name), 'utf8');
  }
  const reachable = new Set([...workflowText.matchAll(/pnpm (check:[a-z0-9:-]+)/g)].map((match) => match[1]));
  for (let grew = true; grew;) {
    grew = false;
    for (const key of [...reachable]) {
      for (const match of (scripts[key] ?? '').matchAll(/pnpm (check:[a-z0-9:-]+)/g)) {
        if (!reachable.has(match[1])) {
          reachable.add(match[1]);
          grew = true;
        }
      }
    }
  }
  return reachable;
}

const ciReachable = ciReachableKeys();

const red = [];
const failedToStart = [];
for (const key of selected) {
  try {
    await run('pnpm', [key], { cwd: repoRoot, timeout: TIMEOUT_MS, shell: true, maxBuffer: 64 * 1024 * 1024 });
    process.stdout.write(`green ${key}\n`);
  } catch (error) {
    if (error.killed) {
      failedToStart.push({ key, detail: `timed out after ${TIMEOUT_MS}ms` });
      process.stdout.write(`TIMEOUT ${key}\n`);
      continue;
    }
    red.push({ key, detail: String(error.stdout ?? '').trim().split('\n').slice(-3).join('\n') });
    process.stdout.write(`RED ${key}\n`);
  }
}

process.stdout.write('\n--- sweep summary ---\n');
process.stdout.write(`static gates run: ${selected.length} of ${keys.length} check keys\n`);
for (const [key, reason] of NON_STATIC) {
  process.stdout.write(`excluded: ${key} (${reason})\n`);
}
for (const { key, detail } of failedToStart) {
  process.stdout.write(`timeout: ${key} - ${detail}\n`);
}

const redEnforced = red.filter(({ key }) => ciReachable.has(key));
const redOrphan = red.filter(({ key }) => !ciReachable.has(key));
process.stdout.write(`\nred, CI-enforced (${redEnforced.length}):\n`);
for (const { key, detail } of redEnforced) process.stdout.write(`\n  ${key}\n${detail}\n`);
process.stdout.write(`\nred, no workflow reaches it (${redOrphan.length}):\n`);
for (const { key, detail } of redOrphan) process.stdout.write(`\n  ${key}\n${detail}\n`);

process.stdout.write(`\nred count: ${red.length + failedToStart.length}`);
process.stdout.write(` (CI-enforced ${redEnforced.length}, orphan ${redOrphan.length}`);
process.stdout.write(`, timeout ${failedToStart.length})\n`);
if (red.length > 0 || failedToStart.length > 0) process.exit(1);
