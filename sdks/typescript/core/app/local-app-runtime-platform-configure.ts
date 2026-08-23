import type {
  NimiAIConfigOptionsQuery,
  NimiAIConfigOptionsResult,
  NimiAIConfigOverwriteInput,
  NimiSharedLocalAgentAIConfigOverwriteResult,
  NimiSharedLocalAgentAIConfigSnapshot,
  NimiSharedLocalAgentCapabilityParticipation,
  NimiCapabilityAIConfig,
} from '../ai/capability-configuration.js';
import { validateCapabilityIntents } from './local-app-runtime-platform-ai-config.js';
import {
  validateAgentHandle,
  type NimiLocalAppAgentHandle,
} from './local-app-runtime-platform-conversation.js';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
  assertSafeProjection,
  localAppError,
  localAppProjectionError,
  projectTimestamp,
} from './local-app-runtime-platform-validation.js';

export type NimiLocalAppAgentAutonomyMode = 'off' | 'low' | 'medium' | 'high';
export type NimiLocalAppAgentPresentationBackendKind = 'vrm' | 'live2d' | 'sprite2d' | 'canvas2d' | 'video';
export type NimiLocalAppRevision = string;

export type NimiLocalAppTimestamp = {
  readonly seconds: string;
  readonly nanos: number;
};

export type NimiLocalAppDuration = {
  readonly seconds: string;
  readonly nanos: number;
};

export type NimiLocalAppAgentAutonomyConfig = {
  readonly dailyTokenBudget: number;
  readonly maxTokensPerHook: number;
  readonly minHookInterval?: NimiLocalAppDuration;
  readonly suspendUntil?: NimiLocalAppTimestamp;
  readonly mode: NimiLocalAppAgentAutonomyMode;
};

export type NimiLocalAppAgentAutonomyProjection = {
  readonly enabled: boolean;
  readonly config: NimiLocalAppAgentAutonomyConfig | null;
  readonly usedTokensInWindow: number;
  readonly windowStartedAt?: NimiLocalAppTimestamp;
  readonly budgetExhausted: boolean;
  readonly suspendedUntil?: NimiLocalAppTimestamp;
  readonly autonomyRevision: NimiLocalAppRevision;
};

export type NimiLocalAppAgentAutonomyIntent = {
  readonly enabled?: boolean;
  readonly config?: NimiLocalAppAgentAutonomyConfig;
};

export type NimiLocalAppAgentPresentationProfile = {
  readonly backendKind: NimiLocalAppAgentPresentationBackendKind;
  readonly avatarAssetRef: string;
  readonly expressionProfileRef: string;
  readonly idlePreset: string;
  readonly interactionPolicyRef: string;
  readonly defaultVoiceReference: string;
  readonly avatarAutoplay: boolean;
  readonly backgroundAssetRef: string;
  readonly revision: NimiLocalAppRevision;
};

export type NimiLocalAppAgentPresentationProjection = {
  readonly profile: NimiLocalAppAgentPresentationProfile | null;
  readonly previousProfile: NimiLocalAppAgentPresentationProfile | null;
  readonly defaultVoiceReference: string;
  readonly presentationRevision: NimiLocalAppRevision;
};

export type NimiLocalAppAgentPresentationAssetMaterial = {
  readonly role: 'avatar' | 'background';
  readonly fileName: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
  readonly sha256: string;
};

export type NimiLocalAppAgentPresentationIntent = {
  readonly backendKind: NimiLocalAppAgentPresentationBackendKind;
  readonly avatarAssetRef: string;
  readonly expressionProfileRef: string;
  readonly idlePreset: string;
  readonly interactionPolicyRef: string;
  readonly defaultVoiceReference: string;
  readonly avatarAutoplay: boolean;
  readonly backgroundAssetRef: string;
};

export type NimiLocalAppAgentScopedInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
};

export type NimiLocalAppAutonomySnapshotInput = NimiLocalAppAgentScopedInput;

export type NimiLocalAppAutonomyUpdateInput = NimiLocalAppAgentScopedInput & {
  readonly expectedAutonomyRevision: NimiLocalAppRevision;
  readonly intent: NimiLocalAppAgentAutonomyIntent;
};

export type NimiLocalAppPresentationSnapshotInput = NimiLocalAppAgentScopedInput;

