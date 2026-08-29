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
  createNimiLocalAppEmbodimentClient,
  createNimiLocalAppEmbodimentRuntimeClient,
  type NimiLocalAppEmbodimentClient,
  type NimiLocalAppEmbodimentRuntime,
  type NimiLocalAppEmbodimentShell,
} from './local-app-runtime-platform-embodiment.js';
import {
  createNimiLocalAppConversationClient,
  type NimiLocalAppConversationArtifactReadInput,
  type NimiLocalAppConversationArtifactReadResult,
  type NimiLocalAppConversationAttachmentUploadInput,
  type NimiLocalAppConversationAttachmentUploadResult,
  type NimiLocalAppConversationVoiceTranscriptionInput,
  type NimiLocalAppConversationVoiceTranscriptionResult,
	type NimiLocalAppConversationVoiceRenderInput,
	type NimiLocalAppConversationVoiceRenderResult,
	type NimiLocalAppConversationCallOptions,
  type NimiLocalAppConversationOpenInput,
  NimiLocalAppConversationOpenResult,
  NimiLocalAppConversationInterruptResult,
  NimiLocalAppConversationLiveAction,
  NimiLocalAppConversationLiveTool,
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
  type NimiLocalAppAgentMemoryItem,
  type NimiLocalAppAgentMemoryProjection,
  type NimiLocalAppAgentMemoryMutationResult,
} from './local-app-runtime-platform-configure.js';
export {
  createNimiLocalAppAgentConfigureRuntimeShell,
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
  createNimiLocalAppPersonaCharacterClient,
  type NimiLocalAppPersonaCharacterClient,
  type NimiLocalAppPersonaCharacterShell,
} from './local-app-runtime-platform-persona-character.js';
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
import {
  createNimiAgentRealtimeClient,
  createNimiAiRealtimeClient,
  type NimiAgentRealtimeClient,
  type NimiAgentRealtimeShell,
  type NimiAiRealtimeClient,
  type NimiAiRealtimeShell,
} from './local-app-runtime-platform-realtime.js';
import {
  createNimiRealmRealtimeClient,
  type NimiRealmRealtimeClient,
  type NimiRealmRealtimeShell,
} from './local-app-runtime-platform-realm-realtime.js';
import {
  createNimiRealmChatClient,
  type NimiRealmChatClient,
  type NimiRealmChatShell,
} from './local-app-runtime-platform-realm-chat.js';

