#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import {
  RUNTIME_INTERFACE_ORDER,
  SDK_INTERFACE_ORDER,
  collectProviderUniverse,
  collectProvidersFromDefinitions,
  loadProviderCatalog,
  parseRuntimeLiveTestDefinitions,
  parseSdkLiveTestDefinitions,
  resolveRepoRoot,
  toSortedArray,
  mapDefinitionsToObject,
} from './live-provider-utils.mjs';
import { mergeMissingEnv, prepareLiveAudioFixtures } from './lib/live-audio-fixtures.mjs';
import { buildMergedEnv } from './lib/live-env.mjs';
import { synthesizeLiveProviderEnvDefaults } from './lib/live-provider-defaults.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);
const runtimeDir = path.join(repoRoot, 'runtime');
const sdkRoot = path.join(repoRoot, 'sdk');
const runtimeLiveSmokeFile = path.join(
  repoRoot,
  'runtime/internal/services/ai/live_provider_smoke_matrix_test.go',
);
const sdkTestFile = path.join(
  repoRoot,
  'sdk/test/runtime/contract/providers/nimi-sdk-ai-provider-live-smoke.test.ts',
);
const providerCatalogFile = path.join(
  repoRoot,
  'spec/runtime/kernel/tables/provider-catalog.yaml',
);
const reportDir = path.join(repoRoot, 'dev', 'report');
const reportPath = path.join(reportDir, 'live-test-coverage.yaml');
const goldReportPath = path.join(reportDir, 'ai-gold-path-report.yaml');
const baseLiveEnv = buildMergedEnv({
  baseEnv: process.env,
  filePaths: [
    path.join(repoRoot, 'dev', 'config', 'dashscope-gold-path.env'),
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
const liveEnv = mergeMissingEnv(
  mergeMissingEnv(baseLiveEnv, { env: derivedProviderEnv.env }),
  preparedAudio.payload,
);

function runRuntimeTests() {
  process.stdout.write('[live-test-matrix] running runtime live smoke tests...\n');
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

function runSdkTests() {
  process.stdout.write('[live-test-matrix] running SDK live smoke tests...\n');
  const result = spawnSync(
    'pnpm',
    ['--filter', '@nimiplatform/sdk', 'exec', 'tsx', '--test', sdkTestFile],
    {
      cwd: sdkRoot,
      env: { ...liveEnv, NIMI_SDK_LIVE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 20 * 60 * 1000,
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

function runGoldPathTests() {
  process.stdout.write('[live-test-matrix] running gold-path replay tests...\n');
  const result = spawnSync(
    'node',
    ['scripts/run-dashscope-gold-path.mjs'],
    {
      cwd: repoRoot,
      env: liveEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 30 * 60 * 1000,
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

function readGoldPathReport() {
  if (!existsSync(goldReportPath)) {
    return null;
  }
  return YAML.parse(readFileSync(goldReportPath, 'utf8')) || null;
}

function parseGoTestOutput(output) {
  const results = new Map();
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/---\s+(PASS|FAIL|SKIP):\s+(\S+)/);
    if (!match) {
      continue;
    }
    const [, status, testName] = match;
    results.set(testName, status.toLowerCase());
  }
  return results;
}

function parseNodeTestOutput(output) {
  const results = new Map();
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const tapMatch = line.match(/^(ok|not ok)\s+\d+\s+-\s+(.+?)(?:\s+#\s+(.+))?$/);
    if (tapMatch) {
      const [, okStatus, description, directive] = tapMatch;
      const testName = description.trim();
      if (directive && directive.toUpperCase().startsWith('SKIP')) {
        results.set(testName, 'skip');
      } else if (okStatus === 'ok') {
        results.set(testName, 'pass');
      } else {
        results.set(testName, 'fail');
      }
      continue;
    }

    const nodePass = line.match(/^\s*[✓✔]\s+(.+?)(?:\s+\(\d+[\d.]*m?s\))?$/);
    if (nodePass) {
      results.set(nodePass[1].trim(), 'pass');
      continue;
    }

    const nodeFail = line.match(/^\s*[✗✘✖✕]\s+(.+?)(?:\s+\(\d+[\d.]*m?s\))?$/);
    if (nodeFail) {
      results.set(nodeFail[1].trim(), 'fail');
      continue;
    }

    const nodeSkip = line.match(/^\s*[-–]\s+(.+?)\s+\(skipped\)/);
    if (nodeSkip) {
      results.set(nodeSkip[1].trim(), 'skip');
      continue;
    }

    // Node 24 + tsx may emit skipped cases as:
    // "﹣ test name (0.123ms) # skip reason"
    const nodeDashSkip = line.match(/^\s*[﹣\-–]\s+(.+?)(?:\s+\(\d+[\d.]*m?s\))\s+#\s+.+$/);
    if (nodeDashSkip) {
      results.set(nodeDashSkip[1].trim(), 'skip');
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
    const parent = testName.slice(0, slashIndex);
    return goResults.get(parent) || null;
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
      continue;
    }
    if (status === 'skip') {
      hasSkip = true;
    }
  }

  if (hasPass) {
    return { status: 'passed' };
  }
  if (hasSkip) {
    return { status: 'skipped', reason: 'env var not set' };
  }
  if (hasObserved) {
    return { status: 'no_test', reason: 'test did not emit pass/fail/skip status' };
  }
  return { status: 'no_test', reason: 'test declared but not executed' };
}

function resolveNodeCellStatus(nodeResults, testNames) {
  if (!testNames || testNames.size === 0) {
    return { status: 'no_test', reason: 'no test exists for this cell' };
  }

  let hasPass = false;
  let hasSkip = false;
  let hasObserved = false;

  for (const testName of testNames) {
    const status = nodeResults.get(testName);
    if (!status) {
      continue;
    }
    hasObserved = true;
    if (status === 'fail') {
      return { status: 'failed' };
    }
    if (status === 'pass') {
      hasPass = true;
      continue;
    }
    if (status === 'skip') {
      hasSkip = true;
    }
  }

  if (hasPass) {
    return { status: 'passed' };
  }
  if (hasSkip) {
    return { status: 'skipped', reason: 'env var not set' };
  }
  if (hasObserved) {
    return { status: 'no_test', reason: 'test did not emit pass/fail/skip status' };
  }
  return { status: 'no_test', reason: 'test declared but not executed' };
}

function countSummary(runtimeMatrix, sdkMatrix) {
  const summary = {
    total_cells: 0,
    passed: 0,
    skipped: 0,
    failed: 0,
    no_test: 0,
  };

  const matrices = [runtimeMatrix, sdkMatrix];
  for (const matrix of matrices) {
    for (const providerData of Object.values(matrix)) {
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
  }

  return summary;
}

function orderedInterfacesForProvider(definitions, order) {
  const ifaceSet = new Set(definitions.keys());
  const prioritized = order.filter((iface) => ifaceSet.has(iface));
  const extras = [...ifaceSet].filter((iface) => !order.includes(iface)).sort((a, b) => a.localeCompare(b));
  return [...prioritized, ...extras];
}

function main() {
  const skipRuntime = process.argv.includes('--skip-runtime');
  const skipSdk = process.argv.includes('--skip-sdk');
  const skipGoldPath = process.argv.includes('--skip-gold-path');

  const catalogProviders = loadProviderCatalog(providerCatalogFile);
  const runtimeDefinitions = parseRuntimeLiveTestDefinitions(runtimeLiveSmokeFile);
  const sdkDefinitions = parseSdkLiveTestDefinitions(sdkTestFile);

  const providerUniverse = collectProviderUniverse({
    catalogProviders,
    runtimeDefinitions,
    sdkDefinitions,
    includeLocal: true,
  });

  let runtimeGoResults = new Map();
  let sdkNodeResults = new Map();

  let runtimeExitStatus = 0;
  let sdkExitStatus = 0;
  let goldExitStatus = 0;
  let goldReport = null;

  if (!skipRuntime) {
    const runtimeRun = runRuntimeTests();
    runtimeExitStatus = runtimeRun.status;
    runtimeGoResults = parseGoTestOutput(runtimeRun.output);
    if (runtimeExitStatus !== 0 && String(runtimeRun.output || '').trim()) {
      process.stdout.write('[live-test-matrix] runtime output start\n');
      process.stdout.write(`${runtimeRun.output}\n`);
      process.stdout.write('[live-test-matrix] runtime output end\n');
    }
  }

  if (!skipSdk) {
    const sdkRun = runSdkTests();
    sdkExitStatus = sdkRun.status;
    sdkNodeResults = parseNodeTestOutput(sdkRun.output);
    if (sdkExitStatus !== 0 && String(sdkRun.output || '').trim()) {
      process.stdout.write('[live-test-matrix] sdk output start\n');
      process.stdout.write(`${sdkRun.output}\n`);
      process.stdout.write('[live-test-matrix] sdk output end\n');
    }
  }

  if (!skipGoldPath) {
    const goldRun = runGoldPathTests();
    goldExitStatus = goldRun.status;
    goldReport = readGoldPathReport();
    if (goldExitStatus !== 0 && String(goldRun.output || '').trim()) {
      process.stdout.write('[live-test-matrix] gold-path output start\n');
      process.stdout.write(`${goldRun.output}\n`);
      process.stdout.write('[live-test-matrix] gold-path output end\n');
    }
  }

  const providers = toSortedArray(providerUniverse);
  const runtimeMatrix = {};
  const sdkMatrix = {};

  for (const provider of providers) {
    const runtimeProviderDefinitions = runtimeDefinitions.get(provider) || new Map();
    runtimeMatrix[provider] = {};
    for (const iface of orderedInterfacesForProvider(runtimeProviderDefinitions, RUNTIME_INTERFACE_ORDER)) {
      runtimeMatrix[provider][iface] = resolveGoCellStatus(
        runtimeGoResults,
        runtimeProviderDefinitions.get(iface),
      );
    }

    const sdkProviderDefinitions = sdkDefinitions.get(provider) || new Map();
    sdkMatrix[provider] = {};
    for (const iface of orderedInterfacesForProvider(sdkProviderDefinitions, SDK_INTERFACE_ORDER)) {
      sdkMatrix[provider][iface] = resolveNodeCellStatus(
        sdkNodeResults,
        sdkProviderDefinitions.get(iface),
      );
    }
  }

  const summary = countSummary(runtimeMatrix, sdkMatrix);
  const report = {
    generated_at: new Date().toISOString(),
    summary,
    metadata: {
      providers: {
        catalog: toSortedArray(catalogProviders),
        runtime_live_tests: toSortedArray(collectProvidersFromDefinitions(runtimeDefinitions)),
        sdk_live_tests: toSortedArray(collectProvidersFromDefinitions(sdkDefinitions)),
        matrix_universe: providers,
      },
      interfaces: {
        runtime: RUNTIME_INTERFACE_ORDER,
        sdk: SDK_INTERFACE_ORDER,
      },
      runtime_test_definitions: mapDefinitionsToObject(runtimeDefinitions),
      sdk_test_definitions: mapDefinitionsToObject(sdkDefinitions),
      command_status: {
        runtime: skipRuntime ? 'skipped' : runtimeExitStatus === 0 ? 'ok' : 'failed',
        sdk: skipSdk ? 'skipped' : sdkExitStatus === 0 ? 'ok' : 'failed',
        gold_path: skipGoldPath ? 'skipped' : goldExitStatus === 0 ? 'ok' : 'failed',
      },
    },
    runtime: runtimeMatrix,
    sdk: sdkMatrix,
    gold_path: goldReport
      ? {
        ...goldReport,
        report_path: goldReportPath,
      }
      : {
        generated_at: null,
        summary: null,
        fixtures: [],
        report_path: goldReportPath,
      },
  };

  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }
  writeFileSync(reportPath, YAML.stringify(report), 'utf8');

  process.stdout.write(`[live-test-matrix] report written to ${reportPath}\n`);
  process.stdout.write(`[live-test-matrix] summary: ${summary.passed} passed, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.no_test} no_test (${summary.total_cells} total cells)\n`);
  if (goldReport?.summary) {
    process.stdout.write(`[live-test-matrix] gold-path summary: ${goldReport.summary.passed} passed, ${goldReport.summary.skipped} skipped, ${goldReport.summary.failed} failed, ${goldReport.summary.reserved} reserved (${goldReport.summary.total_fixtures} total fixtures)\n`);
  }

  if (
    summary.failed > 0
    || runtimeExitStatus !== 0
    || sdkExitStatus !== 0
    || goldExitStatus !== 0
    || Number(goldReport?.summary?.failed || 0) > 0
  ) {
    process.stdout.write('[live-test-matrix] WARNING: runtime/sdk live smoke run contains failures\n');
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