export type NimiLocalAppPresentationCommitInput = NimiLocalAppAgentScopedInput & {
  readonly expectedPresentationRevision: NimiLocalAppRevision;
  readonly intent: NimiLocalAppAgentPresentationIntent;
  readonly importedAssets: readonly NimiLocalAppAgentPresentationAssetMaterial[];
};

export type NimiLocalAppAgentConfigureShell = {
  readonly sharedAIConfig: {
    readonly get: () => Promise<unknown>;
    readonly overwrite: (input: NimiAIConfigOverwriteInput) => Promise<unknown>;
    readonly listOptions: (query: NimiAIConfigOptionsQuery) => Promise<unknown>;
  };
  readonly autonomy: {
    readonly snapshot: (input: { readonly agentHandle: string }) => Promise<unknown>;
    readonly update: (input: {
      readonly agentHandle: string;
      readonly expectedAutonomyRevision: string;
      readonly intent: NimiLocalAppAgentAutonomyIntent;
    }) => Promise<unknown>;
  };
  readonly presentation: {
    readonly snapshot: (input: { readonly agentHandle: string }) => Promise<unknown>;
    readonly commit: (input: {
      readonly agentHandle: string;
      readonly expectedPresentationRevision: string;
      readonly intent: NimiLocalAppAgentPresentationIntent;
      readonly importedAssets: readonly NimiLocalAppAgentPresentationAssetMaterial[];
    }) => Promise<unknown>;
  };
};

export type NimiLocalAppAgentConfigureClient = {
  readonly sharedAIConfig: {
    readonly get: () => Promise<NimiSharedLocalAgentAIConfigSnapshot>;
    readonly overwrite: (input: NimiAIConfigOverwriteInput) => Promise<NimiSharedLocalAgentAIConfigOverwriteResult>;
    readonly listOptions: (query: NimiAIConfigOptionsQuery) => Promise<NimiAIConfigOptionsResult>;
  };
  readonly autonomy: {
    readonly snapshot: (
      input: NimiLocalAppAutonomySnapshotInput,
    ) => Promise<NimiLocalAppAgentAutonomyProjection>;
    readonly update: (
      input: NimiLocalAppAutonomyUpdateInput,
    ) => Promise<NimiLocalAppAgentAutonomyProjection>;
  };
  readonly presentation: {
    readonly snapshot: (
      input: NimiLocalAppPresentationSnapshotInput,
    ) => Promise<NimiLocalAppAgentPresentationProjection>;
    readonly commit: (
      input: NimiLocalAppPresentationCommitInput,
    ) => Promise<NimiLocalAppAgentPresentationProjection>;
  };
};

const MAX_AGENT_CONFIGURE_TEXT_BYTES = 512;
const MAX_PRESENTATION_IMPORTED_ASSETS = 2;
const MAX_PRESENTATION_ASSET_CONTENT_BYTES = 64 * 1024 * 1024;

const AUTONOMY_MODES = new Set<NimiLocalAppAgentAutonomyMode>(['off', 'low', 'medium', 'high']);
const PRESENTATION_BACKENDS = new Set<NimiLocalAppAgentPresentationBackendKind>([
  'vrm',
  'live2d',
  'sprite2d',
  'canvas2d',
  'video',
]);

/**
 * Agent configuration operations for a protected Local App session. The shared
 * LocalAgent subsystem AIConfig resolves its singular owner inside Runtime and
 * carries no Agent handle; autonomy and presentation stay handle-addressed with
 * their own independent revision CAS. Presentation restore rides the commit
 * carrier's previousProfile projection.
 */
