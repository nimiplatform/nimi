#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(repoRoot, 'runtime', 'catalog', 'source', 'providers');
const generatedPath = path.join(repoRoot, 'runtime', 'internal', 'providerregistry', 'generated.go');
const sdkGeneratedPath = path.join(repoRoot, 'sdk', 'src', 'runtime', 'provider-targeting.generated.ts');
const providerCatalogTablePath = path.join(repoRoot, 'spec', 'runtime', 'kernel', 'tables', 'provider-catalog.yaml');
const providerCapabilitiesTablePath = path.join(repoRoot, 'spec', 'runtime', 'kernel', 'tables', 'provider-capabilities.yaml');

const supplementalProviders = [
  {
    id: 'nimillm',
    runtimePlane: 'remote',
    managedConnectorSupported: true,
    inlineSupported: true,
    requiresExplicitEndpoint: true,
    defaultEndpoint: '',
    defaultTextModel: '',
    supports: { text: true, embed: true, image: true, video: true, tts: true, stt: true, music: false, musicIteration: false, ttsV2V: false, ttsT2V: false },
  },
  {
    id: 'openai_compatible',
    runtimePlane: 'remote',
    managedConnectorSupported: true,
    inlineSupported: true,
    requiresExplicitEndpoint: true,
    defaultEndpoint: '',
    defaultTextModel: '',
    supports: { text: true, embed: true, image: true, video: true, tts: true, stt: true, music: false, musicIteration: false, ttsV2V: false, ttsT2V: false },
  },
  {
    id: 'volcengine_openspeech',
    runtimePlane: 'remote',
    managedConnectorSupported: true,
    inlineSupported: true,
    requiresExplicitEndpoint: false,
    defaultEndpoint: 'https://openspeech.bytedance.com/api/v1',
    defaultTextModel: '',
    supports: { text: false, embed: false, image: false, video: false, tts: true, stt: true, music: false, musicIteration: false, ttsV2V: false, ttsT2V: false },
  },
];

const canonicalModelCapabilities = new Set([
  'text.generate',
  'text.generate.vision',
  'text.embed',
  'image.generate',
  'video.generate',
  'audio.synthesize',
  'audio.transcribe',
  'music.generate',
  'music.generate.iteration',
]);

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function providerEnvToken(providerID) {
  return String(providerID || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const v = String(item || '').trim();
    if (!v) {
      continue;
    }
    const key = v.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(v);
  }
  return out;
}

function capabilityFlags(sourceDoc) {
  const models = Array.isArray(sourceDoc?.models) ? sourceDoc.models : [];
  const defaults = normalizeStringArray(sourceDoc?.defaults?.capabilities).map((entry) => entry.toLowerCase());

  let text = false;
  let embed = false;
  let image = false;
  let video = false;
  let tts = false;
  let stt = false;
  let music = false;
  let musicIteration = false;

  for (const model of models) {
    const capabilities = normalizeStringArray(model?.capabilities).map((entry) => entry.toLowerCase());
    const effectiveCaps = capabilities.length > 0 ? capabilities : defaults;
    for (const capability of effectiveCaps) {
      if (!canonicalModelCapabilities.has(capability)) {
        throw new Error(`provider ${sourceDoc?.provider || '<unknown>'} uses non-canonical capability token: ${capability}`);
      }
      if (capability === 'text.generate') {
        text = true;
      }
      if (capability === 'text.embed') {
        embed = true;
      }
      if (capability === 'image.generate') {
        image = true;
      }
      if (capability === 'video.generate') {
        video = true;
      }
      if (capability === 'audio.synthesize') {
        tts = true;
      }
      if (capability === 'audio.transcribe') {
        stt = true;
      }
      if (capability === 'music.generate') {
        music = true;
      }
      if (capability === 'music.generate.iteration') {
        musicIteration = true;
      }
    }
  }

  const workflowModels = Array.isArray(sourceDoc?.voice_workflow_models) ? sourceDoc.voice_workflow_models : [];
  let ttsV2V = false;
  let ttsT2V = false;
  for (const workflow of workflowModels) {
    const workflowType = String(workflow?.workflow_type || '').trim().toLowerCase();
    if (workflowType === 'tts_v2v') {
      ttsV2V = true;
    }
    if (workflowType === 'tts_t2v') {
      ttsT2V = true;
    }
  }

  return { text, embed, image, video, tts, stt, music, musicIteration, ttsV2V, ttsT2V };
}

