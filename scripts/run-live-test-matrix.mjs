#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import {
  RUNTIME_INTERFACE_ORDER,
  collectProvidersFromDefinitions,
  loadProviderCatalog,
  mapDefinitionsToObject,
  parseRuntimeLiveTestDefinitions,
  resolveRepoRoot,
  toSortedArray,
} from './live-provider-utils.mjs';
import { mergeMissingEnv, prepareLiveAudioFixtures } from './lib/live-audio-fixtures.mjs';
import { buildMergedEnv } from './lib/live-env.mjs';
import { synthesizeLiveProviderEnvDefaults } from './lib/live-provider-defaults.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);
const runtimeDir = path.join(repoRoot, 'runtime');
const runtimeLiveSmokeFile = path.join(
  repoRoot,
  'runtime/internal/services/ai/live_provider_smoke_matrix_test.go',
);
const providerCatalogFile = path.join(
  repoRoot,
  '.nimi/spec/runtime/kernel/tables/provider-catalog.yaml',
);
const reportDir = path.join(repoRoot, '.local', 'report');
const reportPath = path.join(reportDir, 'live-test-coverage.yaml');

function printUsage() {
  process.stdout.write(`Usage: node scripts/run-live-test-matrix.mjs [--help] [--skip-runtime]

Runs the Runtime-owned provider-by-capability live matrix and writes
.local/report/live-test-coverage.yaml.

The SDK protected-carrier journey is separate candidate-bound evidence. This
runner does not synthesize SDK coverage from direct-daemon calls or test names.
--skip-runtime is diagnostic only and exits nonzero.
`);
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const options = { skipRuntime: false };
  for (const token of args) {
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (token === '--skip-runtime') {
      options.skipRuntime = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return options;
}

function buildLiveEnv() {
  const baseLiveEnv = buildMergedEnv({
    baseEnv: process.env,
    filePaths: [
      path.join(repoRoot, 'config', 'live', 'dashscope-gold-path.env'),
      path.join(repoRoot, '.env'),
    ],
  });
  const preparedAudio = prepareLiveAudioFixtures({
    cwd: repoRoot,
    env: baseLiveEnv,
    strict: false,
  });
  if (preparedAudio.error) {
    process.stdout.write(`[live-test-matrix] live audio fixture prepare skipped: ${preparedAudio.error}\n`);
  }
  const derivedProviderEnv = synthesizeLiveProviderEnvDefaults({
    repoRoot,
    env: baseLiveEnv,
  });
  if (derivedProviderEnv.providers.length > 0) {
    process.stdout.write(
      `[live-test-matrix] derived live provider defaults: ${derivedProviderEnv.providers.join(', ')}\n`,
    );
  }
  return mergeMissingEnv(
    mergeMissingEnv(baseLiveEnv, { env: derivedProviderEnv.env }),
    preparedAudio.payload,
  );
}

function runRuntimeTests(liveEnv) {
  process.stdout.write('[live-test-matrix] running Runtime provider-capability live tests...\n');
  const result = spawnSync(
    'go',
    ['test', './internal/services/ai/', '-v', '-run', 'TestLiveSmokeProviderCapabilityMatrix|TestLiveSmokeLocalSidecarMusicPromptOnly', '-timeout', '15m', '-count=1'],
    {
      cwd: runtimeDir,
      env: liveEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 15 * 60 * 1000,
    },
  );

  return {
    output: [
      typeof result.stdout === 'string' ? result.stdout : '',
      typeof result.stderr === 'string' ? result.stderr : '',
    ].join('\n'),
    status: result.status ?? 1,
  };
}

function parseGoTestOutput(output) {
  const results = new Map();
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/---\s+(PASS|FAIL|SKIP):\s+(\S+)/);
    if (match) {
      results.set(match[2], match[1].toLowerCase());
    }
  }
  return results;
}

function lookupGoTestStatus(goResults, testName) {
  const direct = goResults.get(testName);
  if (direct) {
    return direct;
  }
  const slashIndex = testName.indexOf('/');
  if (slashIndex > 0) {
    return goResults.get(testName.slice(0, slashIndex)) || null;
  }
  return null;
}

function resolveGoCellStatus(goResults, testNames) {
  if (!testNames || testNames.size === 0) {
    return { status: 'no_test', reason: 'no test exists for this cell' };
  }

  let hasPass = false;
  let hasSkip = false;
  let hasObserved = false;
  for (const testName of testNames) {
    const status = lookupGoTestStatus(goResults, testName);
    if (!status) {
      continue;
    }
    hasObserved = true;
    if (status === 'fail') {
      return { status: 'failed' };
    }
    if (status === 'pass') {
      hasPass = true;
    } else if (status === 'skip') {
      hasSkip = true;
    }
  }

  if (hasPass) {
    return { status: 'passed' };
  }
  if (hasSkip) {
    return { status: 'skipped', reason: 'live environment requirement not satisfied' };
  }
  if (hasObserved) {
    return { status: 'no_test', reason: 'test did not emit a terminal status' };
  }
  return { status: 'no_test', reason: 'declared test did not execute' };
}