export function createNimiLocalAppAgentConfigureClient(
  shell: NimiLocalAppAgentConfigureShell,
): NimiLocalAppAgentConfigureClient {
  return Object.freeze({
    sharedAIConfig: Object.freeze({
      get: async (): Promise<NimiSharedLocalAgentAIConfigSnapshot> => projectSharedAIConfigSnapshot(await shell.sharedAIConfig.get()),
      overwrite: async (input: NimiAIConfigOverwriteInput): Promise<NimiSharedLocalAgentAIConfigOverwriteResult> => {
        validateCapabilityIntents(input.capabilities);
        decimalRevision(input.expectedRevision, 'expectedRevision', true);
        return projectSharedAIConfigOverwrite(await shell.sharedAIConfig.overwrite(input));
      },
      listOptions: async (query: NimiAIConfigOptionsQuery): Promise<NimiAIConfigOptionsResult> => {
        assertExactKeys(query, query.kind === 'cloud-targets'
          ? ['kind', 'capabilityContract', 'connectorRef', 'search']
          : ['kind', 'capabilityContract', 'search'], 'shared AIConfig options query');
        if (!['local-loadouts', 'cloud-connectors', 'cloud-targets'].includes(query.kind)) return localAppProjectionError('shared AIConfig options kind');
        if (typeof query.capabilityContract !== 'string' || !query.capabilityContract.trim()
          || query.capabilityContract.trim() !== query.capabilityContract
          || (query.kind === 'cloud-targets' && (!query.connectorRef || query.connectorRef.trim() !== query.connectorRef))
          || (query.search !== undefined && (typeof query.search !== 'string' || query.search.trim() !== query.search))) {
          return localAppProjectionError('shared AIConfig options query');
        }
        return projectSharedAIConfigOptions(await shell.sharedAIConfig.listOptions(query));
      },
    }),
    autonomy: Object.freeze({
      snapshot: async (
        input: NimiLocalAppAutonomySnapshotInput,
      ): Promise<NimiLocalAppAgentAutonomyProjection> => projectAutonomy(
        await shell.autonomy.snapshot(agentScopedPayload(input, 'autonomy snapshot')),
      ),
      update: async (
        input: NimiLocalAppAutonomyUpdateInput,
      ): Promise<NimiLocalAppAgentAutonomyProjection> => {
        assertExactKeys(
          input,
          ['agentHandle', 'expectedAutonomyRevision', 'intent'],
          'local-app autonomy update input',
        );
        assertNoAuthorityMaterial(input);
        const value = await shell.autonomy.update({
          agentHandle: validateAgentHandle(input.agentHandle),
          expectedAutonomyRevision: decimalRevision(
            input.expectedAutonomyRevision,
            'expectedAutonomyRevision',
            false,
          ),
          intent: validateAutonomyIntent(input.intent),
        });
        return projectAutonomy(value);
      },
    }),
    presentation: Object.freeze({
      snapshot: async (
        input: NimiLocalAppPresentationSnapshotInput,
      ): Promise<NimiLocalAppAgentPresentationProjection> => projectPresentation(
        await shell.presentation.snapshot(agentScopedPayload(input, 'presentation snapshot')),
      ),
      commit: async (
        input: NimiLocalAppPresentationCommitInput,
      ): Promise<NimiLocalAppAgentPresentationProjection> => {
        assertExactKeys(
          input,
          ['agentHandle', 'expectedPresentationRevision', 'intent', 'importedAssets'],
          'local-app presentation commit input',
        );
        assertNoAuthorityMaterial(input);
        const value = await shell.presentation.commit({
          agentHandle: validateAgentHandle(input.agentHandle),
          expectedPresentationRevision: decimalRevision(
            input.expectedPresentationRevision,
            'expectedPresentationRevision',
            true,
          ),
          intent: validatePresentationIntent(input.intent),
          importedAssets: validatePresentationAssets(input.importedAssets),
        });
        return projectPresentation(value);
      },
    }),
  });
}

function agentScopedPayload(
  input: NimiLocalAppAgentScopedInput,
  operation: string,
): { readonly agentHandle: string } {
  assertExactKeys(input, ['agentHandle'], `local-app agent ${operation} input`);
  assertNoAuthorityMaterial(input);
  return { agentHandle: validateAgentHandle(input.agentHandle) };
}

function decimalRevision(value: unknown, field: string, allowZero: boolean): string {
  if (typeof value !== 'string'
    || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || (!allowZero && value === '0')) {
    return localAppError(
      `Local-app agent configure ${field} is invalid.`,
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_current_snapshot_revision',
    );
  }
  return value;
}

