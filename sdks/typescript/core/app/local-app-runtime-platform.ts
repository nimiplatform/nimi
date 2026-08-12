import type { JsonValue } from '../../types';
import type { RealmModel } from '../../realm/generated.js';
import {
  createNimiLocalAppAIConfigClient,
  type NimiLocalAppAIConfigClient,
  type NimiLocalAppAIConfigShell,
} from './local-app-runtime-platform-ai-config.js';
import {
  createNimiLocalAppAIConsumptionClient,
  type NimiLocalAppAIConsumptionClient,
  type NimiLocalAppAIConsumptionShell,
} from './local-app-runtime-platform-ai.js';
import {
  createNimiLocalAppAgentReferencesClient,
  type NimiLocalAppAgentReferencesClient,
  type NimiLocalAppAgentReferencesShell,
} from './local-app-runtime-platform-agent-references.js';
import {
  createNimiLocalAppConversationClient,
  type NimiLocalAppConversationOpenInput,
  NimiLocalAppConversationOpenResult,
  NimiLocalAppConversationInterruptResult,
  NimiLocalAppConversationScopeInput,
  NimiLocalAppConversationSendInput,
  NimiLocalAppConversationSendResult,
  NimiLocalAppConversationShell,
  NimiLocalAppConversationSnapshot,
  NimiLocalAppConversationSubscription,
} from './local-app-runtime-platform-conversation.js';
import {
  createNimiLocalAppAgentConfigureClient,
  type NimiLocalAppAgentConfigureClient,
  type NimiLocalAppAgentConfigureShell,
} from './local-app-runtime-platform-configure.js';
import {
  createNimiAppRuntimeStorageClient,
  type NimiAppRuntimeStorageDocument,
  type NimiAppRuntimeStorageRemoveResult,
} from './local-app-runtime-platform-protected-operations.js';
import {
  createNimiLocalAppAssetsClient,
  type NimiLocalAppAssetsClient,
  type NimiLocalAppAssetsShell,
} from './local-app-runtime-platform-assets.js';
import {
  asRecord,
  assertExactKeys,
  assertExactMethodNamespace,
  assertExactProjectionKeys,
  assertSafeProjection,
  localAppError,
  localAppProjectionError,
  normalizeFieldName,
  projectionText,
  requireText,
} from './local-app-runtime-platform-validation';

export type {
  NimiLocalAppAIConfigClient,
  NimiLocalAppAIConfigShell,
} from './local-app-runtime-platform-ai-config.js';
export {
  createNimiLocalAppRuntimeScenarioJobClient,
} from './local-app-runtime-platform-ai.js';
export type {
  NimiLocalAppAIConsumptionClient,
  NimiLocalAppAIConsumptionShell,
  NimiLocalAppArtifactImageMime,
  NimiLocalAppArtifactUploadResult,
  NimiLocalAppImageGenerateSpec,
  NimiLocalAppScenarioArtifact,
  NimiLocalAppScenarioExecuteResult,
  NimiLocalAppScenarioExecuteSpec,
  NimiLocalAppScenarioJob,
  NimiLocalAppScenarioJobEvent,
  NimiLocalAppScenarioJobSpec,
  NimiLocalAppScenarioJobSubmitResult,
  NimiLocalAppScenarioTimestamp,
  NimiLocalAppSubscription,
  NimiLocalAppTextTurnEvent,
  NimiLocalAppVideoContent,
  NimiLocalAppVideoContentRole,
  NimiLocalAppVoiceAsset,
} from './local-app-runtime-platform-ai.js';
export type {
  NimiLocalAppAgentReference,
  NimiLocalAppAgentReferencesClient,
  NimiLocalAppAgentReferencesShell,
} from './local-app-runtime-platform-agent-references.js';
export type {
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationMessage,
  NimiLocalAppConversationOpenInput,
  NimiLocalAppConversationOpenResult,
  NimiLocalAppConversationInterruptResult,
  NimiLocalAppConversationScopeInput,
  NimiLocalAppConversationSendInput,
  NimiLocalAppConversationSendResult,
  NimiLocalAppConversationShellSubscription,
  NimiLocalAppConversationSnapshot,
  NimiLocalAppConversationSubscription,
  NimiLocalAppAgentHandle,
} from './local-app-runtime-platform-conversation.js';
export type {
  NimiLocalAppAgentAutonomyConfig,
  NimiLocalAppAgentAutonomyIntent,
  NimiLocalAppAgentAutonomyMode,
  NimiLocalAppAgentAutonomyProjection,
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentConfigureShell,
  NimiLocalAppAgentPresentationAssetMaterial,
  NimiLocalAppAgentPresentationBackendKind,
  NimiLocalAppAgentPresentationIntent,
  NimiLocalAppAgentPresentationProfile,
  NimiLocalAppAgentPresentationProjection,
  NimiLocalAppAgentScopedInput,
  NimiLocalAppAutonomySnapshotInput,
  NimiLocalAppAutonomyUpdateInput,
  NimiLocalAppDuration,
  NimiLocalAppPresentationCommitInput,
  NimiLocalAppPresentationSnapshotInput,
  NimiLocalAppRevision,
  NimiLocalAppTimestamp,
} from './local-app-runtime-platform-configure.js';
export type {
  NimiAppRuntimeStorageDocument,
  NimiAppRuntimeStorageRemoveResult,
} from './local-app-runtime-platform-protected-operations';
export type {
  NimiLocalAppAssetBody,
  NimiLocalAppAssetReadResult,
  NimiLocalAppAssetRecord,
  NimiLocalAppAssetsClient,
  NimiLocalAppAssetsShell,
} from './local-app-runtime-platform-assets.js';

