#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const RUNTIME_INTERFACE_ORDER = [
  'generate',
  'embed',
  'image',
  'video',
  'tts',
  'stt',
  'connector_tts',
];

export const SDK_INTERFACE_ORDER = ['generate'];

const PROVIDER_ALIASES = {
  local: 'local',
  localprovider: 'local',
  nimillm: 'nimillm',
  openai: 'openai',
  anthropic: 'anthropic',
  dashscope: 'dashscope',
  alibaba: 'dashscope',
  volcengine: 'volcengine',
  bytedance: 'volcengine',
  gemini: 'gemini',
  minimax: 'minimax',
  kimi: 'kimi',
  glm: 'glm',
  deepseek: 'deepseek',
  openrouter: 'openrouter',
  azure: 'azure',
  mistral: 'mistral',
  groq: 'groq',
  xai: 'xai',
  qianfan: 'qianfan',
  hunyuan: 'hunyuan',
  spark: 'spark',
  openaicompatible: 'openai_compatible',
  volcengineopenspeech: 'volcengine_openspeech',
};

export function canonicalProviderId(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return '';
  }

  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!normalized) {
    return '';
  }

  if (Object.prototype.hasOwnProperty.call(PROVIDER_ALIASES, normalized)) {
    return PROVIDER_ALIASES[normalized];
  }

  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function readYamlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return YAML.parse(content) || {};
}

export function loadProviderCatalog(providerCatalogPath) {
  const doc = readYamlFile(providerCatalogPath);
  const providers = Array.isArray(doc?.providers) ? doc.providers : [];
  const set = new Set();

  for (const entry of providers) {
    const provider = canonicalProviderId(entry?.provider);
    if (!provider) {
      continue;
    }
    set.add(provider);
  }

  return set;
}

export function parseCloudProviderEnvBindings(providerGoPath) {
  const source = fs.readFileSync(providerGoPath, 'utf8');
  const blockMatch = source.match(/var\s+cloudProviderEnvBindings\s*=\s*\[\]struct\s*\{[\s\S]*?\}\s*\{([\s\S]*?)\n\}/m);
  const out = new Map();
  if (!blockMatch?.[1]) {
    return out;
  }

  const tupleRegex = /\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\}/g;
  let match;
  while ((match = tupleRegex.exec(blockMatch[1])) !== null) {
    const provider = canonicalProviderId(match[1]);
    if (!provider) {
      continue;
    }
    out.set(provider, {
      baseEnv: String(match[2] || '').trim(),
      keyEnv: String(match[3] || '').trim(),
    });
  }

  return out;
}

function ensureNestedMapSet(target, provider, iface, testName) {
  if (!provider || !iface || !testName) {
    return;
  }
  if (!target.has(provider)) {
    target.set(provider, new Map());
  }
  const providerMap = target.get(provider);
  if (!providerMap.has(iface)) {
    providerMap.set(iface, new Set());
  }
  providerMap.get(iface).add(testName);
}

function extractFunctionBody(source, functionStartIndex) {
  const braceStart = source.indexOf('{', functionStartIndex);
  if (braceStart < 0) {
    return '';
  }

  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, index);
      }
    }
  }

  return source.slice(braceStart + 1);
}

function normalizeMediaModality(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'image') {
    return 'image';
  }
  if (normalized === 'video') {
    return 'video';
  }
  if (normalized === 'tts') {
    return 'tts';
  }
  if (normalized === 'stt') {
    return 'stt';
  }
  return '';
}