function collectProviderCapabilities(sourceDoc) {
  const defaults = normalizeStringArray(sourceDoc?.defaults?.capabilities);
  const models = Array.isArray(sourceDoc?.models) ? sourceDoc.models : [];
  const capabilitySet = new Set();
  for (const model of models) {
    const capabilities = normalizeStringArray(model?.capabilities);
    const effectiveCaps = capabilities.length > 0 ? capabilities : defaults;
    for (const capability of effectiveCaps) {
      const normalized = capability.toLowerCase();
      if (!canonicalModelCapabilities.has(normalized)) {
        throw new Error(`provider ${sourceDoc?.provider || '<unknown>'} uses non-canonical capability token: ${capability}`);
      }
      capabilitySet.add(normalized);
    }
  }
  const workflows = Array.isArray(sourceDoc?.voice_workflow_models) ? sourceDoc.voice_workflow_models : [];
  for (const workflow of workflows) {
    const workflowType = String(workflow?.workflow_type || '').trim().toLowerCase();
    if (workflowType === 'tts_v2v') {
      capabilitySet.add('voice_workflow.tts_v2v');
    }
    if (workflowType === 'tts_t2v') {
      capabilitySet.add('voice_workflow.tts_t2v');
    }
  }
  return [...capabilitySet].sort((left, right) => left.localeCompare(right));
}

function readRuntimeMetadata(sourceDoc, providerID) {
  const runtime = sourceDoc?.runtime && typeof sourceDoc.runtime === 'object' ? sourceDoc.runtime : {};
  const runtimePlane = String(runtime?.runtime_plane || '').trim();
  const managedConnectorSupported = Boolean(runtime?.managed_connector_supported);
  const inlineSupported = Boolean(runtime?.inline_supported);
  const defaultEndpoint = String(runtime?.default_endpoint || '').trim();
  const defaultTextModel = String(sourceDoc?.defaults?.default_text_model || '').trim();
  const requiresExplicitEndpoint = Boolean(runtime?.requires_explicit_endpoint);

  if (runtimePlane !== 'local' && runtimePlane !== 'remote') {
    throw new Error(`provider ${providerID} runtime.runtime_plane must be local or remote`);
  }
  if (runtimePlane === 'local') {
    if (inlineSupported) {
      throw new Error(`provider ${providerID} local runtime must not enable inline_supported`);
    }
    if (defaultEndpoint) {
      throw new Error(`provider ${providerID} local runtime must not set default_endpoint`);
    }
    if (requiresExplicitEndpoint) {
      throw new Error(`provider ${providerID} local runtime must not require explicit endpoint`);
    }
  }
  if (runtimePlane === 'remote' && !managedConnectorSupported) {
    throw new Error(`provider ${providerID} remote runtime must set managed_connector_supported=true`);
  }
  if (defaultEndpoint && requiresExplicitEndpoint) {
    throw new Error(`provider ${providerID} must not set both default_endpoint and requires_explicit_endpoint=true`);
  }
  return {
    runtimePlane,
    managedConnectorSupported,
    inlineSupported,
    defaultEndpoint,
    defaultTextModel,
    requiresExplicitEndpoint,
  };
}