function validateAutonomyIntent(value: unknown): NimiLocalAppAgentAutonomyIntent {
  const intent = asRecord(value);
  if (!intent) return invalidAutonomyIntent('intent must be an object');
  assertExactKeys(intent, ['enabled', 'config'], 'local-app autonomy intent');
  if (intent.enabled === undefined && intent.config === undefined) {
    return invalidAutonomyIntent('at least one mutation field is required');
  }
  if (intent.enabled !== undefined && typeof intent.enabled !== 'boolean') {
    return invalidAutonomyIntent('enabled');
  }
  if (intent.config === undefined) {
    return Object.freeze({ enabled: intent.enabled as boolean | undefined });
  }
  const config = asRecord(intent.config);
  if (!config) return invalidAutonomyIntent('config');
  assertExactKeys(
    config,
    ['dailyTokenBudget', 'maxTokensPerHook', 'minHookInterval', 'suspendUntil', 'mode'],
    'local-app autonomy config',
  );
  const minHookInterval = optionalSecondsNanos(config.minHookInterval, 'minHookInterval');
  const suspendUntil = optionalSecondsNanos(config.suspendUntil, 'suspendUntil');
  return Object.freeze({
    ...(intent.enabled === undefined ? {} : { enabled: intent.enabled as boolean }),
    config: Object.freeze({
      dailyTokenBudget: nonNegativeBudget(config.dailyTokenBudget, 'dailyTokenBudget'),
      maxTokensPerHook: nonNegativeBudget(config.maxTokensPerHook, 'maxTokensPerHook'),
      ...(minHookInterval === undefined ? {} : { minHookInterval }),
      ...(suspendUntil === undefined ? {} : { suspendUntil }),
      mode: autonomyMode(config.mode),
    }),
  });
}

function nonNegativeBudget(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalidAutonomyIntent(field);
  }
  return value;
}

function autonomyMode(value: unknown): NimiLocalAppAgentAutonomyMode {
  if (typeof value !== 'string' || !AUTONOMY_MODES.has(value as NimiLocalAppAgentAutonomyMode)) {
    return invalidAutonomyIntent('mode');
  }
  return value as NimiLocalAppAgentAutonomyMode;
}

function optionalSecondsNanos(
  value: unknown,
  field: string,
): NimiLocalAppDuration | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (!record) return invalidAutonomyIntent(field);
  assertExactKeys(record, ['seconds', 'nanos'], `local-app autonomy ${field}`);
  if (typeof record.seconds !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/u.test(record.seconds)) {
    return invalidAutonomyIntent(`${field}.seconds`);
  }
  if (typeof record.nanos !== 'number'
    || !Number.isInteger(record.nanos)
    || record.nanos < 0
    || record.nanos > 999_999_999) {
    return invalidAutonomyIntent(`${field}.nanos`);
  }
  return Object.freeze({ seconds: record.seconds, nanos: record.nanos });
}

function invalidAutonomyIntent(field: string): never {
  return localAppError(
    `Local-app autonomy intent is invalid: ${field}.`,
    'SDK_LOCAL_APP_INPUT_INVALID',
    'provide_exact_autonomy_intent',
  );
}

function validatePresentationIntent(value: unknown): NimiLocalAppAgentPresentationIntent {
  const intent = asRecord(value);
  if (!intent) return invalidPresentationInput('intent must be an object');
  assertExactKeys(
    intent,
    [
      'backendKind',
      'avatarAssetRef',
      'expressionProfileRef',
      'idlePreset',
      'interactionPolicyRef',
      'defaultVoiceReference',
      'avatarAutoplay',
      'backgroundAssetRef',
    ],
    'local-app presentation intent',
  );
  const backendKind = intent.backendKind;
  if (typeof backendKind !== 'string'
    || !PRESENTATION_BACKENDS.has(backendKind as NimiLocalAppAgentPresentationBackendKind)) {
    return invalidPresentationInput('backendKind');
  }
  if (typeof intent.avatarAutoplay !== 'boolean') {
    return invalidPresentationInput('avatarAutoplay');
  }
  return Object.freeze({
    backendKind: backendKind as NimiLocalAppAgentPresentationBackendKind,
    avatarAssetRef: configureText(intent.avatarAssetRef, 'avatarAssetRef'),
    expressionProfileRef: configureText(intent.expressionProfileRef, 'expressionProfileRef'),
    idlePreset: configureText(intent.idlePreset, 'idlePreset'),
    interactionPolicyRef: configureText(intent.interactionPolicyRef, 'interactionPolicyRef'),
    defaultVoiceReference: configureText(intent.defaultVoiceReference, 'defaultVoiceReference'),
    avatarAutoplay: intent.avatarAutoplay,
    backgroundAssetRef: configureText(intent.backgroundAssetRef, 'backgroundAssetRef'),
  });
}

