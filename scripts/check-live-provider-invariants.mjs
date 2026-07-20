#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITY_INTERFACE_ORDER,
  loadSourceProviderCapabilityMatrix,
  loadProviderCatalog,
  parseProviderRegistryProviders,
  parseRuntimeLiveTestDefinitions,
  parseLiveEnvTemplateProviders,
  readYamlFile,
  resolveRepoRoot,
  toSortedArray,
} from './live-provider-utils.mjs';

const repoRoot = resolveRepoRoot(import.meta.url);
const providerCatalogPath = path.join(repoRoot, '.nimi/spec/runtime/kernel/tables/provider-catalog.yaml');
const sourceProviderDir = path.join(repoRoot, 'runtime/catalog/source/providers');
const providerRegistryPath = path.join(repoRoot, 'runtime/internal/providerregistry/generated.go');
const runtimeLiveSmokePath = path.join(repoRoot, 'runtime/internal/services/ai/live_provider_smoke_matrix_test.go');
const workflowLiveConfigPaths = [
  '.github/workflows/live-smoke-matrix.yml',
  '.github/workflows/desktop-release-dry-run.yml',
].map((workflowPath) => path.join(repoRoot, workflowPath));
const liveEnvTemplatePath = path.join(repoRoot, 'config/live/live-test.env.example');
const defaultBaselinePath = path.join(repoRoot, 'config/live/live-gate-baseline.yaml');
const nimi2dImage2ForbiddenLiveRouteTokens = [
  'openai_api_key',
  'NIMI2D_IMAGE2_OPENAI_API_KEY',
  'openai_image_api',
];
const retiredSdkLiveAuthorityScanPaths = [
  'package.json',
  'scripts/run-live-test-matrix.mjs',
  'scripts/check-live-smoke-gate.mjs',
  'scripts/check-runtime-target-identity-v2.mjs',
  'config/live/live-gate-baseline.yaml',
  'config/live/live-test.env.example',
  'config/live/dashscope-gold-path.env',
  '.github/workflows/live-smoke-matrix.yml',
  '.github/workflows/release-runtime.yml',
  '.github/workflows/release.yml',
  'runtime/cmd/nimi/main.go',
  'runtime/cmd/nimi/usage_text.go',
  'runtime/cmd/nimi/ai_replay_commands.go',
  'sdks/typescript/runtime/public-credential-grant-hardcut.test.ts',
  'sdks/typescript/runtime/live-runtime-daemon.test-helper.ts',
];
const retiredSdkLiveExecutablePaths = [
  'scripts/ai-gold-path/fixtures.mjs',
  'scripts/ai-gold-path/run.ts',
  'scripts/ai-gold-path/sdk-vnext-runner.ts',
  'scripts/run-ai-gold-path.mjs',
  'scripts/run-dashscope-gold-path.mjs',
  'runtime/cmd/nimi/ai_replay_runtime.go',
  'sdks/typescript/runtime/live-provider-smoke.test.ts',
  'sdks/typescript/runtime/runtime-agent-ai-config-live-acceptance.test.ts',
  'sdks/typescript/runtime/runtime-agent-live-e2e-fixture.test.ts',
  'sdks/typescript/runtime/runtime-agent-live-e2e-fixture.test-helper.ts',
  'sdks/typescript/runtime/runtime-agent-live-e2e-fixture-realm-scenarios.test-helper.ts',
  'sdks/typescript/runtime/runtime-agent-live-e2e-fixture-realm-server.test-helper.ts',
  'sdks/typescript/runtime/runtime-agent-live-e2e-fixture-routes.test-helper.ts',
  'sdks/typescript/runtime/runtime-agent-live-e2e-fixture-runtime.test-helper.ts',
  'sdks/typescript/runtime/runtime-agent-live-e2e-fixture-shared.test-helper.ts',
  'sdks/typescript/runtime/runtime-agent-live-e2e-fixture-source-packet.test-helper.ts',
];
const retiredSdkLiveImportScanPaths = [
  'apps/zhiyu/package.json',
  ...listFilesUnder(path.join(repoRoot, 'apps/zhiyu/test'))
    .filter((filePath) => /\.(?:c|m)?(?:js|ts|tsx)$/u.test(filePath))
    .map((filePath) => path.relative(repoRoot, filePath).replaceAll(path.sep, '/')),
];
const retiredSdkLiveImportPattern = /\bfrom\s+['"][^'"]*(?:runtime-agent-live-e2e-fixture|live-runtime-daemon\.test-helper)[^'"]*['"]/u;
const retiredSdkLiveAuthorityPatterns = [
  ['direct_daemon', /\bwithRuntimeDaemon\b/u],
  ['public_grant_rpc', /\bauthorizeExternalPrincipal\b/u],
  ['public_grant_facade', /\.grants\s*\./u],
  ['self_asserted_node_grpc', /['"]node-grpc['"]/u],
  ['self_asserted_endpoint', /(?:--endpoint|NIMI_RUNTIME_GRPC_ADDR)/u],
  ['sdk_test_name_matrix', /(?:parseSdkLiveTestDefinitions|NIMI_SDK_LIVE|sdk_test_definitions|nimi sdk vnext live smoke:)/u],
  ['retired_sdk_live_test', /live-provider-smoke\.test\.ts/u],
  ['retired_gold_path_entry', /(?:run:ai-gold-path|run-dashscope-gold-path)/u],
  ['retired_gold_path_source', /ai-gold-path\/(?:run|sdk-vnext-runner)\.(?:mjs|ts)/u],
  ['retired_gold_subject', /NIMI_LIVE_GOLD_SUBJECT_USER_ID/u],
  ['runtime_daemon_replay', /(?:runRuntimeAIReplay|executeRuntimeReplay|nimi ai replay|case\s+"replay")/u],
];

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

function collectWorkflowLocalLiveFallbacks(workflowPaths) {
  const fallbackRefs = [];
  const liveEnvFallbackPattern = /^\s*(NIMI_LIVE_[A-Z0-9_]*(?:MODEL_ID|BASE_URL|PROVIDER|SUBJECT_USER_ID)):\s*\$\{\{[^}\n]*\|\|\s*['"][^'"]+['"][^}\n]*\}\}/;
  for (const workflowPath of workflowPaths) {
    if (!fs.existsSync(workflowPath)) {
      continue;
    }
    const relPath = path.relative(repoRoot, workflowPath);
    const lines = fs.readFileSync(workflowPath, 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const match = line.match(liveEnvFallbackPattern);
      if (match) {
        fallbackRefs.push(`${relPath}:${index + 1}:${match[1]}`);
      }
    }
  }
  return fallbackRefs;
}

function listFilesUnder(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function shouldScanNimi2DImage2LiveRoutePath(relPath) {
  if (relPath.startsWith('.nimi/spec/nimi2d/')) {
    return true;
  }
  if (relPath.startsWith('nimi2d/src/node/image2-provider/')) {
    return true;
  }
  if (relPath.startsWith('nimi2d/test/')) {
    return true;
  }
  return false;
}

function isIsolatedOpenAIImageApiAdapterPath(relPath) {
  if (relPath.startsWith('.nimi/spec/nimi2d/')) {
    return false;
  }
  return /(^|\/)(provider-openai-image-api|[^/]*openai-image-api[^/]*)/.test(relPath);
}

function collectNimi2DImage2LiveRouteDriftRefs(scanRoot = repoRoot) {
  const roots = [
    '.nimi/spec/nimi2d',
    'nimi2d/src/node/image2-provider',
    'nimi2d/test',
  ];
  const driftRefs = [];
  for (const root of roots) {
    for (const absolutePath of listFilesUnder(path.join(scanRoot, root))) {
      const relPath = path.relative(scanRoot, absolutePath).split(path.sep).join('/');
      if (!shouldScanNimi2DImage2LiveRoutePath(relPath)) {
        continue;
      }
      const content = fs.readFileSync(absolutePath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        for (const token of nimi2dImage2ForbiddenLiveRouteTokens) {
          if (!line.includes(token)) {
            continue;
          }
          if (token === 'openai_image_api' && isIsolatedOpenAIImageApiAdapterPath(relPath)) {
            continue;
          }
          driftRefs.push({
            path: relPath,
            line: index + 1,
            token,
          });
        }
      }
    }
  }
  return driftRefs;
}

function runtimeSourceCapabilityRequired(provider, capability, runtimeProviderCapabilityPairs) {
  const pair = `${provider}:${capability}`;
  if (
    provider === 'local'
    && (capability === 'voice_clone' || capability === 'voice_design')
    && !runtimeProviderCapabilityPairs.has(pair)
  ) {
    return false;
  }
  return true;
}

function collectMissingRuntimeGenerateProviders(
  sourceProviderCapabilityMatrix,
  runtimeLiveDefinitions,
  exemptions = new Set(),
) {
  const runtimeGenerateProviders = collectGenerateProviders(runtimeLiveDefinitions);
  return toSortedArray(
    [...sourceProviderCapabilityMatrix.entries()]
      .filter(([, capabilities]) => capabilities.has('generate'))
      .map(([provider]) => provider)
      .filter((provider) => !runtimeGenerateProviders.has(provider) && !exemptions.has(provider)),
  );
}

function collectMissingRuntimeCapabilityPairs(
  sourceProviderCapabilityMatrix,
  runtimeLiveDefinitions,
  exemptions = new Set(),
) {
  const runtimeProviderCapabilityPairs = collectProviderCapabilityPairs(runtimeLiveDefinitions);
  const missingPairs = [];
  for (const [provider, capabilities] of sourceProviderCapabilityMatrix.entries()) {
    for (const capability of capabilities) {
      const pair = `${provider}:${capability}`;
      if (!runtimeSourceCapabilityRequired(provider, capability, runtimeProviderCapabilityPairs)) {
        continue;
      }
      if (!exemptions.has(pair) && !runtimeProviderCapabilityPairs.has(pair)) {
        missingPairs.push(pair);
      }
    }
  }
  return missingPairs.sort((left, right) => left.localeCompare(right));
}

function collectRetiredSdkLiveAuthorityRefs(
  scanRoot = repoRoot,
  relativePaths = retiredSdkLiveAuthorityScanPaths,
) {
  const refs = [];
  for (const relativePath of relativePaths) {
    const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
    if (!normalizedPath) {
      continue;
    }
    const absolutePath = path.join(scanRoot, normalizedPath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }
    const lines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const [token, pattern] of retiredSdkLiveAuthorityPatterns) {
        if (pattern.test(line)) {
          refs.push({ path: normalizedPath, line: index + 1, token });
        }
      }
    }
  }

  for (const retiredPath of retiredSdkLiveExecutablePaths) {
    if (fs.existsSync(path.join(scanRoot, retiredPath))) {
      refs.push({ path: retiredPath, line: 1, token: 'retired_sdk_live_executable' });
    }
  }
  return refs;
}

