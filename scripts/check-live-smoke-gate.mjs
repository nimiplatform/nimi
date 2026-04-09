#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  canonicalProviderId,
  readYamlFile,
  resolveRepoRoot,
  toSortedArray,
} from './live-provider-utils.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);
const defaultReportPath = path.join(repoRoot, 'nimi-coding/.local/report/live-test-coverage.yaml');
const defaultBaselinePath = path.join(repoRoot, 'nimi-coding/config/live-gate-baseline.yaml');
const providerTargetingSmokeFiles = new Set([
  'runtime/internal/services/ai/live_provider_smoke_test.go',
  'runtime/internal/services/ai/live_provider_smoke_matrix_test.go',
  'sdk/test/runtime/contract/providers/nimi-sdk-ai-provider-live-smoke.test.ts',
]);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    reportPath: defaultReportPath,
    baselinePath: defaultBaselinePath,
    requireRelease: false,
    changedProvidersInput: '',
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--report') {
      const value = String(args[index + 1] || '').trim();
      if (!value || value.startsWith('--')) {
        throw new Error('missing value after --report');
      }
      options.reportPath = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
      index += 1;
      continue;
    }
    if (token === '--baseline') {
      const value = String(args[index + 1] || '').trim();
      if (!value || value.startsWith('--')) {
        throw new Error('missing value after --baseline');
      }
      options.baselinePath = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
      index += 1;
      continue;
    }
    if (token === '--changed-providers') {
      const value = String(args[index + 1] || '').trim();
      if (!value || value.startsWith('--')) {
        throw new Error('missing value after --changed-providers');
      }
      options.changedProvidersInput = value;
      index += 1;
      continue;
    }
    if (token === '--require-release') {
      options.requireRelease = true;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }

  return options;
}

function toStringSet(input) {
  if (!Array.isArray(input)) {
    return new Set();
  }
  return new Set(
    input
      .map((value) => canonicalProviderId(value))
      .filter(Boolean),
  );
}

function toStringArray(input, fallback) {
  if (!Array.isArray(input) || input.length === 0) {
    return [...fallback];
  }
  return input
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function parseChangedProvidersInput(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((item) => canonicalProviderId(item))
      .filter(Boolean),
  );
}

function runGit(args) {
  const result = spawnSync(
    'git',
    args,
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  return {
    status: result.status ?? 1,
    output: [
      typeof result.stdout === 'string' ? result.stdout : '',
      typeof result.stderr === 'string' ? result.stderr : '',
    ].join('\n'),
  };
}

function listGitPaths(args) {
  const result = runGit(args);
  if (result.status !== 0) {
    return [];
  }
  return result.output
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);
}

function providerEnvToken(provider) {
  return String(provider || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function addAll(target, values) {
  for (const value of values) {
    target.add(value);
  }
}

function providersFromFilePath(providerUniverse, filePath) {
  const out = new Set();
  const basename = path.basename(String(filePath || '').trim());
  const patterns = [
    /^adapter_voice_(.+)\.go$/i,
    /^adapter_(.+)_media\.go$/i,
    /^adapter_(.+)\.go$/i,
    /^(.+)\.source\.yaml$/i,
  ];

  for (const pattern of patterns) {
    const match = basename.match(pattern);
    if (!match) {
      continue;
    }
    const provider = canonicalProviderId(match[1]);
    if (provider && providerUniverse.has(provider)) {
      out.add(provider);
    }
  }

  return out;
}

function normalizeGitPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function isProviderTargetingSmokeFile(filePath) {
  const normalized = normalizeGitPath(filePath);
  for (const target of providerTargetingSmokeFiles) {
    if (normalized.endsWith(target)) {
      return true;
    }
  }
  return false;
}

function extractChangedLines(diffText) {
  return String(diffText || '')
    .split(/\r?\n/)
    .filter((line) => (
      (line.startsWith('+') || line.startsWith('-'))
      && !line.startsWith('+++')
      && !line.startsWith('---')
    ))
    .map((line) => line.slice(1));
}

function collectChangedProvidersFromLines(providerUniverse, changedLines) {
  if (!Array.isArray(changedLines) || changedLines.length === 0) {
    return new Set();
  }

  const changedText = changedLines.join('\n');
  const out = new Set();

  for (const provider of providerUniverse) {
    const escapedProvider = provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedToken = providerEnvToken(provider).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`['"\`]${escapedProvider}['"\`]`, 'i'),
      new RegExp(`\\bprovider\\s*:\\s*${escapedProvider}\\b`, 'i'),
      new RegExp(`^\\s*-\\s*${escapedProvider}\\b`, 'im'),
      new RegExp(`NIMI_LIVE_${escapedToken}_`, 'i'),
      new RegExp(`NIMI_RUNTIME_[A-Z0-9_]*${escapedToken}_`, 'i'),
    ];
    if (patterns.some((pattern) => pattern.test(changedText))) {
      out.add(provider);
    }
  }

  return out;
}