function validatePresentationAssets(
  value: unknown,
): readonly NimiLocalAppAgentPresentationAssetMaterial[] {
  if (!Array.isArray(value) || value.length > MAX_PRESENTATION_IMPORTED_ASSETS) {
    return invalidPresentationInput('importedAssets');
  }
  return Object.freeze(value.map((entry, index) => {
    const asset = asRecord(entry);
    if (!asset) return invalidPresentationInput(`importedAssets[${index}]`);
    assertExactKeys(
      asset,
      ['role', 'fileName', 'mediaType', 'content', 'sha256'],
      `local-app presentation asset ${index}`,
    );
    if (asset.role !== 'avatar' && asset.role !== 'background') {
      return invalidPresentationInput(`importedAssets[${index}].role`);
    }
    const content = asset.content;
    if (!(content instanceof Uint8Array)
      || content.byteLength === 0
      || content.byteLength > MAX_PRESENTATION_ASSET_CONTENT_BYTES) {
      return invalidPresentationInput(`importedAssets[${index}].content`);
    }
    return Object.freeze({
      role: asset.role,
      fileName: requiredConfigureText(asset.fileName, `importedAssets[${index}].fileName`),
      mediaType: requiredConfigureText(asset.mediaType, `importedAssets[${index}].mediaType`),
      content,
      sha256: requiredConfigureText(asset.sha256, `importedAssets[${index}].sha256`),
    });
  }));
}

function configureText(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > MAX_AGENT_CONFIGURE_TEXT_BYTES) {
    return invalidPresentationInput(field);
  }
  return value;
}

function requiredConfigureText(value: unknown, field: string): string {
  const text = configureText(value, field);
  if (!text) return invalidPresentationInput(field);
  return text;
}

function invalidPresentationInput(field: string): never {
  return localAppError(
    `Local-app presentation input is invalid: ${field}.`,
    'SDK_LOCAL_APP_INPUT_INVALID',
    'provide_exact_presentation_commit_input',
  );
}

function projectSharedAIConfig(value: unknown): NimiCapabilityAIConfig {
  const config = asRecord(value);
  assertExactProjectionKeys(config, ['owner', 'capabilities'], 'shared LocalAgent AIConfig');
  assertSafeProjection(config);
  const owner = asRecord(config.owner);
  assertExactProjectionKeys(owner, ['owner'], 'shared LocalAgent AIConfig owner');
  const ownerVariant = asRecord(owner.owner);
  assertExactProjectionKeys(
    ownerVariant,
    ['oneofKind', 'runtimeLocalAgentSubsystem'],
    'shared LocalAgent AIConfig owner variant',
  );
  if (ownerVariant.oneofKind !== 'runtimeLocalAgentSubsystem') {
    localAppProjectionError('shared LocalAgent AIConfig owner variant');
  }
  const marker = asRecord(ownerVariant.runtimeLocalAgentSubsystem);
  assertExactProjectionKeys(marker, [], 'shared LocalAgent AIConfig owner marker');
  if (!Array.isArray(config.capabilities)) {
    localAppProjectionError('shared LocalAgent AIConfig capabilities');
  }
  return config as unknown as NimiCapabilityAIConfig;
}

function projectSharedAIConfigSnapshot(value: unknown): NimiSharedLocalAgentAIConfigSnapshot {
  const snapshot = asRecord(value);
  assertExactProjectionKeys(snapshot, ['config', 'revision', 'effectiveSelections', 'participation'], 'shared LocalAgent AIConfig snapshot');
  assertSafeProjection(snapshot);
  const config = snapshot.config === null ? null : projectSharedAIConfig(snapshot.config);
  const revision = projectionRevision(snapshot.revision, 'shared LocalAgent AIConfig revision');
  if (!Array.isArray(snapshot.effectiveSelections)) localAppProjectionError('shared LocalAgent AIConfig effective selections');
  snapshot.effectiveSelections.forEach(projectSharedEffectiveSelection);
  const participation = projectSharedParticipation(snapshot.participation);
  return Object.freeze({ config, revision, effectiveSelections: Object.freeze([...snapshot.effectiveSelections]), participation }) as NimiSharedLocalAgentAIConfigSnapshot;
}

