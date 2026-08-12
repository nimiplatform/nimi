import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalAssetKind,
  LocalAssetStatus,
  LocalCapabilityInterpretability,
  LocalCapabilityReason,
  LocalCapabilityRequirementPolicy,
  LocalCapabilityRequirementResolution,
  LocalCapabilityRequirementRole,
  type AIConfig,
  type LocalAssetExactBinding,
  type LocalAssetRecord,
  type LocalCapabilityConfiguration,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client.js';
import { ReasonCode } from '../types/index.js';
import {
  NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE,
  NIMI_MACHINE_LOCAL_LLAMA_CPP_EMBED_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_QWEN3_ASR_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_QWEN3_TTS_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_QWEN3_VOICE_CREATE_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_IMAGE_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VOICE_CREATE_CAPABILITY_CONTRACT,
  createNimiMachineLocalAIConfigurationClient,
  createNimiMachineLocalLlamaCppEmbedConfigurationInput,
  createNimiMachineLocalLlamaCppTextConfigurationInput,
  createNimiMachineLocalQwen3ASRConfigurationInput,
  createNimiMachineLocalQwen3ASRTransformersConfigurationInput,
  createNimiMachineLocalQwen3TTSConfigurationInput,
  createNimiMachineLocalQwen3VoiceCreateConfigurationInput,
  createNimiMachineLocalStableDiffusionImageConfigurationInput,
  createNimiMachineLocalStableDiffusionVideoConfigurationInput,
  deriveNimiMachineLocalAIConfigurationImpact,
  fromNimiRuntimeProtoStruct,
  loadNimiMachineLocalAIConfigurationImpact,
  projectNimiMachineLocalCapabilityConfiguration,
  toNimiRuntimeProtoStruct,
  type NimiMachineLocalAIConfigurationRpcClient,
} from './index.js';

const MAIN_CONTENT_ID = `sha256:${'a'.repeat(64)}`;
const MAIN_ENTRY_SHA256 = 'a'.repeat(64);
const SECOND_CONTENT_ID = `sha256:${'b'.repeat(64)}`;
const SECOND_ENTRY_SHA256 = 'b'.repeat(64);

function exactBinding(
  localAssetId = 'asset-main',
  verifiedContentId = MAIN_CONTENT_ID,
  entrySha256 = MAIN_ENTRY_SHA256,
): LocalAssetExactBinding {
  return {
    requirementId: 'main.gguf',
    localAssetId,
    verifiedContentId,
    entrySha256,
  };
}

function rawConfiguration(input: {
  readonly resolution?: LocalCapabilityRequirementResolution;
  readonly bindings?: LocalAssetExactBinding[];
} = {}): LocalCapabilityConfiguration {
  return {
    configurationId: 'lcc_test',
    capabilityContract: NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION },
    portableConfig: toNimiRuntimeProtoStruct({ mainRequirementPolicy: 'substitutable' }),
    projectedRequirements: [{
      requirementId: 'main.gguf',
      role: LocalCapabilityRequirementRole.MAIN,
      resourceKind: 'gguf',
      policy: LocalCapabilityRequirementPolicy.SUBSTITUTABLE,
      preferredVerifiedContentId: '',
      compatibilityConstraints: toNimiRuntimeProtoStruct({
        engine: 'llama',
        artifact_role: 'llm',
      }),
      occurrenceOrdinal: 0,
      displayLabel: 'Main model',
    }],
    exactBindings: input.bindings ?? [],
    supportedFeatures: [],
    interpretability: LocalCapabilityInterpretability.INTERPRETABLE,
    requirementResolution: input.resolution
      ?? LocalCapabilityRequirementResolution.UNRESOLVED,
    reasons: input.resolution === LocalCapabilityRequirementResolution.CONFIGURED
      ? []
      : [LocalCapabilityReason.REQUIRED_BINDING_MISSING],
    displayName: 'Local writing model',
    provenance: toNimiRuntimeProtoStruct({ source: 'test' }),
  };
}