export function parseRuntimeLiveTestDefinitions(runtimeLiveSmokePath) {
  const source = fs.readFileSync(runtimeLiveSmokePath, 'utf8');
  const definitions = new Map();
  const fnRegex = /func\s+(TestLiveSmoke(?:Connector)?[A-Za-z0-9]+(?:GenerateText|Embed|SubmitMediaJobModalities|TTS))\s*\(/g;
  let match;

  while ((match = fnRegex.exec(source)) !== null) {
    const functionName = String(match[1] || '').trim();
    if (!functionName) {
      continue;
    }

    if (functionName.startsWith('TestLiveSmokeConnector') && functionName.endsWith('TTS')) {
      const token = functionName.slice('TestLiveSmokeConnector'.length, -'TTS'.length);
      const provider = canonicalProviderId(token);
      ensureNestedMapSet(definitions, provider, 'connector_tts', functionName);
      continue;
    }

    if (!functionName.startsWith('TestLiveSmoke')) {
      continue;
    }

    if (functionName.endsWith('GenerateText')) {
      const token = functionName.slice('TestLiveSmoke'.length, -'GenerateText'.length);
      const provider = canonicalProviderId(token);
      ensureNestedMapSet(definitions, provider, 'generate', functionName);
      continue;
    }

    if (functionName.endsWith('Embed')) {
      const token = functionName.slice('TestLiveSmoke'.length, -'Embed'.length);
      const provider = canonicalProviderId(token);
      ensureNestedMapSet(definitions, provider, 'embed', functionName);
      continue;
    }

    if (functionName.endsWith('SubmitMediaJobModalities')) {
      const token = functionName.slice('TestLiveSmoke'.length, -'SubmitMediaJobModalities'.length);
      const provider = canonicalProviderId(token);
      const body = extractFunctionBody(source, match.index);
      const modalitySet = new Set();
      const runRegex = /t\.Run\("([^"]+)"/g;
      let runMatch;
      while ((runMatch = runRegex.exec(body)) !== null) {
        const iface = normalizeMediaModality(runMatch[1]);
        if (iface) {
          modalitySet.add(iface);
        }
      }

      if (modalitySet.size === 0) {
        modalitySet.add('image');
        modalitySet.add('video');
        modalitySet.add('tts');
        modalitySet.add('stt');
      }

      for (const iface of modalitySet) {
        ensureNestedMapSet(definitions, provider, iface, `${functionName}/${iface}`);
      }
    }
  }

  return definitions;
}

export function parseSdkLiveTestDefinitions(sdkLiveSmokePath) {
  const source = fs.readFileSync(sdkLiveSmokePath, 'utf8');
  const definitions = new Map();
  const testRegex = /test\(\s*['"]nimi sdk ai-provider live smoke:\s*([^'"]+?)\s+generate text['"]/g;
  let match;
  while ((match = testRegex.exec(source)) !== null) {
    const label = String(match[1] || '').trim();
    const provider = canonicalProviderId(label);
    if (!provider) {
      continue;
    }
    const testName = `nimi sdk ai-provider live smoke: ${label} generate text`;
    ensureNestedMapSet(definitions, provider, 'generate', testName);
  }
  return definitions;
}

export function parseLiveEnvTemplateProviders(envTemplatePath) {
  const source = fs.readFileSync(envTemplatePath, 'utf8');
  const providers = new Map();

  for (const line of source.split(/\r?\n/)) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const variableMatch = trimmed.match(/^(NIMI_LIVE_[A-Z0-9_]+)=/);
    if (!variableMatch?.[1]) {
      continue;
    }

    const variable = variableMatch[1];
    const tokenMatch = variable.match(/^NIMI_LIVE_([A-Z0-9]+)_/);
    if (!tokenMatch?.[1]) {
      continue;
    }

    const token = String(tokenMatch[1] || '').trim().toUpperCase();
    if (!token || token === 'STT') {
      continue;
    }

    const provider = canonicalProviderId(token);
    if (!provider) {
      continue;
    }
    if (!providers.has(provider)) {
      providers.set(provider, new Set());
    }
    providers.get(provider).add(variable);
  }

  return providers;
}

export function collectProvidersFromDefinitions(definitions) {
  const providers = new Set();
  for (const provider of definitions.keys()) {
    providers.add(provider);
  }
  return providers;
}

export function collectProviderUniverse(input) {
  const providers = new Set();
  for (const provider of input.catalogProviders || []) {
    providers.add(provider);
  }
  for (const provider of collectProvidersFromDefinitions(input.runtimeDefinitions || new Map())) {
    providers.add(provider);
  }
  for (const provider of collectProvidersFromDefinitions(input.sdkDefinitions || new Map())) {
    providers.add(provider);
  }
  if (input.includeLocal !== false) {
    providers.add('local');
  }
  return providers;
}

export function toSortedArray(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function mapDefinitionsToObject(definitions) {
  const out = {};
  for (const [provider, ifaceMap] of definitions.entries()) {
    out[provider] = {};
    for (const [iface, testNames] of ifaceMap.entries()) {
      out[provider][iface] = toSortedArray(testNames);
    }
  }
  return out;
}

export function resolveRepoRoot(scriptImportMetaUrl) {
  return path.resolve(path.dirname(new URL(scriptImportMetaUrl).pathname), '..');
}