function projectSharedAIConfigOverwrite(value: unknown): NimiSharedLocalAgentAIConfigOverwriteResult {
  const result = asRecord(value);
  if (!result) return localAppProjectionError('shared LocalAgent AIConfig overwrite');
  assertSafeProjection(result);
  const revision = projectionRevision(result.revision, 'shared LocalAgent AIConfig revision');
  const config = result.config === null ? null : projectSharedAIConfig(result.config);
  const participation = projectSharedParticipation(result.participation);
  if (result.outcome === 'committed' && config) {
    assertExactProjectionKeys(result, ['outcome', 'config', 'revision', 'participation'], 'shared LocalAgent AIConfig committed overwrite');
    return Object.freeze({ outcome: 'committed', config, revision, participation });
  }
  if (result.outcome === 'conflict' && result.reasonCode === 'AGENT_AI_CONFIG_REVISION_CONFLICT') {
    assertExactProjectionKeys(result, ['outcome', 'config', 'revision', 'participation', 'reasonCode'], 'shared LocalAgent AIConfig conflict overwrite');
    return Object.freeze({ outcome: 'conflict', config, revision, reasonCode: result.reasonCode, participation });
  }
  return localAppProjectionError('shared LocalAgent AIConfig overwrite outcome');
}

function projectSharedParticipation(value: unknown): readonly NimiSharedLocalAgentCapabilityParticipation[] {
  const expected = [
    ['conversation.primary', 'text.generate'],
    ['memory.embedding', 'text.embed'],
    ['conversation.input.voice', 'audio.transcribe'],
    ['conversation.output.voice', 'audio.synthesize'],
    ['conversation.action.image', 'image.generate'],
  ] as const;
  if (!Array.isArray(value) || value.length !== expected.length) {
    return localAppProjectionError('shared LocalAgent participation');
  }
  return Object.freeze(value.map((entry, index) => {
    const row = asRecord(entry);
    const expectedRow = expected[index];
    assertExactProjectionKeys(row, ['role', 'capabilityContract'], `shared LocalAgent participation ${index}`);
    if (!expectedRow || row.role !== expectedRow[0] || row.capabilityContract !== expectedRow[1]) {
      return localAppProjectionError(`shared LocalAgent participation ${index}`);
    }
    return Object.freeze({ role: expectedRow[0], capabilityContract: expectedRow[1] });
  }));
}

function projectSharedAIConfigOptions(value: unknown): NimiAIConfigOptionsResult {
  const result = asRecord(value);
  assertExactProjectionKeys(result, ['kind', 'options', 'truncated'], 'shared LocalAgent AIConfig options');
  assertSafeProjection(result);
  if (!['local-loadouts', 'cloud-connectors', 'cloud-targets'].includes(String(result.kind))
    || !Array.isArray(result.options) || typeof result.truncated !== 'boolean') {
    return localAppProjectionError('shared LocalAgent AIConfig options');
  }
  if (result.kind === 'local-loadouts') result.options.forEach(projectSharedLocalOption);
  else if (result.kind === 'cloud-connectors') result.options.forEach(projectSharedCloudConnectorOption);
  else result.options.forEach(projectSharedCloudTargetOption);
  return Object.freeze({
    kind: result.kind,
    options: Object.freeze([...result.options]),
    truncated: result.truncated,
  }) as NimiAIConfigOptionsResult;
}

function projectSharedEffectiveSelection(value: unknown, index: number): void {
  const selection = asRecord(value);
  assertExactProjectionKeys(selection, ['capabilityContract', 'state', 'resource', 'reasons'], `shared AIConfig effective selection ${index}`);
  if (typeof selection.capabilityContract !== 'string' || !selection.capabilityContract.trim()
    || !['ready', 'missing', 'blocked', 'unavailable'].includes(String(selection.state))
    || !Array.isArray(selection.reasons)) {
    localAppProjectionError(`shared AIConfig effective selection ${index}`);
  }
  if (selection.resource !== null) {
    const resource = asRecord(selection.resource);
    if (!resource) localAppProjectionError(`shared AIConfig effective resource ${index}`);
    if (resource.oneofKind === 'local') {
      assertExactProjectionKeys(resource, ['oneofKind', 'local'], `shared AIConfig effective Local resource ${index}`);
      projectSharedLocalOption(resource.local, index);
    } else if (resource.oneofKind === 'cloud') {
      assertExactProjectionKeys(resource, ['oneofKind', 'cloud'], `shared AIConfig effective Cloud resource ${index}`);
      const cloud = asRecord(resource.cloud);
      assertExactProjectionKeys(cloud, ['connector', 'target'], `shared AIConfig effective Cloud resource ${index}`);
      projectSharedCloudConnectorOption(cloud.connector, index);
      projectSharedCloudTargetOption(cloud.target, index);
    } else localAppProjectionError(`shared AIConfig effective resource ${index}`);
  }
}