export type NimiAppAuthMode = 'local-first-party-app' | 'local-app';

export type NimiAppLocalSessionState =
  | 'session-bound'
  | 'action-required'
  | 'revoked'
  | 'project-changed'
  | 'process-replaced'
  | 'account-changed'
  | 'runtime-restarted';

export type NimiAppLocalSessionProjection = {
  readonly mode: NimiAppAuthMode;
  readonly state: NimiAppLocalSessionState;
  readonly sessionBound: boolean;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly retryable: boolean;
};

export type NimiAppAuthUnavailable = {
  readonly mode: NimiAppAuthMode;
  readonly state: 'unavailable';
  readonly sessionBound: false;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly retryable: boolean;
};

export type NimiAppAuthProjection = NimiAppLocalSessionProjection | NimiAppAuthUnavailable;

export type NimiLocalAppWorldCoreListInput = {
  readonly take?: number;
  readonly visibility?: 'private' | 'unlisted' | 'public' | 'system';
};

export type NimiCurrentUserDisplay = {
  readonly handle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};

export type NimiLocalAppTextCandidateMessage = {
  readonly role: 'system' | 'user';
  readonly text: string;
};

export type NimiLocalAppTextCandidateInput = {
  readonly messages: readonly NimiLocalAppTextCandidateMessage[];
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly topK?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly stop?: readonly string[];
  readonly seed?: number;
};

export type NimiLocalAppModelConfigLocalSelection = {
  readonly capabilityContract: string;
  readonly state: 'selected' | 'broken';
  readonly configurationId: null;
  readonly displayName: string | null;
  readonly supportedFeatures: readonly string[];
  readonly reasons: readonly string[];
  readonly effectiveDefaults: Readonly<Record<string, string>> | null;
};

export type NimiLocalAppTextCandidateResult = {
  readonly text: string;
  readonly finishReason: 'stop' | 'length' | 'content-filter';
  readonly traceId: string;
};

/**
 * Host-neutral structural contract implemented directly by Kit's local-app
 * shell surface. It exposes session status and exact typed operation carriers.
 * It is not a generic Runtime forwarding client.
 */
export type NimiLocalAppStandardShell = {
  readonly session: {
    readonly status: () => Promise<unknown>;
  };
  readonly ai: {
    readonly text: {
      readonly generateCandidate: (input: NimiLocalAppTextCandidateInput) => Promise<unknown>;
      readonly streamTurn: NimiLocalAppAIConsumptionShell['text']['streamTurn'];
    };
    readonly scenario: NimiLocalAppAIConsumptionShell['scenario'];
    readonly scenarioJobs: NimiLocalAppAIConsumptionShell['scenarioJobs'];
    readonly artifacts: NimiLocalAppAIConsumptionShell['artifacts'];
    readonly voiceAssets: NimiLocalAppAIConsumptionShell['voiceAssets'];
  };
  readonly aiConfig: NimiLocalAppAIConfigShell;
  readonly modelConfig: {
    readonly localSelections: () => Promise<unknown>;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<unknown>;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<unknown>;
    readonly removeJson: (relativePath: string) => Promise<unknown>;
    readonly assets: NimiLocalAppAssetsShell;
  };
  readonly realm: {
    readonly worldCore: {
      readonly list: (input?: NimiLocalAppWorldCoreListInput) => Promise<unknown>;
      readonly create: (input: unknown) => Promise<unknown>;
    };
  };
  readonly agents: NimiLocalAppAgentReferencesShell;
  readonly conversation: NimiLocalAppConversationShell;
  readonly agentConfigure: NimiLocalAppAgentConfigureShell;
};

