import {
  LocalCapabilityInterpretability,
  LocalCapabilityReason,
  LocalCapabilityRequirementPolicy,
  LocalCapabilityRequirementResolution,
  LocalCapabilityRequirementRole,
  type CapabilityImplementationIdentity,
  type LocalAssetExactBinding,
  type LocalCapabilityConfiguration,
  type LocalCapabilityRequirement,
  type LocalCapabilitySelection,
  type MachineLocalAIConfiguration,
  type RuntimeTypedCallOptions,
  type RuntimeTypedClient,
} from '../core-generated/runtime-typed-client.js';
import {
  createNimiClientId,
  createNimiError,
  isJsonObject,
  ReasonCode,
  type JsonObject,
  type JsonValue,
} from '../types/index.js';
import {
  listNimiRuntimeLocalAssetEntries,
  type NimiRuntimeLocalAssetEntry,
  type NimiRuntimeLocalAssetListInput,
} from './runtime-local-assets.js';
import {
  fromNimiRuntimeProtoStruct,
  toNimiRuntimeProtoStruct,
} from './runtime-agent-values.js';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs.js';

export const NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT = 'text.generate';
export const NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE = 'input.image';

export const NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.text.generate.llama-cpp',
  driverId: 'nimi.runtime.driver.llama-cpp',
  driverDialect: 'llama.cpp/text-generate/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export type NimiMachineLocalCapabilityInterpretability =
  | 'interpretable'
  | 'unavailable';

export type NimiMachineLocalCapabilityRequirementResolution =
  | 'unresolved'
  | 'configured';

export type NimiMachineLocalCapabilityRequirementRole = 'main' | 'companion';
export type NimiMachineLocalCapabilityRequirementPolicy = 'strict' | 'substitutable';

export type NimiMachineLocalCapabilityReason =
  | 'driver_not_found'
  | 'driver_dialect_unsupported'
  | 'implementation_unsupported'
  | 'portable_config_invalid'
  | 'feature_unsupported'
  | 'required_binding_missing'
  | 'binding_ambiguous'
  | 'local_asset_not_found'
  | 'local_asset_content_unverified'
  | 'local_asset_content_mismatch'
  | 'local_asset_incompatible';

export interface NimiMachineLocalCapabilityImplementation {
  readonly implementationId: string;
  readonly driverId: string;
  readonly driverDialect: string;
}

export interface NimiMachineLocalCapabilityRequirement {
  readonly requirementId: string;
  readonly role: NimiMachineLocalCapabilityRequirementRole;
  readonly resourceKind: string;
  readonly policy: NimiMachineLocalCapabilityRequirementPolicy;
  readonly preferredVerifiedContentId?: string;
  readonly compatibilityConstraints?: Readonly<JsonObject>;
}

export interface NimiMachineLocalAssetExactBinding {
  readonly requirementId: string;
  readonly localAssetId: string;
  readonly verifiedContentId: string;
  readonly entrySha256: string;
}

export interface NimiMachineLocalCapabilityConfiguration {
  readonly configurationId: string;
  readonly capabilityContract: string;
  readonly implementation: NimiMachineLocalCapabilityImplementation;
  readonly portableConfig?: Readonly<JsonObject>;
  readonly projectedRequirements: readonly NimiMachineLocalCapabilityRequirement[];
  readonly exactBindings: readonly NimiMachineLocalAssetExactBinding[];
  readonly supportedFeatures: readonly string[];
  readonly interpretability: NimiMachineLocalCapabilityInterpretability;
  readonly requirementResolution: NimiMachineLocalCapabilityRequirementResolution;
  readonly reasons: readonly NimiMachineLocalCapabilityReason[];
  readonly displayName: string;
  readonly provenance?: Readonly<JsonObject>;
}

export interface NimiMachineLocalCapabilitySelection {
  readonly capabilityContract: string;
  readonly configurationId: string;
}

export interface NimiMachineLocalAIConfiguration {
  readonly configurations: readonly NimiMachineLocalCapabilityConfiguration[];
  readonly selections: readonly NimiMachineLocalCapabilitySelection[];
}