function localAssetRecord(): LocalAssetRecord {
  return {
    localAssetId: 'asset-main',
    assetId: 'local/main-model',
    kind: LocalAssetKind.CHAT,
    engine: 'llama',
    entry: 'model.gguf',
    files: ['model.gguf'],
    license: '',
    hashes: { 'model.gguf': MAIN_ENTRY_SHA256 },
    status: LocalAssetStatus.INSTALLED,
    installedAt: '',
    updatedAt: '',
    healthDetail: '',
    capabilities: ['text.generate'],
    logicalModelId: 'local/main-model',
    family: 'test',
    artifactRoles: ['llm'],
    preferredEngine: 'llama',
    fallbackEngines: [],
    bundleState: 0,
    localInvokeProfileId: '',
    endpoint: '',
    reasonCode: 0,
    displayName: 'Main model file',
    sourceFileName: 'model.gguf',
    importInstanceId: '',
  } as LocalAssetRecord;
}

test('Machine Local AI Configuration typed client maps every admitted RPC through one fixture carrier', async () => {
  const calls: Array<{
    readonly method: string;
    readonly request: unknown;
    readonly options?: RuntimeTypedCallOptions;
  }> = [];
  const unresolved = rawConfiguration();
  const configured = rawConfiguration({
    resolution: LocalCapabilityRequirementResolution.CONFIGURED,
    bindings: [exactBinding()],
  });
  const rebound = rawConfiguration({
    resolution: LocalCapabilityRequirementResolution.CONFIGURED,
    bindings: [exactBinding('asset-second', SECOND_CONTENT_ID, SECOND_ENTRY_SHA256)],
  });
  const fixture = {
    async getMachineLocalAIConfiguration(request, options) {
      calls.push({ method: 'get', request, options });
      return {
        aggregate: {
          configurations: [unresolved],
          selections: [{
            capabilityContract: NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
            configurationId: 'lcc_test',
            effectiveDefaults: toNimiRuntimeProtoStruct({ temperature: '0.8', seed: 'random' }),
          }],
        },
      };
    },
    async getLocalCapabilityConfiguration(request, options) {
      calls.push({ method: 'getConfiguration', request, options });
      return { configuration: unresolved };
    },
    async addLocalCapabilityConfiguration(request, options) {
      calls.push({ method: 'add', request, options });
      return { configuration: unresolved };
    },
    async updateLocalCapabilityConfiguration(request, options) {
      calls.push({ method: 'update', request, options });
      return { configuration: configured };
    },
    async selectLocalCapabilityConfiguration(request, options) {
      calls.push({ method: 'select', request, options });
      return { selection: request };
    },
    async clearLocalCapabilitySelection(request, options) {
      calls.push({ method: 'clearSelection', request, options });
      return {};
    },
    async deleteLocalCapabilityConfiguration(request, options) {
      calls.push({ method: 'delete', request, options });
      return {};
    },
    async reprojectLocalCapabilityRequirements(request, options) {
      calls.push({ method: 'reproject', request, options });
      return { configuration: unresolved };
    },
    async bindLocalCapabilityRequirement(request, options) {
      calls.push({ method: 'bind', request, options });
      return { configuration: configured };
    },
    async rebindLocalCapabilityRequirement(request, options) {
      calls.push({ method: 'rebind', request, options });
      return { configuration: rebound };
    },
    async unbindLocalCapabilityRequirement(request, options) {
      calls.push({ method: 'unbind', request, options });
      return { configuration: unresolved };
    },
    async listLocalAssets(request, options) {
      calls.push({ method: 'listLocalAssets', request, options });
      return { assets: [localAssetRecord()], nextPageToken: '' };
    },
  } satisfies NimiMachineLocalAIConfigurationRpcClient;
  const defaultOptions = { timeoutMs: 321 } satisfies RuntimeTypedCallOptions;
  const client = createNimiMachineLocalAIConfigurationClient({
    runtime: fixture,
    callOptions: defaultOptions,
  });

  const aggregate = await client.get();
  assert.equal(aggregate.configurations[0]?.requirementResolution, 'unresolved');
  assert.equal(aggregate.configurations[0]?.projectedRequirements[0]?.occurrenceOrdinal, 0);
  assert.equal(aggregate.configurations[0]?.projectedRequirements[0]?.displayLabel, 'Main model');
  assert.deepEqual(aggregate.selections, [{
    capabilityContract: 'text.generate',
    configurationId: 'lcc_test',
    effectiveDefaults: { temperature: '0.8', seed: 'random' },
  }]);

  const textOnlyInput = createNimiMachineLocalLlamaCppTextConfigurationInput({
    displayName: 'Text-only model',
  });
  assert.deepEqual(textOnlyInput.supportedFeatures, []);
  assert.deepEqual(textOnlyInput.portableConfig, {
    mainRequirementPolicy: 'substitutable',
  });
  const embedInput = createNimiMachineLocalLlamaCppEmbedConfigurationInput({
    displayName: 'Local embedding model',
    contextSize: 4096,
  });
  assert.equal(embedInput.capabilityContract, NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT);
  assert.deepEqual(embedInput.implementation, NIMI_MACHINE_LOCAL_LLAMA_CPP_EMBED_IMPLEMENTATION);
  assert.deepEqual(embedInput.portableConfig, {
    mainRequirementPolicy: 'substitutable',
    contextSize: 4096,
  });
  assert.deepEqual(embedInput.supportedFeatures, []);
  const ttsInput = createNimiMachineLocalQwen3TTSConfigurationInput({
    displayName: 'Local speech synthesis',
  });
  assert.equal(ttsInput.capabilityContract, NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT);
  assert.deepEqual(ttsInput.implementation, NIMI_MACHINE_LOCAL_QWEN3_TTS_IMPLEMENTATION);
  assert.deepEqual(ttsInput.portableConfig, {});
  assert.deepEqual(ttsInput.supportedFeatures, []);
  const referenceVoiceInput = createNimiMachineLocalQwen3VoiceCreateConfigurationInput({
    displayName: 'Local reference voice',
    source: 'reference-audio',
  });
  assert.equal(referenceVoiceInput.capabilityContract, NIMI_MACHINE_LOCAL_VOICE_CREATE_CAPABILITY_CONTRACT);
  assert.deepEqual(referenceVoiceInput.implementation, NIMI_MACHINE_LOCAL_QWEN3_VOICE_CREATE_IMPLEMENTATION);
  assert.deepEqual(referenceVoiceInput.portableConfig, {});
  assert.deepEqual(referenceVoiceInput.supportedFeatures, ['input.audio']);
  const describedVoiceInput = createNimiMachineLocalQwen3VoiceCreateConfigurationInput({
    displayName: 'Local described voice',
    source: 'text-description',
  });
  assert.deepEqual(describedVoiceInput.supportedFeatures, ['input.text']);
  assert.throws(
    () => createNimiMachineLocalQwen3VoiceCreateConfigurationInput({
      displayName: 'Invalid voice',
      source: 'clone' as 'reference-audio',
    }),
    /source must be reference-audio or text-description/u,
  );
  const asrInput = createNimiMachineLocalQwen3ASRConfigurationInput({
    displayName: 'Local speech transcription',
  });
  assert.equal(asrInput.capabilityContract, NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT);
  assert.deepEqual(asrInput.implementation, NIMI_MACHINE_LOCAL_QWEN3_ASR_IMPLEMENTATION);
  assert.deepEqual(asrInput.portableConfig, {});
  assert.deepEqual(asrInput.supportedFeatures, []);
  const transformersASRInput = createNimiMachineLocalQwen3ASRTransformersConfigurationInput({
    displayName: 'Transformers-native local speech transcription',
  });
  assert.equal(transformersASRInput.capabilityContract, NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT);
  assert.deepEqual(transformersASRInput.implementation, NIMI_MACHINE_LOCAL_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION);
  assert.deepEqual(transformersASRInput.portableConfig, {});
  assert.deepEqual(transformersASRInput.supportedFeatures, []);
  const addInput = createNimiMachineLocalLlamaCppTextConfigurationInput({
    displayName: 'Local writing model',
    acceptsImageInput: true,
    contextSize: 8192,
  });
  assert.deepEqual(addInput.supportedFeatures, [NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE]);
  await client.addConfiguration(addInput);
  await client.updateConfiguration({
    configurationId: 'lcc_test',
    portableConfig: addInput.portableConfig,
    supportedFeatures: addInput.supportedFeatures,
    displayName: addInput.displayName,
  });
  await client.getConfiguration('lcc_test');
  await client.reprojectRequirements('lcc_test');
  await client.select('text.generate', 'lcc_test');
  await client.clearSelection('text.generate');
  await client.bindRequirement({
    configurationId: 'lcc_test',
    requirementId: 'main.gguf',
    target: {
      localAssetId: 'asset-main',
      expectedVerifiedContentId: MAIN_CONTENT_ID,
    },
  });
  await client.rebindRequirement({
    configurationId: 'lcc_test',
    requirementId: 'main.gguf',
    expectedCurrentBinding: {
      requirementId: 'main.gguf',
      localAssetId: 'asset-main',
      verifiedContentId: MAIN_CONTENT_ID,
      entrySha256: MAIN_ENTRY_SHA256,
    },
    target: {
      localAssetId: 'asset-second',
      expectedVerifiedContentId: SECOND_CONTENT_ID,
    },
  });
  await client.unbindRequirement({
    configurationId: 'lcc_test',
    requirementId: 'main.gguf',
    expectedCurrentBinding: {
      requirementId: 'main.gguf',
      localAssetId: 'asset-second',
      verifiedContentId: SECOND_CONTENT_ID,
      entrySha256: SECOND_ENTRY_SHA256,
    },
  });
  await client.deleteConfiguration('lcc_test');
  const assets = await client.listLocalAssets({ engine: 'llama' });

  assert.equal(assets[0]?.expectedVerifiedContentId, MAIN_CONTENT_ID);
  assert.deepEqual(calls.map((call) => call.method), [
    'get',
    'add',
    'update',
    'getConfiguration',
    'reproject',
    'select',
    'clearSelection',
    'bind',
    'rebind',
    'unbind',
    'delete',
    'listLocalAssets',
  ]);
  const addCall = calls.find((call) => call.method === 'add');
  const addRequest = addCall?.request as {
    portableConfig?: Parameters<typeof fromNimiRuntimeProtoStruct>[0];
    supportedFeatures: string[];
  };
  assert.deepEqual(fromNimiRuntimeProtoStruct(addRequest.portableConfig), {
    mainRequirementPolicy: 'substitutable',
    mmprojRequirementPolicy: 'substitutable',
    contextSize: 8192,
  });
  assert.deepEqual(addRequest.supportedFeatures, ['input.image']);
  for (const call of calls.filter((item) => !['get', 'getConfiguration', 'listLocalAssets'].includes(item.method))) {
    assert.match(String(call.options?.metadata?.idempotencyKey), /^machine-local-ai-/u);
  }
});