export type NimiLocalAppClientInput = {
  readonly standardShell: NimiLocalAppStandardShell;
};

export type NimiLocalAppClient = {
  readonly auth: {
    readonly status: () => Promise<NimiAppAuthProjection>;
  };
  readonly currentUser: {
    readonly get: () => Promise<NimiCurrentUserDisplay>;
  };
  readonly ai: {
    readonly text: {
      readonly generateCandidate: (
        input: NimiLocalAppTextCandidateInput,
      ) => Promise<NimiLocalAppTextCandidateResult>;
      readonly streamTurn: NimiLocalAppAIConsumptionClient['text']['streamTurn'];
    };
    readonly scenario: NimiLocalAppAIConsumptionClient['scenario'];
    readonly scenarioJobs: NimiLocalAppAIConsumptionClient['scenarioJobs'];
    readonly artifacts: NimiLocalAppAIConsumptionClient['artifacts'];
    readonly voiceAssets: NimiLocalAppAIConsumptionClient['voiceAssets'];
  };
  readonly aiConfig: NimiLocalAppAIConfigClient;
  readonly modelConfig: {
    readonly localSelections: () => Promise<readonly NimiLocalAppModelConfigLocalSelection[]>;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<NimiAppRuntimeStorageDocument>;
    readonly writeJson: (
      relativePath: string,
      value: JsonValue,
    ) => Promise<NimiAppRuntimeStorageDocument>;
    readonly removeJson: (relativePath: string) => Promise<NimiAppRuntimeStorageRemoveResult>;
    readonly assets: NimiLocalAppAssetsClient;
  };
  readonly realm: {
    readonly worldCore: {
      readonly list: (
        input?: NimiLocalAppWorldCoreListInput,
      ) => Promise<readonly RealmModel<'WorldCoreDto'>[]>;
      readonly create: (
        input: RealmModel<'CreateWorldCoreDto'>,
      ) => Promise<RealmModel<'WorldCoreDto'>>;
    };
  };
  readonly agents: NimiLocalAppAgentReferencesClient;
  readonly agentConfigure: NimiLocalAppAgentConfigureClient;
  readonly conversation: {
    readonly open: (input: NimiLocalAppConversationOpenInput) => Promise<NimiLocalAppConversationOpenResult>;
    readonly send: (input: NimiLocalAppConversationSendInput) => Promise<NimiLocalAppConversationSendResult>;
    readonly interruptTurn: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationInterruptResult>;
    readonly subscribe: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSubscription>;
    readonly snapshot: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSnapshot>;
  };
};