function projectSharedCloudConnectorOption(value: unknown, index: number): void {
  const option = asRecord(value);
  assertExactProjectionKeys(option, ['connectorRef', 'label', 'provider', 'state', 'reasons'], `shared AIConfig Cloud Connector ${index}`);
  if (typeof option.connectorRef !== 'string' || !option.connectorRef.trim()
    || typeof option.label !== 'string' || !option.label.trim()
    || typeof option.provider !== 'string' || !option.provider.trim()
    || !['ready', 'blocked'].includes(String(option.state)) || !Array.isArray(option.reasons)) {
    localAppProjectionError(`shared AIConfig Cloud Connector ${index}`);
  }
}

function projectSharedCloudTargetOption(value: unknown, index: number): void {
  const option = asRecord(value);
  assertExactProjectionKeys(option, [
    'connectorRef', 'label', 'capabilityContract', 'implementation', 'providerModelTarget',
    'supportedFeatures', 'state', 'reasons',
  ], `shared AIConfig Cloud target ${index}`);
  const implementation = asRecord(option.implementation);
  assertExactProjectionKeys(implementation, ['implementationId', 'driverId', 'driverDialect'], `shared AIConfig Cloud target ${index} implementation`);
  if (typeof option.connectorRef !== 'string' || !option.connectorRef.trim()
    || typeof option.label !== 'string' || !option.label.trim()
    || typeof option.capabilityContract !== 'string' || !option.capabilityContract.trim()
    || !asRecord(option.providerModelTarget) || !Array.isArray(option.supportedFeatures)
    || !['ready', 'blocked'].includes(String(option.state)) || !Array.isArray(option.reasons)) {
    localAppProjectionError(`shared AIConfig Cloud target ${index}`);
  }
}

function projectSharedLocalOption(value: unknown, index: number): void {
  const option = asRecord(value);
  assertExactProjectionKeys(option, [
    'loadoutRef', 'label', 'capabilityContract', 'implementation',
    'supportedFeatures', 'state', 'reasons',
  ], `shared AIConfig Local option ${index}`);
  if (typeof option.loadoutRef !== 'string' || !option.loadoutRef.trim()
    || typeof option.label !== 'string' || !option.label.trim()
    || typeof option.capabilityContract !== 'string' || !option.capabilityContract.trim()
    || !['ready', 'blocked'].includes(String(option.state))
    || !Array.isArray(option.supportedFeatures) || !Array.isArray(option.reasons)) {
    localAppProjectionError(`shared AIConfig Local option ${index}`);
  }
  const implementation = asRecord(option.implementation);
  assertExactProjectionKeys(implementation, ['implementationId', 'driverId', 'driverDialect'], `shared AIConfig Local option ${index} implementation`);
}

function projectionRevision(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return localAppProjectionError(field);
  }
  return value;
}

function projectAutonomy(value: unknown): NimiLocalAppAgentAutonomyProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    [
      'enabled',
      'config',
      'usedTokensInWindow',
      'windowStartedAt',
      'budgetExhausted',
      'suspendedUntil',
      'autonomyRevision',
    ],
    'agent autonomy projection',
  );
  assertSafeProjection(record);
  if (typeof record.enabled !== 'boolean' || typeof record.budgetExhausted !== 'boolean') {
    localAppProjectionError('agent autonomy flags');
  }
  if (typeof record.usedTokensInWindow !== 'number'
    || !Number.isSafeInteger(record.usedTokensInWindow)
    || record.usedTokensInWindow < 0) {
    localAppProjectionError('agent autonomy usedTokensInWindow');
  }
  const windowStartedAt = projectTimestamp(record.windowStartedAt, 'agent autonomy windowStartedAt');
  const suspendedUntil = projectTimestamp(record.suspendedUntil, 'agent autonomy suspendedUntil');
  return Object.freeze({
    enabled: record.enabled,
    config: projectAutonomyConfig(record.config),
    usedTokensInWindow: record.usedTokensInWindow,
    ...(windowStartedAt === undefined ? {} : { windowStartedAt }),
    budgetExhausted: record.budgetExhausted,
    ...(suspendedUntil === undefined ? {} : { suspendedUntil }),
    autonomyRevision: projectedRevision(record.autonomyRevision, 'autonomyRevision'),
  });
}

