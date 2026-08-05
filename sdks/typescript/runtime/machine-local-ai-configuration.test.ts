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
  type LocalAssetExactBinding,
  type LocalAssetRecord,
  type LocalCapabilityConfiguration,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client.js';
import { ReasonCode } from '../types/index.js';
import {
  NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE,
  NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  createNimiMachineLocalAIConfigurationClient,
  createNimiMachineLocalLlamaCppTextConfigurationInput,
  fromNimiRuntimeProtoStruct,
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
    warmState: 0,
    localInvokeProfileId: '',
    endpoint: '',
    reasonCode: 0,
    displayName: 'Main model file',
    sourceFileName: 'model.gguf',
    importInstanceId: '',
    durableTargetStatus: LocalAssetStatus.UNSPECIFIED,
    durableTargetReasonCode: 0,
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
  assert.deepEqual(aggregate.selections, [{
    capabilityContract: 'text.generate',
    configurationId: 'lcc_test',
  }]);

  const textOnlyInput = createNimiMachineLocalLlamaCppTextConfigurationInput({
    displayName: 'Text-only model',
  });
  assert.deepEqual(textOnlyInput.supportedFeatures, []);
  assert.deepEqual(textOnlyInput.portableConfig, {
    mainRequirementPolicy: 'substitutable',
  });
  const addInput = createNimiMachineLocalLlamaCppTextConfigurationInput({
    displayName: 'Local writing model',
    acceptsImageInput: true,
  });
  assert.deepEqual(addInput.supportedFeatures, [NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE]);
  await client.addConfiguration(addInput);
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
  });
  assert.deepEqual(addRequest.supportedFeatures, ['input.image']);
  for (const call of calls.filter((item) => !['get', 'getConfiguration', 'listLocalAssets'].includes(item.method))) {
    assert.match(String(call.options?.metadata?.idempotencyKey), /^machine-local-ai-/u);
  }
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