export function createNimiLocalAppClient(
  input: NimiLocalAppClientInput,
): NimiLocalAppClient {
  assertExactKeys(input, ['standardShell'], 'SDK local-app client input');
  const standardShell = input.standardShell;
  const expectedNamespaces = ['session', 'ai', 'aiConfig', 'modelConfig', 'storage', 'realm', 'agents', 'conversation', 'agentConfigure'] as const;
  if (!asRecord(standardShell)
    || Object.keys(standardShell).sort().join('|') !== [...expectedNamespaces].sort().join('|')) {
    return localAppError(
      'Host-injected local-app standardShell namespaces are invalid.',
      'SDK_LOCAL_APP_CARRIER_REQUIRED',
      'use_host_injected_standard_shell',
    );
  }
  assertExactMethodNamespace(standardShell.session, ['status'], 'session');
  const ai = asRecord(standardShell.ai);
  const aiNamespaces = ['text', 'scenario', 'scenarioJobs', 'artifacts', 'voiceAssets'] as const;
  if (!ai || Object.keys(ai).sort().join('|') !== [...aiNamespaces].sort().join('|')) {
    return localAppError(
      'Host-injected local-app standardShell ai namespace is invalid.',
      'SDK_LOCAL_APP_CARRIER_REQUIRED',
      'use_host_injected_standard_shell',
    );
  }
  assertExactMethodNamespace(ai.text, ['generateCandidate', 'streamTurn'], 'ai.text');
  assertExactMethodNamespace(ai.scenario, ['execute'], 'ai.scenario');
  assertExactMethodNamespace(ai.scenarioJobs, ['submit', 'get', 'subscribe', 'cancel'], 'ai.scenarioJobs');
  assertExactMethodNamespace(ai.artifacts, ['read', 'upload'], 'ai.artifacts');
  assertExactMethodNamespace(ai.voiceAssets, ['list'], 'ai.voiceAssets');
  assertExactMethodNamespace(standardShell.aiConfig, ['get'], 'aiConfig');
  assertExactMethodNamespace(standardShell.modelConfig, ['localSelections'], 'modelConfig');
  const storage = asRecord(standardShell.storage);
  if (!storage || Object.keys(storage).sort().join('|') !== ['assets', 'readJson', 'removeJson', 'writeJson'].sort().join('|')) {
    return localAppError('Host-injected local-app standardShell storage namespace is invalid.', 'SDK_LOCAL_APP_CARRIER_REQUIRED', 'use_host_injected_standard_shell');
  }
  if (typeof storage.readJson !== 'function' || typeof storage.writeJson !== 'function' || typeof storage.removeJson !== 'function') {
    return localAppError('Host-injected local-app standardShell storage namespace is invalid.', 'SDK_LOCAL_APP_CARRIER_REQUIRED', 'use_host_injected_standard_shell');
  }
  assertExactMethodNamespace(storage.assets, ['stat', 'list', 'write', 'read', 'remove', 'move', 'adoptArtifact'], 'storage.assets');
  const realm = asRecord(standardShell.realm);
  if (!realm || Object.keys(realm).length !== 1 || !Object.hasOwn(realm, 'worldCore')) {
    return localAppError(
      'Host-injected local-app standardShell realm namespace is invalid.',
      'SDK_LOCAL_APP_CARRIER_REQUIRED',
      'use_host_injected_standard_shell',
    );
  }
  assertExactMethodNamespace(realm.worldCore, ['list', 'create'], 'realm.worldCore');
  assertExactMethodNamespace(standardShell.agents, ['listReferences'], 'agents');
  assertExactMethodNamespace(standardShell.conversation, ['open', 'send', 'interruptTurn', 'subscribe', 'snapshot'], 'conversation');
  const agentConfigure = asRecord(standardShell.agentConfigure);
  if (!agentConfigure
    || Object.keys(agentConfigure).length !== 3
    || !Object.hasOwn(agentConfigure, 'sharedAIConfig')
    || !Object.hasOwn(agentConfigure, 'autonomy')
    || !Object.hasOwn(agentConfigure, 'presentation')) {
    return localAppError(
      'Host-injected local-app standardShell agentConfigure namespace is invalid.',
      'SDK_LOCAL_APP_CARRIER_REQUIRED',
      'use_host_injected_standard_shell',
    );
  }
  assertExactMethodNamespace(agentConfigure.sharedAIConfig, ['get', 'overwrite'], 'agentConfigure.sharedAIConfig');
  assertExactMethodNamespace(agentConfigure.autonomy, ['snapshot', 'update'], 'agentConfigure.autonomy');
  assertExactMethodNamespace(agentConfigure.presentation, ['snapshot', 'commit'], 'agentConfigure.presentation');

  return Object.freeze({
    auth: Object.freeze({
      status: async () => projectAuth(await standardShell.session.status()),
    }),
    currentUser: Object.freeze({
      get: async () => projectCurrentUser(await standardShell.session.status()),
    }),
    ai: createAIClient(standardShell.ai),
    aiConfig: createNimiLocalAppAIConfigClient(standardShell.aiConfig),
    modelConfig: Object.freeze({
      localSelections: async () => projectModelConfigLocalSelections(
        await standardShell.modelConfig.localSelections(),
      ),
    }),
    storage: Object.freeze({
      ...createNimiAppRuntimeStorageClient(standardShell.storage),
      assets: createNimiLocalAppAssetsClient(standardShell.storage.assets),
    }),
    realm: Object.freeze({ worldCore: createWorldCoreClient(standardShell.realm.worldCore) }),
    agents: createNimiLocalAppAgentReferencesClient(standardShell.agents),
    conversation: createNimiLocalAppConversationClient(standardShell.conversation),
    agentConfigure: createNimiLocalAppAgentConfigureClient(standardShell.agentConfigure),
  });
}

function createAIClient(
  shell: NimiLocalAppStandardShell['ai'],
): NimiLocalAppClient['ai'] {
  const consumption = createNimiLocalAppAIConsumptionClient(shell);
  return Object.freeze({
    ...consumption,
    text: Object.freeze({
      generateCandidate: createTextCandidateClient(shell.text).generateCandidate,
      streamTurn: consumption.text.streamTurn,
    }),
  });
}

const MAX_TEXT_CANDIDATE_MESSAGES = 8;
const MAX_TEXT_CANDIDATE_MESSAGE_BYTES = 32 * 1024;
const MAX_TEXT_CANDIDATE_PROMPT_BYTES = 64 * 1024;
const MAX_TEXT_CANDIDATE_RESULT_BYTES = 256 * 1024;
const MAX_TEXT_CANDIDATE_TOKENS = 4096;

