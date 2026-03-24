export function createCatalogChecks(context) {
  const {
    cwd,
    fail,
    fs,
    normalizeProviderName,
    path,
    readYaml,
    runtimeCatalogProvidersDir,
    runtimeCatalogSourceProvidersDir,
    YAML,
  } = context;

  function listSourceProviderIDs() {
    if (!fs.existsSync(runtimeCatalogSourceProvidersDir)) {
      return [];
    }
    return fs.readdirSync(runtimeCatalogSourceProvidersDir)
      .filter((name) => name.endsWith('.source.yaml') || name.endsWith('.source.yml'))
      .map((name) => normalizeProviderName(name.replace(/\.source\.ya?ml$/iu, '')))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  function listSourceProviderDocs() {
    if (!fs.existsSync(runtimeCatalogSourceProvidersDir)) {
      return [];
    }
    return fs.readdirSync(runtimeCatalogSourceProvidersDir)
      .filter((name) => name.endsWith('.source.yaml') || name.endsWith('.source.yml'))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const relPath = path.join('runtime/catalog/source/providers', name);
        const parsed = YAML.parse(fs.readFileSync(path.join(cwd, relPath), 'utf8')) || {};
        return {
          relPath,
          provider: normalizeProviderName(parsed?.provider || name.replace(/\.source\.ya?ml$/iu, '')),
          parsed,
        };
      })
      .filter((entry) => entry.provider);
  }

  function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  function aggregateProviderCapabilities(parsed) {
    const capabilitySet = new Set();
    const defaults = normalizeStringArray(parsed?.defaults?.capabilities).map((item) => item.toLowerCase());
    const models = Array.isArray(parsed?.models) ? parsed.models : [];
    for (const model of models) {
      const declared = normalizeStringArray(model?.capabilities).map((item) => item.toLowerCase());
      const effective = declared.length > 0 ? declared : defaults;
      for (const capability of effective) {
        capabilitySet.add(capability);
      }
    }
    const workflows = Array.isArray(parsed?.voice_workflow_models) ? parsed.voice_workflow_models : [];
    for (const workflow of workflows) {
      const workflowType = String(workflow?.workflow_type || '').trim().toLowerCase();
      if (workflowType === 'tts_v2v') {
        capabilitySet.add('voice_workflow.tts_v2v');
      }
      if (workflowType === 'tts_t2v') {
        capabilitySet.add('voice_workflow.tts_t2v');
      }
    }
    return [...capabilitySet].sort((a, b) => a.localeCompare(b));
  }

  function listTtsProvidersFromSnapshots() {
    if (!fs.existsSync(runtimeCatalogProvidersDir)) {
      return [];
    }
    const providers = [];
    const files = fs.readdirSync(runtimeCatalogProvidersDir)
      .filter((name) => /\.(yaml|yml)$/iu.test(name))
      .sort((a, b) => a.localeCompare(b));
    for (const fileName of files) {
      const parsed = YAML.parse(fs.readFileSync(path.join(runtimeCatalogProvidersDir, fileName), 'utf8'));
      const provider = normalizeProviderName(parsed?.provider || fileName.replace(/\.(yaml|yml)$/iu, ''));
      if (!provider) {
        continue;
      }
      const models = Array.isArray(parsed?.models) ? parsed.models : [];
      const hasTts = models.some((model) => {
        const capabilities = Array.isArray(model?.capabilities) ? model.capabilities : [];
        return capabilities.some((capability) => {
          const normalized = String(capability || '').trim().toLowerCase();
          return normalized === 'audio.synthesize';
        });
      });
      if (hasTts) {
        providers.push(provider);
      }
    }
    return providers.sort((a, b) => a.localeCompare(b));
  }

  function checkProviderTableParity() {
    const catalog = readYaml('spec/runtime/kernel/tables/provider-catalog.yaml');
    const capabilities = readYaml('spec/runtime/kernel/tables/provider-capabilities.yaml');
    const sourceDocs = listSourceProviderDocs();

    const catalogProviders = new Set(
      (Array.isArray(catalog?.providers) ? catalog.providers : [])
        .map((item) => String(item?.provider || '').trim())
        .filter(Boolean),
    );

    const capabilityProviders = Array.isArray(capabilities?.providers) ? capabilities.providers : [];
    const remoteCapabilities = capabilityProviders.filter((item) => String(item?.runtime_plane || '').trim() === 'remote');
    const remoteCapabilityProviders = new Set(
      remoteCapabilities.map((item) => String(item?.provider || '').trim()).filter(Boolean),
    );

    const missingInCapabilities = [...catalogProviders].filter((provider) => !remoteCapabilityProviders.has(provider));
    const extraInCapabilities = [...remoteCapabilityProviders].filter((provider) => !catalogProviders.has(provider));
    if (missingInCapabilities.length > 0) {
      fail(`provider-capabilities missing remote providers from provider-catalog: ${missingInCapabilities.join(', ')}`);
    }
    if (extraInCapabilities.length > 0) {
      fail(`provider-capabilities has unknown remote providers: ${extraInCapabilities.join(', ')}`);
    }

    const localEntries = capabilityProviders.filter((item) => String(item?.provider || '').trim() === 'local');
    if (localEntries.length !== 1) {
      fail('provider-capabilities must contain exactly one `local` entry');
    } else {
      const local = localEntries[0];
      if (String(local?.runtime_plane || '').trim() !== 'local') {
        fail('provider-capabilities local entry must use runtime_plane=local');
      }
      if (String(local?.execution_module || '').trim() !== 'local-model') {
        fail('provider-capabilities local entry must map execution_module=local-model');
      }
      if (local?.inline_supported === true) {
        fail('provider-capabilities local entry must not support inline');
      }
    }

    const catalogMap = new Map();
    for (const item of Array.isArray(catalog?.providers) ? catalog.providers : []) {
      const provider = String(item?.provider || '').trim();
      if (!provider) {
        continue;
      }
      catalogMap.set(provider, Boolean(item?.requires_explicit_endpoint));
    }
    for (const item of remoteCapabilities) {
      const provider = String(item?.provider || '').trim();
      if (!provider) {
        continue;
      }
      const explicitRequired = catalogMap.get(provider);
      const endpointRequirement = String(item?.endpoint_requirement || '').trim();
      if (explicitRequired && endpointRequirement !== 'explicit_required') {
        fail(`provider-capabilities ${provider} must use endpoint_requirement=explicit_required`);
      }
      if (!explicitRequired && endpointRequirement === 'explicit_required') {
        fail(`provider-capabilities ${provider} endpoint_requirement conflicts with provider-catalog default endpoint`);
      }
    }

    const catalogByProvider = new Map(
      (Array.isArray(catalog?.providers) ? catalog.providers : [])
        .map((item) => [normalizeProviderName(item?.provider), item]),
    );
    const capabilitiesByProvider = new Map(
      (Array.isArray(capabilities?.providers) ? capabilities.providers : [])
        .map((item) => [normalizeProviderName(item?.provider), item]),
    );

    for (const { relPath, provider, parsed } of sourceDocs) {
      const runtime = parsed?.runtime && typeof parsed.runtime === 'object' ? parsed.runtime : {};
      const runtimePlane = String(runtime?.runtime_plane || '').trim();
      const managed = Boolean(runtime?.managed_connector_supported);
      const inline = Boolean(runtime?.inline_supported);
      const defaultEndpoint = String(runtime?.default_endpoint || '').trim();
      const explicit = Boolean(runtime?.requires_explicit_endpoint);

      if (runtimePlane !== 'local' && runtimePlane !== 'remote') {
        fail(`${relPath} runtime.runtime_plane must be local or remote`);
        continue;
      }

      const capabilityEntry = capabilitiesByProvider.get(provider);
      if (!capabilityEntry) {
        fail(`${relPath} provider ${provider} missing provider-capabilities entry`);
        continue;
      }
      if (String(capabilityEntry?.runtime_plane || '').trim() !== runtimePlane) {
        fail(`${relPath} provider ${provider} runtime_plane mismatch with provider-capabilities`);
      }
      if (Boolean(capabilityEntry?.managed_connector_supported) !== managed) {
        fail(`${relPath} provider ${provider} managed_connector_supported mismatch with provider-capabilities`);
      }
      if (Boolean(capabilityEntry?.inline_supported) !== inline) {
        fail(`${relPath} provider ${provider} inline_supported mismatch with provider-capabilities`);
      }
      const expectedRequirement = runtimePlane === 'local'
        ? 'empty_string_only'
        : explicit
          ? 'explicit_required'
          : 'default_or_explicit';
      if (String(capabilityEntry?.endpoint_requirement || '').trim() !== expectedRequirement) {
        fail(`${relPath} provider ${provider} endpoint_requirement mismatch with provider-capabilities`);
      }
      const expectedCapabilities = aggregateProviderCapabilities(parsed);
      const actualCapabilities = normalizeStringArray(capabilityEntry?.capabilities)
        .map((item) => item.toLowerCase())
        .sort((a, b) => a.localeCompare(b));
      if (JSON.stringify(actualCapabilities) !== JSON.stringify(expectedCapabilities)) {
        fail(`${relPath} provider ${provider} capabilities mismatch with provider-capabilities`);
      }

      const catalogEntry = catalogByProvider.get(provider);
      if (runtimePlane === 'local') {
        if (catalogEntry) {
          fail(`${relPath} local provider must not appear in provider-catalog.yaml`);
        }
        continue;
      }
      if (!catalogEntry) {
        fail(`${relPath} remote provider ${provider} missing provider-catalog entry`);
        continue;
      }
      if (String(catalogEntry?.default_endpoint || '').trim() !== defaultEndpoint) {
        fail(`${relPath} provider ${provider} default_endpoint mismatch with provider-catalog`);
      }
      if (Boolean(catalogEntry?.requires_explicit_endpoint) !== explicit) {
        fail(`${relPath} provider ${provider} requires_explicit_endpoint mismatch with provider-catalog`);
      }
    }
  }

  function checkSourceProviderCoverage() {
    const sourceProviders = new Set(listSourceProviderIDs());
    if (sourceProviders.size === 0) {
      fail('runtime/catalog/source/providers must include at least one provider');
      return;
    }

    const providerCatalog = readYaml('spec/runtime/kernel/tables/provider-catalog.yaml');
    const providerCapabilities = readYaml('spec/runtime/kernel/tables/provider-capabilities.yaml');

    const catalogProviders = new Set(
      (Array.isArray(providerCatalog?.providers) ? providerCatalog.providers : [])
        .map((item) => normalizeProviderName(item?.provider))
        .filter(Boolean),
    );
    const capabilityProviders = new Set(
      (Array.isArray(providerCapabilities?.providers) ? providerCapabilities.providers : [])
        .map((item) => normalizeProviderName(item?.provider))
        .filter(Boolean),
    );

    const remoteSourceProviders = [...sourceProviders].filter((provider) => provider !== 'local');
    const missingRemoteCatalog = remoteSourceProviders.filter((provider) => !catalogProviders.has(provider));
    if (missingRemoteCatalog.length > 0) {
      fail(`provider-catalog missing source remote providers: ${missingRemoteCatalog.join(', ')}`);
    }

    const missingCapabilities = [...sourceProviders].filter((provider) => !capabilityProviders.has(provider));
    if (missingCapabilities.length > 0) {
      fail(`provider-capabilities missing source providers: ${missingCapabilities.join(', ')}`);
    }
  }

  function checkModelCatalogTables() {
    if (!fs.existsSync(runtimeCatalogProvidersDir)) {
      fail(`runtime catalog provider directory is missing: ${path.relative(cwd, runtimeCatalogProvidersDir)}`);
      return;
    }

    const providerFiles = fs.readdirSync(runtimeCatalogProvidersDir)
      .filter((name) => /\.(yaml|yml)$/iu.test(name))
      .sort((a, b) => a.localeCompare(b));
    if (providerFiles.length === 0) {
      fail('runtime/catalog/providers must include at least one provider yaml');
      return;
    }

    const allowedPricingUnits = new Set(['token', 'char', 'second', 'request']);
    const seenProviders = new Set();
    const dashscopeModelVoices = new Map();

    for (const fileName of providerFiles) {
      const absPath = path.join(runtimeCatalogProvidersDir, fileName);
      const parsed = YAML.parse(fs.readFileSync(absPath, 'utf8'));
      const provider = normalizeProviderName(parsed?.provider || fileName.replace(/\.(yaml|yml)$/iu, ''));
      if (!provider) {
        fail(`${path.relative(cwd, absPath)} must include provider`);
        continue;
      }
      if (seenProviders.has(provider)) {
        fail(`runtime/catalog/providers has duplicate provider entry: ${provider}`);
        continue;
      }
      seenProviders.add(provider);

      const version = Number(parsed?.version);
      if (Number.isNaN(version) || version <= 0) {
        fail(`${path.relative(cwd, absPath)} must include positive version`);
      }
      if (!String(parsed?.catalog_version || '').trim()) {
        fail(`${path.relative(cwd, absPath)} must include catalog_version`);
      }

      const models = Array.isArray(parsed?.models) ? parsed.models : [];
      const voices = Array.isArray(parsed?.voices) ? parsed.voices : [];
      if (models.length === 0) {
        fail(`${path.relative(cwd, absPath)} must include at least one model`);
        continue;
      }

      const modelKeySet = new Set();
      const modelToVoiceSet = new Map();
      const modelToVoices = new Map();
      const validVoiceSets = new Set();
      const requiredVoiceModels = new Set();

      for (const model of models) {
        const modelProvider = normalizeProviderName(model?.provider || provider);
        const modelID = String(model?.model_id || '').trim();
        const modelType = String(model?.model_type || '').trim();
        const updatedAt = String(model?.updated_at || '').trim();
        const voiceSetID = String(model?.voice_set_id || '').trim();
        const voiceDiscoveryMode = String(model?.voice_discovery_mode || '').trim();
        const voiceRefKinds = Array.isArray(model?.voice_ref_kinds)
          ? model.voice_ref_kinds.map((item) => String(item || '').trim()).filter(Boolean)
          : [];
        const capabilities = Array.isArray(model?.capabilities) ? model.capabilities : [];
        const requiresVoice = voiceSetID
          || capabilities.some((capability) => {
            const normalized = String(capability || '').trim().toLowerCase();
            return normalized === 'audio.synthesize';
          });

        if (modelProvider !== provider) {
          fail(`${path.relative(cwd, absPath)} model ${modelID || '<unknown>'} provider mismatch: ${modelProvider}`);
        }
        if (!modelID || !modelType || !updatedAt) {
          fail(`${path.relative(cwd, absPath)} model entry must include model_id/model_type/updated_at`);
          continue;
        }
        if (requiresVoice && !voiceSetID) {
          fail(`${path.relative(cwd, absPath)} model entry must include voice_set_id when audio.synthesize capability is present`);
        }
        if (requiresVoice && !voiceDiscoveryMode) {
          fail(`${path.relative(cwd, absPath)} model entry must include voice_discovery_mode when audio.synthesize capability is present`);
        }
        if (voiceDiscoveryMode) {
          const allowedVoiceDiscoveryModes = new Set(['static_catalog', 'dynamic_user_scoped', 'mixed']);
          if (!allowedVoiceDiscoveryModes.has(voiceDiscoveryMode)) {
            fail(`${path.relative(cwd, absPath)} model ${modelID} has invalid voice_discovery_mode: ${voiceDiscoveryMode}`);
          }
        }
        if (requiresVoice && voiceDiscoveryMode === 'static_catalog' && !voiceSetID) {
          fail(`${path.relative(cwd, absPath)} model ${modelID} static_catalog requires voice_set_id`);
        }
        if (requiresVoice && voiceRefKinds.length === 0) {
          fail(`${path.relative(cwd, absPath)} model ${modelID} must include voice_ref_kinds when audio.synthesize capability is present`);
        }
        if (voiceDiscoveryMode === 'dynamic_user_scoped' && !voiceRefKinds.includes('voice_asset_id')) {
          fail(`${path.relative(cwd, absPath)} model ${modelID} dynamic_user_scoped must include voice_ref_kinds.voice_asset_id`);
        }
        const modelKey = `${provider}:${modelID}`;
        if (modelKeySet.has(modelKey)) {
          fail(`${path.relative(cwd, absPath)} has duplicate model entry: ${modelKey}`);
          continue;
        }
        modelKeySet.add(modelKey);
        if (voiceSetID) {
          modelToVoiceSet.set(modelKey, voiceSetID);
          validVoiceSets.add(`${provider}:${voiceSetID}`);
        }
        if (requiresVoice) {
          requiredVoiceModels.add(modelKey);
        }

        if (capabilities.length === 0) {
          fail(`${path.relative(cwd, absPath)} model ${modelKey} must include capabilities`);
        }
        const hasVideoCapability = capabilities.some((capability) => {
          const normalized = String(capability || '').trim().toLowerCase();
          return normalized === 'video.generate';
        });
        if (hasVideoCapability) {
          const videoGeneration = model?.video_generation;
          if (!videoGeneration || typeof videoGeneration !== 'object') {
            fail(`${path.relative(cwd, absPath)} model ${modelKey} must include video_generation for video capability`);
          } else {
            const modes = Array.isArray(videoGeneration?.modes) ? videoGeneration.modes : [];
            if (modes.length === 0) {
              fail(`${path.relative(cwd, absPath)} model ${modelKey} video_generation.modes must not be empty`);
            }
            const inputRoles = videoGeneration?.input_roles;
            if (!inputRoles || typeof inputRoles !== 'object' || Object.keys(inputRoles).length === 0) {
              fail(`${path.relative(cwd, absPath)} model ${modelKey} video_generation.input_roles must not be empty`);
            }
            const limits = videoGeneration?.limits;
            if (!limits || typeof limits !== 'object' || Object.keys(limits).length === 0) {
              fail(`${path.relative(cwd, absPath)} model ${modelKey} video_generation.limits must not be empty`);
            }
            const options = videoGeneration?.options;
            if (!options || typeof options !== 'object' || Object.keys(options).length === 0) {
              fail(`${path.relative(cwd, absPath)} model ${modelKey} video_generation.options must not be empty`);
            }
            const outputs = videoGeneration?.outputs;
            if (!outputs || typeof outputs !== 'object' || Object.keys(outputs).length === 0) {
              fail(`${path.relative(cwd, absPath)} model ${modelKey} video_generation.outputs must not be empty`);
            }
          }
        }

        const pricing = model?.pricing || {};
        const unit = String(pricing?.unit || '').trim();
        if (!allowedPricingUnits.has(unit)) {
          fail(`${path.relative(cwd, absPath)} model ${modelKey} has invalid pricing.unit: ${unit}`);
        }
        for (const field of ['input', 'output', 'currency', 'as_of', 'notes']) {
          if (!String(pricing?.[field] || '').trim()) {
            fail(`${path.relative(cwd, absPath)} model ${modelKey} missing pricing.${field}`);
          }
        }

        const sourceRef = model?.source_ref || {};
        if (!String(sourceRef?.url || '').trim()) {
          fail(`${path.relative(cwd, absPath)} model ${modelKey} missing source_ref.url`);
        }
        if (!String(sourceRef?.retrieved_at || '').trim()) {
          fail(`${path.relative(cwd, absPath)} model ${modelKey} missing source_ref.retrieved_at`);
        }
      }

      if (requiredVoiceModels.size > 0 && voices.length === 0) {
        fail(`${path.relative(cwd, absPath)} must include voices when audio.synthesize models exist`);
      }

      const voiceSetToVoiceIDs = new Map();
      for (const voice of voices) {
        const voiceSetID = String(voice?.voice_set_id || '').trim();
        const voiceProvider = normalizeProviderName(voice?.provider || provider);
        const voiceID = String(voice?.voice_id || '').trim();
        const voiceName = String(voice?.name || '').trim();
        if (voiceProvider !== provider) {
          fail(`${path.relative(cwd, absPath)} voice ${voiceID || '<unknown>'} provider mismatch: ${voiceProvider}`);
        }
        if (!voiceSetID || !voiceID || !voiceName) {
          fail(`${path.relative(cwd, absPath)} voice entry must include voice_set_id/voice_id/name`);
          continue;
        }

        const voiceSetKey = `${provider}:${voiceSetID}`;
        if (!validVoiceSets.has(voiceSetKey)) {
          fail(`${path.relative(cwd, absPath)} voice ${voiceID} references undefined voice set: ${voiceSetKey}`);
        }

        const voicesInSet = voiceSetToVoiceIDs.get(voiceSetKey) || new Set();
        const normalizedVoiceID = voiceID.toLowerCase();
        if (voicesInSet.has(normalizedVoiceID)) {
          fail(`${path.relative(cwd, absPath)} has duplicate voice_id under ${voiceSetKey}: ${voiceID}`);
        }
        voicesInSet.add(normalizedVoiceID);
        voiceSetToVoiceIDs.set(voiceSetKey, voicesInSet);

        const langs = Array.isArray(voice?.langs) ? voice.langs : [];
        if (langs.length === 0) {
          fail(`${path.relative(cwd, absPath)} voice ${voiceSetKey}:${voiceID} must include langs`);
        }

        const modelIDs = Array.isArray(voice?.model_ids) ? voice.model_ids : [];
        if (modelIDs.length === 0) {
          fail(`${path.relative(cwd, absPath)} voice ${voiceSetKey}:${voiceID} must include model_ids`);
        }
        for (const modelIDRaw of modelIDs) {
          const modelID = String(modelIDRaw || '').trim();
          if (!modelID) {
            fail(`${path.relative(cwd, absPath)} voice ${voiceSetKey}:${voiceID} contains empty model_id`);
            continue;
          }
          const modelKey = `${provider}:${modelID}`;
          if (!modelKeySet.has(modelKey)) {
            fail(`${path.relative(cwd, absPath)} voice ${voiceSetKey}:${voiceID} references unknown model_id: ${modelKey}`);
            continue;
          }
          const expectedVoiceSet = modelToVoiceSet.get(modelKey);
          if (expectedVoiceSet && expectedVoiceSet !== voiceSetID) {
            fail(`${path.relative(cwd, absPath)} voice ${voiceSetKey}:${voiceID} mismatches model voice_set_id for ${modelKey}`);
          }
          const modelVoiceSet = modelToVoices.get(modelKey) || new Set();
          modelVoiceSet.add(voiceID);
          modelToVoices.set(modelKey, modelVoiceSet);
        }

        const sourceRef = voice?.source_ref || {};
        if (!String(sourceRef?.url || '').trim()) {
          fail(`${path.relative(cwd, absPath)} voice ${voiceSetKey}:${voiceID} missing source_ref.url`);
        }
        if (!String(sourceRef?.retrieved_at || '').trim()) {
          fail(`${path.relative(cwd, absPath)} voice ${voiceSetKey}:${voiceID} missing source_ref.retrieved_at`);
        }
      }

      for (const modelKey of requiredVoiceModels) {
        if (!modelToVoices.has(modelKey)) {
          fail(`${path.relative(cwd, absPath)} model ${modelKey} has no voice mapping`);
        }
      }

      if (provider === 'dashscope') {
        const requiredDashScopeModels = [
          'qwen3-tts-instruct-flash',
          'qwen3-tts-instruct-flash-2026-01-26',
          'qwen3-tts-flash',
        ];
        for (const modelID of requiredDashScopeModels) {
          const key = `dashscope:${modelID}`;
          if (!modelKeySet.has(key)) {
            fail(`${path.relative(cwd, absPath)} missing required dashscope model: ${modelID}`);
          }
        }
        const qwenVersionKey = 'dashscope:qwen3-tts-instruct-flash-2026-01-26';
        dashscopeModelVoices.set(qwenVersionKey, modelToVoices.get(qwenVersionKey) || new Set());
      }
    }

    for (const provider of listSourceProviderIDs()) {
      if (!seenProviders.has(provider)) {
        fail(`runtime/catalog/providers missing required provider file: ${provider}.yaml`);
      }
    }

    const qwenVersionKey = 'dashscope:qwen3-tts-instruct-flash-2026-01-26';
    const qwenVoices = dashscopeModelVoices.get(qwenVersionKey);
    if (!qwenVoices || qwenVoices.size === 0) {
      fail(`runtime/catalog/providers missing voices for ${qwenVersionKey}`);
      return;
    }
    if (qwenVoices.has('Haruto')) {
      fail(`runtime/catalog/providers must not include Haruto for ${qwenVersionKey}`);
    }
    for (const requiredVoice of ['cherry', 'serena']) {
      if (!qwenVoices.has(requiredVoice)) {
        fail(`runtime/catalog/providers missing required DashScope voice ${requiredVoice} for ${qwenVersionKey}`);
      }
    }
  }

  function checkTtsProviderCapabilityMatrix(kernelRuleSet) {
    const tablePath = 'spec/runtime/kernel/tables/tts-provider-capability-matrix.yaml';
    const table = readYaml(tablePath);
    const entries = Array.isArray(table?.entries) ? table.entries : [];
    if (entries.length === 0) {
      fail(`${tablePath} must include at least one entry`);
      return;
    }

    const allowedRuntimePlanes = new Set(['remote', 'local']);
    const allowedActivationStates = new Set(['active']);
    const allowedDiscoveryModes = new Set(['static_catalog', 'dynamic_user_scoped', 'mixed']);
    const seenProviderIDs = new Set();
    const activeProviders = new Set();

    for (const entry of entries) {
      const providerID = String(entry?.provider_id || '').trim();
      if (!providerID) {
        fail(`${tablePath} entry is missing provider_id`);
        continue;
      }
      if (seenProviderIDs.has(providerID)) {
        fail(`${tablePath} has duplicate provider_id: ${providerID}`);
        continue;
      }
      seenProviderIDs.add(providerID);

      const runtimePlane = String(entry?.runtime_plane || '').trim();
      if (!allowedRuntimePlanes.has(runtimePlane)) {
        fail(`${tablePath} provider ${providerID} has invalid runtime_plane: ${runtimePlane}`);
      }

      const activationState = String(entry?.activation_state || '').trim();
      if (!allowedActivationStates.has(activationState)) {
        fail(`${tablePath} provider ${providerID} has invalid activation_state: ${activationState}`);
      } else if (activationState === 'active') {
        activeProviders.add(providerID);
      }

      const discoveryMode = String(entry?.voice_discovery_mode || '').trim();
      if (!allowedDiscoveryModes.has(discoveryMode)) {
        fail(`${tablePath} provider ${providerID} has invalid voice_discovery_mode: ${discoveryMode}`);
      }

      for (const field of [
        'supports_tts_synthesize',
        'supports_tts_v2v',
        'supports_tts_t2v',
        'supports_timing_alignment',
      ]) {
        if (typeof entry?.[field] !== 'boolean') {
          fail(`${tablePath} provider ${providerID} must use boolean ${field}`);
        }
      }

      if (entry?.supports_tts_synthesize !== true) {
        fail(`${tablePath} provider ${providerID} must set supports_tts_synthesize=true`);
      }

      const sourceRule = String(entry?.source_rule || '').trim();
      if (!sourceRule) {
        fail(`${tablePath} provider ${providerID} must include source_rule`);
        continue;
      }
      if (!/^K-[A-Z]+-\d{3}$/u.test(sourceRule)) {
        fail(`${tablePath} provider ${providerID} has invalid source_rule format: ${sourceRule}`);
        continue;
      }
      if (!kernelRuleSet.has(sourceRule)) {
        fail(`${tablePath} provider ${providerID} references undefined source_rule: ${sourceRule}`);
      }

      const expectedActiveSnapshot = path.join(runtimeCatalogProvidersDir, `${providerID}.yaml`);
      if (!fs.existsSync(expectedActiveSnapshot)) {
        fail(`${tablePath} active provider ${providerID} missing runtime/catalog/providers/${providerID}.yaml`);
      }

      const sourceDir = path.join(cwd, 'runtime/catalog/source/providers');
      const sourcePath = path.join(sourceDir, `${providerID}.source.yaml`);
      const snapshotPath = path.join(runtimeCatalogProvidersDir, `${providerID}.yaml`);

      if (!fs.existsSync(sourcePath)) {
        fail(`${tablePath} provider ${providerID} missing source file: ${path.relative(cwd, sourcePath)}`);
        continue;
      }
      if (!fs.existsSync(snapshotPath)) {
        fail(`${tablePath} provider ${providerID} missing snapshot file: ${path.relative(cwd, snapshotPath)}`);
        continue;
      }

      const sourceDoc = YAML.parse(fs.readFileSync(sourcePath, 'utf8'));
      const snapshotDoc = YAML.parse(fs.readFileSync(snapshotPath, 'utf8'));

      const sourceProvider = normalizeProviderName(sourceDoc?.provider);
      const inferredRuntimePlane = sourceProvider === 'local' ? 'local' : 'remote';
      if (runtimePlane !== inferredRuntimePlane) {
        fail(`${tablePath} provider ${providerID} runtime_plane mismatch (matrix=${runtimePlane}, inferred=${inferredRuntimePlane})`);
      }

      const workflowModels = Array.isArray(sourceDoc?.voice_workflow_models) ? sourceDoc.voice_workflow_models : [];
      const inferredSupportsV2V = workflowModels.some((workflow) => String(workflow?.workflow_type || '').trim() === 'tts_v2v');
      const inferredSupportsT2V = workflowModels.some((workflow) => String(workflow?.workflow_type || '').trim() === 'tts_t2v');
      if (Boolean(entry?.supports_tts_v2v) !== inferredSupportsV2V) {
        fail(`${tablePath} provider ${providerID} supports_tts_v2v mismatch (matrix=${Boolean(entry?.supports_tts_v2v)}, inferred=${inferredSupportsV2V})`);
      }
      if (Boolean(entry?.supports_tts_t2v) !== inferredSupportsT2V) {
        fail(`${tablePath} provider ${providerID} supports_tts_t2v mismatch (matrix=${Boolean(entry?.supports_tts_t2v)}, inferred=${inferredSupportsT2V})`);
      }

      const snapshotModels = Array.isArray(snapshotDoc?.models) ? snapshotDoc.models : [];
      const ttsModels = snapshotModels.filter((model) => {
        const capabilities = Array.isArray(model?.capabilities) ? model.capabilities : [];
        return capabilities.some((capability) => {
          const normalized = String(capability || '').trim().toLowerCase();
          return normalized === 'audio.synthesize';
        });
      });
      const inferredSupportsSynthesize = ttsModels.length > 0;
      if (Boolean(entry?.supports_tts_synthesize) !== inferredSupportsSynthesize) {
        fail(`${tablePath} provider ${providerID} supports_tts_synthesize mismatch (matrix=${Boolean(entry?.supports_tts_synthesize)}, inferred=${inferredSupportsSynthesize})`);
      }

      const discoverySet = new Set(
        ttsModels.map((model) => String(model?.voice_discovery_mode || '').trim()).filter(Boolean),
      );
      if (inferredSupportsSynthesize && discoverySet.size === 0) {
        fail(`${tablePath} provider ${providerID} audio.synthesize models must include voice_discovery_mode`);
      } else if (discoverySet.size > 0) {
        const inferredDiscoveryMode = discoverySet.size === 1 ? [...discoverySet][0] : 'mixed';
        if (discoveryMode !== inferredDiscoveryMode) {
          fail(`${tablePath} provider ${providerID} voice_discovery_mode mismatch (matrix=${discoveryMode}, inferred=${inferredDiscoveryMode})`);
        }
      }

      for (const model of ttsModels) {
        const modelID = String(model?.model_id || '').trim() || '<unknown>';
        const modelDiscovery = String(model?.voice_discovery_mode || '').trim();
        const modelVoiceKinds = Array.isArray(model?.voice_ref_kinds)
          ? model.voice_ref_kinds.map((item) => String(item || '').trim()).filter(Boolean)
          : [];
        if (modelDiscovery === 'dynamic_user_scoped' && !modelVoiceKinds.includes('voice_asset_id')) {
          fail(`${tablePath} provider ${providerID} model ${modelID} dynamic_user_scoped must include voice_ref_kinds.voice_asset_id`);
        }
      }
    }

    for (const providerID of listTtsProvidersFromSnapshots()) {
      if (!activeProviders.has(providerID)) {
        fail(`${tablePath} missing active provider entry: ${providerID}`);
      }
    }
  }

  return {
    checkModelCatalogTables,
    checkProviderTableParity,
    checkSourceProviderCoverage,
    checkTtsProviderCapabilityMatrix,
  };
}