test('stable-diffusion image configuration constructor emits only supported Driver portable fields', () => {
  const strictContentId = `sha256:${'c'.repeat(64)}`;
  const input = createNimiMachineLocalStableDiffusionImageConfigurationInput({
    displayName: 'Local image studio',
    modelFamily: 'ideogram4',
    enableInputImage: true,
    mainRequirementPolicy: 'strict',
    mainVerifiedContentId: strictContentId,
    textEncoderRequirementPolicy: 'substitutable',
    vaeRequirementPolicy: 'substitutable',
    uncondDiffusionRequirementPolicy: 'substitutable',
    executionOptions: {
      steps: 30,
      cfgScale: 6.5,
      width: 1024,
      height: 768,
      seed: -1,
      sampler: 'euler_a',
      scheduler: 'karras',
      threads: 8,
      diffusionFlashAttention: true,
      offloadParamsToCPU: false,
    },
  });

  assert.equal(input.capabilityContract, NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT);
  assert.deepEqual(input.implementation, NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_IMAGE_IMPLEMENTATION);
  assert.deepEqual(input.supportedFeatures, [NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE]);
  assert.deepEqual(input.portableConfig, {
    modelFamily: 'ideogram4',
    enableInputImage: true,
    mainRequirementPolicy: 'strict',
    mainVerifiedContentId: strictContentId,
    textEncoderRequirementPolicy: 'substitutable',
    vaeRequirementPolicy: 'substitutable',
    uncondDiffusionRequirementPolicy: 'substitutable',
    executionOptions: {
      steps: 30,
      cfgScale: 6.5,
      width: 1024,
      height: 768,
      seed: -1,
      sampler: 'euler_a',
      scheduler: 'karras',
      threads: 8,
      diffusionFlashAttention: true,
      offloadParamsToCPU: false,
    },
  });

  assert.throws(
    () => createNimiMachineLocalStableDiffusionImageConfigurationInput({
      displayName: 'Unsupported LoRA configuration',
      modelFamily: 'z-image',
      loras: [],
    } as never),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AI_INPUT_INVALID);
      return true;
    },
  );
  assert.throws(
    () => createNimiMachineLocalStableDiffusionImageConfigurationInput({
      displayName: 'Invalid strict slot',
      modelFamily: 'z-image',
      mainRequirementPolicy: 'strict',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AI_INPUT_INVALID);
      return true;
    },
  );
  assert.throws(
    () => createNimiMachineLocalStableDiffusionImageConfigurationInput({
      displayName: 'Invalid dimensions',
      modelFamily: 'z-image',
      executionOptions: { width: 1025 },
    }),
    /multiple of eight/u,
  );
  assert.throws(
    () => createNimiMachineLocalStableDiffusionImageConfigurationInput({
      displayName: 'Injected portable key',
      modelFamily: 'z-image',
      provider: 'not-a-driver-field',
    } as never),
    /unsupported fields/u,
  );
});