function createTextCandidateClient(
  shell: NimiLocalAppStandardShell['ai']['text'],
): Pick<NimiLocalAppClient['ai']['text'], 'generateCandidate'> {
  return Object.freeze({
    generateCandidate: async (
      input: NimiLocalAppTextCandidateInput,
    ): Promise<NimiLocalAppTextCandidateResult> => {
      assertExactKeys(input, [
        'messages', 'temperature', 'topP', 'maxTokens', 'topK',
        'presencePenalty', 'frequencyPenalty', 'stop', 'seed',
      ], 'text candidate input');
      if (!Array.isArray(input.messages)
        || input.messages.length === 0
        || input.messages.length > MAX_TEXT_CANDIDATE_MESSAGES) {
        return localAppError(
          'Text candidate messages are invalid.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_bounded_text_candidate_messages',
        );
      }
      let promptBytes = 0;
      let sawSystem = false;
      let sawUser = false;
      const messages = input.messages.map((message, index): NimiLocalAppTextCandidateMessage => {
        assertExactKeys(message, ['role', 'text'], `text candidate message ${index}`);
        if (message.role === 'system') {
          if (sawSystem || sawUser) return invalidTextCandidateInput('system message order is invalid');
          sawSystem = true;
        } else if (message.role === 'user') {
          sawUser = true;
        } else {
          return invalidTextCandidateInput(`message ${index} role is invalid`);
        }
        const text = requireText(message.text, `text_candidate_message_${index}`);
        const textBytes = new TextEncoder().encode(text).byteLength;
        if (textBytes > MAX_TEXT_CANDIDATE_MESSAGE_BYTES) {
          return invalidTextCandidateInput(`message ${index} exceeds the byte bound`);
        }
        promptBytes += new TextEncoder().encode(message.role).byteLength + textBytes;
        if (promptBytes > MAX_TEXT_CANDIDATE_PROMPT_BYTES) {
          return invalidTextCandidateInput('messages exceed the prompt byte bound');
        }
        return Object.freeze({ role: message.role, text });
      });
      if (!sawUser) invalidTextCandidateInput('at least one user message is required');
      const temperature = optionalBoundedTextCandidateNumber(input.temperature, 0, 2, 'temperature');
      const topP = optionalBoundedTextCandidateNumber(input.topP, 0, 1, 'topP');
      const maxTokens = optionalBoundedTextCandidateInteger(input.maxTokens, 0, MAX_TEXT_CANDIDATE_TOKENS, 'maxTokens');
      const topK = optionalBoundedTextCandidateInteger(input.topK, 0, Number.MAX_SAFE_INTEGER, 'topK');
      const presencePenalty = optionalBoundedTextCandidateNumber(input.presencePenalty, -2, 2, 'presencePenalty');
      const frequencyPenalty = optionalBoundedTextCandidateNumber(input.frequencyPenalty, -2, 2, 'frequencyPenalty');
      const seed = optionalBoundedTextCandidateInteger(input.seed, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'seed');
      const stop = validateTextCandidateStop(input.stop);
      const value = await shell.generateCandidate({
        messages: Object.freeze(messages),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topP !== undefined ? { topP } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(topK !== undefined ? { topK } : {}),
        ...(presencePenalty !== undefined ? { presencePenalty } : {}),
        ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
        ...(stop !== undefined ? { stop } : {}),
        ...(seed !== undefined ? { seed } : {}),
      });
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['text', 'finishReason', 'traceId'], 'text candidate');
      assertSafeProjection(record);
      const text = projectionUtf8Content(
        record.text,
        'text candidate text',
        MAX_TEXT_CANDIDATE_RESULT_BYTES,
      );
      const finishReason = projectionText(record.finishReason, 'text candidate finishReason');
      if (finishReason !== 'stop' && finishReason !== 'length' && finishReason !== 'content-filter') {
        localAppProjectionError('text candidate finishReason');
      }
      return Object.freeze({
        text,
        finishReason,
        traceId: projectionText(record.traceId, 'text candidate traceId'),
      });
    },
  });
}

function optionalBoundedTextCandidateNumber(
  value: number | undefined,
  minimum: number,
  maximum: number,
  field: string,
): number | undefined {
  return value === undefined ? undefined : boundedTextCandidateNumber(value, minimum, maximum, field);
}

function optionalBoundedTextCandidateInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalidTextCandidateInput(`${field} is invalid`);
  }
  return value;
}

function validateTextCandidateStop(value: readonly string[] | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    invalidTextCandidateInput('stop is invalid');
  }
  return Object.freeze([...value]);
}

