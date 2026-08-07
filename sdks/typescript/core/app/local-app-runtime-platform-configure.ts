import type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
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
    readonly overwrite: (
      capabilities: readonly NimiCapabilityAIConfigIntent[],
    ) => Promise<unknown>;
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
    readonly get: () => Promise<NimiCapabilityAIConfig>;
    readonly overwrite: (
      capabilities: readonly NimiCapabilityAIConfigIntent[],
    ) => Promise<NimiCapabilityAIConfig>;
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
      get: async (): Promise<NimiCapabilityAIConfig> => projectSharedAIConfig(await shell.sharedAIConfig.get()),
      overwrite: async (
        capabilities: readonly NimiCapabilityAIConfigIntent[],
      ): Promise<NimiCapabilityAIConfig> => {
        validateCapabilityIntents(capabilities);
        return projectSharedAIConfig(await shell.sharedAIConfig.overwrite(capabilities));
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