test('stable-diffusion image configuration constrains seed to the managed signed-int32 carrier', () => {
  for (const seed of [-2147483648, 2147483647]) {
    const input = createNimiMachineLocalStableDiffusionImageConfigurationInput({
      displayName: `Local image seed ${seed}`,
      modelFamily: 'z-image',
      executionOptions: { seed },
    });
    assert.equal(
      (input.portableConfig.executionOptions as { seed?: number } | undefined)?.seed,
      seed,
    );
  }
  for (const seed of [-2147483649, 2147483648]) {
    assert.throws(
      () => createNimiMachineLocalStableDiffusionImageConfigurationInput({
        displayName: `Invalid local image seed ${seed}`,
        modelFamily: 'z-image',
        executionOptions: { seed },
      }),
      (error: unknown) => {
        assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AI_INPUT_INVALID);
        return true;
      },
    );
  }
});

test('stable-diffusion video configuration constructor emits only Driver portable fields in ordered form', () => {
  const fl2vaContentId = `sha256:${'e'.repeat(64)}`;
  const input = createNimiMachineLocalStableDiffusionVideoConfigurationInput({
    displayName: 'Local video studio',
    enableInputImage: true,
    fl2vaRequirementPolicy: 'strict',
    fl2vaVerifiedContentId: fl2vaContentId,
    ref2vaRequirementPolicy: 'substitutable',
    encoderRequirementPolicy: 'substitutable',
    videoVAERequirementPolicy: 'substitutable',
    audioVAERequirementPolicy: 'substitutable',
  });

  assert.equal(input.capabilityContract, NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT);
  assert.deepEqual(input.implementation, NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION);
  assert.deepEqual(input.supportedFeatures, [NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE]);
  assert.deepEqual(input.portableConfig, {
    fl2vaRequirementPolicy: 'strict',
    fl2vaVerifiedContentId: fl2vaContentId,
    ref2vaRequirementPolicy: 'substitutable',
    encoderRequirementPolicy: 'substitutable',
    videoVAERequirementPolicy: 'substitutable',
    audioVAERequirementPolicy: 'substitutable',
  });

  const defaults = createNimiMachineLocalStableDiffusionVideoConfigurationInput({
    displayName: 'Default video studio',
  });
  assert.deepEqual(defaults.portableConfig, {});
  assert.deepEqual(defaults.supportedFeatures, []);

  assert.throws(
    () => createNimiMachineLocalStableDiffusionVideoConfigurationInput({
      displayName: 'Invalid strict slot',
      fl2vaRequirementPolicy: 'strict',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AI_INPUT_INVALID);
      return true;
    },
  );
  assert.throws(
    () => createNimiMachineLocalStableDiffusionVideoConfigurationInput({
      displayName: 'Invalid content identity',
      videoVAEVerifiedContentId: 'not-a-digest',
    }),
    /canonical sha256 content identity/u,
  );
  assert.throws(
    () => createNimiMachineLocalStableDiffusionVideoConfigurationInput({
      displayName: 'Injected portable key',
      modelFamily: 'minimax-h3',
    } as never),
    /unsupported fields/u,
  );
});