function invalidTextCandidateInput(reason: string): never {
  return localAppError(
    `Text candidate input is invalid: ${reason}.`,
    'SDK_LOCAL_APP_INPUT_INVALID',
    'provide_exact_text_candidate_input',
  );
}

function boundedTextCandidateNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    return invalidTextCandidateInput(`${field} is invalid`);
  }
  return value;
}

function projectionUtf8Content(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string'
    || !value.trim()
    || new TextEncoder().encode(value).byteLength > maxBytes) {
    localAppProjectionError(field);
  }
  return value;
}

function createWorldCoreClient(
  shell: NimiLocalAppStandardShell['realm']['worldCore'],
): NimiLocalAppClient['realm']['worldCore'] {
  return Object.freeze({
    list: async (
      input: NimiLocalAppWorldCoreListInput = {},
    ): Promise<readonly RealmModel<'WorldCoreDto'>[]> => {
      assertExactKeys(input, ['take', 'visibility'], 'WorldCore list input');
      const normalized: NimiLocalAppWorldCoreListInput = {
        ...(input.take === undefined ? {} : { take: requireWorldCoreTake(input.take) }),
        ...(input.visibility === undefined ? {} : { visibility: requireWorldVisibility(input.visibility) }),
      };
      const value = await shell.list(normalized);
      if (!Array.isArray(value)) localAppProjectionError('WorldCore list');
      return Object.freeze(value.map((entry) => projectWorldCore(entry)));
    },
    create: async (
      input: RealmModel<'CreateWorldCoreDto'>,
    ): Promise<RealmModel<'WorldCoreDto'>> => {
      const record = asRecord(input);
      assertExactKeys(record, ['core', 'id', 'origin', 'visibility'], 'WorldCore create input');
      if (!record || !Object.hasOwn(record, 'core') || !Object.hasOwn(record, 'origin')) {
        return localAppError(
          'WorldCore create input requires core and origin.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_world_core_create_fields',
        );
      }
      const core = asRecord(record.core);
      const origin = asRecord(record.origin);
      if (!core || !origin) {
        return localAppError(
          'WorldCore create core and origin must be objects.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_world_core_create_fields',
        );
      }
      assertExactKeys(
        origin,
        ['kind', 'parentCharacterId', 'parentWorldId', 'sourceContentHash', 'sourceId', 'sourceVersion'],
        'WorldCore origin',
      );
      if (!Object.hasOwn(origin, 'kind')
        || !['manual', 'forge', 'worldCharacterDerivation', 'import', 'system'].includes(String(origin.kind))) {
        return localAppError(
          'WorldCore origin kind is invalid.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_world_core_origin',
        );
      }
      if (record.id !== undefined) requireText(record.id, 'world_core_id');
      if (record.visibility !== undefined) requireWorldVisibility(record.visibility);
      for (const key of ['parentCharacterId', 'parentWorldId', 'sourceContentHash', 'sourceId', 'sourceVersion']) {
        if (origin[key] !== undefined) requireText(origin[key], `world_core_origin_${key}`);
      }
      assertWorldCoreInputJson(record);
      return projectWorldCore(await shell.create(input));
    },
  });
}

function projectWorldCore(value: unknown): RealmModel<'WorldCoreDto'> {
  const record = asRecord(value);
  if (!record) localAppProjectionError('WorldCore');
  assertAllowedWorldCoreKeys(
    record,
    ['id', 'schemaVersion', 'contentRevision', 'contentHash', 'origin', 'visibility', 'core', 'createdAt', 'updatedAt', 'creatorId'],
    ['id', 'schemaVersion', 'contentRevision', 'contentHash', 'origin', 'visibility', 'core', 'createdAt', 'updatedAt'],
    'WorldCore',
  );
  for (const field of ['id', 'schemaVersion', 'contentHash', 'createdAt', 'updatedAt']) {
    projectionText(record[field], `WorldCore ${field}`);
  }
  if (typeof record.contentRevision !== 'number' || !Number.isFinite(record.contentRevision)) {
    localAppProjectionError('WorldCore contentRevision');
  }
  if (!['private', 'unlisted', 'public', 'system'].includes(String(record.visibility))) {
    localAppProjectionError('WorldCore visibility');
  }
  const origin = asRecord(record.origin);
  assertAllowedWorldCoreKeys(
    origin,
    ['kind', 'parentCharacterId', 'parentWorldId', 'sourceContentHash', 'sourceId', 'sourceVersion'],
    ['kind'],
    'WorldCore origin',
  );
  if (!origin || !['manual', 'forge', 'worldCharacterDerivation', 'import', 'system'].includes(String(origin.kind))) {
    localAppProjectionError('WorldCore origin kind');
  }
  const core = asRecord(record.core);
  assertAllowedWorldCoreKeys(
    core,
    ['identity', 'presentation', 'ontology', 'timeModel', 'timeline', 'entities', 'relationships', 'systems', 'scenes', 'assets', 'authoring'],
    ['identity', 'presentation', 'ontology', 'timeModel', 'timeline', 'entities', 'relationships', 'systems', 'scenes', 'assets', 'authoring'],
    'WorldCore core',
  );
  assertSafeProjection(record);
  return Object.freeze({ ...record }) as unknown as RealmModel<'WorldCoreDto'>;
}