function collectRetiredSdkLiveFixtureImports(
  scanRoot = repoRoot,
  relativePaths = retiredSdkLiveImportScanPaths,
) {
  const refs = [];
  for (const relativePath of relativePaths) {
    const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
    const absolutePath = path.join(scanRoot, normalizedPath);
    if (!normalizedPath || !fs.existsSync(absolutePath)) continue;
    const lines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (retiredSdkLiveImportPattern.test(line)) {
        refs.push({ path: normalizedPath, line: index + 1, token: 'retired_sdk_live_fixture_import' });
      }
    }
  }
  return refs;
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
  const runtimeCapabilityExemptions = toPairSet(exemptions.runtime_live_capability_exemptions);

  const catalogProviders = loadProviderCatalog(providerCatalogPath);
  const sourceProviderCapabilityMatrix = loadSourceProviderCapabilityMatrix(sourceProviderDir);
  const sourceProviders = new Set(sourceProviderCapabilityMatrix.keys());
  const cloudProviderBindings = parseProviderRegistryProviders(providerRegistryPath, 'RemoteProviders');
  const runtimeLiveDefinitions = parseRuntimeLiveTestDefinitions(runtimeLiveSmokePath);
  const liveEnvProviders = parseLiveEnvTemplateProviders(liveEnvTemplatePath);

  const bindingProviders = new Set(cloudProviderBindings);
  const runtimeGenerateProviders = collectGenerateProviders(runtimeLiveDefinitions);
  const runtimeProviderCapabilityPairs = collectProviderCapabilityPairs(runtimeLiveDefinitions);
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

  const missingRuntimeGenerate = collectMissingRuntimeGenerateProviders(
    sourceProviderCapabilityMatrix,
    runtimeLiveDefinitions,
    runtimeLiveGenerateExemptions,
  );
  pushMissing(
    failures,
    'runtime live smoke generate coverage missing for cloudProviderEnvBindings providers',
    missingRuntimeGenerate,
  );

  const missingRuntimeCapabilityPairs = collectMissingRuntimeCapabilityPairs(
    sourceProviderCapabilityMatrix,
    runtimeLiveDefinitions,
    runtimeCapabilityExemptions,
  );
  if (missingRuntimeCapabilityPairs.length > 0) {
    failures.push(`runtime live smoke capability coverage missing pairs: ${missingRuntimeCapabilityPairs.sort((a, b) => a.localeCompare(b)).join(', ')}`);
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
    'config/live/live-test.env.example missing provider env blocks for cloudProviderEnvBindings providers',
    missingLiveEnvTemplate,
  );

  const workflowLocalLiveFallbacks = collectWorkflowLocalLiveFallbacks(workflowLiveConfigPaths);
  if (workflowLocalLiveFallbacks.length > 0) {
    failures.push(`workflow-local live provider defaults are forbidden: ${workflowLocalLiveFallbacks.join(', ')}`);
  }

  const nimi2dImage2LiveRouteDriftRefs = collectNimi2DImage2LiveRouteDriftRefs(repoRoot);
  if (nimi2dImage2LiveRouteDriftRefs.length > 0) {
    failures.push(
      `nimi2d Image2 direct API/key live route drift is forbidden: ${nimi2dImage2LiveRouteDriftRefs
        .map((ref) => `${ref.path}:${ref.line}:${ref.token}`)
        .join(', ')}`,
    );
  }

  const retiredSdkLiveAuthorityRefs = collectRetiredSdkLiveAuthorityRefs(repoRoot);
  if (retiredSdkLiveAuthorityRefs.length > 0) {
    failures.push(
      `retired SDK direct-daemon/live-matrix authority is forbidden in active gate paths: ${retiredSdkLiveAuthorityRefs
        .map((ref) => `${ref.path}:${ref.line}:${ref.token}`)
        .join(', ')}`,
    );
  }
  const retiredSdkLiveFixtureImports = collectRetiredSdkLiveFixtureImports(repoRoot);
  if (retiredSdkLiveFixtureImports.length > 0) {
    failures.push(
      `retired SDK live-fixture imports are forbidden in Zhiyu tests: ${retiredSdkLiveFixtureImports
        .map((ref) => `${ref.path}:${ref.line}:${ref.token}`)
        .join(', ')}`,
    );
  }

  const capabilityEnvSuffixes = {
    generate: ['MODEL_ID'],
    embed: ['EMBED_MODEL_ID', 'MODEL_ID'],
    image: ['IMAGE_MODEL_ID', 'MODEL_ID'],
    video: ['VIDEO_MODEL_ID', 'MODEL_ID'],
    tts: ['TTS_MODEL_ID', 'MODEL_ID'],
    stt: ['STT_MODEL_ID', 'MODEL_ID'],
    music: ['MUSIC_MODEL_ID', 'MODEL_ID'],
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
    failures.push(`config/live/live-test.env.example missing capability env blocks: ${missingCapabilityEnvBlocks.sort((a, b) => a.localeCompare(b)).join(', ')}`);
  }

  const localCapabilities = sourceProviderCapabilityMatrix.get('local') || new Set();
  const liveEnvTemplateContent = fs.readFileSync(liveEnvTemplatePath, 'utf8');
  if (localCapabilities.has('music')) {
    const requiredLocalSidecarVars = [
      'NIMI_LIVE_LOCAL_SIDECAR_BASE_URL=',
      'NIMI_LIVE_LOCAL_SIDECAR_API_KEY=',
      'NIMI_LIVE_LOCAL_SIDECAR_MUSIC_MODEL_ID=',
    ];
    const missingLocalSidecarVars = requiredLocalSidecarVars.filter(
      (variable) => !liveEnvTemplateContent.includes(variable),
    );
    if (missingLocalSidecarVars.length > 0) {
      failures.push(`config/live/live-test.env.example missing local sidecar live env vars required for local music coverage: ${missingLocalSidecarVars.join(', ')}`);
    }
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
    process.stderr.write(`- runtime provider+capability pairs: ${toSortedArray(runtimeProviderCapabilityPairs).join(', ')}\n`);
    process.stderr.write(`- capability universe: ${CAPABILITY_INTERFACE_ORDER.join(', ')}\n`);
    process.stderr.write(`- env template providers: ${toSortedArray(envProviders).join(', ')}\n`);
    process.exit(1);
  }

  process.stdout.write('[check-live-provider-invariants] provider invariants passed\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    process.stderr.write(`[check-live-provider-invariants] fatal: ${message}\n`);
    process.exit(1);
  }
}

export {
  collectMissingRuntimeCapabilityPairs,
  collectMissingRuntimeGenerateProviders,
  collectNimi2DImage2LiveRouteDriftRefs,
  collectRetiredSdkLiveAuthorityRefs,
  collectRetiredSdkLiveFixtureImports,
};