function evaluateChangedProviderEntries(providerUniverse, entries) {
  const changedProviders = new Set();
  const unresolvedSmokeFiles = new Set();
  const items = Array.isArray(entries) ? entries : [];

  for (const entry of items) {
    const filePath = String(entry?.filePath || '').trim();
    if (!filePath) {
      continue;
    }
    const fromPath = providersFromFilePath(providerUniverse, filePath);
    const fromLines = collectChangedProvidersFromLines(
      providerUniverse,
      Array.isArray(entry?.changedLines) ? entry.changedLines : [],
    );
    addAll(changedProviders, fromPath);
    addAll(changedProviders, fromLines);
    if (isProviderTargetingSmokeFile(filePath) && fromPath.size === 0 && fromLines.size === 0) {
      unresolvedSmokeFiles.add(normalizeGitPath(filePath));
    }
  }

  return {
    changedProviders,
    unresolvedSmokeFiles: toSortedArray(unresolvedSmokeFiles),
  };
}

function collectUntrackedFocusEntries(focusPaths) {
  const result = runGit(['ls-files', '--others', '--exclude-standard', '--', ...focusPaths]);
  if (result.status !== 0) {
    return [];
  }

  const files = result.output
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);

  if (files.length === 0) {
    return [];
  }

  return files
    .map((filePath) => {
      try {
        return {
          filePath,
          changedLines: readFileSync(path.join(repoRoot, filePath), 'utf8').split(/\r?\n/),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function detectChangedProvidersFromGit(providerUniverse) {
  const baseRef = String(process.env.NIMI_BASE_SHA || '').trim();
  const range = baseRef ? `${baseRef}...HEAD` : 'HEAD~1...HEAD';
  const focusPaths = [
    'runtime/internal/nimillm',
    'runtime/internal/services/ai/provider.go',
    'runtime/internal/services/ai/live_provider_smoke_test.go',
    'runtime/internal/services/ai/live_provider_smoke_matrix_test.go',
    'sdk/test/runtime/contract/providers/nimi-sdk-ai-provider-live-smoke.test.ts',
    'nimi-coding/config/live-test.env.example',
    'spec/runtime/kernel/tables/provider-catalog.yaml',
    'nimi-coding/config/live-gate-baseline.yaml',
  ];

  function detectFromDiff(diffRefArgs) {
    const changedFiles = listGitPaths(['diff', '--name-only', ...diffRefArgs, '--', ...focusPaths]);
    const entries = [];

    for (const filePath of changedFiles) {
      const diffResult = runGit(['diff', '-U0', ...diffRefArgs, '--', filePath]);
      if (diffResult.status !== 0) {
        continue;
      }
      entries.push({
        filePath,
        changedLines: extractChangedLines(diffResult.output),
      });
    }

    for (const entry of collectUntrackedFocusEntries(focusPaths)) {
      entries.push(entry);
    }

    return evaluateChangedProviderEntries(providerUniverse, entries);
  }

  const worktreeChanged = detectFromDiff(['HEAD']);
  if (worktreeChanged.changedProviders.size > 0 || worktreeChanged.unresolvedSmokeFiles.length > 0) {
    return worktreeChanged;
  }

  return detectFromDiff([range]);
}

function resolveConditionalProviders(conditionalBaselines) {
  const out = new Set();
  const items = Array.isArray(conditionalBaselines) ? conditionalBaselines : [];
  for (const item of items) {
    const provider = canonicalProviderId(item?.provider);
    if (!provider) {
      continue;
    }
    const envKeys = Array.isArray(item?.when_env_all)
      ? item.when_env_all.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    if (envKeys.length === 0) {
      continue;
    }
    const allSet = envKeys.every((key) => String(process.env[key] || '').trim().length > 0);
    if (allSet) {
      out.add(provider);
    }
  }
  return out;
}

function collectConfiguredProviders(matrix) {
  const configuredProviders = new Set();
  const entries = matrix && typeof matrix === 'object' ? Object.entries(matrix) : [];
  for (const [provider, record] of entries) {
    if (!record || typeof record !== 'object') {
      continue;
    }
    const cells = Object.values(record);
    const hasObservedCell = cells.some((cell) => {
      const status = String(cell?.status || '').trim();
      return status && status !== 'skipped' && status !== 'no_test';
    });
    if (hasObservedCell) {
      configuredProviders.add(provider);
    }
  }
  return configuredProviders;
}

function resolveRequiredProviders({
  baselineProviders,
  conditionalProviders,
  changedProviders,
  reportProviders,
  configuredProviders,
  exemptions,
  requireRelease,
}) {
  const requiredProviders = new Set([
    ...baselineProviders,
    ...conditionalProviders,
    ...changedProviders,
  ]);

  if (requiredProviders.size === 0) {
    const fallbackProviders = requireRelease ? configuredProviders : reportProviders;
    for (const provider of fallbackProviders) {
      requiredProviders.add(provider);
    }
  }

  for (const provider of exemptions) {
    requiredProviders.delete(provider);
  }

  return requiredProviders;
}

function evaluateLayer(input) {
  const failures = [];
  const softSkips = [];

  for (const provider of input.requiredProviders) {
    const providerRecord = input.matrix?.[provider];
    if (!providerRecord || typeof providerRecord !== 'object') {
      failures.push(`${input.layer}:${provider}:missing_provider_record`);
      continue;
    }

    const requiredInterfaces = Array.isArray(input.requiredInterfacesPerProvider?.get(provider))
      ? input.requiredInterfacesPerProvider.get(provider)
      : input.requiredInterfaces;
    const effectiveInterfaces = Array.isArray(requiredInterfaces) && requiredInterfaces.length > 0
      ? requiredInterfaces
      : Object.keys(providerRecord);

    for (const iface of effectiveInterfaces) {
      const cell = providerRecord[iface];
      if (!cell || typeof cell !== 'object') {
        failures.push(`${input.layer}:${provider}:${iface}:missing_cell`);
        continue;
      }
      const status = String(cell.status || '').trim();
      if (!status || status === 'no_test') {
        failures.push(`${input.layer}:${provider}:${iface}:no_test`);
        continue;
      }
      if (status === 'failed') {
        failures.push(`${input.layer}:${provider}:${iface}:failed`);
        continue;
      }
      if (status === 'skipped') {
        if (input.requireRelease) {
          failures.push(`${input.layer}:${provider}:${iface}:skipped`);
        } else {
          softSkips.push(`${input.layer}:${provider}:${iface}:skipped`);
        }
      }
    }
  }

  return {
    failures,
    softSkips,
  };
}

function evaluateGoldPath(report, options) {
  const failures = [];
  const softSkips = [];
  const fixtures = Array.isArray(report?.fixtures) ? report.fixtures : [];
  const gatedDashscopeFixtures = fixtures.filter((fixture) => fixture?.gated && fixture?.provider === 'dashscope');

  if (gatedDashscopeFixtures.length === 0) {
    if (options.requireRelease) {
      failures.push('gold_path:dashscope:missing_fixture_records');
    }
    return { failures, softSkips, fixtureIds: [] };
  }

  for (const fixture of gatedDashscopeFixtures) {
    const fixtureId = String(fixture.fixture_id || '').trim() || 'unknown-fixture';
    for (const layer of ['L0', 'L1', 'L2', 'L3']) {
      const status = String(fixture?.layers?.[layer]?.status || '').trim();
      const cellId = `gold_path:${fixtureId}:${layer}`;
      if (status === 'passed') {
        continue;
      }
      if (status === 'skipped' && !options.requireRelease) {
        softSkips.push(`${cellId}:skipped`);
        continue;
      }
      failures.push(`${cellId}:${status || 'missing'}`);
    }
  }

  return {
    failures,
    softSkips,
    fixtureIds: gatedDashscopeFixtures.map((fixture) => String(fixture.fixture_id || '').trim()).filter(Boolean),
  };
}

function main() {
  const options = parseArgs();
  const report = readYamlFile(options.reportPath);
  const baseline = readYamlFile(options.baselinePath);

  const runtimeMatrix = report?.runtime && typeof report.runtime === 'object' ? report.runtime : {};
  const sdkMatrix = report?.sdk && typeof report.sdk === 'object' ? report.sdk : {};

  const runtimeProvidersInReport = new Set(Object.keys(runtimeMatrix));
  const sdkProvidersInReport = new Set(Object.keys(sdkMatrix));
  const configuredRuntimeProviders = collectConfiguredProviders(runtimeMatrix);
  const configuredSdkProviders = collectConfiguredProviders(sdkMatrix);
  const providerUniverse = new Set([...runtimeProvidersInReport, ...sdkProvidersInReport]);

  const changedProviders = parseChangedProvidersInput(options.changedProvidersInput);
  if (changedProviders.size === 0) {
    for (const provider of parseChangedProvidersInput(process.env.NIMI_CHANGED_PROVIDERS)) {
      changedProviders.add(provider);
    }
  }
  if (changedProviders.size === 0) {
    const detection = detectChangedProvidersFromGit(providerUniverse);
    if (detection.unresolvedSmokeFiles.length > 0) {
      throw new Error(
        `cannot infer changed providers from smoke test edits: ${detection.unresolvedSmokeFiles.join(', ')}; `
        + 'add explicit provider markers in the edited lines or pass --changed-providers',
      );
    }
    for (const provider of detection.changedProviders) {
      changedProviders.add(provider);
    }
  }

  const exemptions = baseline?.exemptions && typeof baseline.exemptions === 'object'
    ? baseline.exemptions
    : {};
  const runtimeExemptions = toStringSet(exemptions.runtime_live_generate_exemptions);
  const sdkExemptions = toStringSet(exemptions.sdk_live_smoke_exemptions);

  const runtimeBaselineProviders = toStringSet(baseline?.runtime?.baseline_providers);
  const sdkBaselineProviders = toStringSet(baseline?.sdk?.baseline_providers);

  const runtimeConditional = resolveConditionalProviders(baseline?.runtime?.conditional_baselines);
  const sdkConditional = resolveConditionalProviders(baseline?.sdk?.conditional_baselines);

  const runtimeRequiredInterfaces = toStringArray(
    baseline?.runtime?.required_interfaces,
    [],
  );
  const sdkRequiredInterfaces = toStringArray(
    baseline?.sdk?.required_interfaces,
    [],
  );

  const runtimeRequiredProviders = resolveRequiredProviders({
    baselineProviders: runtimeBaselineProviders,
    conditionalProviders: runtimeConditional,
    changedProviders,
    reportProviders: runtimeProvidersInReport,
    configuredProviders: configuredRuntimeProviders,
    exemptions: runtimeExemptions,
    requireRelease: options.requireRelease,
  });
  const sdkRequiredProviders = resolveRequiredProviders({
    baselineProviders: sdkBaselineProviders,
    conditionalProviders: sdkConditional,
    changedProviders,
    reportProviders: sdkProvidersInReport,
    configuredProviders: configuredSdkProviders,
    exemptions: sdkExemptions,
    requireRelease: options.requireRelease,
  });

  const runtimeEvaluation = evaluateLayer({
    layer: 'runtime',
    matrix: runtimeMatrix,
    requiredProviders: toSortedArray(runtimeRequiredProviders),
    requiredInterfaces: runtimeRequiredInterfaces,
    requiredInterfacesPerProvider: new Map(
      Object.entries(runtimeMatrix).map(([provider, cells]) => [provider, Object.keys(cells || {})]),
    ),
    requireRelease: options.requireRelease,
  });
  const sdkEvaluation = evaluateLayer({
    layer: 'sdk',
    matrix: sdkMatrix,
    requiredProviders: toSortedArray(sdkRequiredProviders),
    requiredInterfaces: sdkRequiredInterfaces,
    requiredInterfacesPerProvider: new Map(
      Object.entries(sdkMatrix).map(([provider, cells]) => [provider, Object.keys(cells || {})]),
    ),
    requireRelease: options.requireRelease,
  });

  const goldEvaluation = evaluateGoldPath(report?.gold_path, {
    requireRelease: options.requireRelease,
  });

  const failures = [...runtimeEvaluation.failures, ...sdkEvaluation.failures, ...goldEvaluation.failures];
  const softSkips = [...runtimeEvaluation.softSkips, ...sdkEvaluation.softSkips, ...goldEvaluation.softSkips];

  process.stdout.write('[check-live-smoke-gate] evaluation context\n');
  process.stdout.write(`- mode: ${options.requireRelease ? 'release-hard-block' : 'pr-skip-safe'}\n`);
  process.stdout.write(`- changed providers: ${toSortedArray(changedProviders).join(', ') || '(none)'}\n`);
  process.stdout.write(`- runtime required providers: ${toSortedArray(runtimeRequiredProviders).join(', ') || '(none)'}\n`);
  process.stdout.write(`- sdk required providers: ${toSortedArray(sdkRequiredProviders).join(', ') || '(none)'}\n`);
  process.stdout.write(`- gold-path fixtures: ${goldEvaluation.fixtureIds.join(', ') || '(none)'}\n`);

  if (softSkips.length > 0) {
    process.stdout.write(`- skip-safe cells: ${softSkips.join(', ')}\n`);
  }

  if (failures.length > 0) {
    process.stderr.write('[check-live-smoke-gate] gate failed\n');
    for (const failure of failures) {
      process.stderr.write(`- ${failure}\n`);
    }
    process.exit(1);
  }

  process.stdout.write('[check-live-smoke-gate] gate passed\n');
}

function isDirectExecution() {
  const entry = String(process.argv[1] || '').trim();
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

export {
  collectChangedProvidersFromLines,
  detectChangedProvidersFromGit,
  evaluateChangedProviderEntries,
  isProviderTargetingSmokeFile,
  main,
  parseArgs,
  resolveRequiredProviders,
  providersFromFilePath,
};

if (isDirectExecution()) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    process.stderr.write(`[check-live-smoke-gate] fatal: ${message}\n`);
    process.exit(1);
  }
}
