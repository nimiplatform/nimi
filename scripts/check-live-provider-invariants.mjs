#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import {
  loadProviderCatalog,
  parseCloudProviderEnvBindings,
  parseRuntimeLiveTestDefinitions,
  parseSdkLiveTestDefinitions,
  parseLiveEnvTemplateProviders,
  readYamlFile,
  resolveRepoRoot,
  toSortedArray,
} from './live-provider-utils.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);
const providerCatalogPath = path.join(repoRoot, 'spec/runtime/kernel/tables/provider-catalog.yaml');
const providerBindingsPath = path.join(repoRoot, 'runtime/internal/services/ai/provider.go');
const runtimeLiveSmokePath = path.join(repoRoot, 'runtime/internal/services/ai/live_provider_smoke_test.go');
const sdkLiveSmokePath = path.join(repoRoot, 'sdk/test/runtime/contract/providers/nimi-sdk-ai-provider-live-smoke.test.ts');
const liveEnvTemplatePath = path.join(repoRoot, 'dev/live-test.env.example');
const defaultBaselinePath = path.join(repoRoot, 'dev/config/live-gate-baseline.yaml');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    baselinePath: defaultBaselinePath,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--baseline') {
      const value = String(args[i + 1] || '').trim();
      if (!value || value.startsWith('--')) {
        throw new Error('missing value after --baseline');
      }
      options.baselinePath = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
      i += 1;
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
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
}

function collectGenerateProviders(definitions) {
  const providers = new Set();
  for (const [provider, ifaceMap] of definitions.entries()) {
    if (ifaceMap?.has('generate')) {
      providers.add(provider);
    }
  }
  return providers;
}

function pushMissing(failures, label, missingProviders) {
  if (missingProviders.length === 0) {
    return;
  }
  failures.push(`${label}: ${missingProviders.join(', ')}`);
}

function main() {
  const options = parseArgs();
  const baseline = readYamlFile(options.baselinePath);
  const exemptions = baseline?.exemptions && typeof baseline.exemptions === 'object'
    ? baseline.exemptions
    : {};

  const runtimeBindingsWithoutCatalog = toStringSet(exemptions.runtime_bindings_without_catalog);
  const catalogWithoutRuntimeBinding = toStringSet(exemptions.catalog_without_runtime_binding);
  const runtimeLiveGenerateExemptions = toStringSet(exemptions.runtime_live_generate_exemptions);
  const sdkLiveSmokeExemptions = toStringSet(exemptions.sdk_live_smoke_exemptions);

  const catalogProviders = loadProviderCatalog(providerCatalogPath);
  const cloudProviderBindings = parseCloudProviderEnvBindings(providerBindingsPath);
  const runtimeLiveDefinitions = parseRuntimeLiveTestDefinitions(runtimeLiveSmokePath);
  const sdkLiveDefinitions = parseSdkLiveTestDefinitions(sdkLiveSmokePath);
  const liveEnvProviders = parseLiveEnvTemplateProviders(liveEnvTemplatePath);

  const bindingProviders = new Set(cloudProviderBindings.keys());
  const runtimeGenerateProviders = collectGenerateProviders(runtimeLiveDefinitions);
  const sdkGenerateProviders = collectGenerateProviders(sdkLiveDefinitions);
  const envProviders = new Set(liveEnvProviders.keys());

  const failures = [];

  const bindingsMissingCatalog = toSortedArray(
    [...bindingProviders].filter(
      (provider) => !catalogProviders.has(provider) && !runtimeBindingsWithoutCatalog.has(provider),
    ),
  );
  pushMissing(
    failures,
    'provider.go cloudProviderEnvBindings has providers not covered by provider-catalog.yaml or exemptions',
    bindingsMissingCatalog,
  );

  const catalogMissingBindings = toSortedArray(
    [...catalogProviders].filter(
      (provider) => !bindingProviders.has(provider) && !catalogWithoutRuntimeBinding.has(provider),
    ),
  );
  pushMissing(
    failures,
    'provider-catalog.yaml has providers missing cloudProviderEnvBindings or exemptions',
    catalogMissingBindings,
  );

  const missingRuntimeGenerate = toSortedArray(
    [...bindingProviders].filter(
      (provider) => !runtimeGenerateProviders.has(provider) && !runtimeLiveGenerateExemptions.has(provider),
    ),
  );
  pushMissing(
    failures,
    'runtime live smoke generate coverage missing for cloudProviderEnvBindings providers',
    missingRuntimeGenerate,
  );

  const tokenApiRoutableProviders = new Set(
    [...bindingProviders].filter((provider) => !runtimeLiveGenerateExemptions.has(provider)),
  );
  const missingSdkGenerate = toSortedArray(
    [...tokenApiRoutableProviders].filter(
      (provider) => !sdkGenerateProviders.has(provider) && !sdkLiveSmokeExemptions.has(provider),
    ),
  );
  pushMissing(
    failures,
    'sdk live smoke generate coverage missing for token-api routable providers',
    missingSdkGenerate,
  );

  const envCoverageExemptions = new Set([
    ...runtimeBindingsWithoutCatalog,
    ...runtimeLiveGenerateExemptions,
  ]);
  const missingLiveEnvTemplate = toSortedArray(
    [...bindingProviders].filter(
      (provider) => !envProviders.has(provider) && !envCoverageExemptions.has(provider),
    ),
  );
  pushMissing(
    failures,
    'dev/live-test.env.example missing provider env blocks for cloudProviderEnvBindings providers',
    missingLiveEnvTemplate,
  );

  const knownRuntimeProviderUniverse = new Set([
    ...bindingProviders,
    ...catalogProviders,
    'local',
  ]);
  const unexpectedRuntimeLiveProviders = toSortedArray(
    [...runtimeLiveDefinitions.keys()].filter((provider) => !knownRuntimeProviderUniverse.has(provider)),
  );
  pushMissing(
    failures,
    'runtime live smoke contains unknown provider ids (not in bindings/catalog/local)',
    unexpectedRuntimeLiveProviders,
  );

  if (failures.length > 0) {
    process.stderr.write('[check-live-provider-invariants] provider invariants failed:\n');
    for (const failure of failures) {
      process.stderr.write(`- ${failure}\n`);
    }
    process.stderr.write('\n[check-live-provider-invariants] snapshots:\n');
    process.stderr.write(`- catalog providers: ${toSortedArray(catalogProviders).join(', ')}\n`);
    process.stderr.write(`- cloud bindings: ${toSortedArray(bindingProviders).join(', ')}\n`);
    process.stderr.write(`- runtime generate providers: ${toSortedArray(runtimeGenerateProviders).join(', ')}\n`);
    process.stderr.write(`- sdk generate providers: ${toSortedArray(sdkGenerateProviders).join(', ')}\n`);
    process.stderr.write(`- env template providers: ${toSortedArray(envProviders).join(', ')}\n`);
    process.exit(1);
  }

  process.stdout.write('[check-live-provider-invariants] provider invariants passed\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || '');
  process.stderr.write(`[check-live-provider-invariants] fatal: ${message}\n`);
  process.exit(1);
}