function compareProviderID(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function boolLiteral(value) {
  return value ? 'true' : 'false';
}

function goString(value) {
  const text = String(value || '');
  return JSON.stringify(text);
}

function renderProviderRecord(record) {
  return `\t${goString(record.id)}: {\n` +
    `\t\tID: ${goString(record.id)},\n` +
    `\t\tRuntimePlane: ${goString(record.runtimePlane)},\n` +
    `\t\tManagedConnectorSupported: ${boolLiteral(record.managedConnectorSupported)},\n` +
    `\t\tInlineSupported: ${boolLiteral(record.inlineSupported)},\n` +
    `\t\tDefaultEndpoint: ${goString(record.defaultEndpoint)},\n` +
    `\t\tDefaultTextModel: ${goString(record.defaultTextModel)},\n` +
    `\t\tRequiresExplicitEndpoint: ${boolLiteral(record.requiresExplicitEndpoint)},\n` +
    `\t\tSupportsText: ${boolLiteral(record.supports.text)},\n` +
    `\t\tSupportsEmbed: ${boolLiteral(record.supports.embed)},\n` +
    `\t\tSupportsImage: ${boolLiteral(record.supports.image)},\n` +
    `\t\tSupportsVideo: ${boolLiteral(record.supports.video)},\n` +
    `\t\tSupportsTTS: ${boolLiteral(record.supports.tts)},\n` +
    `\t\tSupportsSTT: ${boolLiteral(record.supports.stt)},\n` +
    `\t\tSupportsMusic: ${boolLiteral(record.supports.music)},\n` +
    `\t\tSupportsMusicIteration: ${boolLiteral(record.supports.musicIteration)},\n` +
    `\t\tSupportsTTSV2V: ${boolLiteral(record.supports.ttsV2V)},\n` +
    `\t\tSupportsTTST2V: ${boolLiteral(record.supports.ttsT2V)},\n` +
    `\t},`;
}

async function loadSourceProviders() {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.source.yaml'))
    .map((entry) => path.join(sourceDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const out = [];
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const doc = YAML.parse(raw) || {};
    const providerID = normalizeProvider(doc?.provider || path.basename(file, '.source.yaml'));
    if (!providerID) {
      throw new Error(`provider is required: ${file}`);
    }
    const runtimeMetadata = readRuntimeMetadata(doc, providerID);

    out.push({
      id: providerID,
      runtimePlane: runtimeMetadata.runtimePlane,
      managedConnectorSupported: runtimeMetadata.managedConnectorSupported,
      inlineSupported: runtimeMetadata.inlineSupported,
      defaultEndpoint: runtimeMetadata.defaultEndpoint,
      defaultTextModel: runtimeMetadata.defaultTextModel,
      requiresExplicitEndpoint: runtimeMetadata.requiresExplicitEndpoint,
      supports: capabilityFlags(doc),
      capabilities: collectProviderCapabilities(doc),
    });
  }

  return out;
}

function endpointRequirementFor(record) {
  if (record.runtimePlane === 'local') {
    return 'empty_string_only';
  }
  return record.requiresExplicitEndpoint ? 'explicit_required' : 'default_or_explicit';
}

function providerCatalogTableDoc(records) {
  const providers = records
    .filter((record) => record.runtimePlane === 'remote')
    .sort((a, b) => compareProviderID(a.id, b.id))
    .map((record) => ({
      provider: record.id,
      default_endpoint: record.defaultEndpoint || null,
      default_text_model: record.defaultTextModel || null,
      requires_explicit_endpoint: Boolean(record.requiresExplicitEndpoint),
      source_rule: 'K-MCAT-027',
    }));
  return { version: 1, providers };
}

function providerCapabilitiesTableDoc(records) {
  const providers = records
    .slice()
    .sort((a, b) => compareProviderID(a.id, b.id))
    .map((record) => ({
      provider: record.id,
      runtime_plane: record.runtimePlane,
      execution_module: record.runtimePlane === 'local' ? 'local-model' : 'nimillm',
      managed_connector_supported: Boolean(record.managedConnectorSupported),
      inline_supported: Boolean(record.inlineSupported),
      endpoint_requirement: endpointRequirementFor(record),
      capabilities: Array.isArray(record.capabilities) ? record.capabilities : [],
      sources: record.runtimePlane === 'local'
        ? ['K-MCAT-027', 'K-LOCAL-001', 'K-LOCAL-002']
        : ['K-MCAT-027', 'K-CONN-008', 'K-KEYSRC-001'],
    }));
  return { version: 1, providers };
}

function renderGoFile(records) {
  const providerRecords = records
    .slice()
    .sort((a, b) => compareProviderID(a.id, b.id))
    .map((record) => renderProviderRecord(record))
    .join('\n');

  const sourceProviders = records
    .filter((record) => !record.supplemental)
    .map((record) => record.id)
    .sort(compareProviderID);

  const remoteProviders = records
    .filter((record) => record.runtimePlane === 'remote')
    .map((record) => record.id)
    .sort(compareProviderID);

  const allProviders = records.map((record) => record.id).sort(compareProviderID);

  const sourceProvidersLiteral = sourceProviders.map((id) => `\t${goString(id)},`).join('\n');
  const remoteProvidersLiteral = remoteProviders.map((id) => `\t${goString(id)},`).join('\n');
  const allProvidersLiteral = allProviders.map((id) => `\t${goString(id)},`).join('\n');

  return `// Code generated by scripts/generate-runtime-provider-registry.mjs. DO NOT EDIT.\n\npackage providerregistry\n\n// ProviderRecord captures runtime routing and capability metadata for one provider.\ntype ProviderRecord struct {\n\tID string\n\tRuntimePlane string\n\tManagedConnectorSupported bool\n\tInlineSupported bool\n\tDefaultEndpoint string\n\tDefaultTextModel string\n\tRequiresExplicitEndpoint bool\n\tSupportsText bool\n\tSupportsEmbed bool\n\tSupportsImage bool\n\tSupportsVideo bool\n\tSupportsTTS bool\n\tSupportsSTT bool\n\tSupportsMusic bool\n\tSupportsMusicIteration bool\n\tSupportsTTSV2V bool\n\tSupportsTTST2V bool\n}\n\nvar AllProviders = []string{\n${allProvidersLiteral}\n}\n\nvar SourceProviders = []string{\n${sourceProvidersLiteral}\n}\n\nvar RemoteProviders = []string{\n${remoteProvidersLiteral}\n}\n\nvar Records = map[string]ProviderRecord{\n${providerRecords}\n}\n`;
}

function renderSDKFile(records) {
  const remoteProviders = records
    .filter((record) => record.runtimePlane === 'remote')
    .map((record) => record.id)
    .sort(compareProviderID);

  return `// Code generated by scripts/generate-runtime-provider-registry.mjs. DO NOT EDIT.\n\n` +
    `export const REMOTE_PROVIDER_IDS = ${JSON.stringify(remoteProviders, null, 2)} as const;\n`;
}

async function main() {
  const sourceProviders = await loadSourceProviders();

  const recordsByID = new Map();
  for (const record of sourceProviders) {
    recordsByID.set(record.id, record);
  }

  for (const supplemental of supplementalProviders) {
    recordsByID.set(supplemental.id, {
      ...supplemental,
      supplemental: true,
    });
  }

  const records = [...recordsByID.values()].sort((a, b) => compareProviderID(a.id, b.id));
  const rendered = renderGoFile(records);
  const sdkRendered = renderSDKFile(records);
  await fs.mkdir(path.dirname(generatedPath), { recursive: true });
  await fs.mkdir(path.dirname(sdkGeneratedPath), { recursive: true });
  await fs.writeFile(generatedPath, rendered, 'utf8');
  await fs.writeFile(sdkGeneratedPath, sdkRendered, 'utf8');
  await fs.writeFile(
    providerCatalogTablePath,
    YAML.stringify(providerCatalogTableDoc(records), { lineWidth: 0 }),
    'utf8',
  );
  await fs.writeFile(
    providerCapabilitiesTablePath,
    YAML.stringify(providerCapabilitiesTableDoc(records), { lineWidth: 0 }),
    'utf8',
  );
  process.stdout.write(`generated provider registry: ${path.relative(repoRoot, generatedPath)} (${records.length} providers)\n`);
}

main().catch((error) => {
  process.stderr.write(`generate-runtime-provider-registry failed: ${String(error)}\n`);
  process.exit(1);
});
