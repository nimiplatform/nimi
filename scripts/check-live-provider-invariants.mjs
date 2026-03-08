#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import {
  CAPABILITY_INTERFACE_ORDER,
  loadSourceProviderCapabilityMatrix,
  loadProviderCatalog,
  parseProviderRegistryProviders,
  parseRuntimeLiveTestDefinitions,
  parseSdkLiveTestDefinitions,
  parseLiveEnvTemplateProviders,
  readYamlFile,
  resolveRepoRoot,
  toSortedArray,
} from './live-provider-utils.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);
const providerCatalogPath = path.join(repoRoot, 'spec/runtime/kernel/tables/provider-catalog.yaml');
const sourceProviderDir = path.join(repoRoot, 'runtime/catalog/source/providers');
const providerRegistryPath = path.join(repoRoot, 'runtime/internal/providerregistry/generated.go');
const runtimeLiveSmokePath = path.join(repoRoot, 'runtime/internal/services/ai/live_provider_smoke_matrix_test.go');
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

function collectProviderCapabilityPairs(definitions) {
  const pairs = new Set();
  for (const [provider, ifaceMap] of definitions.entries()) {
    for (const iface of ifaceMap.keys()) {
      pairs.add(`${provider}:${iface}`);
    }
  }
  return pairs;
}

function toPairSet(input) {
  if (!Array.isArray(input)) {
    return new Set();
  }
  return new Set(
    input
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  );
}