function impactAIConfig(input: {
  readonly owner: 'app' | 'shared';
  readonly ownerId?: string;
  readonly route: 'local' | 'cloud';
  readonly requiredFeatures?: string[];
}): AIConfig {
  return {
    owner: input.owner === 'app'
      ? { owner: { oneofKind: 'app', app: { appId: input.ownerId ?? 'app.test' } } }
      : { owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} } },
    capabilities: [{
      capabilityContract: NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
      requiredFeatures: input.requiredFeatures ?? [],
      defaults: toNimiRuntimeProtoStruct({ steps: 24 }),
      route: input.route === 'local'
        ? { oneofKind: 'local', local: {} }
        : {
          oneofKind: 'cloud',
          cloud: {
            implementation: { implementationId: 'cloud.image', driverId: 'cloud.driver', driverDialect: 'v1' },
            providerModelTarget: toNimiRuntimeProtoStruct({ provider: 'cloud', model: 'image' }),
          },
        },
    }],
  };
}

test('Machine Local AI Configuration impact is derived ephemerally from Local feature-subset owners', async () => {
  const projected = projectNimiMachineLocalCapabilityConfiguration({
    ...rawConfiguration(),
    configurationId: 'lcc_image',
    capabilityContract: NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_IMAGE_IMPLEMENTATION },
    supportedFeatures: [NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE],
  });
  const machine = {
    configurations: [projected],
    selections: [{
      capabilityContract: NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
      configurationId: 'lcc_image',
      effectiveDefaults: null,
    }],
  };
  const matchingApp = impactAIConfig({
    owner: 'app',
    ownerId: 'app.image-editor',
    route: 'local',
    requiredFeatures: [NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE],
  });
  const matchingSharedAgent = impactAIConfig({ owner: 'shared', route: 'local' });
  const cloudApp = impactAIConfig({ owner: 'app', ownerId: 'app.cloud', route: 'cloud' });
  const featureMismatch = impactAIConfig({
    owner: 'app',
    ownerId: 'app.future-feature',
    route: 'local',
    requiredFeatures: ['future.feature'],
  });

  const impact = deriveNimiMachineLocalAIConfigurationImpact({
    operation: 'delete',
    capabilityContract: NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
    configurationId: 'lcc_image',
    machine,
    aiConfigs: [matchingSharedAgent, cloudApp, matchingApp, featureMismatch],
  });
  assert.deepEqual(impact.affectedOwners, [
    {
      kind: 'app',
      ownerId: 'app.image-editor',
      requiredFeatures: [NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE],
    },
    { kind: 'shared-local-agent', ownerId: 'shared-local-agent', requiredFeatures: [] },
  ]);
  assert.equal('ownerIndex' in impact, false);

  let machineReads = 0;
  const loaded = await loadNimiMachineLocalAIConfigurationImpact({
    operation: 'select',
    capabilityContract: NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
    configurationId: 'lcc_image',
    machine: {
      async get() {
        machineReads += 1;
        return machine;
      },
    },
    aiConfigs: [
      { async get() { return matchingApp; } },
      { async get() { throw { reasonCode: 'AI_CONFIG_NOT_FOUND' }; } },
      { async get() { return matchingSharedAgent; } },
    ],
  });
  assert.equal(machineReads, 1);
  assert.deepEqual(loaded.affectedOwners.map((owner) => owner.kind), [
    'app',
    'shared-local-agent',
  ]);
});

