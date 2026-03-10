import fs from 'node:fs';
import path from 'node:path';

import { canonicalProviderId, readYamlFile } from '../live-provider-utils.mjs';

const MODEL_CAPABILITY_ENV_SUFFIX = new Map([
  ['text.generate', 'MODEL_ID'],
  ['text.embed', 'EMBED_MODEL_ID'],
  ['image.generate', 'IMAGE_MODEL_ID'],
  ['video.generate', 'VIDEO_MODEL_ID'],
  ['audio.synthesize', 'TTS_MODEL_ID'],
  ['audio.transcribe', 'STT_MODEL_ID'],
]);

const WORKFLOW_ENV_SUFFIX = new Map([
  ['tts_v2v', { modelKey: 'VOICE_CLONE_MODEL_ID', targetKey: 'VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID' }],
  ['tts_t2v', { modelKey: 'VOICE_DESIGN_MODEL_ID', targetKey: 'VOICE_DESIGN_MODEL_ID_TARGET_MODEL_ID' }],
]);

function providerEnvToken(provider) {
  return String(provider || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function hasValue(value) {
  return String(value || '').trim() !== '';
}

function firstString(values) {
  for (const value of values || []) {
    const normalized = String(value || '').trim();
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function deriveProviderDefaults(doc) {
  const derived = {};
  const defaultCapabilities = normalizeStringArray(doc?.defaults?.capabilities)
    .map((capability) => capability.toLowerCase());
  const models = Array.isArray(doc?.models) ? doc.models : [];
  const workflowModelsByID = new Map();

  for (const model of models) {
    const modelID = String(model?.model_id || '').trim();
    if (!modelID) {
      continue;
    }
    const capabilities = normalizeStringArray(model?.capabilities)
      .map((capability) => capability.toLowerCase());
    const effectiveCapabilities = capabilities.length > 0 ? capabilities : defaultCapabilities;
    for (const capability of effectiveCapabilities) {
      const envSuffix = MODEL_CAPABILITY_ENV_SUFFIX.get(capability);
      if (envSuffix && !derived[envSuffix]) {
        derived[envSuffix] = modelID;
      }
    }
  }

  const workflows = Array.isArray(doc?.voice_workflow_models) ? doc.voice_workflow_models : [];
  for (const workflow of workflows) {
    const workflowModelID = String(workflow?.workflow_model_id || '').trim();
    if (workflowModelID) {
      workflowModelsByID.set(workflowModelID, workflow);
    }
  }

  const workflowBindings = Array.isArray(doc?.model_workflow_bindings)
    ? doc.model_workflow_bindings
    : [];
  for (const binding of workflowBindings) {
    const boundModelID = String(binding?.model_id || '').trim();
    if (!boundModelID) {
      continue;
    }
    const workflowTypes = normalizeStringArray(binding?.workflow_types)
      .map((workflowType) => workflowType.toLowerCase());
    const workflowRefs = normalizeStringArray(binding?.workflow_model_refs);
    for (const workflowType of workflowTypes) {
      const mapping = WORKFLOW_ENV_SUFFIX.get(workflowType);
      if (!mapping) {
        continue;
      }
      if (!derived[mapping.modelKey]) {
        derived[mapping.modelKey] = boundModelID;
      }

      if (derived[mapping.targetKey]) {
        continue;
      }
      const matchedWorkflow = workflowRefs
        .map((workflowRef) => workflowModelsByID.get(workflowRef))
        .find((workflow) => String(workflow?.workflow_type || '').trim().toLowerCase() === workflowType);
      const targetModelID = firstString(matchedWorkflow?.target_model_refs);
      derived[mapping.targetKey] = targetModelID || boundModelID;
    }
  }

  for (const workflow of workflows) {
    const workflowType = String(workflow?.workflow_type || '').trim().toLowerCase();
    const mapping = WORKFLOW_ENV_SUFFIX.get(workflowType);
    if (!mapping) {
      continue;
    }

    const targetModelID = firstString(workflow?.target_model_refs);
    if (targetModelID && !derived[mapping.targetKey]) {
      derived[mapping.targetKey] = targetModelID;
    }
  }

  if (!derived.VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID && derived.TTS_MODEL_ID) {
    derived.VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID = derived.TTS_MODEL_ID;
  }
  if (!derived.VOICE_DESIGN_MODEL_ID_TARGET_MODEL_ID && derived.TTS_MODEL_ID) {
    derived.VOICE_DESIGN_MODEL_ID_TARGET_MODEL_ID = derived.TTS_MODEL_ID;
  }

  return derived;
}

export function synthesizeLiveProviderEnvDefaults({ repoRoot, env = process.env } = {}) {
  const derivedEnv = {};
  const derivedProviders = [];
  const providerSourceDir = path.join(repoRoot, 'runtime', 'catalog', 'source', 'providers');

  if (!fs.existsSync(providerSourceDir)) {
    return { env: derivedEnv, providers: derivedProviders };
  }

  const files = fs.readdirSync(providerSourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.source.yaml'))
    .map((entry) => path.join(providerSourceDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  for (const filePath of files) {
    const doc = readYamlFile(filePath);
    const provider = canonicalProviderId(
      doc?.provider || path.basename(filePath, '.source.yaml'),
    );
    if (!provider) {
      continue;
    }

    const token = providerEnvToken(provider);
    const apiKeyEnv = `NIMI_LIVE_${token}_API_KEY`;
    if (!hasValue(env[apiKeyEnv])) {
      continue;
    }

    let added = false;
    const defaultEndpoint = String(doc?.runtime?.default_endpoint || '').trim();
    const baseURLEnv = `NIMI_LIVE_${token}_BASE_URL`;
    if (defaultEndpoint && !hasValue(env[baseURLEnv])) {
      derivedEnv[baseURLEnv] = defaultEndpoint;
      added = true;
    }

    const providerDefaults = deriveProviderDefaults(doc);
    for (const [suffix, value] of Object.entries(providerDefaults)) {
      const envKey = `NIMI_LIVE_${token}_${suffix}`;
      if (!hasValue(value) || hasValue(env[envKey])) {
        continue;
      }
      derivedEnv[envKey] = value;
      added = true;
    }

    if (added) {
      derivedProviders.push(provider);
    }
  }

  return {
    env: derivedEnv,
    providers: derivedProviders.sort((left, right) => left.localeCompare(right)),
  };
}
