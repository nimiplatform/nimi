#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadImmutablePackageCandidate,
  runImmutablePackageNegativeFixtures,
  validateImmutablePackageCandidate,
} from './lib/immutable-package-unavailable-check.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function printIssues(issues) {
  process.stderr.write('immutable package unavailable gate failed:\n');
  for (const item of issues) {
    process.stderr.write(`- ${item.code}: ${item.reason} (${item.target})\n`);
  }
}

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim();
    throw new Error(`${label} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result;
}

function runRuntimeBehavior() {
  const expected = [
    'TestImmutablePackageLifecycleMethodsAreUnavailableBeforeTargetParsing',
    'TestImmutablePackageLifecycleMethodsIgnoreCallerSelectedTargets',
    'TestAppServiceHasNoImmutablePackageMaterializerOrJobStore',
    'TestGetAppPackageReadinessAlwaysReturnsOpaqueUnavailableProjection',
    'TestGetAppPackageReadinessIsSelectorIndependent',
    'TestImmutablePackageUnaryRPCsAreDenyAllOnEveryRuntimeTransport',
    'TestImmutablePackageJobStreamIsDenyAllOnEveryRuntimeTransport',
    'TestImmutablePackageDenyAllSetMatchesFrozenWireSeams',
  ];
  const pattern = `^(${expected.join('|')})$`;
  const result = run(
    'go',
    ['test', '-json', './internal/services/app', './internal/grpcserver', '-run', pattern, '-count=1'],
    path.join(repoRoot, 'runtime'),
    'Runtime immutable-package behavior proof',
  );
  const passed = new Set(result.stdout.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
    try {
      const event = JSON.parse(line);
      return event.Action === 'pass' && expected.includes(event.Test) ? [event.Test] : [];
    } catch {
      return [];
    }
  }));
  const missing = expected.filter((name) => !passed.has(name));
  if (missing.length > 0) {
    throw new Error(`Runtime immutable-package behavior proof did not execute passing tests: ${missing.join(', ')}`);
  }
}

function runSdkBehavior() {
  const harness = path.join(repoRoot, 'scripts/fixtures/immutable-package-unavailable/sdk-positive.ts');
  const tsxCli = path.join(repoRoot, 'sdks/typescript/node_modules/tsx/dist/cli.mjs');
  run(process.execPath, [tsxCli, harness], path.join(repoRoot, 'sdks/typescript'), 'SDK immutable-package behavior proof');
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--fixture-report-json', '--static-only'].includes(arg))) {
    process.stderr.write('usage: check-immutable-package-unavailable.mjs [--fixture-report-json|--static-only]\n');
    process.exitCode = 1;
    return;
  }
  const baseline = loadImmutablePackageCandidate(repoRoot);
  const issues = validateImmutablePackageCandidate(baseline);
  if (issues.length > 0) {
    printIssues(issues);
    process.exitCode = 1;
    return;
  }
  const fixtures = runImmutablePackageNegativeFixtures(baseline);
  if (args.includes('--fixture-report-json')) {
    process.stdout.write(`${JSON.stringify({ fixtures }, null, 2)}\n`);
    return;
  }
  if (!args.includes('--static-only')) {
    runRuntimeBehavior();
    runSdkBehavior();
  }
  process.stdout.write(`immutable package unavailable: OK (9 deny-all methods, 3 transports, ${fixtures.length} negative fixtures)\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`immutable package unavailable gate failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
}