test('Machine Local AI Configuration client fails closed on injected input before transport', async () => {
  let calls = 0;
  const fixture = {
    async getMachineLocalAIConfiguration() {
      calls += 1;
      return { aggregate: { configurations: [], selections: [] } };
    },
    async getLocalCapabilityConfiguration() {
      calls += 1;
      return { configuration: rawConfiguration() };
    },
    async addLocalCapabilityConfiguration() {
      calls += 1;
      return { configuration: rawConfiguration() };
    },
    async selectLocalCapabilityConfiguration() {
      calls += 1;
      return { selection: { capabilityContract: 'text.generate', configurationId: 'lcc_test' } };
    },
    async clearLocalCapabilitySelection() { calls += 1; return {}; },
    async deleteLocalCapabilityConfiguration() { calls += 1; return {}; },
    async reprojectLocalCapabilityRequirements() {
      calls += 1;
      return { configuration: rawConfiguration() };
    },
    async bindLocalCapabilityRequirement() {
      calls += 1;
      return { configuration: rawConfiguration() };
    },
    async rebindLocalCapabilityRequirement() {
      calls += 1;
      return { configuration: rawConfiguration() };
    },
    async unbindLocalCapabilityRequirement() {
      calls += 1;
      return { configuration: rawConfiguration() };
    },
    async listLocalAssets() { calls += 1; return { assets: [], nextPageToken: '' }; },
  } satisfies NimiMachineLocalAIConfigurationRpcClient;
  const client = createNimiMachineLocalAIConfigurationClient({ runtime: fixture });
  const valid = createNimiMachineLocalLlamaCppTextConfigurationInput({ displayName: 'Local text' });

  await assert.rejects(
    client.addConfiguration({ ...valid, owner: { machine: true } } as never),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AI_INPUT_INVALID);
      return true;
    },
  );
  await assert.rejects(
    client.bindRequirement({
      configurationId: 'lcc_test',
      requirementId: 'main.gguf',
      target: {
        localAssetId: 'asset-main',
        expectedVerifiedContentId: 'not-canonical',
      },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AI_INPUT_INVALID);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test('Machine Local AI Configuration projection rejects missing and dangling Runtime truth', async () => {
  const base = {
    async getLocalCapabilityConfiguration() { return { configuration: rawConfiguration() }; },
    async addLocalCapabilityConfiguration() { return { configuration: rawConfiguration() }; },
    async selectLocalCapabilityConfiguration() {
      return { selection: { capabilityContract: 'text.generate', configurationId: 'lcc_test' } };
    },
    async clearLocalCapabilitySelection() { return {}; },
    async deleteLocalCapabilityConfiguration() { return {}; },
    async reprojectLocalCapabilityRequirements() { return { configuration: rawConfiguration() }; },
    async bindLocalCapabilityRequirement() { return { configuration: rawConfiguration() }; },
    async rebindLocalCapabilityRequirement() { return { configuration: rawConfiguration() }; },
    async unbindLocalCapabilityRequirement() { return { configuration: rawConfiguration() }; },
    async listLocalAssets() { return { assets: [], nextPageToken: '' }; },
  };
  const missingAggregate = createNimiMachineLocalAIConfigurationClient({
    runtime: {
      ...base,
      async getMachineLocalAIConfiguration() { return {}; },
    } satisfies NimiMachineLocalAIConfigurationRpcClient,
  });
  await assert.rejects(
    missingAggregate.get(),
    (error: unknown) => {
      assert.equal(
        (error as { reasonCode?: string }).reasonCode,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
      return true;
    },
  );

  const danglingSelection = createNimiMachineLocalAIConfigurationClient({
    runtime: {
      ...base,
      async getMachineLocalAIConfiguration() {
        return {
          aggregate: {
            configurations: [rawConfiguration()],
            selections: [{
              capabilityContract: 'text.generate',
              configurationId: 'lcc_missing',
            }],
          },
        };
      },
    } satisfies NimiMachineLocalAIConfigurationRpcClient,
  });
  await assert.rejects(
    danglingSelection.get(),
    (error: unknown) => {
      assert.equal(
        (error as { reasonCode?: string }).reasonCode,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
      return true;
    },
  );
});
