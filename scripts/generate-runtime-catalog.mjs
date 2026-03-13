#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const args = new Set(process.argv.slice(2));
const checkMode = args.has('--check');
const sourceDir = path.join(
  repoRoot,
  'runtime',
  'catalog',
  'source',
  'providers',
);
const scopeLabel = 'active';
const generateCommand = 'pnpm generate:runtime-catalog';
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

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeID(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const trimmed = normalizeString(entry);
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function normalizeYAML(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  return `${trimmed}\n`;
}

function fileExists(filePath) {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

function ensureVoiceSetID(provider, value) {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return '';
  }
  if (trimmed.includes(':')) {
    return trimmed;
  }
  return `${provider}:${trimmed}`;
}

function defaultCatalogSource(sourceList) {
  const first = Array.isArray(sourceList) ? sourceList[0] : null;
  if (!first) {
    throw new Error('sources must include at least one entry');
  }
  const url = normalizeString(first.url);
  const retrievedAt = normalizeString(first.retrieved_at);
  const note = normalizeString(first.note);
  if (!url || !retrievedAt) {
    throw new Error('sources entries must include url and retrieved_at');
  }
  return { url, retrieved_at: retrievedAt, note };
}

function buildSourceIndex(sourceList) {
  const out = new Map();
  for (const entry of Array.isArray(sourceList) ? sourceList : []) {
    const sourceID = normalizeString(entry?.source_id);
    if (!sourceID) {
      continue;
    }
    const url = normalizeString(entry?.url);
    const retrievedAt = normalizeString(entry?.retrieved_at);
    const note = normalizeString(entry?.note);
    if (!url || !retrievedAt) {
      throw new Error(`source ${sourceID} must include url and retrieved_at`);
    }
    out.set(sourceID, { url, retrieved_at: retrievedAt, note });
  }
  return out;
}

function resolveSourceRef(sourceIDs, sourceIndex, fallback) {
  for (const sourceID of normalizeStringArray(sourceIDs)) {
    const resolved = sourceIndex.get(sourceID);
    if (resolved) {
      return { ...resolved };
    }
  }
  return { ...fallback };
}

function buildLanguageProfiles(languageProfiles) {
  const out = new Map();
  if (!languageProfiles || typeof languageProfiles !== 'object') {
    return out;
  }
  for (const [name, values] of Object.entries(languageProfiles)) {
    const key = normalizeString(name);
    if (!key) {
      continue;
    }
    out.set(key, normalizeStringArray(values));
  }
  return out;
}

function resolveLangs(entry, profiles, fallback = []) {
  const direct = normalizeStringArray(entry?.langs);
  if (direct.length > 0) {
    return direct;
  }
  const langsRef = normalizeString(entry?.langs_ref);
  if (langsRef) {
    const mapped = profiles.get(langsRef) || [];
    if (mapped.length > 0) {
      return [...mapped];
    }
  }
  if (fallback.length > 0) {
    return normalizeStringArray(fallback);
  }
  for (const values of profiles.values()) {
    if (values.length > 0) {
      return [...values];
    }
  }
  return [];
}

function resolveUpdatedAt(entryModelID, modelUpdatedAt) {
  const matched = /(\d{4}-\d{2}-\d{2})$/.exec(normalizeString(entryModelID));
  if (matched) {
    return matched[1];
  }
  const direct = normalizeString(modelUpdatedAt);
  if (direct) {
    return direct;
  }
  return 'unknown';
}

function resolveCapabilities(defaultCaps, overrideCaps) {
  const merged = normalizeStringArray([...(defaultCaps || []), ...(overrideCaps || [])]);
  if (merged.length === 0) {
    throw new Error('capabilities must not be empty');
  }
  for (const capability of merged) {
    if (!canonicalModelCapabilities.has(capability.toLowerCase())) {
      throw new Error(`capabilities must use canonical capability tokens only, got: ${capability}`);
    }
  }
  return merged;
}

function resolvePricing(defaultPricing, overridePricing) {
  const source = {
    ...(defaultPricing && typeof defaultPricing === 'object' ? defaultPricing : {}),
    ...(overridePricing && typeof overridePricing === 'object' ? overridePricing : {}),
  };
  const unit = normalizeString(source.unit);
  const input = normalizeString(source.input);
  const output = normalizeString(source.output);
  const currency = normalizeString(source.currency);
  const asOf = normalizeString(source.as_of);
  const notes = normalizeString(source.notes);
  if (!unit || !input || !output || !currency || !asOf || !notes) {
    throw new Error('pricing must include unit/input/output/currency/as_of/notes');
  }
  return {
    unit,
    input,
    output,
    currency,
    as_of: asOf,
    notes,
  };
}

function makeDynamicVoiceSetID(modelID) {
  const base = normalizeID(modelID).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'model'}-dynamic`;
}

function ensureUnderRepoRoot(absPath) {
  const rel = path.relative(repoRoot, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`generated_target must stay under repository root: ${absPath}`);
  }
}

function parseVoiceDefinition(rawVoice, setLangs) {
  if (typeof rawVoice === 'string') {
    const voiceID = normalizeString(rawVoice);
    if (!voiceID) {
      throw new Error('voice string entry must not be empty');
    }
    return {
      voiceID,
      name: voiceID,
      langs: setLangs,
      sourceIDs: [],
      modelIDs: [],
    };
  }
  if (!rawVoice || typeof rawVoice !== 'object') {
    throw new Error('voice entry must be string or object');
  }

  const voiceID = normalizeString(rawVoice.voice_id || rawVoice.name);
  if (!voiceID) {
    throw new Error('voice object entry must include voice_id or name');
  }
  const name = normalizeString(rawVoice.name || voiceID);
  return {
    voiceID,
    name,
    langs: null,
    sourceIDs: normalizeStringArray(rawVoice.source_ids),
    modelIDs: normalizeStringArray(rawVoice.model_ids),
    raw: rawVoice,
  };
}

function modelRequiresVoiceSupport(capabilities, discoveryMode, voiceSetRef) {
  const capabilityRequiresVoice = capabilities.some((capability) => {
    const normalized = normalizeString(capability).toLowerCase();
    return normalized === 'audio.synthesize';
  });
  return capabilityRequiresVoice || normalizeString(discoveryMode) !== '' || normalizeString(voiceSetRef) !== '';
}

function normalizeRoleList(value) {
  return normalizeStringArray(value).map((item) => item.toLowerCase());
}

function normalizeInputRoles(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const out = {};
  for (const [mode, roles] of Object.entries(value)) {
    const normalizedMode = normalizeString(mode);
    if (!normalizedMode) {
      continue;
    }
    out[normalizedMode] = normalizeRoleList(roles);
  }
  return out;
}

function normalizeVideoGeneration(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const modes = normalizeStringArray(raw.modes).map((mode) => mode.toLowerCase());
  if (modes.length === 0) {
    throw new Error('video_generation.modes must not be empty');
  }
  const allowedModes = new Set(['t2v', 'i2v_first_frame', 'i2v_first_last', 'i2v_reference']);
  for (const mode of modes) {
    if (!allowedModes.has(mode)) {
      throw new Error(`video_generation.modes contains unsupported mode: ${mode}`);
    }
  }

  const inputRoles = normalizeInputRoles(raw.input_roles);
  if (Object.keys(inputRoles).length === 0) {
    throw new Error('video_generation.input_roles must not be empty');
  }
  const limits = raw.limits && typeof raw.limits === 'object' ? raw.limits : {};
  if (Object.keys(limits).length === 0) {
    throw new Error('video_generation.limits must not be empty');
  }
  const options = raw.options && typeof raw.options === 'object' ? raw.options : {};
  if (Object.keys(options).length === 0) {
    throw new Error('video_generation.options must not be empty');
  }
  const outputs = raw.outputs && typeof raw.outputs === 'object' ? raw.outputs : {};
  if (Object.keys(outputs).length === 0) {
    throw new Error('video_generation.outputs must not be empty');
  }

  return {
    modes,
    input_roles: inputRoles,
    limits,
    options,
    outputs,
  };
}

function normalizeWorkflowType(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized === 'tts_v2v' || normalized === 'tts_t2v') {
    return normalized;
  }
  throw new Error(`voice workflow type must be tts_v2v or tts_t2v, got: ${normalized}`);
}

function generateProviderCatalog(doc) {
  const provider = normalizeProvider(doc?.provider);
  if (!provider) {
    throw new Error('provider is required');
  }
  const schemaVersion = Number(doc?.schema_version);
  if (schemaVersion !== 3) {
    throw new Error(`unsupported schema_version for ${provider}: ${doc?.schema_version}`);
  }

  const defaults = doc?.defaults && typeof doc.defaults === 'object' ? doc.defaults : {};
  const defaultTextModel = normalizeString(defaults.default_text_model);
  const defaultModelType = normalizeString(defaults.model_type) || 'tts';
  const defaultCapabilities = normalizeStringArray(defaults.capabilities);
  const defaultPricing = defaults.pricing || {};
  const catalogVersion = normalizeString(doc?.catalog_version);
  if (!catalogVersion) {
    throw new Error(`${provider} source is missing catalog_version`);
  }

  const sourceIndex = buildSourceIndex(doc?.sources);
  const fallbackSourceRef = defaultCatalogSource(doc?.sources);
  const languageProfiles = buildLanguageProfiles(doc?.language_profiles);

  const voiceSets = new Map();
  for (const voiceSet of Array.isArray(doc?.voice_sets) ? doc.voice_sets : []) {
    const voiceSetID = normalizeString(voiceSet?.voice_set_id);
    if (!voiceSetID) {
      continue;
    }
    voiceSets.set(voiceSetID, voiceSet);
  }

  const modelsOut = [];
  const voicesOut = [];
  const modelIDsSeen = new Set();
  const modelToVoiceCount = new Map();
  const staticSetToModels = new Map();
  const dynamicSetAggregates = new Map();

  for (const model of Array.isArray(doc?.models) ? doc.models : []) {
    const canonicalModelID = normalizeString(model?.model_id);
    if (!canonicalModelID) {
      throw new Error(`${provider} model entry missing model_id`);
    }
    const aliases = normalizeStringArray(model?.aliases);
    const expandedModelIDs = normalizeStringArray([canonicalModelID, ...aliases]);

    const modelType = normalizeString(model?.model_type) || defaultModelType;
    const capabilities = resolveCapabilities(defaultCapabilities, model?.capabilities);
    const pricing = resolvePricing(defaultPricing, model?.pricing);

    const voiceConfig = model?.voice && typeof model.voice === 'object' ? model.voice : {};
    const discoveryMode = normalizeString(voiceConfig.discovery_mode || model?.voice_discovery_mode);
    const supportsVoiceRefKinds = normalizeStringArray(voiceConfig.supports_voice_ref_kinds || model?.supports_voice_ref_kinds);
    const voiceLangsRef = normalizeString(voiceConfig.langs_ref || model?.langs_ref);
    const staticVoiceSetRef = normalizeString(voiceConfig.voice_set_ref || model?.preset_voice_set_ref || model?.voice_set_id);
    const allowedDiscoveryModes = new Set(['static_catalog', 'dynamic_user_scoped']);
    if (discoveryMode && !allowedDiscoveryModes.has(discoveryMode)) {
      throw new Error(`${provider} model ${canonicalModelID} has unsupported voice discovery_mode: ${discoveryMode}`);
    }

    const requiresVoice = modelRequiresVoiceSupport(capabilities, discoveryMode, staticVoiceSetRef);
    let resolvedVoiceSetID = '';
    let dynamicVoiceSet = false;
    let dynamicVoiceSetMode = '';
    if (requiresVoice) {
      if (!discoveryMode && !staticVoiceSetRef) {
        throw new Error(`${provider} model ${canonicalModelID} requires voice.discovery_mode or voice.voice_set_ref`);
      }
      if (discoveryMode === 'static_catalog' || staticVoiceSetRef) {
        if (!staticVoiceSetRef) {
          throw new Error(`${provider} model ${canonicalModelID} requires voice.voice_set_ref`);
        }
        if (discoveryMode && discoveryMode !== 'static_catalog') {
          throw new Error(`${provider} model ${canonicalModelID} uses discovery_mode=${discoveryMode} with static voice_set_ref`);
        }
        if (!voiceSets.has(staticVoiceSetRef)) {
          throw new Error(`${provider} model ${canonicalModelID} references unknown voice_set ${staticVoiceSetRef}`);
        }
        resolvedVoiceSetID = ensureVoiceSetID(provider, staticVoiceSetRef);
      } else {
        dynamicVoiceSet = true;
        dynamicVoiceSetMode = discoveryMode || 'dynamic_user_scoped';
        const dynamicVoiceSetRef = normalizeString(voiceConfig.dynamic_voice_set_ref || model?.dynamic_voice_set_ref)
          || makeDynamicVoiceSetID(canonicalModelID);
        resolvedVoiceSetID = ensureVoiceSetID(provider, dynamicVoiceSetRef);
      }
    }

    const setDef = staticVoiceSetRef ? voiceSets.get(staticVoiceSetRef) : null;
    const modelSourceIDs = normalizeStringArray([
      ...normalizeStringArray(model?.source_ids),
      ...normalizeStringArray(setDef?.source_ids),
    ]);

    const modelLangs = resolveLangs({ ...model, langs_ref: voiceLangsRef || model?.langs_ref }, languageProfiles, []);
    const modelSourceRef = resolveSourceRef(modelSourceIDs, sourceIndex, fallbackSourceRef);

    const videoGeneration = normalizeVideoGeneration(model?.video_generation);

    for (const entryModelID of expandedModelIDs) {
      const normalizedKey = entryModelID.toLowerCase();
      if (modelIDsSeen.has(normalizedKey)) {
        throw new Error(`${provider} duplicate model id after alias expansion: ${entryModelID}`);
      }
      modelIDsSeen.add(normalizedKey);

      const modelEntry = {
        model_id: entryModelID,
        provider,
        model_type: modelType,
        updated_at: resolveUpdatedAt(entryModelID, model?.updated_at),
        capabilities: [...capabilities],
        pricing: { ...pricing },
        source_ref: { ...modelSourceRef },
      };
      if (resolvedVoiceSetID) {
        modelEntry.voice_set_id = resolvedVoiceSetID;
        modelEntry.voice_discovery_mode = dynamicVoiceSet ? dynamicVoiceSetMode : 'static_catalog';
      }
      if (videoGeneration) {
        modelEntry.video_generation = videoGeneration;
      }
      if (supportsVoiceRefKinds.length > 0) {
        modelEntry.voice_ref_kinds = supportsVoiceRefKinds;
      }

      modelsOut.push(modelEntry);

      if (resolvedVoiceSetID && !dynamicVoiceSet) {
        const current = staticSetToModels.get(resolvedVoiceSetID) || [];
        current.push(entryModelID);
        staticSetToModels.set(resolvedVoiceSetID, current);
      }
      if (resolvedVoiceSetID && dynamicVoiceSet) {
        const aggregate = dynamicSetAggregates.get(resolvedVoiceSetID) || {
          modelIDs: [],
          langs: [],
          sourceIDs: [],
          discoveryMode: dynamicVoiceSetMode,
        };
        if (aggregate.discoveryMode && aggregate.discoveryMode !== dynamicVoiceSetMode) {
          throw new Error(`${provider} dynamic set ${resolvedVoiceSetID} mixes discovery_mode values`);
        }
        aggregate.discoveryMode = dynamicVoiceSetMode;
        aggregate.modelIDs = normalizeStringArray([...aggregate.modelIDs, entryModelID]);
        aggregate.langs = normalizeStringArray([...aggregate.langs, ...modelLangs]);
        aggregate.sourceIDs = normalizeStringArray([...aggregate.sourceIDs, ...modelSourceIDs]);
        dynamicSetAggregates.set(resolvedVoiceSetID, aggregate);
      }
    }
  }

  for (const [setID, modelIDs] of staticSetToModels.entries()) {
    const shortSetID = setID.includes(':') ? setID.slice(setID.indexOf(':') + 1) : setID;
    const setDef = voiceSets.get(shortSetID);
    if (!setDef) {
      throw new Error(`${provider} static set ${setID} not found in voice_sets`);
    }
    const setLangs = resolveLangs(setDef, languageProfiles, []);
    const setSourceIDs = normalizeStringArray(setDef?.source_ids);

    const voices = Array.isArray(setDef?.voices) ? setDef.voices : [];
    if (voices.length === 0) {
      throw new Error(`${provider} static set ${setID} has no voices`);
    }

    for (const rawVoice of voices) {
      const parsed = parseVoiceDefinition(rawVoice, setLangs);
      const voiceLangs = parsed.langs || resolveLangs(parsed.raw, languageProfiles, setLangs);
      if (voiceLangs.length === 0) {
        throw new Error(`${provider} voice ${parsed.voiceID} in ${setID} has no langs`);
      }

      let voiceModelIDs = modelIDs;
      if (parsed.modelIDs.length > 0) {
        const modelLookup = new Map(modelIDs.map((id) => [id.toLowerCase(), id]));
        voiceModelIDs = [];
        for (const requestedModelID of parsed.modelIDs) {
          const mapped = modelLookup.get(requestedModelID.toLowerCase());
          if (!mapped) {
            throw new Error(`${provider} voice ${parsed.voiceID} references model ${requestedModelID} outside set ${setID}`);
          }
          voiceModelIDs.push(mapped);
        }
      }
      voiceModelIDs = normalizeStringArray(voiceModelIDs);
      if (voiceModelIDs.length === 0) {
        throw new Error(`${provider} voice ${parsed.voiceID} in ${setID} has empty model_ids`);
      }

      for (const modelID of voiceModelIDs) {
        modelToVoiceCount.set(modelID.toLowerCase(), (modelToVoiceCount.get(modelID.toLowerCase()) || 0) + 1);
      }

      voicesOut.push({
        voice_id: parsed.voiceID,
        voice_set_id: setID,
        provider,
        name: parsed.name,
        langs: [...voiceLangs],
        model_ids: [...voiceModelIDs],
        source_ref: resolveSourceRef([...parsed.sourceIDs, ...setSourceIDs], sourceIndex, fallbackSourceRef),
      });
    }
  }

  for (const [setID, aggregate] of dynamicSetAggregates.entries()) {
    const langs = normalizeStringArray(aggregate.langs);
    if (langs.length === 0) {
      throw new Error(`${provider} dynamic set ${setID} has empty langs`);
    }
    const modelIDs = normalizeStringArray(aggregate.modelIDs);
    if (modelIDs.length === 0) {
      throw new Error(`${provider} dynamic set ${setID} has empty model_ids`);
    }

    for (const modelID of modelIDs) {
      modelToVoiceCount.set(modelID.toLowerCase(), (modelToVoiceCount.get(modelID.toLowerCase()) || 0) + 1);
    }

    voicesOut.push({
      voice_id: 'user-custom',
      voice_set_id: setID,
      provider,
      name: 'User Custom Voice',
      langs: [...langs],
      model_ids: [...modelIDs],
      source_ref: resolveSourceRef(aggregate.sourceIDs, sourceIndex, fallbackSourceRef),
    });
  }

  for (const model of modelsOut) {
    const capabilities = normalizeStringArray(model.capabilities);
    const requiresVoice = capabilities.some((capability) => normalizeString(capability).toLowerCase() === 'audio.synthesize');
    if (!requiresVoice) {
      continue;
    }
    const key = normalizeID(model.model_id);
    if ((modelToVoiceCount.get(key) || 0) === 0) {
      throw new Error(`${provider} model ${model.model_id} has no generated voice mapping`);
    }
  }

  const workflowModelTypeByID = new Map();
  const workflowModelsOut = [];
  for (const workflowModel of Array.isArray(doc?.voice_workflow_models) ? doc.voice_workflow_models : []) {
    const workflowModelID = normalizeString(workflowModel?.workflow_model_id);
    if (!workflowModelID) {
      throw new Error(`${provider} voice_workflow_models entry missing workflow_model_id`);
    }
    const workflowType = normalizeWorkflowType(workflowModel?.workflow_type);
    if (!workflowType) {
      throw new Error(`${provider} workflow model ${workflowModelID} missing workflow_type`);
    }
    const workflowKey = workflowModelID.toLowerCase();
    if (workflowModelTypeByID.has(workflowKey)) {
      throw new Error(`${provider} duplicate workflow_model_id: ${workflowModelID}`);
    }

    const targetModelRefs = normalizeStringArray(workflowModel?.target_model_refs);
    if (targetModelRefs.length === 0) {
      throw new Error(`${provider} workflow model ${workflowModelID} must include target_model_refs`);
    }
    for (const modelID of targetModelRefs) {
      if (!modelIDsSeen.has(modelID.toLowerCase())) {
        throw new Error(`${provider} workflow model ${workflowModelID} references unknown target model ${modelID}`);
      }
    }

    const inputContractRef = normalizeString(workflowModel?.input_contract_ref);
    const outputPersistence = normalizeString(workflowModel?.output_persistence);
    const langs = resolveLangs(workflowModel, languageProfiles, []);
    const sourceRef = resolveSourceRef(workflowModel?.source_ids, sourceIndex, fallbackSourceRef);

    const entry = {
      workflow_model_id: workflowModelID,
      workflow_type: workflowType,
      input_contract_ref: inputContractRef,
      output_persistence: outputPersistence,
      target_model_refs: targetModelRefs,
      source_ref: sourceRef,
    };
    if (langs.length > 0) {
      entry.langs = langs;
    }
    workflowModelsOut.push(entry);
    workflowModelTypeByID.set(workflowKey, workflowType);
  }

  const modelWorkflowBindingsOut = [];
  for (const binding of Array.isArray(doc?.model_workflow_bindings) ? doc.model_workflow_bindings : []) {
    const modelID = normalizeString(binding?.model_id);
    if (!modelID) {
      throw new Error(`${provider} model_workflow_bindings entry missing model_id`);
    }
    if (!modelIDsSeen.has(modelID.toLowerCase())) {
      throw new Error(`${provider} model_workflow_bindings references unknown model ${modelID}`);
    }

    const workflowModelRefs = normalizeStringArray(binding?.workflow_model_refs);
    if (workflowModelRefs.length === 0) {
      throw new Error(`${provider} model_workflow_bindings for ${modelID} must include workflow_model_refs`);
    }

    const inferredTypes = [];
    for (const workflowRef of workflowModelRefs) {
      const workflowType = workflowModelTypeByID.get(workflowRef.toLowerCase());
      if (!workflowType) {
        throw new Error(`${provider} model_workflow_bindings for ${modelID} references unknown workflow model ${workflowRef}`);
      }
      inferredTypes.push(workflowType);
    }

    const declaredWorkflowTypes = normalizeStringArray(binding?.workflow_types).map((value) => normalizeWorkflowType(value));
    const workflowTypes = declaredWorkflowTypes.length > 0
      ? normalizeStringArray(declaredWorkflowTypes)
      : normalizeStringArray(inferredTypes);
    if (workflowTypes.length === 0) {
      throw new Error(`${provider} model_workflow_bindings for ${modelID} has empty workflow_types`);
    }
    for (const workflowType of workflowTypes) {
      if (!inferredTypes.includes(workflowType)) {
        throw new Error(`${provider} model_workflow_bindings for ${modelID} declares workflow_type ${workflowType} not covered by workflow_model_refs`);
      }
    }

    modelWorkflowBindingsOut.push({
      model_id: modelID,
      workflow_model_refs: workflowModelRefs,
      workflow_types: workflowTypes,
    });
  }

  const result = {
    version: 1,
    provider,
    catalog_version: catalogVersion,
    default_text_model: defaultTextModel || undefined,
    models: modelsOut,
    voices: voicesOut,
  };
  if (workflowModelsOut.length > 0) {
    result.voice_workflow_models = workflowModelsOut;
  }
  if (modelWorkflowBindingsOut.length > 0) {
    result.model_workflow_bindings = modelWorkflowBindingsOut;
  }
  return result;
}

async function loadSourceFiles() {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.source\.ya?ml$/iu.test(entry.name))
    .map((entry) => path.join(sourceDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    throw new Error(`no source files found in ${sourceDir}`);
  }
  return files;
}

async function generateOne(sourcePath) {
  const raw = await fs.readFile(sourcePath, 'utf8');
  const doc = YAML.parse(raw);
  if (!doc || typeof doc !== 'object') {
    throw new Error(`invalid YAML object: ${path.relative(repoRoot, sourcePath)}`);
  }
  const generatedTarget = normalizeString(doc.generated_target);
  if (!generatedTarget) {
    throw new Error(`${path.relative(repoRoot, sourcePath)} missing generated_target`);
  }

  const outputDoc = generateProviderCatalog(doc);
  const rendered = normalizeYAML(YAML.stringify(outputDoc, { lineWidth: 0 }));
  const outputPath = path.resolve(repoRoot, generatedTarget);
  ensureUnderRepoRoot(outputPath);

  if (checkMode) {
    if (!(await fileExists(outputPath))) {
      throw new Error(`runtime catalog file missing: ${path.relative(repoRoot, outputPath)}\nrun \`${generateCommand}\` to regenerate.`);
    }
    const current = normalizeYAML(await fs.readFile(outputPath, 'utf8'));
    if (current !== rendered) {
      throw new Error(`runtime catalog drift detected: ${path.relative(repoRoot, outputPath)}\nrun \`${generateCommand}\` to regenerate.`);
    }
    return {
      provider: outputDoc.provider,
      outputPath,
      modelCount: outputDoc.models.length,
      voiceCount: outputDoc.voices.length,
      changed: false,
    };
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, rendered, 'utf8');
  return {
    provider: outputDoc.provider,
    outputPath,
    modelCount: outputDoc.models.length,
    voiceCount: outputDoc.voices.length,
    changed: true,
  };
}

async function main() {
  const sourceFiles = await loadSourceFiles();
  const results = [];
  for (const sourcePath of sourceFiles) {
    results.push(await generateOne(sourcePath));
  }

  if (checkMode) {
    process.stdout.write(`runtime catalog ${scopeLabel} source snapshots are up-to-date (${results.length} providers)\n`);
    return;
  }
  for (const result of results) {
    process.stdout.write(
      `generated runtime catalog ${scopeLabel}: ${result.provider} models=${result.modelCount} voices=${result.voiceCount} -> ${path.relative(repoRoot, result.outputPath)}\n`,
    );
  }
}

main().catch((error) => {
  process.stderr.write(`generate-runtime-catalog failed: ${String(error)}\n`);
  process.exitCode = 1;
});