function orderedInterfacesForProvider(definitions) {
  const ifaceSet = new Set(definitions.keys());
  const prioritized = RUNTIME_INTERFACE_ORDER.filter((iface) => ifaceSet.has(iface));
  const extras = [...ifaceSet]
    .filter((iface) => !RUNTIME_INTERFACE_ORDER.includes(iface))
    .sort((left, right) => left.localeCompare(right));
  return [...prioritized, ...extras];
}

function countSummary(runtimeMatrix) {
  const summary = {
    total_cells: 0,
    passed: 0,
    skipped: 0,
    failed: 0,
    no_test: 0,
  };
  for (const providerData of Object.values(runtimeMatrix)) {
    for (const cell of Object.values(providerData)) {
      summary.total_cells += 1;
      if (cell.status === 'passed') {
        summary.passed += 1;
      } else if (cell.status === 'failed') {
        summary.failed += 1;
      } else if (cell.status === 'skipped') {
        summary.skipped += 1;
      } else {
        summary.no_test += 1;
      }
    }
  }
  return summary;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const catalogProviders = loadProviderCatalog(providerCatalogFile);
  const runtimeDefinitions = parseRuntimeLiveTestDefinitions(runtimeLiveSmokeFile);
  const providers = toSortedArray(collectProvidersFromDefinitions(runtimeDefinitions));
  let runtimeResults = new Map();
  let runtimeExitStatus = 0;

  if (!options.skipRuntime) {
    const runtimeRun = runRuntimeTests(buildLiveEnv());
    runtimeExitStatus = runtimeRun.status;
    runtimeResults = parseGoTestOutput(runtimeRun.output);
    if (runtimeExitStatus !== 0 && String(runtimeRun.output || '').trim()) {
      process.stdout.write('[live-test-matrix] Runtime output start\n');
      process.stdout.write(`${runtimeRun.output}\n`);
      process.stdout.write('[live-test-matrix] Runtime output end\n');
    }
  }

  const runtimeMatrix = {};
  for (const provider of providers) {
    const definitions = runtimeDefinitions.get(provider);
    if (!definitions || definitions.size === 0) {
      continue;
    }
    const cells = {};
    for (const iface of orderedInterfacesForProvider(definitions)) {
      cells[iface] = resolveGoCellStatus(runtimeResults, definitions.get(iface));
    }
    if (Object.keys(cells).length > 0) {
      runtimeMatrix[provider] = cells;
    }
  }

  const summary = countSummary(runtimeMatrix);
  const report = {
    generated_at: new Date().toISOString(),
    summary,
    metadata: {
      providers: {
        catalog: toSortedArray(catalogProviders),
        runtime_live_tests: providers,
        matrix_universe: providers,
      },
      interfaces: { runtime: RUNTIME_INTERFACE_ORDER },
      runtime_test_definitions: mapDefinitionsToObject(runtimeDefinitions),
      command_status: {
        runtime: options.skipRuntime ? 'skipped' : runtimeExitStatus === 0 ? 'ok' : 'failed',
      },
      required_lane_status: {
        runtime: options.skipRuntime
          ? 'blocked_skipped_required_lane'
          : runtimeExitStatus === 0 ? 'ok' : 'failed',
      },
      skipped_required_lanes: options.skipRuntime ? ['runtime'] : [],
    },
    runtime: runtimeMatrix,
  };

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, YAML.stringify(report), 'utf8');

  process.stdout.write(`[live-test-matrix] report written to ${reportPath}\n`);
  process.stdout.write(`[live-test-matrix] summary: ${summary.passed} passed, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.no_test} no_test (${summary.total_cells} total cells)\n`);
  if (options.skipRuntime) {
    process.stdout.write('[live-test-matrix] ERROR: required Runtime lane was skipped\n');
  }
  if (summary.no_test > 0) {
    process.stdout.write(`[live-test-matrix] ERROR: Runtime matrix contains ${summary.no_test} declared cells with no test result\n`);
  }

  if (
    options.skipRuntime
    || summary.failed > 0
    || summary.no_test > 0
    || runtimeExitStatus !== 0
  ) {
    process.stdout.write('[live-test-matrix] WARNING: Runtime live matrix contains failures or a blocked lane\n');
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || '');
  process.stderr.write(`[live-test-matrix] fatal: ${message}\n`);
  process.exit(1);
}