export type {
  NimiLocalAppAIConfigClient,
  NimiLocalAppAIConfigShell,
} from './local-app-runtime-platform-ai-config.js';
export type {
  NimiAgentRealtimeClient,
  NimiAgentRealtimeEvent,
  NimiAgentRealtimeInput,
  NimiAgentRealtimeShell,
  NimiAiRealtimeClient,
  NimiAiRealtimeEvent,
  NimiAiRealtimeInput,
  NimiAiRealtimeShell,
  NimiRealtimeAudioFormat,
  NimiRealtimeControlStatus,
  NimiRealtimeEventEnvelope,
  NimiRealtimeOperationResult,
  NimiRealtimeSubscription,
  NimiRealtimeUsage,
} from './local-app-runtime-platform-realtime.js';
export type {
  NimiRealmChatAttachment,
  NimiRealmChatUserSnapshot,
  NimiRealmChatUserSummary,
  NimiRealmRealtimeClient,
  NimiRealmRealtimeChatEvent,
  NimiRealmRealtimeDataEvent,
  NimiRealmRealtimeEvent,
  NimiRealmRealtimeMessage,
  NimiRealmRealtimeMessagePayload,
  NimiRealmRealtimeShell,
  NimiRealmRealtimeSubscription,
  NimiRealmRealtimeTarget,
} from './local-app-runtime-platform-realm-realtime.js';
export type {
  NimiRealmChatClient,
  NimiRealmChatListInput,
  NimiRealmChatListItem,
  NimiRealmChatListPage,
  NimiRealmChatRuntime,
  NimiRealmChatShell,
} from './local-app-runtime-platform-realm-chat.js';
export {
  createNimiRealmChatRuntimeClient,
} from './local-app-runtime-platform-realm-chat.js';
export {
  createNimiLocalAppAIConsumptionRuntimeClient,
  createNimiLocalAppRuntimeScenarioJobClient,
  createNimiLocalAppVoiceAssetsRuntimeClient,
} from './local-app-runtime-platform-ai.js';
export {
  createNimiLocalAppConversationRuntimeClient,
} from './local-app-runtime-platform-direct-conversation.js';
export {
  createNimiAgentRealtimeRuntimeClient,
} from './local-app-runtime-platform-direct-agent-realtime.js';
export {
  createNimiAiRealtimeRuntimeClient,
} from './local-app-runtime-platform-direct-ai-realtime.js';
export {
  createNimiRealmRealtimeRuntimeClient,
} from './local-app-runtime-platform-direct-realm-realtime.js';
export type {
  NimiLocalAppConversationRuntime,
} from './local-app-runtime-platform-direct-conversation.js';
export type {
  NimiAgentRealtimeRuntime,
} from './local-app-runtime-platform-direct-agent-realtime.js';
export type {
  NimiAiRealtimeRuntime,
} from './local-app-runtime-platform-direct-ai-realtime.js';
export type {
  NimiRealmRealtimeRuntime,
} from './local-app-runtime-platform-direct-realm-realtime.js';
export {
  projectNimiLocalAppPersonaCharacter,
  projectNimiLocalAppPersonaCharacterDeleteResult,
  projectNimiLocalAppPersonaCharacterList,
  toNimiLocalAppPersonaCharacterProfileInput,
  validateNimiLocalAppPersonaCharacterWriteInput,
} from './local-app-runtime-platform-persona-character.js';
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
  NimiLocalAppScenarioJobSubmitOptions,
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
  NimiLocalAppAgentReferencesRuntime,
  NimiLocalAppAgentReferencesShell,
} from './local-app-runtime-platform-agent-references.js';
export {
  createNimiLocalAppEmbodimentClient,
  createNimiLocalAppEmbodimentRuntimeClient,
} from './local-app-runtime-platform-embodiment.js';
export type {
  NimiLocalAppEmbodimentActivity,
  NimiLocalAppEmbodimentClient,
  NimiLocalAppEmbodimentRuntime,
  NimiLocalAppEmbodimentEmotion,
  NimiLocalAppEmbodimentEvent,
  NimiLocalAppEmbodimentPosture,
  NimiLocalAppEmbodimentScopeInput,
  NimiLocalAppEmbodimentShell,
  NimiLocalAppEmbodimentShellSubscription,
  NimiLocalAppEmbodimentSnapshot,
  NimiLocalAppEmbodimentSubscribeInput,
  NimiLocalAppEmbodimentSubscription,
  NimiLocalAppEmbodimentVoiceTiming,
} from './local-app-runtime-platform-embodiment.js';
export {
  createNimiLocalAppAgentReferencesRuntimeClient,
} from './local-app-runtime-platform-agent-references.js';
export type {
  NimiLocalAppConversationAction,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationMessage,
  NimiLocalAppConversationMessagePart,
  NimiLocalAppConversationInputPart,
  NimiLocalAppConversationArtifactReadInput,
  NimiLocalAppConversationArtifactReadResult,
  NimiLocalAppConversationAttachmentUploadInput,
  NimiLocalAppConversationAttachmentUploadResult,
  NimiLocalAppConversationVoiceTranscriptionInput,
  NimiLocalAppConversationVoiceTranscriptionResult,
  NimiLocalAppConversationVoiceRenderInput,
  NimiLocalAppConversationVoiceRenderResult,
  NimiLocalAppConversationOpenInput,
  NimiLocalAppConversationOpenResult,
  NimiLocalAppConversationInterruptResult,
  NimiLocalAppConversationLiveAction,
  NimiLocalAppConversationLiveTool,
  NimiLocalAppConversationScopeInput,
  NimiLocalAppConversationSendInput,
  NimiLocalAppConversationSendResult,
  NimiLocalAppConversationShellSubscription,
  NimiLocalAppConversationSnapshot,
  NimiLocalAppConversationSubscription,
  NimiLocalAppConversationTurn,
  NimiLocalAppConversationVoice,
  NimiLocalAppAgentHandle,
} from './local-app-runtime-platform-conversation.js';
export type {
  NimiLocalAppAgentAutonomyConfig,
  NimiLocalAppAgentAutonomyIntent,
  NimiLocalAppAgentAutonomyMode,
  NimiLocalAppAgentAutonomyProjection,
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentConfigureRuntime,
  NimiLocalAppAgentConfigureShell,
  NimiLocalAppAgentMemoryItem,
  NimiLocalAppAgentMemoryProjection,
  NimiLocalAppAgentMemoryMutationResult,
  NimiLocalAppAgentExecutionState,
  NimiLocalAppAgentLifecycleStatus,
  NimiLocalAppAgentManagerContextProjection,
  NimiLocalAppAgentManagerContextState,
  NimiLocalAppAgentManagerConversationSummaryStatus,
  NimiLocalAppAgentManagerCoverageProjection,
  NimiLocalAppAgentManagerCoverageSection,
  NimiLocalAppAgentManagerCoverageState,
  NimiLocalAppAgentManagerLaneId,
  NimiLocalAppAgentManagerLaneProjection,
  NimiLocalAppAgentManagerLaneState,
  NimiLocalAppAgentManagerReasonCode,
  NimiLocalAppAgentManagerSnapshot,
  NimiLocalAppAgentManagerSnapshotInput,
  NimiLocalAppAgentManagerSourceCognitionStatus,
  NimiLocalAppAgentManagerSourceProjection,
  NimiLocalAppAgentManagerSourceState,
  NimiLocalAppAgentManagerTruncationProjection,
  NimiLocalAppAgentManagerTruncationReason,
  NimiLocalAppAgentPresentationAssetMaterial,
  NimiLocalAppAgentPresentationAsset,
  NimiLocalAppAgentPresentationBackendKind,
  NimiLocalAppAgentPresentationIntent,
  NimiLocalAppAgentPresentationProfile,
  NimiLocalAppAgentPresentationProjection,
  NimiLocalAppAgentScopedInput,
  NimiLocalAppAutonomySnapshotInput,
  NimiLocalAppAutonomyUpdateInput,
  NimiLocalAppDuration,
  NimiLocalAppPresentationCommitInput,
  NimiLocalAppPresentationAssetReadInput,
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
export type {
  NimiLocalAppPersonaCharacter,
  NimiLocalAppPersonaCharacterAssetIntent,
  NimiLocalAppPersonaCharacterClient,
  NimiLocalAppPersonaCharacterCreateInput,
  NimiLocalAppPersonaCharacterDeleteResult,
  NimiLocalAppPersonaCharacterDiagnostic,
  NimiLocalAppPersonaCharacterExternalRef,
  NimiLocalAppPersonaCharacterExtension,
  NimiLocalAppPersonaCharacterFailureReason,
  NimiLocalAppPersonaCharacterListOwnedInput,
  NimiLocalAppPersonaCharacterListOwnedPage,
  NimiLocalAppPersonaCharacterLorebookDeclaration,
  NimiLocalAppPersonaCharacterOrigin,
  NimiLocalAppPersonaCharacterProfile,
  NimiLocalAppPersonaCharacterProfileCoverage,
  NimiLocalAppPersonaCharacterProfileCoverageRef,
  NimiLocalAppPersonaCharacterProfileCoverageSection,
  NimiLocalAppPersonaCharacterProfileInput,
  NimiLocalAppPersonaCharacterReplaceInput,
  NimiLocalAppPersonaCharacterResourceRef,
  NimiLocalAppPersonaCharacterShell,
  NimiLocalAppPersonaCharacterVisibility,
  NimiLocalAppPersonaCharacterWritableVisibility,
} from './local-app-runtime-platform-persona-character.js';

export type NimiAppAuthMode = 'local-app';

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
    readonly realtime: NimiAiRealtimeShell;
  };
  readonly aiConfig: NimiLocalAppAIConfigShell;
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<unknown>;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<unknown>;
    readonly removeJson: (relativePath: string) => Promise<unknown>;
    readonly assets: NimiLocalAppAssetsShell;
  };
  readonly realm: {
    readonly chat: NimiRealmChatShell;
    readonly worldCore: {
      readonly list: (input?: NimiLocalAppWorldCoreListInput) => Promise<unknown>;
      readonly create: (input: unknown) => Promise<unknown>;
    };
    readonly personaCharacter: NimiLocalAppPersonaCharacterShell;
    readonly realtime: NimiRealmRealtimeShell;
  };
  readonly agents: NimiLocalAppAgentReferencesShell;
  readonly conversation: NimiLocalAppConversationShell;
  readonly embodiment: NimiLocalAppEmbodimentShell;
  readonly agentRealtime: NimiAgentRealtimeShell;
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
    readonly realtime: NimiAiRealtimeClient;
  };
  readonly aiConfig: NimiLocalAppAIConfigClient;
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
    readonly chat: NimiRealmChatClient;
    readonly worldCore: {
      readonly list: (
        input?: NimiLocalAppWorldCoreListInput,
      ) => Promise<readonly RealmModel<'WorldCoreDto'>[]>;
      readonly create: (
        input: RealmModel<'CreateWorldCoreDto'>,
      ) => Promise<RealmModel<'WorldCoreDto'>>;
    };
    readonly personaCharacter: NimiLocalAppPersonaCharacterClient;
    readonly realtime: NimiRealmRealtimeClient;
  };
  readonly agents: NimiLocalAppAgentReferencesClient;
  readonly agentConfigure: NimiLocalAppAgentConfigureClient;
  readonly conversation: {
    readonly open: (input: NimiLocalAppConversationOpenInput) => Promise<NimiLocalAppConversationOpenResult>;
    readonly send: (input: NimiLocalAppConversationSendInput) => Promise<NimiLocalAppConversationSendResult>;
    readonly uploadAttachment: (input: NimiLocalAppConversationAttachmentUploadInput) => Promise<NimiLocalAppConversationAttachmentUploadResult>;
    readonly readArtifact: (input: NimiLocalAppConversationArtifactReadInput) => Promise<NimiLocalAppConversationArtifactReadResult>;
	readonly transcribeVoice: (input: NimiLocalAppConversationVoiceTranscriptionInput, options?: NimiLocalAppConversationCallOptions) => Promise<NimiLocalAppConversationVoiceTranscriptionResult>;
    readonly renderVoice: (input: NimiLocalAppConversationVoiceRenderInput) => Promise<NimiLocalAppConversationVoiceRenderResult>;
    readonly interruptTurn: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationInterruptResult>;
    readonly subscribe: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSubscription>;
    readonly snapshot: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSnapshot>;
  };
  readonly embodiment: NimiLocalAppEmbodimentClient;
  readonly agentRealtime: NimiAgentRealtimeClient;
};

