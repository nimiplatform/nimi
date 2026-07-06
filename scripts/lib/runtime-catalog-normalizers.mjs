import { promises as fs } from 'node:fs';

const canonicalModelCapabilities = new Set([
  'text.generate',
  'text.generate.vision',
  'text.embed',
  'image.generate',
  'video.generate',
  'world.generate',
  'audio.synthesize',
  'audio.transcribe',
  'music.generate',
  'music.generate.iteration',
]);


export function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeString(value) {
  return String(value || '').trim();
}

export function normalizeID(value) {
  return normalizeString(value).toLowerCase();
}

export function normalizeStringArray(value) {
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

export function normalizeInventoryMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return 'static_source';
  }
  if (normalized !== 'static_source' && normalized !== 'dynamic_endpoint') {
    throw new Error(`runtime.inventory_mode must be static_source or dynamic_endpoint, got: ${value}`);
  }
  return normalized;
}

export function normalizeDynamicInventory(value, provider) {
  if (!value || typeof value !== 'object') {
    throw new Error(`${provider} runtime.dynamic_inventory is required for dynamic_endpoint providers`);
  }
  const discoveryTransport = normalizeString(value.discovery_transport);
  if (discoveryTransport !== 'connector_list_models') {
    throw new Error(`${provider} runtime.dynamic_inventory.discovery_transport must be connector_list_models`);
  }
  const cacheTTLSeconds = Number(value.cache_ttl_sec);
  if (!Number.isInteger(cacheTTLSeconds) || cacheTTLSeconds <= 0) {
    throw new Error(`${provider} runtime.dynamic_inventory.cache_ttl_sec must be a positive integer`);
  }
  const selectionMode = normalizeString(value.selection_mode);
  if (selectionMode !== 'curated_filter' && selectionMode !== 'pass_through') {
    throw new Error(`${provider} runtime.dynamic_inventory.selection_mode must be curated_filter or pass_through`);
  }
  const failurePolicy = normalizeString(value.failure_policy);
  if (failurePolicy !== 'use_cache_then_fail_closed' && failurePolicy !== 'fail_closed') {
    throw new Error(`${provider} runtime.dynamic_inventory.failure_policy must be use_cache_then_fail_closed or fail_closed`);
  }
  return {
    discovery_transport: discoveryTransport,
    cache_ttl_sec: cacheTTLSeconds,
    selection_mode: selectionMode,
    failure_policy: failurePolicy,
    ...(normalizeStringArray(value.allowed_capabilities).length > 0
      ? { allowed_capabilities: normalizeStringArray(value.allowed_capabilities) }
      : {}),
    ...(normalizeStringArray(value.deny_model_patterns).length > 0
      ? { deny_model_patterns: normalizeStringArray(value.deny_model_patterns) }
      : {}),
    ...(normalizeStringArray(value.allow_model_patterns).length > 0
      ? { allow_model_patterns: normalizeStringArray(value.allow_model_patterns) }
      : {}),
    ...(normalizeStringArray(value.preferred_model_patterns).length > 0
      ? { preferred_model_patterns: normalizeStringArray(value.preferred_model_patterns) }
      : {}),
  };
}

export function normalizeYAML(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  return `${trimmed}\n`;
}

export function fileExists(filePath) {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

export function ensureVoiceSetID(provider, value) {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return '';
  }
  if (trimmed.includes(':')) {
    return trimmed;
  }
  return `${provider}:${trimmed}`;
}