function envVariableMatchesSuffix(variables, suffixes) {
  for (const variable of variables) {
    for (const suffix of suffixes) {
      if (variable.endsWith(`_${suffix}`)) {
        return true;
      }
    }
  }
  return false;
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
  const runtimeCapabilityExemptions = toPairSet(exemptions.runtime_live_capability_exemptions);
  const sdkCapabilityExemptions = toPairSet(exemptions.sdk_live_capability_exemptions);

  const catalogProviders = loadProviderCatalog(providerCatalogPath);
  const sourceProviderCapabilityMatrix = loadSourceProviderCapabilityMatrix(sourceProviderDir);
  const sourceProviders = new Set(sourceProviderCapabilityMatrix.keys());
  const cloudProviderBindings = parseProviderRegistryProviders(providerRegistryPath, 'RemoteProviders');
  const runtimeLiveDefinitions = parseRuntimeLiveTestDefinitions(runtimeLiveSmokePath);
  const sdkLiveDefinitions = parseSdkLiveTestDefinitions(sdkLiveSmokePath);
  const liveEnvProviders = parseLiveEnvTemplateProviders(liveEnvTemplatePath);

  const bindingProviders = new Set(cloudProviderBindings);
  const runtimeGenerateProviders = collectGenerateProviders(runtimeLiveDefinitions);
  const sdkGenerateProviders = collectGenerateProviders(sdkLiveDefinitions);
  const runtimeProviderCapabilityPairs = collectProviderCapabilityPairs(runtimeLiveDefinitions);
  const sdkProviderCapabilityPairs = collectProviderCapabilityPairs(sdkLiveDefinitions);
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

  const sourceMissingCatalog = toSortedArray(
    [...sourceProviders].filter((provider) => provider !== 'local' && !catalogProviders.has(provider)),
  );
  pushMissing(
    failures,
    'source provider matrix has providers missing provider-catalog.yaml',
    sourceMissingCatalog,
  );

  const sourceGenerateProviders = new Set(
    [...sourceProviderCapabilityMatrix.entries()]
      .filter(([, capabilities]) => capabilities.has('generate'))
      .map(([provider]) => provider),
  );
  const missingRuntimeGenerate = toSortedArray(
    [...sourceGenerateProviders].filter(
      (provider) => !runtimeGenerateProviders.has(provider) && !runtimeLiveGenerateExemptions.has(provider),
    ),
  );
  pushMissing(
    failures,
    'runtime live smoke generate coverage missing for cloudProviderEnvBindings providers',
    missingRuntimeGenerate,
  );

  const tokenApiRoutableProviders = new Set(
    [...sourceGenerateProviders].filter((provider) => provider !== 'local' && !runtimeLiveGenerateExemptions.has(provider)),
  );
  const missingSdkGenerate = toSortedArray(
    [...tokenApiRoutableProviders].filter(
      (provider) => !sdkGenerateProviders.has(provider) && !sdkLiveSmokeExemptions.has(provider),
    ),
  );
  pushMissing(
    failures,
    'sdk live smoke generate coverage missing for cloud routable providers',
    missingSdkGenerate,
  );

  const missingRuntimeCapabilityPairs = [];
  for (const [provider, capabilities] of sourceProviderCapabilityMatrix.entries()) {
    for (const capability of capabilities) {
      const pair = `${provider}:${capability}`;
      if (runtimeCapabilityExemptions.has(pair)) {
        continue;
      }
      if (!runtimeProviderCapabilityPairs.has(pair)) {
        missingRuntimeCapabilityPairs.push(pair);
      }
    }
  }
  if (missingRuntimeCapabilityPairs.length > 0) {
    failures.push(`runtime live smoke capability coverage missing pairs: ${missingRuntimeCapabilityPairs.sort((a, b) => a.localeCompare(b)).join(', ')}`);
  }

  const missingSdkCapabilityPairs = [];
  for (const [provider, capabilities] of sourceProviderCapabilityMatrix.entries()) {
    for (const capability of capabilities) {
      const pair = `${provider}:${capability}`;
      if (sdkCapabilityExemptions.has(pair)) {
        continue;
      }
      if (!sdkProviderCapabilityPairs.has(pair)) {
        missingSdkCapabilityPairs.push(pair);
      }
    }
  }
  if (missingSdkCapabilityPairs.length > 0) {
    failures.push(`sdk live smoke capability coverage missing pairs: ${missingSdkCapabilityPairs.sort((a, b) => a.localeCompare(b)).join(', ')}`);
  }

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

  const capabilityEnvSuffixes = {
    generate: ['MODEL_ID'],
    embed: ['EMBED_MODEL_ID', 'MODEL_ID'],
    image: ['IMAGE_MODEL_ID', 'MODEL_ID'],
    video: ['VIDEO_MODEL_ID', 'MODEL_ID'],
    tts: ['TTS_MODEL_ID', 'MODEL_ID'],
    stt: ['STT_MODEL_ID', 'MODEL_ID'],
    voice_clone: ['VOICE_CLONE_MODEL_ID', 'TTS_MODEL_ID'],
    voice_design: ['VOICE_DESIGN_MODEL_ID', 'TTS_MODEL_ID'],
  };
  const missingCapabilityEnvBlocks = [];
  for (const [provider, capabilities] of sourceProviderCapabilityMatrix.entries()) {
    if (provider === 'local') {
      continue;
    }
    const variables = liveEnvProviders.get(provider) || new Set();
    if (!envVariableMatchesSuffix(variables, ['API_KEY'])) {
      missingCapabilityEnvBlocks.push(`${provider}:API_KEY`);
    }
    for (const capability of capabilities) {
      const suffixes = capabilityEnvSuffixes[capability];
      if (!suffixes || suffixes.length === 0) {
        continue;
      }
      if (!envVariableMatchesSuffix(variables, suffixes)) {
        missingCapabilityEnvBlocks.push(`${provider}:${capability}`);
      }
    }
  }
  if (missingCapabilityEnvBlocks.length > 0) {
    failures.push(`dev/live-test.env.example missing capability env blocks: ${missingCapabilityEnvBlocks.sort((a, b) => a.localeCompare(b)).join(', ')}`);
  }

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
    process.stderr.write(`- source providers: ${toSortedArray(sourceProviders).join(', ')}\n`);
    process.stderr.write(`- runtime generate providers: ${toSortedArray(runtimeGenerateProviders).join(', ')}\n`);
    process.stderr.write(`- sdk generate providers: ${toSortedArray(sdkGenerateProviders).join(', ')}\n`);
    process.stderr.write(`- runtime provider+capability pairs: ${toSortedArray(runtimeProviderCapabilityPairs).join(', ')}\n`);
    process.stderr.write(`- sdk provider+capability pairs: ${toSortedArray(sdkProviderCapabilityPairs).join(', ')}\n`);
    process.stderr.write(`- capability universe: ${CAPABILITY_INTERFACE_ORDER.join(', ')}\n`);
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
