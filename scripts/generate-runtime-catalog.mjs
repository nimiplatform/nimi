#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { listProviderSourceDocs } from './lib/provider-source.mjs';
import {
  buildLanguageProfiles,
  buildSourceIndex,
  defaultCatalogSource,
  ensureVoiceSetID,
  fileExists,
  makeDynamicVoiceSetID,
  modelRequiresVoiceSupport,
  normalizeDynamicInventory,
  normalizeImageRequestOptions,
  normalizeID,
  normalizeInventoryMode,
  normalizeProvider,
  normalizeSelectionProfiles,
  normalizeString,
  normalizeStringArray,
  normalizeYAML,
  normalizeTranscriptionOptions,
  normalizeVideoGeneration,
  normalizeVoiceRequestOptions,
  normalizeVoiceWorkflowRequestOptions,
  normalizeWorkflowType,
  normalizeEmbeddingCapability,
  normalizeLocalPlaneRow,
  normalizePresets,
  parseVoiceDefinition,
  resolveCapabilities,
  resolveLangs,
  resolvePricing,
  resolveSourceRef,
  resolveUpdatedAt,
  selectionProfileModelID,
} from './lib/runtime-catalog-normalizers.mjs';

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

function ensureUnderRepoRoot(absPath) {
  const rel = path.relative(repoRoot, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`generated_target must stay under repository root: ${absPath}`);
  }
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
  const runtime = doc?.runtime && typeof doc.runtime === 'object' ? doc.runtime : {};
  const inventoryMode = normalizeInventoryMode(runtime.inventory_mode);
  const dynamicInventory = inventoryMode === 'dynamic_endpoint'
    ? normalizeDynamicInventory(runtime.dynamic_inventory, provider)
    : null;

  if (inventoryMode === 'dynamic_endpoint') {
    if ((Array.isArray(doc?.models) ? doc.models.length : 0) > 0) {
      throw new Error(`${provider} dynamic_endpoint providers must not declare static models`);
    }
    if ((Array.isArray(doc?.selection_profiles) ? doc.selection_profiles.length : 0) > 0) {
      throw new Error(`${provider} dynamic_endpoint providers must not declare selection_profiles`);
    }
    if (defaultTextModel) {
      throw new Error(`${provider} dynamic_endpoint providers must not declare defaults.default_text_model`);
    }
    if ((Array.isArray(doc?.voice_sets) ? doc.voice_sets.length : 0) > 0
      || (Array.isArray(doc?.voice_workflow_models) ? doc.voice_workflow_models.length : 0) > 0
      || (Array.isArray(doc?.model_workflow_bindings) ? doc.model_workflow_bindings.length : 0) > 0
      || (Array.isArray(doc?.voice_handle_policies) ? doc.voice_handle_policies.length : 0) > 0) {
      throw new Error(`${provider} dynamic_endpoint providers must not declare voice/workflow catalog rows`);
    }
  }

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

  for (const model of inventoryMode === 'static_source' && Array.isArray(doc?.models) ? doc.models : []) {
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
    const voiceRequestOptions = normalizeVoiceRequestOptions(voiceConfig.request_options, provider, canonicalModelID);
    const transcription = normalizeTranscriptionOptions(model?.transcription, provider, canonicalModelID);
    const imageRequestOptions = normalizeImageRequestOptions(model?.image_request_options, provider, canonicalModelID);
    const embedding = normalizeEmbeddingCapability(model?.embedding, provider, canonicalModelID);
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
    const localPlane = runtime.runtime_plane === 'local'
      ? normalizeLocalPlaneRow(model, canonicalModelID)
      : null;
    if (voiceRequestOptions && !requiresVoice) {
      throw new Error(`${provider} model ${canonicalModelID} declares voice.request_options without audio.synthesize support`);
    }
    if (transcription && !capabilities.map((value) => value.toLowerCase()).includes('audio.transcribe')) {
      throw new Error(`${provider} model ${canonicalModelID} declares transcription metadata without audio.transcribe support`);
    }
    if (imageRequestOptions && !capabilities.map((value) => value.toLowerCase()).includes('image.generate')) {
      throw new Error(`${provider} model ${canonicalModelID} declares image_request_options without image.generate support`);
    }
    if (capabilities.map((value) => value.toLowerCase()).includes('image.generate') && !imageRequestOptions) {
      throw new Error(`${provider} model ${canonicalModelID} missing image_request_options`);
    }
    if (embedding && !capabilities.map((value) => value.toLowerCase()).includes('text.embed')) {
      throw new Error(`${provider} model ${canonicalModelID} declares embedding metadata without text.embed support`);
    }

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
      const sourceApiModelID = normalizeString(model?.api_model_id);
      const apiModelID = sourceApiModelID || (runtime.runtime_plane === 'local' || entryModelID === canonicalModelID ? '' : canonicalModelID);
      if (apiModelID) {
        modelEntry.api_model_id = apiModelID;
      }
      if (resolvedVoiceSetID) {
        modelEntry.voice_set_id = resolvedVoiceSetID;
        modelEntry.voice_discovery_mode = dynamicVoiceSet ? dynamicVoiceSetMode : 'static_catalog';
      }
      if (voiceRequestOptions) {
        modelEntry.voice_request_options = voiceRequestOptions;
      }
      if (transcription) {
        modelEntry.transcription = transcription;
      }
      if (imageRequestOptions) {
        modelEntry.image_request_options = imageRequestOptions;
      }
      if (embedding) {
        modelEntry.embedding = embedding;
      }
      if (videoGeneration) {
        modelEntry.video_generation = videoGeneration;
      }
      if (supportsVoiceRefKinds.length > 0) {
        modelEntry.voice_ref_kinds = supportsVoiceRefKinds;
      }
      if (localPlane && entryModelID === canonicalModelID) {
        modelEntry.install = localPlane.install;
        modelEntry.variants = localPlane.variants;
        modelEntry.fitness = localPlane.fitness;
        if (localPlane.companions) {
          modelEntry.companions = localPlane.companions;
        }
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

  const modelIndex = new Map(modelsOut.map((model) => [normalizeString(model.model_id).toLowerCase(), model]));

  const localPlaneByModelID = new Map();
  const modelCapabilitiesByID = new Map();
  for (const model of modelsOut) {
    const key = normalizeString(model.model_id).toLowerCase();
    modelCapabilitiesByID.set(key, normalizeStringArray(model.capabilities));
    if (model.install && model.variants && model.fitness) {
      localPlaneByModelID.set(key, model);
    }
  }
  const presetsOut = runtime.runtime_plane === 'local'
    ? normalizePresets(doc?.presets, localPlaneByModelID, modelCapabilitiesByID)
    : undefined;

  const selectionProfilesOut = inventoryMode === 'static_source'
    ? normalizeSelectionProfiles(doc?.selection_profiles, provider, modelIndex)
    : [];
  const derivedDefaultTextModel = inventoryMode === 'static_source'
    ? selectionProfileModelID(selectionProfilesOut, 'text.general')
    : '';
  if (
    inventoryMode === 'static_source'
    && derivedDefaultTextModel
    && defaultTextModel
    && derivedDefaultTextModel.toLowerCase() !== defaultTextModel.toLowerCase()
  ) {
    throw new Error(`${provider} defaults.default_text_model must match selection_profiles[text.general]`);
  }
  const projectedDefaultTextModel = inventoryMode === 'static_source'
    ? (derivedDefaultTextModel || defaultTextModel)
    : '';

  const workflowModelTypeByID = new Map();
  const workflowModelsOut = [];
  for (const workflowModel of inventoryMode === 'static_source' && Array.isArray(doc?.voice_workflow_models) ? doc.voice_workflow_models : []) {
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
    const requestOptions = normalizeVoiceWorkflowRequestOptions(
      workflowModel?.request_options,
      provider,
      workflowModelID,
      workflowType,
    );
    const langs = resolveLangs(workflowModel, languageProfiles, []);
    const sourceRef = resolveSourceRef(workflowModel?.source_ids, sourceIndex, fallbackSourceRef);

    const entry = {
      workflow_model_id: workflowModelID,
      workflow_type: workflowType,
      input_contract_ref: inputContractRef,
      output_persistence: outputPersistence,
      request_options: requestOptions,
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
  for (const binding of inventoryMode === 'static_source' && Array.isArray(doc?.model_workflow_bindings) ? doc.model_workflow_bindings : []) {
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

  const voiceHandlePoliciesOut = [];
  for (const policy of inventoryMode === 'static_source' && Array.isArray(doc?.voice_handle_policies) ? doc.voice_handle_policies : []) {
    const policyID = normalizeString(policy?.policy_id);
    if (!policyID) {
      throw new Error(`${provider} voice_handle_policies entry missing policy_id`);
    }

    const appliesToWorkflowTypes = normalizeStringArray(policy?.applies_to_workflow_types)
      .map((value) => normalizeWorkflowType(value));
    if (appliesToWorkflowTypes.length === 0) {
      throw new Error(`${provider} voice handle policy ${policyID} must include applies_to_workflow_types`);
    }

    const persistence = normalizeString(policy?.persistence);
    if (!persistence) {
      throw new Error(`${provider} voice handle policy ${policyID} missing persistence`);
    }

    const defaultTTL = normalizeString(policy?.default_ttl);
    if (!defaultTTL) {
      throw new Error(`${provider} voice handle policy ${policyID} missing default_ttl`);
    }

    const scope = normalizeString(policy?.scope);
    if (!scope) {
      throw new Error(`${provider} voice handle policy ${policyID} missing scope`);
    }

    const deleteSemantics = normalizeString(policy?.delete_semantics);
    if (!deleteSemantics) {
      throw new Error(`${provider} voice handle policy ${policyID} missing delete_semantics`);
    }

    const entry = {
      policy_id: policyID,
      applies_to_workflow_types: appliesToWorkflowTypes,
      persistence,
      default_ttl: defaultTTL,
      scope,
      delete_semantics: deleteSemantics,
      runtime_reconciliation_required: Boolean(policy?.runtime_reconciliation_required),
      source_ref: resolveSourceRef(policy?.source_ids, sourceIndex, fallbackSourceRef),
    };
    voiceHandlePoliciesOut.push(entry);
  }

  if (workflowModelsOut.length > 0 && voiceHandlePoliciesOut.length === 0) {
    throw new Error(`${provider} voice_workflow_models require voice_handle_policies`);
  }

  if (inventoryMode === 'static_source' && modelsOut.length === 0) {
    throw new Error(`${provider} static_source providers must declare models`);
  }

  const result = {
    version: 1,
    provider,
    catalog_version: catalogVersion,
    inventory_mode: inventoryMode,
    default_text_model: projectedDefaultTextModel || undefined,
    models: modelsOut,
    voices: voicesOut,
  };
  if (dynamicInventory) {
    result.dynamic_inventory = dynamicInventory;
  }
  if (selectionProfilesOut.length > 0) {
    result.selection_profiles = selectionProfilesOut;
  }
  if (workflowModelsOut.length > 0) {
    result.voice_workflow_models = workflowModelsOut;
  }
  if (modelWorkflowBindingsOut.length > 0) {
    result.model_workflow_bindings = modelWorkflowBindingsOut;
  }
  if (voiceHandlePoliciesOut.length > 0) {
    result.voice_handle_policies = voiceHandlePoliciesOut;
  }
  if (presetsOut) {
    result.presets = presetsOut;
  }
  return result;
}

function loadSourceDocs() {
  const entries = listProviderSourceDocs(sourceDir);
  if (entries.length === 0) {
    throw new Error(`no source providers found in ${sourceDir}`);
  }
  return entries;
}

async function generateOne(sourceEntry) {
  const doc = sourceEntry.doc;
  if (!doc || typeof doc !== 'object') {
    throw new Error(`invalid YAML object: ${path.relative(repoRoot, sourceEntry.absPath)}`);
  }
  const generatedTarget = normalizeString(doc.generated_target);
  if (!generatedTarget) {
    throw new Error(`${path.relative(repoRoot, sourceEntry.absPath)} missing generated_target`);
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
  const sourceFiles = loadSourceDocs();
  const results = [];
  for (const sourceEntry of sourceFiles) {
    results.push(await generateOne(sourceEntry));
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