export function defaultCatalogSource(sourceList) {
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

export function buildSourceIndex(sourceList) {
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

export function resolveSourceRef(sourceIDs, sourceIndex, fallback) {
  for (const sourceID of normalizeStringArray(sourceIDs)) {
    const resolved = sourceIndex.get(sourceID);
    if (resolved) {
      return { ...resolved };
    }
  }
  return { ...fallback };
}

export function buildLanguageProfiles(languageProfiles) {
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

export function resolveLangs(entry, profiles, fallback = []) {
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

export function resolveUpdatedAt(entryModelID, modelUpdatedAt) {
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

export function resolveCapabilities(defaultCaps, overrideCaps) {
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

export function resolvePricing(defaultPricing, overridePricing) {
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

export function makeDynamicVoiceSetID(modelID) {
  const base = normalizeID(modelID).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'model'}-dynamic`;
}

export function parseVoiceDefinition(rawVoice, setLangs) {
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

export function modelRequiresVoiceSupport(capabilities, discoveryMode, voiceSetRef) {
  const capabilityRequiresVoice = capabilities.some((capability) => {
    const normalized = normalizeString(capability).toLowerCase();
    return normalized === 'audio.synthesize';
  });
  return capabilityRequiresVoice || normalizeString(discoveryMode) !== '' || normalizeString(voiceSetRef) !== '';
}

export function normalizeRoleList(value) {
  return normalizeStringArray(value).map((item) => item.toLowerCase());
}

export function normalizeInputRoles(value) {
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

export function normalizeVideoGeneration(raw) {
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

export function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeNumericRange(raw, provider, modelID, field) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const min = normalizeNumber(raw.min);
  const max = normalizeNumber(raw.max);
  if (min === null || max === null) {
    throw new Error(`${provider} model ${modelID} ${field} must include numeric min/max`);
  }
  if (max < min) {
    throw new Error(`${provider} model ${modelID} ${field} max must be >= min`);
  }
  return { min, max };
}

export function normalizeProviderExtensions(raw, provider, modelID, field) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const namespace = normalizeString(raw.namespace);
  const schemaVersion = normalizeString(raw.schema_version);
  if (!namespace || !schemaVersion) {
    throw new Error(`${provider} model ${modelID} ${field}.provider_extensions must include namespace and schema_version`);
  }
  return {
    namespace,
    schema_version: schemaVersion,
  };
}

export function normalizeVoiceRenderHints(raw, provider, modelID) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const out = {};
  const stability = normalizeNumericRange(raw.stability, provider, modelID, 'voice.request_options.voice_render_hints.stability');
  const similarityBoost = normalizeNumericRange(raw.similarity_boost, provider, modelID, 'voice.request_options.voice_render_hints.similarity_boost');
  const style = normalizeNumericRange(raw.style, provider, modelID, 'voice.request_options.voice_render_hints.style');
  const speed = normalizeNumericRange(raw.speed, provider, modelID, 'voice.request_options.voice_render_hints.speed');
  if (stability) {
    out.stability = stability;
  }
  if (similarityBoost) {
    out.similarity_boost = similarityBoost;
  }
  if (style) {
    out.style = style;
  }
  if (speed) {
    out.speed = speed;
  }
  if (Boolean(raw.use_speaker_boost)) {
    out.use_speaker_boost = true;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function normalizeVoiceRequestOptions(raw, provider, modelID) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const timingModes = normalizeStringArray(raw.timing_modes).map((value) => value.toLowerCase());
  const audioFormats = normalizeStringArray(raw.audio_formats).map((value) => value.toLowerCase());
  const allowedTimingModes = new Set(['none', 'word', 'char']);
  if (timingModes.length === 0) {
    throw new Error(`${provider} model ${modelID} voice.request_options.timing_modes must not be empty`);
  }
  if (audioFormats.length === 0) {
    throw new Error(`${provider} model ${modelID} voice.request_options.audio_formats must not be empty`);
  }
  for (const mode of timingModes) {
    if (!allowedTimingModes.has(mode)) {
      throw new Error(`${provider} model ${modelID} voice.request_options.timing_modes contains unsupported value: ${mode}`);
    }
  }
  const out = {
    timing_modes: timingModes,
    audio_formats: audioFormats,
  };
  if (Boolean(raw.supports_language)) {
    out.supports_language = true;
  }
  if (Boolean(raw.supports_emotion)) {
    out.supports_emotion = true;
  }
  if (Boolean(raw.supports_native_stream_tts)) {
    out.supports_native_stream_tts = true;
  }
  const hints = normalizeVoiceRenderHints(raw.voice_render_hints, provider, modelID);
  if (hints) {
    out.voice_render_hints = hints;
  }
  const providerExtensions = normalizeProviderExtensions(raw.provider_extensions, provider, modelID, 'voice.request_options');
  if (providerExtensions) {
    out.provider_extensions = providerExtensions;
  }
  return out;
}

export function normalizeTranscriptionOptions(raw, provider, modelID) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const tiers = normalizeStringArray(raw.tiers).map((value) => value.toLowerCase());
  const responseFormats = normalizeStringArray(raw.response_formats).map((value) => value.toLowerCase());
  const allowedTiers = new Set(['core_transcript', 'timed_transcript', 'speaker_aware_transcript']);
  if (tiers.length === 0) {
    throw new Error(`${provider} model ${modelID} transcription.tiers must not be empty`);
  }
  if (responseFormats.length === 0) {
    throw new Error(`${provider} model ${modelID} transcription.response_formats must not be empty`);
  }
  for (const tier of tiers) {
    if (!allowedTiers.has(tier)) {
      throw new Error(`${provider} model ${modelID} transcription.tiers contains unsupported value: ${tier}`);
    }
  }
  const maxSpeakerCountRaw = raw.max_speaker_count;
  let maxSpeakerCount = null;
  if (typeof maxSpeakerCountRaw !== 'undefined' && maxSpeakerCountRaw !== null && String(maxSpeakerCountRaw).trim() !== '') {
    const numeric = Number(maxSpeakerCountRaw);
    if (!Number.isInteger(numeric) || numeric < 0) {
      throw new Error(`${provider} model ${modelID} transcription.max_speaker_count must be a non-negative integer`);
    }
    maxSpeakerCount = numeric;
  }
  const out = {
    tiers,
    response_formats: responseFormats,
  };
  if (Boolean(raw.supports_language)) {
    out.supports_language = true;
  }
  if (Boolean(raw.supports_prompt)) {
    out.supports_prompt = true;
  }
  if (Boolean(raw.supports_timestamps)) {
    out.supports_timestamps = true;
  }
  if (Boolean(raw.supports_diarization)) {
    out.supports_diarization = true;
  }
  if (maxSpeakerCount !== null) {
    if (!out.supports_diarization) {
      throw new Error(`${provider} model ${modelID} transcription.max_speaker_count requires supports_diarization=true`);
    }
    out.max_speaker_count = maxSpeakerCount;
  }
  const providerExtensions = normalizeProviderExtensions(raw.provider_extensions, provider, modelID, 'transcription');
  if (providerExtensions) {
    out.provider_extensions = providerExtensions;
  }
  return out;
}

export function normalizeImageRequestOptions(raw, provider, modelID) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const responseFormats = normalizeStringArray(raw.response_formats).map((value) => value.toLowerCase());
  const allowedResponseFormats = new Set(['b64_json', 'url']);
  if (responseFormats.length === 0) {
    throw new Error(`${provider} model ${modelID} image_request_options.response_formats must not be empty`);
  }
  for (const format of responseFormats) {
    if (!allowedResponseFormats.has(format)) {
      throw new Error(`${provider} model ${modelID} image_request_options.response_formats contains unsupported value: ${format}`);
    }
  }
  const maxImagesPerRequest = Number(raw.max_images_per_request);
  if (!Number.isInteger(maxImagesPerRequest) || maxImagesPerRequest <= 0 || maxImagesPerRequest > 16) {
    throw new Error(`${provider} model ${modelID} image_request_options.max_images_per_request must be an integer in 1..16`);
  }
  const out = {
    response_formats: responseFormats,
    max_images_per_request: maxImagesPerRequest,
    supports_negative_prompt: Boolean(raw.supports_negative_prompt),
    supports_reference_images: Boolean(raw.supports_reference_images),
    supports_mask: Boolean(raw.supports_mask),
    supports_seed: Boolean(raw.supports_seed),
    supports_size: Boolean(raw.supports_size),
    supports_aspect_ratio: Boolean(raw.supports_aspect_ratio),
    supports_quality: Boolean(raw.supports_quality),
    supports_style: Boolean(raw.supports_style),
  };
  const providerExtensions = normalizeProviderExtensions(raw.provider_extensions, provider, modelID, 'image_request_options');
  if (providerExtensions) {
    out.provider_extensions = providerExtensions;
  }
  return out;
}

// normalizeEmbeddingCapability projects the K-MCAT-002 capability-conditional
// `embedding` block for `text.embed` models. It is the catalog authority for the
// model output dimension consumed by the runtime memory embedding profile
// resolver (K-MEM-004, K-AIEXEC-006). `dimension` MUST be a positive integer;
// missing or invalid material fails closed at generation time so the snapshot
// never carries an unusable embedding row.
export function normalizeEmbeddingCapability(raw, provider, modelID) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const dimensionRaw = raw.dimension;
  const dimension = Number(dimensionRaw);
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error(`${provider} model ${modelID} embedding.dimension must be a positive integer`);
  }
  return { dimension };
}

export function normalizeVoiceWorkflowRequestOptions(raw, provider, workflowModelID, workflowType) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${provider} workflow model ${workflowModelID} missing request_options`);
  }
  const normalizedWorkflowType = normalizeWorkflowType(workflowType);
  const out = {};
  const readExplicitBoolean = (field) => {
    if (typeof raw[field] !== 'boolean') {
      throw new Error(`${provider} workflow model ${workflowModelID} request_options.${field} must be explicit boolean`);
    }
    return raw[field];
  };
  const normalizeMode = (field) => {
    const value = normalizeString(raw[field]).toLowerCase();
    if (value !== 'unsupported' && value !== 'optional' && value !== 'required') {
      throw new Error(`${provider} workflow model ${workflowModelID} request_options.${field} must be unsupported|optional|required`);
    }
    return value;
  };

  if (normalizedWorkflowType === 'voice_clone') {
    out.text_prompt_mode = normalizeMode('text_prompt_mode');
    out.supports_language_hints = readExplicitBoolean('supports_language_hints');
    out.supports_preferred_name = readExplicitBoolean('supports_preferred_name');
    out.reference_audio_uri_input = readExplicitBoolean('reference_audio_uri_input');
    out.reference_audio_bytes_input = readExplicitBoolean('reference_audio_bytes_input');
    if (!out.reference_audio_uri_input && !out.reference_audio_bytes_input) {
      throw new Error(`${provider} workflow model ${workflowModelID} must admit at least one reference audio input path`);
    }
    out.allowed_reference_audio_mime_types = normalizeStringArray(raw.allowed_reference_audio_mime_types).map((value) => value.toLowerCase());
    if (out.allowed_reference_audio_mime_types.length === 0) {
      throw new Error(`${provider} workflow model ${workflowModelID} request_options.allowed_reference_audio_mime_types must not be empty`);
    }
  } else if (normalizedWorkflowType === 'voice_design') {
    out.instruction_text_mode = normalizeMode('instruction_text_mode');
    out.preview_text_mode = normalizeMode('preview_text_mode');
    out.supports_language = readExplicitBoolean('supports_language');
    out.supports_preferred_name = readExplicitBoolean('supports_preferred_name');
  } else {
    throw new Error(`${provider} workflow model ${workflowModelID} uses unsupported workflow_type ${workflowType}`);
  }

  const providerExtensions = normalizeProviderExtensions(raw.provider_extensions, provider, workflowModelID, 'request_options');
  if (providerExtensions) {
    out.provider_extensions = providerExtensions;
  }
  return out;
}

export function normalizeSelectionProfiles(rawProfiles, provider, modelIndex) {
  if (!Array.isArray(rawProfiles)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const raw of rawProfiles) {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`${provider} selection_profiles entries must be objects`);
    }
    const profileID = normalizeString(raw.profile_id);
    const capability = normalizeString(raw.capability).toLowerCase();
    const modelID = normalizeString(raw.model_id);
    const reviewedAt = normalizeString(raw.reviewed_at);
    const rationale = normalizeString(raw.rationale);
    const freshnessSLADays = Number(raw.freshness_sla_days);
    if (!profileID || !capability || !modelID || !reviewedAt) {
      throw new Error(`${provider} selection profile must include profile_id/capability/model_id/reviewed_at`);
    }
    if (!Number.isInteger(freshnessSLADays) || freshnessSLADays <= 0) {
      throw new Error(`${provider} selection profile ${profileID} freshness_sla_days must be a positive integer`);
    }
    if (!canonicalModelCapabilities.has(capability)) {
      throw new Error(`${provider} selection profile ${profileID} uses non-canonical capability token: ${capability}`);
    }
    const dedupeKey = profileID.toLowerCase();
    if (seen.has(dedupeKey)) {
      throw new Error(`${provider} duplicate selection profile id: ${profileID}`);
    }
    seen.add(dedupeKey);
    const model = modelIndex.get(modelID.toLowerCase());
    if (!model) {
      throw new Error(`${provider} selection profile ${profileID} references unknown model ${modelID}`);
    }
    const modelCapabilities = normalizeStringArray(model.capabilities).map((value) => value.toLowerCase());
    if (!modelCapabilities.includes(capability)) {
      throw new Error(`${provider} selection profile ${profileID} references model ${modelID} without capability ${capability}`);
    }
    out.push({
      provider,
      profile_id: profileID,
      capability,
      model_id: modelID,
      reviewed_at: reviewedAt,
      freshness_sla_days: freshnessSLADays,
      ...(rationale ? { rationale } : {}),
    });
  }
  return out;
}

export function selectionProfileModelID(selectionProfiles, profileID) {
  const match = Array.isArray(selectionProfiles)
    ? selectionProfiles.find((entry) => normalizeString(entry?.profile_id).toLowerCase() === String(profileID || '').trim().toLowerCase())
    : null;
  return normalizeString(match?.model_id);
}

export function normalizeWorkflowType(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized === 'voice_clone' || normalized === 'voice_design') {
    return normalized;
  }
  throw new Error(`voice workflow type must be voice_clone or voice_design, got: ${normalized}`);
}

const localInstallKinds = new Set(['binary', 'weights', 'verified-hf-multi-file']);
const localPreferredEngines = new Set(['llama', 'media', 'speech', 'sidecar']);
const localAccelerators = new Set(['cpu', 'metal', 'cuda']);

function normalizeInt(value, label) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer, got: ${value}`);
  }
  return parsed;
}

// normalizeLocalHostRequirement projects a K-MCAT-032 variant host_requirement
// block. min_vram_bytes is required only when accelerator != cpu.
function normalizeLocalHostRequirement(raw, label) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${label} requires a host_requirement block`);
  }
  const accelerator = normalizeString(raw.accelerator).toLowerCase();
  if (!localAccelerators.has(accelerator)) {
    throw new Error(`${label} host_requirement.accelerator must be cpu|metal|cuda, got: ${raw.accelerator}`);
  }
  const minRamBytes = normalizeInt(raw.min_ram_bytes, `${label} host_requirement.min_ram_bytes`);
  if (minRamBytes === undefined) {
    throw new Error(`${label} host_requirement.min_ram_bytes is required`);
  }
  const out = { accelerator, min_ram_bytes: minRamBytes };
  const minVramBytes = normalizeInt(raw.min_vram_bytes, `${label} host_requirement.min_vram_bytes`);
  if (accelerator !== 'cpu') {
    if (minVramBytes === undefined) {
      throw new Error(`${label} host_requirement.min_vram_bytes is required when accelerator != cpu`);
    }
    out.min_vram_bytes = minVramBytes;
  } else if (minVramBytes !== undefined) {
    out.min_vram_bytes = minVramBytes;
  }
  return out;
}