// @nimi-authority: definition.nimi.sdks.feature-clients.app-client-plane
// @nimi-authority: rule.nimi.sdks.feature-clients.r019
// @nimi-authority: rule.nimi.sdks.feature-clients.r034
// @nimi-authority: rule.nimi.sdks.feature-clients.r040
export function createNimiLocalAppClient(
  input: NimiLocalAppClientInput,
): NimiLocalAppClient {
  assertExactKeys(input, ['standardShell'], 'SDK local-app client input');
  const standardShell = input.standardShell;
  const expectedNamespaces = ['session', 'ai', 'aiConfig', 'storage', 'realm', 'agents', 'conversation', 'embodiment', 'agentRealtime', 'agentConfigure'] as const;
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
  const aiNamespaces = ['text', 'scenario', 'scenarioJobs', 'artifacts', 'voiceAssets', 'realtime'] as const;
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
  assertExactMethodNamespace(ai.realtime, ['open', 'appendInput', 'submitOwnerControl', 'subscribe', 'interruptOutput', 'close'], 'ai.realtime');
  assertExactMethodNamespace(standardShell.aiConfig, ['get', 'overwrite', 'listOptions'], 'aiConfig');
  const storage = asRecord(standardShell.storage);
  if (!storage || Object.keys(storage).sort().join('|') !== ['assets', 'readJson', 'removeJson', 'writeJson'].sort().join('|')) {
    return localAppError('Host-injected local-app standardShell storage namespace is invalid.', 'SDK_LOCAL_APP_CARRIER_REQUIRED', 'use_host_injected_standard_shell');
  }
  if (typeof storage.readJson !== 'function' || typeof storage.writeJson !== 'function' || typeof storage.removeJson !== 'function') {
    return localAppError('Host-injected local-app standardShell storage namespace is invalid.', 'SDK_LOCAL_APP_CARRIER_REQUIRED', 'use_host_injected_standard_shell');
  }
  assertExactMethodNamespace(storage.assets, ['stat', 'list', 'write', 'read', 'remove', 'move', 'reveal', 'adoptArtifact'], 'storage.assets');
  const realm = asRecord(standardShell.realm);
  if (!realm || Object.keys(realm).sort().join('|') !== ['chat', 'personaCharacter', 'realtime', 'worldCore'].sort().join('|')) {
    return localAppError(
      'Host-injected local-app standardShell realm namespace is invalid.',
      'SDK_LOCAL_APP_CARRIER_REQUIRED',
      'use_host_injected_standard_shell',
    );
  }
  assertExactMethodNamespace(realm.worldCore, ['list', 'create'], 'realm.worldCore');
  assertExactMethodNamespace(realm.chat, ['list'], 'realm.chat');
  assertExactMethodNamespace(realm.personaCharacter, ['listOwned', 'getOwned', 'create', 'replace', 'delete'], 'realm.personaCharacter');
  assertExactMethodNamespace(realm.realtime, ['open', 'subscribe', 'ack', 'closeSubscription', 'closeChannel'], 'realm.realtime');
  assertExactMethodNamespace(standardShell.agents, ['listReferences'], 'agents');
  assertExactMethodNamespace(standardShell.conversation, ['open', 'send', 'uploadAttachment', 'readArtifact', 'transcribeVoice', 'renderVoice', 'interruptTurn', 'subscribe', 'snapshot'], 'conversation');
  assertExactMethodNamespace(standardShell.embodiment, ['snapshot', 'subscribe'], 'embodiment');
  assertExactMethodNamespace(standardShell.agentRealtime, ['open', 'appendInput', 'subscribe', 'status', 'interruptOutput', 'close'], 'agentRealtime');
  const agentConfigure = asRecord(standardShell.agentConfigure);
  if (!agentConfigure
    || Object.keys(agentConfigure).length !== 5
    || !Object.hasOwn(agentConfigure, 'sharedAIConfig')
    || !Object.hasOwn(agentConfigure, 'autonomy')
    || !Object.hasOwn(agentConfigure, 'presentation')
    || !Object.hasOwn(agentConfigure, 'memory')
    || !Object.hasOwn(agentConfigure, 'manager')) {
    return localAppError(
      'Host-injected local-app standardShell agentConfigure namespace is invalid.',
      'SDK_LOCAL_APP_CARRIER_REQUIRED',
      'use_host_injected_standard_shell',
    );
  }
  assertExactMethodNamespace(agentConfigure.sharedAIConfig, ['get', 'overwrite', 'listOptions'], 'agentConfigure.sharedAIConfig');
  assertExactMethodNamespace(agentConfigure.autonomy, ['snapshot', 'update'], 'agentConfigure.autonomy');
  assertExactMethodNamespace(agentConfigure.presentation, ['snapshot', 'readAsset', 'commit'], 'agentConfigure.presentation');
  assertExactMethodNamespace(agentConfigure.memory, ['inspect', 'correct', 'forget', 'setEnabled', 'deleteAll'], 'agentConfigure.memory');
  assertExactMethodNamespace(agentConfigure.manager, ['snapshot'], 'agentConfigure.manager');

  return Object.freeze({
    auth: Object.freeze({
      status: async () => projectAuth(await standardShell.session.status()),
    }),
    currentUser: Object.freeze({
      get: async () => projectCurrentUser(await standardShell.session.status()),
    }),
    ai: createAIClient(standardShell.ai),
    aiConfig: createNimiLocalAppAIConfigClient(standardShell.aiConfig),
    storage: Object.freeze({
      ...createNimiAppRuntimeStorageClient(standardShell.storage),
      assets: createNimiLocalAppAssetsClient(standardShell.storage.assets),
    }),
    realm: Object.freeze({
      chat: createNimiRealmChatClient(standardShell.realm.chat),
      worldCore: createWorldCoreClient(standardShell.realm.worldCore),
      personaCharacter: createNimiLocalAppPersonaCharacterClient(standardShell.realm.personaCharacter),
      realtime: createNimiRealmRealtimeClient(standardShell.realm.realtime),
    }),
    agents: createNimiLocalAppAgentReferencesClient(standardShell.agents),
    conversation: createNimiLocalAppConversationClient(standardShell.conversation),
    embodiment: createNimiLocalAppEmbodimentClient(standardShell.embodiment),
    agentRealtime: createNimiAgentRealtimeClient(standardShell.agentRealtime),
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
    realtime: createNimiAiRealtimeClient(shell.realtime),
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
      assertExactKeys(record, ['core', 'id', 'lorebookDeclaration', 'origin', 'visibility'], 'WorldCore create input');
      if (!record || !Object.hasOwn(record, 'core') || !Object.hasOwn(record, 'lorebookDeclaration') || !Object.hasOwn(record, 'origin')) {
        return localAppError(
          'WorldCore create input requires core, lorebookDeclaration, and origin.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_world_core_create_fields',
        );
      }
      const core = asRecord(record.core);
      const lorebookDeclaration = asRecord(record.lorebookDeclaration);
      const origin = asRecord(record.origin);
      if (!core || !lorebookDeclaration || !origin) {
        return localAppError(
          'WorldCore create core, lorebookDeclaration, and origin must be objects.',
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
    ['id', 'schemaVersion', 'contentRevision', 'contentHash', 'origin', 'visibility', 'lorebookDeclaration', 'core', 'createdAt', 'updatedAt', 'creatorId'],
    ['id', 'schemaVersion', 'contentRevision', 'contentHash', 'origin', 'visibility', 'lorebookDeclaration', 'core', 'createdAt', 'updatedAt'],
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
  const lorebookDeclaration = asRecord(record.lorebookDeclaration);
  assertAllowedWorldCoreKeys(
    lorebookDeclaration,
    ['identityBaseSetting', 'rolePlacements', 'worldRules'],
    ['identityBaseSetting', 'rolePlacements', 'worldRules'],
    'WorldCore lorebookDeclaration',
  );
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
