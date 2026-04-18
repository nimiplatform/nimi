#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const connectorServicePath = path.join(repoRoot, 'runtime', 'internal', 'services', 'connector', 'service_probe.go');
const voiceMethodsPath = path.join(repoRoot, 'runtime', 'internal', 'services', 'ai', 'voice_methods.go');
const speechVoiceResolverPath = path.join(repoRoot, 'runtime', 'internal', 'services', 'ai', 'speech_voice_resolver.go');
const catalogResolverPath = path.join(repoRoot, 'runtime', 'internal', 'aicatalog', 'resolver.go');
const catalogTypesPath = path.join(repoRoot, 'runtime', 'internal', 'aicatalog', 'types.go');
const sourceReadmePath = path.join(repoRoot, 'runtime', 'catalog', 'source', 'README.md');

const scanRoots = [
  path.join(repoRoot, 'runtime', 'catalog', 'source'),
  path.join(repoRoot, 'runtime', 'catalog', 'providers'),
  path.join(repoRoot, '.nimi', 'spec', 'runtime', 'kernel', 'model-catalog-contract.md'),
  path.join(repoRoot, '.nimi', 'spec', 'runtime', 'kernel', 'voice-contract.md'),
  path.join(repoRoot, '.nimi', 'spec', 'runtime', 'kernel', 'tables', 'tts-provider-capability-matrix.yaml'),
  path.join(repoRoot, '.nimi', 'spec', 'runtime', 'kernel', 'tables', 'connector-rpc-field-rules.yaml'),
];

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function readText(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

function rel(absPath) {
  return path.relative(repoRoot, absPath);
}

function walk(absPath) {
  const stat = fs.statSync(absPath);
  if (stat.isFile()) {
    return [absPath];
  }
  return fs.readdirSync(absPath)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((name) => walk(path.join(absPath, name)));
}

function extractFunctionBody(source, functionName) {
  const marker = `func (s *Service) ${functionName}(`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return '';
  }
  const open = source.indexOf('{', start);
  if (open < 0) {
    return '';
  }
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, i);
      }
    }
  }
  return '';
}

function main() {
  const connectorService = readText(connectorServicePath);
  const voiceMethods = readText(voiceMethodsPath);
  const speechVoiceResolver = readText(speechVoiceResolverPath);
  const catalogResolver = readText(catalogResolverPath);
  const catalogTypes = readText(catalogTypesPath);
  const sourceReadme = readText(sourceReadmePath);

  const listConnectorModelsBody = extractFunctionBody(connectorService, 'ListConnectorModels');
  if (!/\blistCatalogConnectorModels\(\s*[^,]+,\s*rec\.Provider\s*\)/u.test(listConnectorModelsBody)) {
    fail(`${rel(connectorServicePath)} ListConnectorModels must keep static_source catalog read path`);
  }
  if (!listConnectorModelsBody.includes('InventoryMode == "dynamic_endpoint"')) {
    fail(`${rel(connectorServicePath)} ListConnectorModels must branch on dynamic_endpoint inventory mode`);
  }
  if (!connectorService.includes('func (s *Service) listDynamicConnectorModels(') || !connectorService.includes('backend.ListModels(ctx)')) {
    fail(`${rel(connectorServicePath)} dynamic ListConnectorModels helper must call backend.ListModels`);
  }
  if (!connectorService.includes('LoadCredential(')) {
    fail(`${rel(connectorServicePath)} dynamic ListConnectorModels path must load connector credentials`);
  }

  if (voiceMethods.includes('ListSpeechVoices(')) {
    fail(`${rel(voiceMethodsPath)} public preset voice listing must not call backend.ListSpeechVoices`);
  }
  if (speechVoiceResolver.includes('ListSpeechVoices(')) {
    fail(`${rel(speechVoiceResolverPath)} speech voice resolver must not use live provider preset discovery`);
  }

  for (const fragment of [
    'runRemoteRefreshLoop',
    'refreshRemote',
    'remoteProviders',
    'remoteETag',
    'cachePath',
    'remoteURL',
    'remoteEnabled',
    'httpClient',
  ]) {
    if (catalogResolver.includes(fragment)) {
      fail(`${rel(catalogResolverPath)} must not retain remote catalog machinery: ${fragment}`);
    }
  }
  for (const fragment of ['SourceRemoteCache', 'ProviderSourceRemote', 'RemoteBundle']) {
    if (catalogTypes.includes(fragment)) {
      fail(`${rel(catalogTypesPath)} must not retain remote catalog types: ${fragment}`);
    }
  }
  if (!sourceReadme.includes('ListPresetVoices` is a catalog read')) {
    fail(`${rel(sourceReadmePath)} must document YAML-only preset voice discovery`);
  }

  const bannedPatterns = [
    { regex: /\bdynamic_global\b/u, label: 'dynamic_global' },
    { regex: /\bpreset-dynamic\b/u, label: 'preset-dynamic' },
    { regex: /\bprovider_live\b/u, label: 'provider_live' },
    { regex: /\bcatalog_remote_cache\b/u, label: 'catalog_remote_cache' },
  ];
  for (const root of scanRoots) {
    for (const absPath of walk(root)) {
      const content = readText(absPath);
      for (const pattern of bannedPatterns) {
        if (pattern.regex.test(content)) {
          fail(`${rel(absPath)} must not contain legacy YAML-first banned token: ${pattern.label}`);
        }
      }
    }
  }

  if (connectorService.includes('MODEL_CATALOG_PROVIDER_SOURCE_REMOTE')) {
    fail(`${rel(connectorServicePath)} runtime must not emit MODEL_CATALOG_PROVIDER_SOURCE_REMOTE`);
  }

  if (failed) {
    process.exit(1);
  }

  console.log('runtime-provider-yaml-first-hardcut: OK');
}

main();