// normalizeLocalVariant projects one K-MCAT-032 variant. Every file MUST carry
// a sha256 hash; missing integrity material fails closed. The variant entry is
// the per-variant engine entry artifact; when omitted it defaults to
// install.entry (multi-file bundles share one canonical entry name, while
// per-quant GGUF variants each carry a distinct entry file).
function normalizeLocalVariant(raw, modelID, installEntry) {
  const variantID = normalizeString(raw?.variant_id);
  if (!variantID) {
    throw new Error(`local model ${modelID} variant entry missing variant_id`);
  }
  const label = `local model ${modelID} variant ${variantID}`;
  const quant = normalizeString(raw?.quant);
  if (!quant) {
    throw new Error(`${label} missing quant`);
  }
  const files = normalizeStringArray(raw?.files);
  if (files.length === 0) {
    throw new Error(`${label} must declare at least one file`);
  }
  let entry = normalizeString(raw?.entry);
  if (!entry) {
    entry = files.length === 1 ? files[0] : installEntry;
  }
  if (!files.includes(entry)) {
    throw new Error(`${label} entry ${entry} is not in the variant files list`);
  }
  const hashesRaw = raw?.hashes && typeof raw.hashes === 'object' ? raw.hashes : {};
  const hashes = {};
  for (const file of files) {
    const hash = normalizeString(hashesRaw[file]);
    if (!hash) {
      throw new Error(`${label} file ${file} is missing a hash`);
    }
    if (!/^sha256:[0-9a-f]{64}$/iu.test(hash)) {
      throw new Error(`${label} file ${file} hash must be sha256:<64-hex>, got: ${hash}`);
    }
    hashes[file] = hash.toLowerCase();
  }
  for (const key of Object.keys(hashesRaw)) {
    if (!files.includes(normalizeString(key))) {
      throw new Error(`${label} hash key ${key} does not match any declared file`);
    }
  }
  const totalSizeBytes = normalizeInt(raw?.total_size_bytes, `${label} total_size_bytes`);
  if (totalSizeBytes === undefined || totalSizeBytes <= 0) {
    throw new Error(`${label} total_size_bytes must be a positive integer`);
  }
  return {
    variant_id: variantID,
    quant,
    entry,
    files,
    hashes,
    total_size_bytes: totalSizeBytes,
    host_requirement: normalizeLocalHostRequirement(raw?.host_requirement, label),
  };
}