function assertAllowedWorldCoreKeys(
  record: Record<string, unknown> | null | undefined,
  allowed: readonly string[],
  required: readonly string[],
  field: string,
): asserts record is Record<string, unknown> {
  if (!record) localAppProjectionError(field);
  const allowedSet = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedSet.has(key))
    || required.some((key) => !Object.hasOwn(record, key))) {
    localAppProjectionError(field);
  }
}

function requireWorldCoreTake(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return localAppError(
      'WorldCore list take is invalid.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_world_core_take',
    );
  }
  return value;
}

function requireWorldVisibility(
  value: unknown,
): 'private' | 'unlisted' | 'public' | 'system' {
  if (value !== 'private' && value !== 'unlisted' && value !== 'public' && value !== 'system') {
    return localAppError(
      'WorldCore visibility is invalid.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_world_core_visibility',
    );
  }
  return value;
}

function assertWorldCoreInputJson(
  value: unknown,
  depth = 0,
  state = { nodes: 0, ancestors: new Set<object>() },
): void {
  state.nodes += 1;
  if (depth > 32 || state.nodes > 100_000) {
    return localAppError(
      'WorldCore create input exceeds structural bounds.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'reduce_world_core_input',
    );
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || state.ancestors.has(value)) {
    return localAppError(
      'WorldCore create input is not JSON-compatible.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_json_world_core_input',
    );
  }
  state.ancestors.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) assertWorldCoreInputJson(entry, depth + 1, state);
  } else {
    const record = asRecord(value);
    if (!record) {
      return localAppError(
        'WorldCore create input is not a plain JSON object.',
        'SDK_LOCAL_APP_INPUT_INVALID',
        'provide_json_world_core_input',
      );
    }
    for (const entry of Object.values(record)) assertWorldCoreInputJson(entry, depth + 1, state);
  }
  state.ancestors.delete(value);
}

function projectModelConfigLocalSelections(
  value: unknown,
): readonly NimiLocalAppModelConfigLocalSelection[] {
  if (!Array.isArray(value) || value.length > 64) {
    return localAppProjectionError('Model Config local selections');
  }
  return Object.freeze(value.map((entry) => {
    const record = asRecord(entry);
    assertExactProjectionKeys(record, [
      'capabilityContract', 'state', 'configurationId', 'displayName',
      'supportedFeatures', 'reasons', 'effectiveDefaults',
    ], 'Model Config local selection');
    assertSafeProjection(record);
    const capabilityContract = projectionText(
      record.capabilityContract,
      'Model Config capabilityContract',
    );
    if ((record.state !== 'selected' && record.state !== 'broken')
      || record.configurationId !== null
      || (record.displayName !== null && (
        typeof record.displayName !== 'string'
        || !record.displayName
        || record.displayName.trim() !== record.displayName
      ))
      || !Array.isArray(record.supportedFeatures)
      || record.supportedFeatures.some((feature) => typeof feature !== 'string'
        || !feature || feature.trim() !== feature)
      || !Array.isArray(record.reasons)
      || record.reasons.some((reason) => typeof reason !== 'string'
        || !reason || reason.trim() !== reason)) {
      return localAppProjectionError('Model Config local selection');
    }
    return Object.freeze({
      capabilityContract,
      state: record.state,
      configurationId: null,
      displayName: record.displayName as string | null,
      supportedFeatures: Object.freeze([...record.supportedFeatures] as string[]),
      reasons: Object.freeze([...record.reasons] as string[]),
      effectiveDefaults: projectEffectiveDefaults(record.effectiveDefaults),
    });
  }));
}

function projectEffectiveDefaults(value: unknown): Readonly<Record<string, string>> | null {
  if (value === null) return null;
  const record = asRecord(value);
  const entries = record ? Object.entries(record) : [];
  if (!record || entries.length === 0 || entries.length > 64 || entries.some(([key, item]) => (
    !key || key.trim() !== key || new TextEncoder().encode(key).byteLength > 128
    || typeof item !== 'string' || !item || item.trim() !== item
    || new TextEncoder().encode(item).byteLength > 128
  ))) {
    return localAppProjectionError('Model Config effective defaults');
  }
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}