export interface NimiMachineLocalAIConfigurationAddInput {
  readonly capabilityContract: string;
  readonly implementation: NimiMachineLocalCapabilityImplementation;
  readonly portableConfig?: Readonly<JsonObject>;
  readonly supportedFeatures?: readonly string[];
  readonly displayName: string;
  readonly provenance?: Readonly<JsonObject>;
}

export interface NimiMachineLocalAIConfigurationBindingTarget {
  readonly localAssetId: string;
  readonly expectedVerifiedContentId: string;
}

export interface NimiMachineLocalAIConfigurationBindInput {
  readonly configurationId: string;
  readonly requirementId: string;
  readonly target: NimiMachineLocalAIConfigurationBindingTarget;
}

export interface NimiMachineLocalAIConfigurationRebindInput
  extends NimiMachineLocalAIConfigurationBindInput {
  readonly expectedCurrentBinding: NimiMachineLocalAssetExactBinding;
}

export interface NimiMachineLocalAIConfigurationUnbindInput {
  readonly configurationId: string;
  readonly requirementId: string;
  readonly expectedCurrentBinding: NimiMachineLocalAssetExactBinding;
}

export type NimiMachineLocalAIConfigurationRpcClient = Pick<
  RuntimeTypedClient,
  | 'getMachineLocalAIConfiguration'
  | 'getLocalCapabilityConfiguration'
  | 'addLocalCapabilityConfiguration'
  | 'selectLocalCapabilityConfiguration'
  | 'clearLocalCapabilitySelection'
  | 'deleteLocalCapabilityConfiguration'
  | 'reprojectLocalCapabilityRequirements'
  | 'bindLocalCapabilityRequirement'
  | 'rebindLocalCapabilityRequirement'
  | 'unbindLocalCapabilityRequirement'
  | 'listLocalAssets'
>;