const localCompanionKinds = new Set(['vae', 'clip', 'lora', 'controlnet', 'auxiliary']);

// normalizeLocalInstall projects a K-MCAT-032 install block (shared by the main
// model row and by companion blocks). label scopes error messages.
function normalizeLocalInstall(install, label) {
  if (!install || typeof install !== 'object') {
    throw new Error(`${label} requires an install block`);
  }
  const repo = normalizeString(install.repo);
  if (!repo) {
    throw new Error(`${label} install.repo is required`);
  }
  const revision = normalizeString(install.revision);
  if (!revision || revision.toLowerCase() === 'main') {
    throw new Error(`${label} install.revision must be a pinned commit sha, not "main"`);
  }
  const installKind = normalizeString(install.install_kind);
  if (!localInstallKinds.has(installKind)) {
    throw new Error(`${label} install.install_kind must be binary|weights|verified-hf-multi-file, got: ${installKind}`);
  }
  const entry = normalizeString(install.entry);
  if (!entry) {
    throw new Error(`${label} install.entry is required`);
  }
  const artifactRoles = normalizeStringArray(install.artifact_roles);
  if (artifactRoles.length === 0) {
    throw new Error(`${label} install.artifact_roles must not be empty`);
  }
  const preferredEngine = normalizeString(install.preferred_engine).toLowerCase();
  if (!localPreferredEngines.has(preferredEngine)) {
    throw new Error(`${label} install.preferred_engine must be llama|media|speech|sidecar, got: ${preferredEngine}`);
  }
  return {
    repo,
    revision,
    install_kind: installKind,
    entry,
    artifact_roles: artifactRoles,
    preferred_engine: preferredEngine,
  };
}

