#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const CAPABILITY_INTERFACE_ORDER = [
  'generate',
  'embed',
  'image',
  'video',
  'tts',
  'stt',
  'voice_clone',
  'voice_design',
];

export const RUNTIME_INTERFACE_ORDER = [
  ...CAPABILITY_INTERFACE_ORDER,
  'connector_tts',
];

export const SDK_INTERFACE_ORDER = [...CAPABILITY_INTERFACE_ORDER];

const PROVIDER_ALIASES = {
  local: 'local',
  localprovider: 'local',
  nimillm: 'nimillm',
  openai: 'openai',
  anthropic: 'anthropic',
  dashscope: 'dashscope',
  volcengine: 'volcengine',
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
  awspolly: 'aws_polly',
  azurespeech: 'azure_speech',
  googlecloudtts: 'google_cloud_tts',
  googleveo: 'google_veo',
  fishaudio: 'fish_audio',
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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = String(item || '').trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function capabilityFromModelCapability(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized === 'text.generate') {
    return 'generate';
  }
  if (normalized === 'text.embed') {
    return 'embed';
  }
  if (normalized === 'image.generate') {
    return 'image';
  }
  if (normalized === 'video.generate') {
    return 'video';
  }
  if (normalized === 'audio.synthesize') {
    return 'tts';
  }
  if (normalized === 'audio.transcribe') {
    return 'stt';
  }
  return '';
}

function workflowCapability(workflowType) {
  const normalized = String(workflowType || '').trim().toLowerCase();
  if (normalized === 'tts_v2v') {
    return 'voice_clone';
  }
  if (normalized === 'tts_t2v') {
    return 'voice_design';
  }
  return '';
}

export function loadSourceProviderCapabilityMatrix(sourceProviderDir) {
  const matrix = new Map();
  const entries = fs.readdirSync(sourceProviderDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.source.yaml'))
    .map((entry) => path.join(sourceProviderDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const doc = readYamlFile(file);
    const provider = canonicalProviderId(doc?.provider || path.basename(file, '.source.yaml'));
    if (!provider) {
      continue;
    }
    const set = matrix.get(provider) || new Set();
    const defaults = normalizeStringArray(doc?.defaults?.capabilities);
    const models = Array.isArray(doc?.models) ? doc.models : [];
    for (const model of models) {
      const caps = normalizeStringArray(model?.capabilities);
      const effectiveCaps = caps.length > 0 ? caps : defaults;
      for (const capability of effectiveCaps) {
        const mapped = capabilityFromModelCapability(capability);
        if (mapped) {
          set.add(mapped);
        }
      }
    }
    const workflows = Array.isArray(doc?.voice_workflow_models) ? doc.voice_workflow_models : [];
    for (const workflow of workflows) {
      const mapped = workflowCapability(workflow?.workflow_type);
      if (mapped) {
        set.add(mapped);
      }
    }
    matrix.set(provider, set);
  }

  return matrix;
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

export function parseProviderRegistryProviders(generatedGoPath, variableName) {
  const source = fs.readFileSync(generatedGoPath, 'utf8');
  const pattern = new RegExp(`var\\s+${variableName}\\s*=\\s*\\[\\]string\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const match = source.match(pattern);
  const out = new Set();
  if (!match?.[1]) {
    return out;
  }
  const itemRegex = /"([^"]+)"/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(match[1])) !== null) {
    const provider = canonicalProviderId(itemMatch[1]);
    if (provider) {
      out.add(provider);
    }
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
  const repoRoot = resolveRepoRoot(import.meta.url);
  const sourceProviderDir = path.join(repoRoot, 'runtime', 'catalog', 'source', 'providers');
  const definitions = new Map();

  if (source.includes('TestLiveSmokeProviderCapabilityMatrix')) {
    const matrix = loadSourceProviderCapabilityMatrix(sourceProviderDir);
    for (const [provider, capabilities] of matrix.entries()) {
      for (const iface of capabilities) {
        ensureNestedMapSet(
          definitions,
          provider,
          iface,
          `TestLiveSmokeProviderCapabilityMatrix/${provider}/${iface}`,
        );
      }
    }
  }

  const fnRegex = /func\s+(TestLiveSmoke(?:Connector)?[A-Za-z0-9]+(?:GenerateText|Embed|SubmitScenarioJobModalities|TTS))\s*\(/g;
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

    if (functionName.endsWith('SubmitScenarioJobModalities')) {
      const token = functionName.slice('TestLiveSmoke'.length, -'SubmitScenarioJobModalities'.length);
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
  const repoRoot = resolveRepoRoot(import.meta.url);
  const sourceProviderDir = path.join(repoRoot, 'runtime', 'catalog', 'source', 'providers');
  const definitions = new Map();
  if (source.includes('registerSdkProviderCapabilityMatrixTests')) {
    const matrix = loadSourceProviderCapabilityMatrix(sourceProviderDir);
    for (const [provider, capabilities] of matrix.entries()) {
      for (const iface of capabilities) {
        ensureNestedMapSet(
          definitions,
          provider,
          iface,
          `nimi sdk ai-provider live smoke: ${provider} ${iface}`,
        );
      }
    }
  }
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
  const capabilityRegex = /test\(\s*['"]nimi sdk ai-provider live smoke:\s*([^'"]+?)\s+(generate|embed|image|video|tts|stt|voice_clone|voice_design)['"]/g;
  while ((match = capabilityRegex.exec(source)) !== null) {
    const providerLabel = String(match[1] || '').trim();
    const provider = canonicalProviderId(providerLabel);
    const iface = String(match[2] || '').trim().toLowerCase();
    if (!provider || !iface) {
      continue;
    }
    const testName = `nimi sdk ai-provider live smoke: ${providerLabel} ${iface}`;
    ensureNestedMapSet(definitions, provider, iface, testName);
  }
  return definitions;
}

export function parseLiveEnvTemplateProviders(envTemplatePath) {
  const source = fs.readFileSync(envTemplatePath, 'utf8');
  const providers = new Map();
  const suffixCandidates = [
    'VOICE_DESIGN_MODEL_ID_TARGET_MODEL_ID',
    'VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID',
    'VOICE_REFERENCE_AUDIO_URI',
    'VOICE_DESIGN_MODEL_ID',
    'VOICE_CLONE_MODEL_ID',
    'EMBED_MODEL_ID',
    'IMAGE_MODEL_ID',
    'VIDEO_MODEL_ID',
    'TTS_MODEL_ID',
    'STT_MODEL_ID',
    'MODEL_ID',
    'BASE_URL',
    'API_KEY',
  ];

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
    if (variable === 'NIMI_LIVE_STT_AUDIO_URI' || variable === 'NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI') {
      continue;
    }
    const raw = variable.slice('NIMI_LIVE_'.length);
    let token = '';
    for (const suffix of suffixCandidates) {
      if (raw.endsWith(`_${suffix}`) && raw.length > suffix.length + 1) {
        token = raw.slice(0, raw.length - suffix.length - 1);
        break;
      }
    }
    if (!token) {
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