function projectAuth(value: unknown): NimiAppAuthProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['state', 'reasonCode', 'retryable', 'currentUser'], 'auth');
  projectCurrentUserStatus(record.currentUser);
  const rawState = projectionText(record.state, 'state');
  const reasonCode = projectionText(record.reasonCode, 'reasonCode');
  if (typeof record.retryable !== 'boolean') localAppProjectionError('auth retryable');
  const state = localAppSessionState(rawState, reasonCode);
  const actionHint = localAppSessionActionHint(state);
  if (state === 'unavailable') {
    return {
      mode: 'local-app',
      state,
      sessionBound: false,
      reasonCode,
      actionHint,
      retryable: record.retryable,
    };
  }
  return {
    mode: 'local-app',
    state,
    sessionBound: state === 'session-bound',
    reasonCode,
    actionHint,
    retryable: record.retryable,
  };
}

function projectCurrentUser(value: unknown): NimiCurrentUserDisplay {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['state', 'reasonCode', 'retryable', 'currentUser'], 'Current User session');
  const status = projectCurrentUserStatus(record.currentUser);
  if (status === null) {
    return localAppError(
      'Current User display is temporarily unavailable while the App session remains ready.',
      'SDK_LOCAL_APP_CURRENT_USER_UNAVAILABLE',
      'retry_current_user_after_account_binding',
    );
  }
  return status;
}

function projectCurrentUserStatus(value: unknown): NimiCurrentUserDisplay | null {
  const status = asRecord(value);
  assertExactProjectionKeys(status, ['state', 'value', 'reasonCode', 'retryable'], 'Current User status');
  const state = projectionText(status.state, 'Current User state');
  const reasonCode = projectionText(status.reasonCode, 'Current User reasonCode');
  if (typeof status.retryable !== 'boolean') localAppProjectionError('Current User retryable');
  if (state === 'unavailable' && status.value === null
    && reasonCode === 'current-user-display-unavailable' && status.retryable) return null;
  if (state !== 'ready' || reasonCode !== 'action-executed' || status.retryable) {
    return localAppProjectionError('Current User posture');
  }
  const display = asRecord(status.value);
  assertExactProjectionKeys(display, ['handle', 'displayName', 'avatarUrl'], 'Current User display');
  const handle = currentUserText(display.handle, 'handle', 160);
  const displayName = currentUserText(display.displayName, 'displayName', 256);
  const avatarUrl = display.avatarUrl;
  if (avatarUrl !== null && !safeCurrentUserAvatarUrl(avatarUrl)) {
    return localAppProjectionError('Current User avatarUrl');
  }
  return Object.freeze({ handle, displayName, avatarUrl: avatarUrl as string | null });
}

function currentUserText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    return localAppProjectionError(`Current User ${field}`);
  }
  return value;
}

function safeCurrentUserAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    if (parsed.protocol === 'https:') return !parsed.port || parsed.port === '443';
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === '3002';
  } catch {
    return false;
  }
}

function localAppSessionState(
  rawState: string,
  reasonCode: string,
): NimiAppLocalSessionState | 'unavailable' {
  const normalizedReason = normalizeFieldName(reasonCode);
  if (normalizedReason.includes('processreplaced')) return 'process-replaced';
  if (normalizedReason.includes('accountchanged')) return 'account-changed';
  if (normalizedReason.includes('runtimerestarted')) return 'runtime-restarted';
  switch (rawState) {
    case 'authorizing': return 'action-required';
    case 'ready': return 'session-bound';
    case 'denied': return 'action-required';
    case 'runtime-unavailable': return 'unavailable';
    case 'revoked': return 'revoked';
    case 'project-changed': return 'project-changed';
    default: return localAppProjectionError('auth state');
  }
}

function localAppSessionActionHint(state: NimiAppLocalSessionState | 'unavailable'): string {
  switch (state) {
    case 'session-bound': return 'continue_local_app_session';
    case 'action-required': return 'establish_fresh_app_access_session';
    case 'revoked': return 'reopen_local_app_session';
    case 'project-changed': return 'register_local_development_project';
    case 'process-replaced': return 'restart_through_verified_desktop_supervisor';
    case 'account-changed': return 'establish_session_for_current_account';
    case 'runtime-restarted': return 'reopen_local_app_session';
    case 'unavailable': return 'start_fixed_runtime_service';
  }
}