// normalizeLocalVariantList projects a K-MCAT-032 variants array (shared by the
// main model row and by companion blocks), enforcing unique variant_id.
function normalizeLocalVariantList(rawVariants, modelID, installEntry) {
  const variants = [];
  const seenVariantIDs = new Set();
  for (const rawVariant of rawVariants) {
    const variant = normalizeLocalVariant(rawVariant, modelID, installEntry);
    const key = variant.variant_id.toLowerCase();
    if (seenVariantIDs.has(key)) {
      throw new Error(`local model ${modelID} duplicate variant_id: ${variant.variant_id}`);
    }
    seenVariantIDs.add(key);
    variants.push(variant);
  }
  return variants;
}

// normalizeLocalCompanion projects one K-MCAT-032 companion block. A companion
// is a passive parent-bound asset: it carries install + variants like a model
// but no capabilities and no fitness. companion_kind must be a K-LOCAL-007
// passive-kind and engine_slot is a K-LOCAL-031 engine-defined slot.
function normalizeLocalCompanion(raw, modelID) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`local model ${modelID} companion entry must be an object`);
  }
  const companionKind = normalizeString(raw.companion_kind).toLowerCase();
  if (!localCompanionKinds.has(companionKind)) {
    throw new Error(`local model ${modelID} companion.companion_kind must be vae|clip|lora|controlnet|auxiliary, got: ${raw.companion_kind}`);
  }
  const engineSlot = normalizeString(raw.engine_slot);
  if (!engineSlot) {
    throw new Error(`local model ${modelID} companion (${companionKind}) requires an engine_slot`);
  }
  const label = `local model ${modelID} companion ${companionKind}/${engineSlot}`;
  const install = normalizeLocalInstall(raw.install, label);
  if (!Array.isArray(raw.variants) || raw.variants.length === 0) {
    throw new Error(`${label} requires at least one variant`);
  }
  const variants = normalizeLocalVariantList(raw.variants, modelID, install.entry);
  if (raw.capabilities !== undefined) {
    throw new Error(`${label} is passive and must not declare capabilities`);
  }
  if (raw.fitness !== undefined) {
    throw new Error(`${label} is passive and must not declare fitness`);
  }
  return {
    companion_kind: companionKind,
    engine_slot: engineSlot,
    install,
    variants,
  };
}

