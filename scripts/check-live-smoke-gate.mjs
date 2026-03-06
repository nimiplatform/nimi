#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  canonicalProviderId,
  readYamlFile,
  resolveRepoRoot,
  toSortedArray,
} from './live-provider-utils.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);
const defaultReportPath = path.join(repoRoot, 'dev/report/live-test-coverage.yaml');
const defaultBaselinePath = path.join(repoRoot, 'dev/config/live-gate-baseline.yaml');

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

function detectChangedProvidersFromGit(providerUniverse) {
  const baseRef = String(process.env.NIMI_BASE_SHA || '').trim();
  const range = baseRef ? `${baseRef}...HEAD` : 'HEAD~1...HEAD';
  const focusFiles = [
    'runtime/internal/services/ai/provider.go',
    'runtime/internal/services/ai/live_provider_smoke_test.go',
    'sdk/test/runtime/contract/providers/nimi-sdk-ai-provider-live-smoke.test.ts',
    'dev/live-test.env.example',
    'spec/runtime/kernel/tables/provider-catalog.yaml',
    'dev/config/live-gate-baseline.yaml',
  ];

  const result = spawnSync(
    'git',
    ['diff', '-U0', range, '--', ...focusFiles],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (result.status !== 0) {
    return new Set();
  }

  const diffText = [
    typeof result.stdout === 'string' ? result.stdout : '',
    typeof result.stderr === 'string' ? result.stderr : '',
  ].join('\n');

  if (!diffText.trim()) {
    return new Set();
  }

  const changed = new Set();
  for (const provider of providerUniverse) {
    const escaped = provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
    if (pattern.test(diffText)) {
      changed.add(provider);
    }
  }
  return changed;
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

function main() {
  const options = parseArgs();
  const report = readYamlFile(options.reportPath);
  const baseline = readYamlFile(options.baselinePath);

  const runtimeMatrix = report?.runtime && typeof report.runtime === 'object' ? report.runtime : {};
  const sdkMatrix = report?.sdk && typeof report.sdk === 'object' ? report.sdk : {};

  const runtimeProvidersInReport = new Set(Object.keys(runtimeMatrix));
  const sdkProvidersInReport = new Set(Object.keys(sdkMatrix));
  const providerUniverse = new Set([...runtimeProvidersInReport, ...sdkProvidersInReport]);

  const changedProviders = parseChangedProvidersInput(options.changedProvidersInput);
  if (changedProviders.size === 0) {
    for (const provider of parseChangedProvidersInput(process.env.NIMI_CHANGED_PROVIDERS)) {
      changedProviders.add(provider);
    }
  }
  if (changedProviders.size === 0) {
    for (const provider of detectChangedProvidersFromGit(providerUniverse)) {
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

  const runtimeRequiredProviders = new Set([
    ...runtimeBaselineProviders,
    ...runtimeConditional,
    ...changedProviders,
  ]);
  const sdkRequiredProviders = new Set([
    ...sdkBaselineProviders,
    ...sdkConditional,
    ...changedProviders,
  ]);

  if (runtimeRequiredProviders.size === 0) {
    for (const provider of runtimeProvidersInReport) {
      runtimeRequiredProviders.add(provider);
    }
  }
  if (sdkRequiredProviders.size === 0) {
    for (const provider of sdkProvidersInReport) {
      sdkRequiredProviders.add(provider);
    }
  }

  for (const provider of runtimeExemptions) {
    runtimeRequiredProviders.delete(provider);
  }
  for (const provider of sdkExemptions) {
    sdkRequiredProviders.delete(provider);
  }

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

  const failures = [...runtimeEvaluation.failures, ...sdkEvaluation.failures];
  const softSkips = [...runtimeEvaluation.softSkips, ...sdkEvaluation.softSkips];

  process.stdout.write('[check-live-smoke-gate] evaluation context\n');
  process.stdout.write(`- mode: ${options.requireRelease ? 'release-hard-block' : 'pr-skip-safe'}\n`);
  process.stdout.write(`- changed providers: ${toSortedArray(changedProviders).join(', ') || '(none)'}\n`);
  process.stdout.write(`- runtime required providers: ${toSortedArray(runtimeRequiredProviders).join(', ') || '(none)'}\n`);
  process.stdout.write(`- sdk required providers: ${toSortedArray(sdkRequiredProviders).join(', ') || '(none)'}\n`);

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

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || '');
  process.stderr.write(`[check-live-smoke-gate] fatal: ${message}\n`);
  process.exit(1);
}