function projectAutonomyConfig(value: unknown): NimiLocalAppAgentAutonomyConfig | null {
  if (value === null) return null;
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['dailyTokenBudget', 'maxTokensPerHook', 'minHookInterval', 'suspendUntil', 'mode'],
    'agent autonomy config',
  );
  if (typeof record.dailyTokenBudget !== 'number'
    || !Number.isSafeInteger(record.dailyTokenBudget)
    || record.dailyTokenBudget < 0
    || typeof record.maxTokensPerHook !== 'number'
    || !Number.isSafeInteger(record.maxTokensPerHook)
    || record.maxTokensPerHook < 0) {
    localAppProjectionError('agent autonomy config budgets');
  }
  const mode = record.mode;
  if (typeof mode !== 'string' || !AUTONOMY_MODES.has(mode as NimiLocalAppAgentAutonomyMode)) {
    localAppProjectionError('agent autonomy mode');
  }
  const minHookInterval = projectTimestamp(record.minHookInterval, 'agent autonomy minHookInterval');
  const suspendUntil = projectTimestamp(record.suspendUntil, 'agent autonomy config suspendUntil');
  return Object.freeze({
    dailyTokenBudget: record.dailyTokenBudget,
    maxTokensPerHook: record.maxTokensPerHook,
    ...(minHookInterval === undefined ? {} : { minHookInterval }),
    ...(suspendUntil === undefined ? {} : { suspendUntil }),
    mode: mode as NimiLocalAppAgentAutonomyMode,
  });
}

function projectPresentation(value: unknown): NimiLocalAppAgentPresentationProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['profile', 'previousProfile', 'defaultVoiceReference', 'presentationRevision'],
    'agent presentation projection',
  );
  assertSafeProjection(record);
  return Object.freeze({
    profile: projectPresentationProfile(record.profile),
    previousProfile: projectPresentationProfile(record.previousProfile),
    defaultVoiceReference: projectedConfigureText(record.defaultVoiceReference, 'defaultVoiceReference'),
    presentationRevision: projectedRevision(record.presentationRevision, 'presentationRevision'),
  });
}

function projectPresentationProfile(value: unknown): NimiLocalAppAgentPresentationProfile | null {
  if (value === null) return null;
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    [
      'backendKind',
      'avatarAssetRef',
      'expressionProfileRef',
      'idlePreset',
      'interactionPolicyRef',
      'defaultVoiceReference',
      'avatarAutoplay',
      'backgroundAssetRef',
      'revision',
    ],
    'agent presentation profile',
  );
  const backendKind = record.backendKind;
  if (typeof backendKind !== 'string'
    || !PRESENTATION_BACKENDS.has(backendKind as NimiLocalAppAgentPresentationBackendKind)) {
    localAppProjectionError('agent presentation backendKind');
  }
  if (typeof record.avatarAutoplay !== 'boolean') {
    localAppProjectionError('agent presentation avatarAutoplay');
  }
  return Object.freeze({
    backendKind: backendKind as NimiLocalAppAgentPresentationBackendKind,
    avatarAssetRef: projectedConfigureText(record.avatarAssetRef, 'avatarAssetRef'),
    expressionProfileRef: projectedConfigureText(record.expressionProfileRef, 'expressionProfileRef'),
    idlePreset: projectedConfigureText(record.idlePreset, 'idlePreset'),
    interactionPolicyRef: projectedConfigureText(record.interactionPolicyRef, 'interactionPolicyRef'),
    defaultVoiceReference: projectedConfigureText(record.defaultVoiceReference, 'defaultVoiceReference'),
    avatarAutoplay: record.avatarAutoplay,
    backgroundAssetRef: projectedConfigureText(record.backgroundAssetRef, 'backgroundAssetRef'),
    revision: projectedRevision(record.revision, 'presentation profile revision'),
  });
}

function projectedConfigureText(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > MAX_AGENT_CONFIGURE_TEXT_BYTES) {
    localAppProjectionError(`agent presentation ${field}`);
  }
  return value;
}

function projectedRevision(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    localAppProjectionError(field);
  }
  return value;
}