// normalizeLocalPlaneRow projects the K-MCAT-032 local-plane block
// (install / variants / fitness / optional companions) for a single models[]
// row. Returns null when the row carries no local-plane block.
export function normalizeLocalPlaneRow(model, modelID) {
  const hasInstall = model?.install && typeof model.install === 'object';
  const hasVariants = Array.isArray(model?.variants) && model.variants.length > 0;
  const hasFitness = model?.fitness && typeof model.fitness === 'object';
  if (!hasInstall && !hasVariants && !hasFitness) {
    return null;
  }
  if (!hasInstall || !hasVariants || !hasFitness) {
    throw new Error(`local model ${modelID} local-plane block requires install, variants, and fitness together`);
  }
  const install = normalizeLocalInstall(model.install, `local model ${modelID}`);
  const variants = normalizeLocalVariantList(model.variants, modelID, install.entry);
  const paramCount = normalizeInt(model.fitness.param_count, `local model ${modelID} fitness.param_count`);
  if (paramCount === undefined || paramCount <= 0) {
    throw new Error(`local model ${modelID} fitness.param_count must be a positive integer`);
  }
  const contextLength = normalizeInt(model.fitness.context_length, `local model ${modelID} fitness.context_length`);
  if (contextLength === undefined) {
    throw new Error(`local model ${modelID} fitness.context_length is required`);
  }
  const out = {
    install,
    variants,
    fitness: {
      param_count: paramCount,
      context_length: contextLength,
    },
  };
  // K-MCAT-032 optional companions block. engine_slot must be unique within a
  // parent row (K-LOCAL-031). Absent or empty companions: omit the field.
  if (model.companions !== undefined) {
    if (!Array.isArray(model.companions)) {
      throw new Error(`local model ${modelID} companions must be a list`);
    }
    if (model.companions.length > 0) {
      const companions = [];
      const seenEngineSlots = new Set();
      for (const rawCompanion of model.companions) {
        const companion = normalizeLocalCompanion(rawCompanion, modelID);
        const slotKey = companion.engine_slot.toLowerCase();
        if (seenEngineSlots.has(slotKey)) {
          throw new Error(`local model ${modelID} duplicate companion engine_slot: ${companion.engine_slot}`);
        }
        seenEngineSlots.add(slotKey);
        companions.push(companion);
      }
      out.companions = companions;
    }
  }
  return out;
}