export interface NimiMachineLocalAIConfigurationClient {
  get(options?: RuntimeTypedCallOptions): Promise<NimiMachineLocalAIConfiguration>;
  addConfiguration(
    input: NimiMachineLocalAIConfigurationAddInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  deleteConfiguration(
    configurationId: string,
    options?: RuntimeTypedCallOptions,
  ): Promise<void>;
  getConfiguration(
    configurationId: string,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  reprojectRequirements(
    configurationId: string,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  select(
    capabilityContract: string,
    configurationId: string,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilitySelection>;
  clearSelection(
    capabilityContract: string,
    options?: RuntimeTypedCallOptions,
  ): Promise<void>;
  bindRequirement(
    input: NimiMachineLocalAIConfigurationBindInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  rebindRequirement(
    input: NimiMachineLocalAIConfigurationRebindInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  unbindRequirement(
    input: NimiMachineLocalAIConfigurationUnbindInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  listLocalAssets(
    filter?: NimiRuntimeLocalAssetListInput,
  ): Promise<readonly NimiRuntimeLocalAssetEntry[]>;
}

export function createNimiMachineLocalLlamaCppTextConfigurationInput(input: {
  readonly displayName: string;
  readonly acceptsImageInput?: boolean;
}): NimiMachineLocalAIConfigurationAddInput {
  assertExactRecord(input, new Set(['displayName', 'acceptsImageInput']), 'llama.cpp configuration input');
  const displayName = requireInputText(input.displayName, 'displayName');
  if (input.acceptsImageInput !== undefined && typeof input.acceptsImageInput !== 'boolean') {
    return inputError('acceptsImageInput must be a boolean when provided');
  }
  const acceptsImageInput = input.acceptsImageInput === true;
  return {
    capabilityContract: NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION },
    portableConfig: acceptsImageInput
      ? {
        mainRequirementPolicy: 'substitutable',
        mmprojRequirementPolicy: 'substitutable',
      }
      : { mainRequirementPolicy: 'substitutable' },
    supportedFeatures: acceptsImageInput
      ? [NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE]
      : [],
    displayName,
  };
}

export function createNimiMachineLocalAIConfigurationClient(input: {
  readonly runtime: NimiMachineLocalAIConfigurationRpcClient;
  readonly callOptions?: RuntimeTypedCallOptions;
}): NimiMachineLocalAIConfigurationClient {
  const runtime = requireRpcClient(input?.runtime);
  const defaultCallOptions = input.callOptions;
  const readOptions = (options?: RuntimeTypedCallOptions) => options ?? defaultCallOptions;
  const writeOptions = (operation: string, options?: RuntimeTypedCallOptions) => (
    withNimiRuntimeIdempotencyMetadata(
      readOptions(options),
      createNimiClientId(`machine-local-ai-${operation}`),
    )
  );

  return Object.freeze({
    async get(options?: RuntimeTypedCallOptions) {
      const response = await runtime.getMachineLocalAIConfiguration({}, readOptions(options));
      if (!response.aggregate) {
        return responseError('GetMachineLocalAIConfiguration returned no aggregate');
      }
      return projectNimiMachineLocalAIConfiguration(response.aggregate);
    },

    async addConfiguration(
      value: NimiMachineLocalAIConfigurationAddInput,
      options?: RuntimeTypedCallOptions,
    ) {
      const request = buildAddRequest(value);
      const response = await runtime.addLocalCapabilityConfiguration(
        request,
        writeOptions('add', options),
      );
      const configuration = requireConfigurationResponse(
        response.configuration,
        'AddLocalCapabilityConfiguration',
      );
      if (configuration.capabilityContract !== request.capabilityContract) {
        return responseError('AddLocalCapabilityConfiguration returned a mismatched capability contract');
      }
      return configuration;
    },

    async deleteConfiguration(configurationId: string, options?: RuntimeTypedCallOptions) {
      await runtime.deleteLocalCapabilityConfiguration(
        { configurationId: requireInputText(configurationId, 'configurationId') },
        writeOptions('delete', options),
      );
    },

    async getConfiguration(configurationId: string, options?: RuntimeTypedCallOptions) {
      const expectedId = requireInputText(configurationId, 'configurationId');
      const response = await runtime.getLocalCapabilityConfiguration(
        { configurationId: expectedId },
        readOptions(options),
      );
      return requireConfigurationIdentity(
        requireConfigurationResponse(response.configuration, 'GetLocalCapabilityConfiguration'),
        expectedId,
        'GetLocalCapabilityConfiguration',
      );
    },

    async reprojectRequirements(configurationId: string, options?: RuntimeTypedCallOptions) {
      const expectedId = requireInputText(configurationId, 'configurationId');
      const response = await runtime.reprojectLocalCapabilityRequirements(
        { configurationId: expectedId },
        writeOptions('reproject', options),
      );
      return requireConfigurationIdentity(
        requireConfigurationResponse(response.configuration, 'ReprojectLocalCapabilityRequirements'),
        expectedId,
        'ReprojectLocalCapabilityRequirements',
      );
    },

    async select(
      capabilityContract: string,
      configurationId: string,
      options?: RuntimeTypedCallOptions,
    ) {
      const expectedCapability = requireInputText(capabilityContract, 'capabilityContract');
      const expectedConfigurationId = requireInputText(configurationId, 'configurationId');
      const response = await runtime.selectLocalCapabilityConfiguration({
        capabilityContract: expectedCapability,
        configurationId: expectedConfigurationId,
      }, writeOptions('select', options));
      const selection = projectSelection(response.selection, 'SelectLocalCapabilityConfiguration');
      if (
        selection.capabilityContract !== expectedCapability
        || selection.configurationId !== expectedConfigurationId
      ) {
        return responseError('SelectLocalCapabilityConfiguration returned a mismatched selection');
      }
      return selection;
    },

    async clearSelection(capabilityContract: string, options?: RuntimeTypedCallOptions) {
      await runtime.clearLocalCapabilitySelection(
        { capabilityContract: requireInputText(capabilityContract, 'capabilityContract') },
        writeOptions('clear-selection', options),
      );
    },

    async bindRequirement(
      value: NimiMachineLocalAIConfigurationBindInput,
      options?: RuntimeTypedCallOptions,
    ) {
      const request = buildBindRequest(value);
      const response = await runtime.bindLocalCapabilityRequirement(
        request,
        writeOptions('bind', options),
      );
      return requireConfigurationIdentity(
        requireConfigurationResponse(response.configuration, 'BindLocalCapabilityRequirement'),
        request.configurationId,
        'BindLocalCapabilityRequirement',
      );
    },

    async rebindRequirement(
      value: NimiMachineLocalAIConfigurationRebindInput,
      options?: RuntimeTypedCallOptions,
    ) {
      assertExactRecord(
        value,
        new Set(['configurationId', 'requirementId', 'expectedCurrentBinding', 'target']),
        'rebindRequirement input',
      );
      const request = {
        ...buildBindingIdentity(value),
        expectedCurrentBinding: buildExpectedBinding(value.expectedCurrentBinding),
        target: buildBindingTarget(value.target),
      };
      const response = await runtime.rebindLocalCapabilityRequirement(
        request,
        writeOptions('rebind', options),
      );
      return requireConfigurationIdentity(
        requireConfigurationResponse(response.configuration, 'RebindLocalCapabilityRequirement'),
        request.configurationId,
        'RebindLocalCapabilityRequirement',
      );
    },

    async unbindRequirement(
      value: NimiMachineLocalAIConfigurationUnbindInput,
      options?: RuntimeTypedCallOptions,
    ) {
      assertExactRecord(
        value,
        new Set(['configurationId', 'requirementId', 'expectedCurrentBinding']),
        'unbindRequirement input',
      );
      const request = {
        ...buildBindingIdentity(value),
        expectedCurrentBinding: buildExpectedBinding(value.expectedCurrentBinding),
      };
      const response = await runtime.unbindLocalCapabilityRequirement(
        request,
        writeOptions('unbind', options),
      );
      return requireConfigurationIdentity(
        requireConfigurationResponse(response.configuration, 'UnbindLocalCapabilityRequirement'),
        request.configurationId,
        'UnbindLocalCapabilityRequirement',
      );
    },

    async listLocalAssets(filter: NimiRuntimeLocalAssetListInput = {}) {
      return listNimiRuntimeLocalAssetEntries(
        { local: runtime },
        {
          ...filter,
          callOptions: filter.callOptions ?? defaultCallOptions,
        },
      );
    },
  });
}

export function projectNimiMachineLocalAIConfiguration(
  aggregate: MachineLocalAIConfiguration,
): NimiMachineLocalAIConfiguration {
  if (!aggregate || !Array.isArray(aggregate.configurations) || !Array.isArray(aggregate.selections)) {
    return responseError('Machine Local AI Configuration aggregate is invalid');
  }
  const configurations = aggregate.configurations.map((configuration) => (
    projectNimiMachineLocalCapabilityConfiguration(configuration)
  ));
  assertUniqueResponseValues(
    configurations.map((configuration) => configuration.configurationId),
    'configuration ids',
  );
  const configurationById = new Map(
    configurations.map((configuration) => [configuration.configurationId, configuration] as const),
  );
  const selections = aggregate.selections.map((selection) => projectSelection(selection, 'aggregate'));
  assertUniqueResponseValues(
    selections.map((selection) => selection.capabilityContract),
    'selection capability contracts',
  );
  for (const selection of selections) {
    const configuration = configurationById.get(selection.configurationId);
    if (!configuration || configuration.capabilityContract !== selection.capabilityContract) {
      return responseError('Machine Local AI Configuration contains a dangling or mismatched selection');
    }
  }
  return { configurations, selections };
}

export function projectNimiMachineLocalCapabilityConfiguration(
  value: LocalCapabilityConfiguration,
): NimiMachineLocalCapabilityConfiguration {
  if (!value || typeof value !== 'object') {
    return responseError('Local Capability Configuration is missing');
  }
  const configurationId = requireResponseText(value.configurationId, 'configurationId');
  const capabilityContract = requireResponseText(value.capabilityContract, 'capabilityContract');
  const implementation = projectImplementation(value.implementation);
  if (!Array.isArray(value.projectedRequirements) || !Array.isArray(value.exactBindings)
    || !Array.isArray(value.supportedFeatures) || !Array.isArray(value.reasons)) {
    return responseError(`Local Capability Configuration ${configurationId} has invalid repeated fields`);
  }
  const projectedRequirements = value.projectedRequirements.map(projectRequirement);
  const exactBindings = value.exactBindings.map(projectExactBinding);
  const requirementIds = projectedRequirements.map((requirement) => requirement.requirementId);
  assertUniqueResponseValues(requirementIds, `requirements for ${configurationId}`);
  assertUniqueResponseValues(
    exactBindings.map((binding) => binding.requirementId),
    `bindings for ${configurationId}`,
  );
  const requirementIdSet = new Set(requirementIds);
  if (exactBindings.some((binding) => !requirementIdSet.has(binding.requirementId))) {
    return responseError(`Local Capability Configuration ${configurationId} binds an unknown requirement`);
  }
  const supportedFeatures = value.supportedFeatures.map((feature) => (
    requireResponseText(feature, 'supportedFeature')
  ));
  assertUniqueResponseValues(supportedFeatures, `supported features for ${configurationId}`);
  const reasons = value.reasons.map(projectReason);
  assertUniqueResponseValues(reasons, `reasons for ${configurationId}`);
  const displayName = requireResponseText(value.displayName, 'displayName', true);
  return {
    configurationId,
    capabilityContract,
    implementation,
    ...(value.portableConfig
      ? { portableConfig: fromNimiRuntimeProtoStruct(value.portableConfig) }
      : {}),
    projectedRequirements,
    exactBindings,
    supportedFeatures,
    interpretability: projectInterpretability(value.interpretability),
    requirementResolution: projectRequirementResolution(value.requirementResolution),
    reasons,
    displayName,
    ...(value.provenance
      ? { provenance: fromNimiRuntimeProtoStruct(value.provenance) }
      : {}),
  };
}

function buildAddRequest(value: NimiMachineLocalAIConfigurationAddInput) {
  assertExactRecord(
    value,
    new Set([
      'capabilityContract',
      'implementation',
      'portableConfig',
      'supportedFeatures',
      'displayName',
      'provenance',
    ]),
    'addConfiguration input',
  );
  const implementation = buildImplementation(value.implementation);
  const supportedFeatures = value.supportedFeatures === undefined
    ? []
    : buildCanonicalTextList(value.supportedFeatures, 'supportedFeatures');
  return {
    capabilityContract: requireInputText(value.capabilityContract, 'capabilityContract'),
    implementation,
    ...(value.portableConfig === undefined
      ? {}
      : { portableConfig: buildProtoStruct(value.portableConfig, 'portableConfig') }),
    supportedFeatures,
    displayName: requireInputText(value.displayName, 'displayName'),
    ...(value.provenance === undefined
      ? {}
      : { provenance: buildProtoStruct(value.provenance, 'provenance') }),
  };
}

function buildBindRequest(value: NimiMachineLocalAIConfigurationBindInput) {
  assertExactRecord(
    value,
    new Set(['configurationId', 'requirementId', 'target']),
    'bindRequirement input',
  );
  return {
    ...buildBindingIdentity(value),
    target: buildBindingTarget(value.target),
  };
}

function buildBindingIdentity(value: {
  readonly configurationId: string;
  readonly requirementId: string;
}) {
  return {
    configurationId: requireInputText(value.configurationId, 'configurationId'),
    requirementId: requireInputText(value.requirementId, 'requirementId'),
  };
}

function buildBindingTarget(
  value: NimiMachineLocalAIConfigurationBindingTarget,
) {
  assertExactRecord(
    value,
    new Set(['localAssetId', 'expectedVerifiedContentId']),
    'binding target',
  );
  return {
    localAssetId: requireInputText(value.localAssetId, 'target.localAssetId'),
    expectedVerifiedContentId: requireCanonicalVerifiedContentId(
      value.expectedVerifiedContentId,
      'target.expectedVerifiedContentId',
      inputError,
    ),
  };
}

function buildExpectedBinding(value: NimiMachineLocalAssetExactBinding): LocalAssetExactBinding {
  assertExactRecord(
    value,
    new Set(['requirementId', 'localAssetId', 'verifiedContentId', 'entrySha256']),
    'expectedCurrentBinding',
  );
  return {
    requirementId: requireInputText(value.requirementId, 'expectedCurrentBinding.requirementId'),
    localAssetId: requireInputText(value.localAssetId, 'expectedCurrentBinding.localAssetId'),
    verifiedContentId: requireCanonicalVerifiedContentId(
      value.verifiedContentId,
      'expectedCurrentBinding.verifiedContentId',
      inputError,
    ),
    entrySha256: requireCanonicalSha256(
      value.entrySha256,
      'expectedCurrentBinding.entrySha256',
      inputError,
    ),
  };
}

function buildImplementation(
  value: NimiMachineLocalCapabilityImplementation,
): CapabilityImplementationIdentity {
  assertExactRecord(
    value,
    new Set(['implementationId', 'driverId', 'driverDialect']),
    'implementation',
  );
  return {
    implementationId: requireInputText(value.implementationId, 'implementation.implementationId'),
    driverId: requireInputText(value.driverId, 'implementation.driverId'),
    driverDialect: requireInputText(value.driverDialect, 'implementation.driverDialect'),
  };
}

function projectImplementation(
  value: CapabilityImplementationIdentity | undefined,
): NimiMachineLocalCapabilityImplementation {
  if (!value) {
    return responseError('Local Capability Configuration is missing implementation identity');
  }
  return {
    implementationId: requireResponseText(value.implementationId, 'implementationId'),
    driverId: requireResponseText(value.driverId, 'driverId'),
    driverDialect: requireResponseText(value.driverDialect, 'driverDialect'),
  };
}

function projectRequirement(
  value: LocalCapabilityRequirement,
): NimiMachineLocalCapabilityRequirement {
  if (!value || typeof value !== 'object') {
    return responseError('Local Capability Requirement is missing');
  }
  const preferredVerifiedContentId = requireResponseText(
    value.preferredVerifiedContentId,
    'preferredVerifiedContentId',
    true,
  );
  if (preferredVerifiedContentId) {
    requireCanonicalVerifiedContentId(
      preferredVerifiedContentId,
      'preferredVerifiedContentId',
      responseError,
    );
  }
  return {
    requirementId: requireResponseText(value.requirementId, 'requirementId'),
    role: projectRequirementRole(value.role),
    resourceKind: requireResponseText(value.resourceKind, 'resourceKind'),
    policy: projectRequirementPolicy(value.policy),
    ...(preferredVerifiedContentId ? { preferredVerifiedContentId } : {}),
    ...(value.compatibilityConstraints
      ? { compatibilityConstraints: fromNimiRuntimeProtoStruct(value.compatibilityConstraints) }
      : {}),
  };
}

function projectExactBinding(value: LocalAssetExactBinding): NimiMachineLocalAssetExactBinding {
  if (!value || typeof value !== 'object') {
    return responseError('Local Asset exact binding is missing');
  }
  return {
    requirementId: requireResponseText(value.requirementId, 'binding.requirementId'),
    localAssetId: requireResponseText(value.localAssetId, 'binding.localAssetId'),
    verifiedContentId: requireCanonicalVerifiedContentId(
      value.verifiedContentId,
      'binding.verifiedContentId',
      responseError,
    ),
    entrySha256: requireCanonicalSha256(
      value.entrySha256,
      'binding.entrySha256',
      responseError,
    ),
  };
}

function projectSelection(
  value: LocalCapabilitySelection | undefined,
  operation: string,
): NimiMachineLocalCapabilitySelection {
  if (!value) {
    return responseError(`${operation} returned no selection`);
  }
  return {
    capabilityContract: requireResponseText(value.capabilityContract, 'selection.capabilityContract'),
    configurationId: requireResponseText(value.configurationId, 'selection.configurationId'),
  };
}

function projectInterpretability(
  value: LocalCapabilityInterpretability,
): NimiMachineLocalCapabilityInterpretability {
  switch (value) {
    case LocalCapabilityInterpretability.INTERPRETABLE:
      return 'interpretable';
    case LocalCapabilityInterpretability.UNAVAILABLE:
      return 'unavailable';
    default:
      return responseError(`unsupported Local Capability interpretability: ${String(value)}`);
  }
}

function projectRequirementResolution(
  value: LocalCapabilityRequirementResolution,
): NimiMachineLocalCapabilityRequirementResolution {
  switch (value) {
    case LocalCapabilityRequirementResolution.UNRESOLVED:
      return 'unresolved';
    case LocalCapabilityRequirementResolution.CONFIGURED:
      return 'configured';
    default:
      return responseError(`unsupported Local Capability requirement resolution: ${String(value)}`);
  }
}

function projectRequirementRole(
  value: LocalCapabilityRequirementRole,
): NimiMachineLocalCapabilityRequirementRole {
  switch (value) {
    case LocalCapabilityRequirementRole.MAIN:
      return 'main';
    case LocalCapabilityRequirementRole.COMPANION:
      return 'companion';
    default:
      return responseError(`unsupported Local Capability requirement role: ${String(value)}`);
  }
}

function projectRequirementPolicy(
  value: LocalCapabilityRequirementPolicy,
): NimiMachineLocalCapabilityRequirementPolicy {
  switch (value) {
    case LocalCapabilityRequirementPolicy.STRICT:
      return 'strict';
    case LocalCapabilityRequirementPolicy.SUBSTITUTABLE:
      return 'substitutable';
    default:
      return responseError(`unsupported Local Capability requirement policy: ${String(value)}`);
  }
}

function projectReason(value: LocalCapabilityReason): NimiMachineLocalCapabilityReason {
  switch (value) {
    case LocalCapabilityReason.DRIVER_NOT_FOUND:
      return 'driver_not_found';
    case LocalCapabilityReason.DRIVER_DIALECT_UNSUPPORTED:
      return 'driver_dialect_unsupported';
    case LocalCapabilityReason.IMPLEMENTATION_UNSUPPORTED:
      return 'implementation_unsupported';
    case LocalCapabilityReason.PORTABLE_CONFIG_INVALID:
      return 'portable_config_invalid';
    case LocalCapabilityReason.FEATURE_UNSUPPORTED:
      return 'feature_unsupported';
    case LocalCapabilityReason.REQUIRED_BINDING_MISSING:
      return 'required_binding_missing';
    case LocalCapabilityReason.BINDING_AMBIGUOUS:
      return 'binding_ambiguous';
    case LocalCapabilityReason.LOCAL_ASSET_NOT_FOUND:
      return 'local_asset_not_found';
    case LocalCapabilityReason.LOCAL_ASSET_CONTENT_UNVERIFIED:
      return 'local_asset_content_unverified';
    case LocalCapabilityReason.LOCAL_ASSET_CONTENT_MISMATCH:
      return 'local_asset_content_mismatch';
    case LocalCapabilityReason.LOCAL_ASSET_INCOMPATIBLE:
      return 'local_asset_incompatible';
    default:
      return responseError(`unsupported Local Capability reason: ${String(value)}`);
  }
}

function requireConfigurationResponse(
  value: LocalCapabilityConfiguration | undefined,
  operation: string,
): NimiMachineLocalCapabilityConfiguration {
  if (!value) {
    return responseError(`${operation} returned no configuration`);
  }
  return projectNimiMachineLocalCapabilityConfiguration(value);
}

function requireConfigurationIdentity(
  configuration: NimiMachineLocalCapabilityConfiguration,
  expectedId: string,
  operation: string,
): NimiMachineLocalCapabilityConfiguration {
  if (configuration.configurationId !== expectedId) {
    return responseError(`${operation} returned a mismatched configuration`);
  }
  return configuration;
}

function requireRpcClient(
  value: NimiMachineLocalAIConfigurationRpcClient | undefined,
): NimiMachineLocalAIConfigurationRpcClient {
  const methods: readonly (keyof NimiMachineLocalAIConfigurationRpcClient)[] = [
    'getMachineLocalAIConfiguration',
    'getLocalCapabilityConfiguration',
    'addLocalCapabilityConfiguration',
    'selectLocalCapabilityConfiguration',
    'clearLocalCapabilitySelection',
    'deleteLocalCapabilityConfiguration',
    'reprojectLocalCapabilityRequirements',
    'bindLocalCapabilityRequirement',
    'rebindLocalCapabilityRequirement',
    'unbindLocalCapabilityRequirement',
    'listLocalAssets',
  ];
  if (!value || methods.some((method) => typeof value[method] !== 'function')) {
    return inputError('Machine Local AI Configuration client requires the complete typed Runtime carrier');
  }
  return value;
}

function buildCanonicalTextList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    return inputError(`${field} must be an array`);
  }
  const result = value.map((item, index) => requireInputText(item, `${field}[${index}]`));
  if (new Set(result).size !== result.length) {
    return inputError(`${field} must not contain duplicates`);
  }
  return result;
}

function buildProtoStruct(value: unknown, field: string) {
  if (!isJsonObject(value) || !isPlainRecord(value)) {
    return inputError(`${field} must be a JSON object`);
  }
  assertJsonValue(value, field, new Set<object>(), 0);
  try {
    return toNimiRuntimeProtoStruct(value);
  } catch {
    return inputError(`${field} could not be encoded as a Runtime Struct`);
  }
}

function assertJsonValue(
  value: unknown,
  field: string,
  ancestors: Set<object>,
  depth: number,
): asserts value is JsonValue {
  if (depth > 64) {
    return inputError(`${field} exceeds the supported JSON nesting depth`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return inputError(`${field} contains a non-finite number`);
    return;
  }
  if (!value || typeof value !== 'object') {
    return inputError(`${field} contains a non-JSON value`);
  }
  if (ancestors.has(value)) {
    return inputError(`${field} contains a cycle`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) return inputError(`${field} contains a sparse array`);
      assertJsonValue(value[index], `${field}[${index}]`, ancestors, depth + 1);
    }
  } else {
    if (!isPlainRecord(value)) return inputError(`${field} contains a non-plain object`);
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${field}.${key}`, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function assertExactRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string,
): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return inputError(`${field} must be an object`);
  }
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    return inputError(`${field} contains unsupported fields: ${unknownKeys.join(', ')}`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireInputText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    return inputError(`${field} must be a non-empty canonical string`);
  }
  return value;
}

function requireResponseText(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.trim() !== value || (!allowEmpty && !value)) {
    return responseError(`${field} is not a canonical string`);
  }
  return value;
}

function requireCanonicalVerifiedContentId(
  value: unknown,
  field: string,
  fail: (message: string) => never,
): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    return fail(`${field} must be a canonical sha256 content identity`);
  }
  return value;
}

function requireCanonicalSha256(
  value: unknown,
  field: string,
  fail: (message: string) => never,
): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    return fail(`${field} must be a canonical sha256 digest`);
  }
  return value;
}

function assertUniqueResponseValues(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    responseError(`Machine Local AI Configuration contains duplicate ${field}`);
  }
}

function inputError(message: string): never {
  throw createNimiError({
    message,
    code: ReasonCode.SDK_AI_INPUT_INVALID,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint: 'provide_canonical_machine_local_ai_configuration_input',
    source: 'sdk',
  });
}

function responseError(message: string): never {
  throw createNimiError({
    message,
    code: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'inspect_machine_local_ai_configuration_response',
    source: 'runtime',
  });
}