// normalizePresets projects the K-MCAT-033 curated presets section. install
// level keys are fixed to minimal and recommended. Each slot.model_ref must
// resolve to a local-plane row whose capabilities include slot.capability.
export function normalizePresets(rawPresets, localPlaneByModelID, modelCapabilitiesByID) {
  if (rawPresets === undefined || rawPresets === null) {
    return undefined;
  }
  if (typeof rawPresets !== 'object' || Array.isArray(rawPresets)) {
    throw new Error('presets must be a mapping of install-level keys');
  }
  const allowedLevels = ['minimal', 'recommended'];
  for (const level of Object.keys(rawPresets)) {
    if (!allowedLevels.includes(level)) {
      throw new Error(`presets install level must be minimal or recommended, got: ${level}`);
    }
  }
  const out = {};
  for (const level of allowedLevels) {
    const preset = rawPresets[level];
    if (preset === undefined) {
      continue;
    }
    if (!preset || typeof preset !== 'object') {
      throw new Error(`presets.${level} must be an object`);
    }
    const factoryAlias = normalizeString(preset.factory_aiprofile_alias);
    if (!factoryAlias) {
      throw new Error(`presets.${level} missing factory_aiprofile_alias`);
    }
    const slotsRaw = Array.isArray(preset.slots) ? preset.slots : [];
    if (slotsRaw.length === 0) {
      throw new Error(`presets.${level} must declare at least one slot`);
    }
    const slots = [];
    const seenSlots = new Set();
    for (const slotRaw of slotsRaw) {
      const slotID = normalizeString(slotRaw?.slot);
      if (!slotID) {
        throw new Error(`presets.${level} slot entry missing slot id`);
      }
      if (seenSlots.has(slotID.toLowerCase())) {
        throw new Error(`presets.${level} duplicate slot: ${slotID}`);
      }
      seenSlots.add(slotID.toLowerCase());
      const capability = normalizeString(slotRaw?.capability);
      if (!canonicalModelCapabilities.has(capability)) {
        throw new Error(`presets.${level} slot ${slotID} capability is not a canonical token: ${capability}`);
      }
      if (capability === 'text.embed') {
        throw new Error(`presets.${level} slot ${slotID}: text.embed is not allowed as a preset slot`);
      }
      const modelRef = normalizeString(slotRaw?.model_ref);
      if (!modelRef) {
        throw new Error(`presets.${level} slot ${slotID} missing model_ref`);
      }
      const modelKey = modelRef.toLowerCase();
      if (!localPlaneByModelID.has(modelKey)) {
        throw new Error(`presets.${level} slot ${slotID} model_ref ${modelRef} does not resolve to a local-plane catalog row`);
      }
      const caps = modelCapabilitiesByID.get(modelKey) || [];
      if (!caps.map((value) => value.toLowerCase()).includes(capability.toLowerCase())) {
        throw new Error(`presets.${level} slot ${slotID} model_ref ${modelRef} does not declare capability ${capability}`);
      }
      const slot = {
        slot: slotID,
        capability,
        model_ref: modelRef,
        required: Boolean(slotRaw?.required),
      };
      if (slotRaw?.host_conditional !== undefined) {
        slot.host_conditional = Boolean(slotRaw.host_conditional);
      }
      slots.push(slot);
    }
    out[level] = {
      factory_aiprofile_alias: factoryAlias,
      slots,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
