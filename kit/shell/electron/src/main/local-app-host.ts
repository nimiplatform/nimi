import {
  NIMI_APP_ACTIVITY_LAUNCH_FAILURE_GRACE_MS,
  validateNimiLocalAppTextAnnotationResult,
} from '@nimiplatform/kit/core/sdk-contract';
import { validateNimiLocalAppSpeechTranscript, validateNimiLocalAppAudioSeparation } from '@nimiplatform/kit/core/sdk-contract';
import { validateNimiLocalAppMusicGeneration, validateNimiLocalAppMusicTranscription, validateNimiLocalAppVoiceConversion } from '@nimiplatform/kit/core/sdk-contract';
import { validateNimiLocalAppArtifactUploadShellInput, validateNimiLocalAppArtifactUploadResult,
  type NimiLocalAppArtifactUploadShellInput } from '@nimiplatform/kit/core/sdk-contract';
import { validateNimiLocalAppTextDecideOutput, validateNimiLocalAppTextDecideShellSpec,
  type NimiLocalAppTextDecideShellSpec } from '@nimiplatform/kit/core/sdk-contract';
import { loadNimiElectronProtectedLocalPackage } from './protected-local-binding-loader.js';
import {
  requestElectronAppActivitySourceLaunch,
  type NimiElectronAppActivitySourceLaunchResult,
} from './app-activity-source-launch.js';

const WINDOWS_X64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-win32-x64';
const MACOS_ARM64_BINDING_PACKAGE = '@nimiplatform/kit-protected-local-darwin-arm64';
const MAX_PERSONA_REQUEST_BYTES = 2 * 1024 * 1024;

const LOCAL_APP_BINDING_METHODS = [
  'localAppVideoSessionOpen',
  'localAppVideoSessionSubmit',
  'localAppVideoSessionRead',
  'localAppVideoSessionClose',
  'localAppSessionStatus',
  'localAppSessionRenew',
  'localAppAIConfigGet',
  'localAppAIConfigOverwrite',
  'localAppAIConfigLocalOptions',
  'localAppTextGenerateCandidate',
  'localAppTextTurnSubscribe',
  'localAppTextTurnStreamNext',
  'localAppTextTurnStreamClose',
  'localAppScenarioExecute',
  'localAppScenarioExecuteCancel',
  'localAppScenarioExecuteRelease',
  'localAppScenarioJobSubmit',
  'localAppScenarioJobGet',
  'localAppScenarioJobSubscribe',
  'localAppScenarioJobStreamNext',
  'localAppScenarioJobStreamClose',
  'localAppScenarioJobCancel',
  'localAppArtifactRead',
  'localAppArtifactUpload',
  'localAppVoiceAssetsList',
  'localAppRealmWorldCoreList',
  'localAppRealmWorldCoreCreate',
  'localAppRealmWorldCreationEligibilityGet',
  'localAppRealmWorldCoreGet',
  'localAppRealmWorldCoreReplace',
  'localAppRealmWorldCharacterList',
  'localAppRealmWorldCharacterGet',
  'localAppRealmWorldCharacterCreate',
  'localAppRealmWorldCharacterReplace',
  'localAppRealmWorldEntityList',
  'localAppRealmWorldEntityGet',
  'localAppRealmWorldEntityCreate',
  'localAppRealmWorldRelationshipList',
  'localAppRealmWorldRelationshipGet',
  'localAppRealmPersonaCharacterListOwned',
  'localAppRealmPersonaCharacterGetOwned',
  'localAppRealmPersonaCharacterCreate',
  'localAppRealmPersonaCharacterReplace',
  'localAppRealmPersonaCharacterDelete',
  'localAppRealmChatList',
  'localAppRealmRealtimeOpen',
  'localAppRealmRealtimeSubscribe',
  'localAppRealmRealtimeAck',
  'localAppRealmRealtimeSubscriptionClose',
  'localAppRealmRealtimeChannelClose',
  'localAppAgentReferenceList',
  'localAppAvatarHostTargetResolve',
  'localAppStorageReadJson',
  'localAppStorageWriteJson',
  'localAppStorageRemoveJson',
  'localAppAssetStat',
  'localAppAssetList',
  'localAppAssetWriteOpen',
  'localAppAssetWriteChunk',
  'localAppAssetWriteCommit',
  'localAppAssetWriteAbort',
  'localAppAssetReadOpen',
  'localAppAssetReadNext',
  'localAppAssetReadClose',
  'localAppAssetRemove',
  'localAppAssetMove',
  'localAppAssetReveal',
  'localAppAssetAdopt',
  'localAppConversationOpen',
  'localAppConversationSendTurn',
  'localAppConversationToolCallsList',
  'localAppConversationToolResultSubmit',
  'localAppConversationAttachmentUpload',
  'localAppConversationArtifactRead',
  'localAppConversationVoiceTranscribe',
  'localAppConversationVoiceTranscribeCancel',
  'localAppConversationVoiceRender',
  'localAppConversationInterruptTurn',
  'localAppConversationSubscribe',
  'localAppConversationStreamNext',
  'localAppConversationStreamClose',
  'localAppConversationSnapshot',
  'localAppEmbodimentSnapshot',
  'localAppEmbodimentSubscribe',
  'localAppActivityPut',
  'localAppActivityList',
  'localAppActivitySubscribe',
  'localAppActivityMarkRead',
  'localAppActivityOpen',
  'localAppActivityOpenRequestsSubscribe',
  'localAppActivityOpenRequestComplete',
  'localAppAiRealtimeOpen',
  'localAppAiRealtimeAppendInput',
  'localAppAiRealtimeSubmitOwnerControl',
  'localAppAiRealtimeSubscribe',
  'localAppAiRealtimeInterruptOutput',
  'localAppAiRealtimeClose',
  'localAppAgentRealtimeOpen',
  'localAppAgentRealtimeAppendInput',
  'localAppAgentRealtimeSubscribe',
  'localAppAgentRealtimeStatus',
  'localAppAgentRealtimeInterruptOutput',
  'localAppAgentRealtimeClose',
  'localAppRealtimeStreamNext',
  'localAppRealtimeStreamClose',
  'localAppSharedAgentAIConfigGet',
  'localAppSharedAgentAIConfigOverwrite',
  'localAppSharedAgentAIConfigLocalOptions',
  'localAppAgentManagerSnapshot',
  'localAppAgentAutonomySnapshot',
  'localAppAgentUpdateAutonomy',
  'localAppAgentPresentationSnapshot',
  'localAppAgentPresentationReadAsset',
  'localAppAgentCommitPresentation',
  'localAppAgentMemoryInspect',
  'localAppAgentMemoryCorrect',
  'localAppAgentMemoryForget',
  'localAppAgentMemorySwitch',
  'localAppAgentMemoryDelete',
] as const;

const ADMITTED_REASON_CODES: ReadonlySet<string> = new Set([
  'protected-carrier-required',
  'runtime-service-unavailable',
  'runtime-service-untrusted',
  'runtime-service-error-unclassified',
  'runtime-service-repair-required',
  'runtime-unauthenticated',
  'process-replaced',
  'account-changed',
  'runtime-restarted',
  'revoked',
  'session-invalid',
  'presence-expired',
  'project-changed',
  'presence-expired',
  'runtime-access-denied',
  'ai-model-not-found',
  'ai-model-not-ready',
  'ai-provider-unavailable',
  'ai-route-unsupported',
  'ai-route-fallback-denied',
  'ai-input-invalid',
  'ai-input-limit-exceeded',
  'ai-media-idempotency-conflict',
  'ai-music-recovery-capacity-exceeded',
  'ai-output-invalid',
  'ai-text-behavior-unsupported',
  'ai-text-behavior-ambiguous',
  'ai-text-output-incomplete',
  'ai-tool-call-invalid',
  'ai-reasoning-continuity-invalid',
  'ai-execution-interrupted',
  'ai-content-filter-blocked',
  'ai-local-model-unavailable',
  'ai-local-model-profile-missing',
  'ai-local-service-unavailable',
  'ai-local-driver-unavailable',
  'ai-local-asset-incompatible',
  'ai-local-selection-not-found',
  'ai-local-capability-mismatch',
  'ai-local-configuration-not-configured',
  'ai-provider-auth-failed',
  'ai-provider-internal',
  'ai-provider-rate-limited',
  'ai-provider-timeout',
  'ai-realtime-session-not-found',
  'ai-realtime-session-closed',
  'ai-media-spec-invalid',
  'ai-media-option-unsupported',
  'ai-face-reference-missing',
  'ai-face-reference-ambiguous',
  'ai-face-target-missing',
  'ai-face-target-ambiguous',
  'ai-video-decode-failed',
  'ai-video-encode-failed',
  'ai-video-session-overloaded',
  'ai-video-session-generation-invalid',
  'ai-local-execution-load-failed',
  'ai-local-execution-inference-failed',
  'ai-local-execution-canceled',
  'ai-local-execution-process-crashed',
  'ai-local-execution-content-mismatch',
  'ai-loadout-model-asset-content-mismatch',
  'ai-local-execution-out-of-memory',
  'ai-voice-input-invalid',
  'ai-voice-workflow-unsupported',
  'ai-voice-asset-not-found',
  'ai-voice-asset-expired',
  'ai-voice-asset-scope-forbidden',
  'ai-voice-target-model-mismatch',
  'ai-voice-job-not-found',
  'ai-voice-job-not-cancellable',
  'local-app-operation-unavailable',
  'local-app-snapshot-unavailable',
  'local-app-access-denied',
  'local-app-operation-unsupported',
  'local-app-owner-unavailable',
  'capability-unavailable',
  'invalid-input',
  'session-invalid',
  'access-denied',
  'owner-authority-missing',
  'content-conflict',
  'realm-unavailable',
  'rate-limited',
  'upstream-failed',
  'contract-invalid',
  'request-too-large',
  'response-too-large',
  'ai-config-invalid',
  'ai-config-not-found',
  'ai-config-persistence-unavailable',
  'agent-presentation-revision-conflict',
  'agent-busy',
  'agent-turn-not-active',
  'agent-presentation-asset-type-invalid',
  'agent-presentation-asset-too-large',
  'agent-presentation-asset-structure-invalid',
  'agent-presentation-asset-dependency-missing',
  'agent-presentation-asset-integrity-mismatch',
  'agent-presentation-backend-incompatible',
  'agent-presentation-asset-not-validated',
  'invalid-payload',
  'not-found',
  'resource-exhausted',
  'invalid-path',
  'already-exists',
  'object-too-large',
  'invalid-range',
  'invalid-cursor',
  'integrity-failure',
  'artifact-unavailable',
  'canceled',
  'timeout',
  'host-internal-error',
] as const);

const ADMITTED_REASON_METADATA_KEYS: ReadonlySet<string> = new Set([
  'diagnostic_stage',
  'local_development_reason_code',
  'capability',
  'grpc_status_code',
]);

const FORBIDDEN_PORTABLE_APP_AI_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'account', 'accountid', 'accesstoken', 'authorization', 'binding', 'bindingid',
  'connectorgrant', 'connectorgrantid', 'credential', 'custody', 'custodymaterial',
  'grantid', 'providercredential', 'refreshtoken', 'token',
]);

const FORBIDDEN_PROJECTION_KEYS: ReadonlySet<string> = new Set([
  'endpoint',
  'authorization',
  'token',
  'localAppPrincipalId',
  'localAppRecordId',
  'trustClass',
  'provenanceRevision',
  'launchLease',
  'bootstrap',
  'processId',
  'sessionId',
  'sessionProof',
  'accountId',
  'grantId',
  'runtimeBootEpoch',
  'registeredAppSubject',
  'registrationHandle',
  'sourceGeneration',
  'declarationGeneration',
  'accountGeneration',
  'snapshotId',
  'credential',
  'peerProof',
  'classification',
  'domainId',
  'operationId',
] as const);

export type NimiElectronLocalAppJson =
  | null
  | boolean
  | number
  | string
  | readonly NimiElectronLocalAppJson[]
  | { readonly [key: string]: NimiElectronLocalAppJson };

export type NimiElectronLocalAppRecord = {
  readonly [key: string]: NimiElectronLocalAppJson;
};

type NimiElectronLocalAppArtifactUploadBindingInput = {
  readonly bytes?: Buffer;
  readonly mimeType: string;
  readonly source?: NimiLocalAppArtifactUploadShellInput['source'];
  readonly audioPreparation?: NimiLocalAppArtifactUploadShellInput['audioPreparation'];
};

type NimiElectronLocalAppConversationAttachmentUploadBindingInput = {
  readonly agentHandle: string;
  readonly conversationAnchorId: string;
  readonly mimeType: string;
  readonly displayName?: string;
  readonly bytes: Buffer;
};

type NimiElectronLocalAppConversationVoiceTranscriptionBindingInput = {
  readonly agentHandle: string;
  readonly conversationAnchorId: string;
  readonly requestId: string;
  readonly mimeType: string;
  readonly audioBytes: Buffer;
};

type NimiElectronLocalAppConversationVoiceTranscriptionCancelBindingInput = {
  readonly requestId: string;
};

type NimiElectronLocalAppScenarioExecuteBindingInput = {
  readonly spec: NimiElectronLocalAppJson;
  /** Host-generated native call identity; never supplied by a renderer. */
  readonly requestId: string;
  readonly timeoutMs?: number;
};

type NimiElectronLocalAppScenarioExecuteCallBindingInput = {
  readonly requestId: string;
};

/** Per-call Host control. Cancellation never serializes the signal itself. */
export type NimiElectronLocalAppCallOptions = {
  readonly signal?: AbortSignal;
};

type NativeLocalAppOutcome =
  | { readonly status: 'ok'; readonly value: unknown }
  | {
      readonly status: 'error';
      readonly reasonCode: string;
      readonly retryable: boolean;
      readonly reasonMetadata?: unknown;
    };

type NativeLocalAppBytesOutcome = NativeLocalAppOutcome & {
  readonly value?: Buffer | Uint8Array | null;
  readonly completed?: boolean;
};

export type NimiElectronLocalAppAssetReadNext =
  | { readonly completed: true }
  | { readonly completed: false; readonly bodyChunk: Uint8Array };

export type NimiElectronProtectedLocalBinding = {
  readonly localAppSessionStatus: () => Promise<NativeLocalAppOutcome>;
  readonly localAppSessionRenew: () => Promise<NativeLocalAppOutcome>;
  readonly localAppAIConfigGet: () => Promise<NativeLocalAppOutcome>;
  readonly localAppAIConfigOverwrite: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAIConfigLocalOptions: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppTextGenerateCandidate: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppTextTurnSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppTextTurnStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppTextTurnStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioExecute: (input: NimiElectronLocalAppScenarioExecuteBindingInput) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioExecuteCancel: (input: NimiElectronLocalAppScenarioExecuteCallBindingInput) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioExecuteRelease: (input: NimiElectronLocalAppScenarioExecuteCallBindingInput) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobSubmit: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobGet: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppScenarioJobCancel: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppArtifactRead: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppArtifactUpload: (input: NimiElectronLocalAppArtifactUploadBindingInput) => Promise<NativeLocalAppOutcome>;
  readonly localAppVoiceAssetsList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCoreList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCoreCreate: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCreationEligibilityGet: () => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCoreGet: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCoreReplace: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCharacterList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCharacterGet: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCharacterCreate: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldCharacterReplace: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldEntityList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldEntityGet: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldEntityCreate: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldRelationshipList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmWorldRelationshipGet: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmPersonaCharacterListOwned: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmPersonaCharacterGetOwned: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmPersonaCharacterCreate: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmPersonaCharacterReplace: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmPersonaCharacterDelete: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmChatList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentReferenceList: () => Promise<NativeLocalAppOutcome>;
  readonly localAppAvatarHostTargetResolve: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageReadJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageWriteJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppStorageRemoveJson: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetStat: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetWriteOpen: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetWriteChunk: (input: { readonly streamId: string; readonly bodyChunk: Buffer }) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetWriteCommit: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetWriteAbort: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetReadOpen: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetReadNext: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppBytesOutcome>;
  readonly localAppAssetReadClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetRemove: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetMove: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetReveal: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAssetAdopt: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationOpen: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationToolCallsList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationToolResultSubmit: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationSendTurn: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationAttachmentUpload: (input: NimiElectronLocalAppConversationAttachmentUploadBindingInput) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationArtifactRead: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationVoiceTranscribe: (input: NimiElectronLocalAppConversationVoiceTranscriptionBindingInput) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationVoiceTranscribeCancel: (input: NimiElectronLocalAppConversationVoiceTranscriptionCancelBindingInput) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationVoiceRender: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationInterruptTurn: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppConversationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppEmbodimentSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppEmbodimentSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppActivityPut: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppActivityList: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppActivitySubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppActivityMarkRead: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppActivityOpen: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppActivityOpenRequestsSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppActivityOpenRequestComplete: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmRealtimeOpen: () => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmRealtimeSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmRealtimeAck: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmRealtimeSubscriptionClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealmRealtimeChannelClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAiRealtimeOpen: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppVideoSessionOpen: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppVideoSessionSubmit: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppVideoSessionRead: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppVideoSessionClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAiRealtimeAppendInput: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAiRealtimeSubmitOwnerControl: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAiRealtimeSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAiRealtimeInterruptOutput: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAiRealtimeClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentRealtimeOpen: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentRealtimeAppendInput: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentRealtimeSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentRealtimeStatus: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentRealtimeInterruptOutput: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentRealtimeClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealtimeStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppRealtimeStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppSharedAgentAIConfigGet: () => Promise<NativeLocalAppOutcome>;
  readonly localAppSharedAgentAIConfigOverwrite: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppSharedAgentAIConfigLocalOptions: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentManagerSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentAutonomySnapshot: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentUpdateAutonomy: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentPresentationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentPresentationReadAsset: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentCommitPresentation: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentMemoryInspect: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentMemoryCorrect: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentMemoryForget: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentMemorySwitch: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
  readonly localAppAgentMemoryDelete: (input: NimiElectronLocalAppRecord) => Promise<NativeLocalAppOutcome>;
};

export type NimiElectronLocalAppHost = {
  readonly sessionStatus: () => Promise<NimiElectronLocalAppRecord>;
  readonly renewTechnicalSession: () => Promise<NimiElectronLocalAppRecord>;
  readonly aiConfigGet: () => Promise<NimiElectronLocalAppRecord>;
  readonly aiConfigOverwrite: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly aiConfigLocalOptions: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly textGenerateCandidate: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly textTurnSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly textTurnStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly textTurnStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioExecute: (
    input: NimiElectronLocalAppRecord,
    options?: NimiElectronLocalAppCallOptions,
  ) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobSubmit: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobGet: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly scenarioJobCancel: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly artifactRead: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly artifactUpload: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly voiceAssetsList: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldCoreList: (input: NimiElectronLocalAppRecord) => Promise<readonly NimiElectronLocalAppRecord[]>;
  readonly realmWorldCoreCreate: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldCreationEligibilityGet: () => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldCoreGet: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldCoreReplace: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldCharacterList: (input: NimiElectronLocalAppRecord) => Promise<readonly NimiElectronLocalAppRecord[]>;
  readonly realmWorldCharacterGet: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldCharacterCreate: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldCharacterReplace: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldEntityList: (input: NimiElectronLocalAppRecord) => Promise<readonly NimiElectronLocalAppRecord[]>;
  readonly realmWorldEntityGet: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldEntityCreate: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmWorldRelationshipList: (input: NimiElectronLocalAppRecord) => Promise<readonly NimiElectronLocalAppRecord[]>;
  readonly realmWorldRelationshipGet: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmPersonaCharacterListOwned: (input: NimiElectronLocalAppRecord) => Promise<readonly NimiElectronLocalAppRecord[]>;
  readonly realmPersonaCharacterGetOwned: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmPersonaCharacterCreate: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmPersonaCharacterReplace: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmPersonaCharacterDelete: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmChatList: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentReferenceList: () => Promise<readonly NimiElectronLocalAppRecord[]>;
  /** Host-only Avatar correlation; never dispatched through local-app commands. */
  readonly avatarHostTargetResolve: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly storageReadJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly storageWriteJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly storageRemoveJson: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetStat: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetList: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetWriteOpen: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetWriteChunk: (input: Readonly<Record<string, unknown>>) => Promise<NimiElectronLocalAppRecord>;
  readonly assetWriteCommit: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetWriteAbort: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetReadOpen: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetReadNext: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppAssetReadNext>;
  readonly assetReadClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetRemove: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetMove: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetReveal: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly assetAdopt: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationOpen: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationToolCallsList: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationToolResultSubmit: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationSendTurn: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationAttachmentUpload: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationArtifactRead: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationVoiceTranscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationVoiceRender: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationInterruptTurn: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly conversationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly embodimentSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly embodimentSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly activityPut: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly activityList: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly activitySubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly activityMarkRead: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly activityOpen: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly activityOpenDeliveriesSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly activityOpenDeliveryComplete: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly activityStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly activityStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmRealtimeOpen: () => Promise<NimiElectronLocalAppRecord>;
  readonly realmRealtimeSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmRealtimeAck: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmRealtimeSubscriptionClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realmRealtimeChannelClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly aiRealtimeOpen: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly videoSessionOpen: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly videoSessionSubmit: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly videoSessionRead: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly videoSessionClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly aiRealtimeAppendInput: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly aiRealtimeSubmitOwnerControl: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly aiRealtimeSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentRealtimeOpen: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentRealtimeAppendInput: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentRealtimeSubscribe: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentRealtimeStatus: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentRealtimeInterruptOutput: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentRealtimeClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly aiRealtimeInterruptOutput: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly aiRealtimeClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realtimeStreamNext: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly realtimeStreamClose: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly sharedAgentAIConfigGet: () => Promise<NimiElectronLocalAppRecord>;
  readonly sharedAgentAIConfigOverwrite: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly sharedAgentAIConfigLocalOptions: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentManagerSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentAutonomySnapshot: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentUpdateAutonomy: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentPresentationSnapshot: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentPresentationReadAsset: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentCommitPresentation: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentMemoryInspect: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentMemoryCorrect: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentMemoryForget: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentMemorySwitch: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
  readonly agentMemoryDelete: (input: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>;
};

export type NimiElectronLocalAppMaintenanceFailure = {
  readonly reasonCode: string;
  readonly retryable: boolean;
};

const LOCAL_APP_SESSION_ROTATION_INTERVAL_MS = 5 * 60 * 1_000;
const sessionReadyObservers = new WeakMap<NimiElectronLocalAppHost, Set<() => void>>();

function notifySessionReady(host: NimiElectronLocalAppHost): void {
  for (const notify of sessionReadyObservers.get(host) ?? []) notify();
}

const LOCAL_APP_SESSION_REBIND_TIMEOUT_MS = 2_000;
const LOCAL_APP_SESSION_INVALID_REASONS: ReadonlySet<string> = new Set([
  // Native drops these one-shot transports; its next call may bind a new scope.
  'runtime-service-unavailable',
  'runtime-service-untrusted',
  'runtime-service-error-unclassified',
  'runtime-unauthenticated',
  'process-replaced',
  'account-changed',
  'runtime-restarted',
  'revoked',
  'project-changed',
  'local-app-snapshot-unavailable',
]);
const LOCAL_APP_BINDING_RETRY_SAFE_METHODS: ReadonlySet<string> = new Set([
  'localAppSessionStatus',
  'localAppAIConfigGet', 'localAppAIConfigLocalOptions',
  'localAppScenarioJobGet', 'localAppArtifactRead', 'localAppVoiceAssetsList',
  'localAppRealmWorldCoreGet',
  'localAppRealmWorldCharacterList',
  'localAppRealmWorldCharacterGet',
  'localAppRealmWorldEntityList',
  'localAppRealmWorldEntityGet',
  'localAppRealmWorldRelationshipList',
  'localAppRealmWorldRelationshipGet',
  'localAppRealmWorldCreationEligibilityGet',
  'localAppRealmWorldCoreList', 'localAppRealmPersonaCharacterListOwned',
  'localAppRealmPersonaCharacterGetOwned', 'localAppRealmChatList',
  'localAppAgentReferenceList', 'localAppAvatarHostTargetResolve',
  'localAppConversationSnapshot', 'localAppEmbodimentSnapshot',
  // Activity publication and read marks are account-scoped mutations; after a
  // rebind they are never replayed into the next session or account.
  'localAppActivityList',
  'localAppAgentRealtimeStatus',
  'localAppSharedAgentAIConfigGet', 'localAppSharedAgentAIConfigLocalOptions',
  'localAppAgentManagerSnapshot', 'localAppAgentAutonomySnapshot',
  'localAppAgentPresentationSnapshot', 'localAppAgentPresentationReadAsset',
  'localAppAgentMemoryInspect',
  'localAppStorageReadJson', 'localAppAssetStat', 'localAppAssetList',
]);

export class NimiElectronLocalAppHostError extends Error {
  readonly reasonCode: string;
  readonly retryable: boolean;
  readonly reasonMetadata: Readonly<Record<string, string>>;

  constructor(
    reasonCode: string,
    retryable: boolean,
    reasonMetadata: Readonly<Record<string, string>> = {},
  ) {
    super(reasonCode);
    this.name = 'NimiElectronLocalAppHostError';
    this.reasonCode = reasonCode;
    this.retryable = retryable;
    this.reasonMetadata = Object.freeze({ ...reasonMetadata });
  }
}

function withBoundedSessionRebind(
  binding: NimiElectronProtectedLocalBinding,
  onSessionChange: (cause: { readonly reasonCode: string; readonly retryable: boolean }) => void,
  onSessionReady: () => void,
): NimiElectronProtectedLocalBinding {
  let rebindInFlight: Promise<NativeLocalAppOutcome> | undefined;
  let generation = 0;
  let invalidated = false;
  const stale = (): NativeLocalAppOutcome => ({ status: 'error', reasonCode: 'runtime-unauthenticated', retryable: false });
  const renew = (cause = { reasonCode: 'runtime-unauthenticated', retryable: false }): Promise<NativeLocalAppOutcome> => {
    if (!rebindInFlight) {
      let resolve!: (outcome: NativeLocalAppOutcome) => void;
      let reject!: (error: unknown) => void;
      const pending = new Promise<NativeLocalAppOutcome>((accept, fail) => { resolve = accept; reject = fail; });
      rebindInFlight = pending.then((outcome) => {
        if (isReadySessionOutcome(outcome)) invalidated = false;
        return outcome;
      }).finally(() => { rebindInFlight = undefined; });
      // Dispose old App state synchronously, before installing another scope.
      // Install the gate first: cleanup may itself close protected resources.
      try {
        if (!invalidated) { generation++; invalidated = true; onSessionChange(cause); }
        void boundedSessionRenew(binding).then(resolve, reject);
      }
      catch (error) { reject(error); }
    }
    return rebindInFlight;
  };
  return new Proxy(binding, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof property !== 'string'
        || typeof value !== 'function'
        || property === 'localAppSessionRenew'
        || !LOCAL_APP_BINDING_METHODS.includes(property as typeof LOCAL_APP_BINDING_METHODS[number])
      ) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (...args: unknown[]): Promise<NativeLocalAppOutcome> => {
        const expected = generation;
        if (rebindInFlight || invalidated) {
          const ready = await (rebindInFlight ?? renew());
          if (expected !== generation) return stale();
          if (!isReadySessionOutcome(ready)) return ready.status === 'error' ? ready : untrustedNativeOutcome();
        }
        const first = await Reflect.apply(value, target, args) as NativeLocalAppOutcome;
        // A late response from the old scope cannot start a second rebind or
        // become a successful response in the newly loaded renderer.
        if (expected !== generation) return stale();
        if (!isSessionInvalidOutcome(first)) {
          return first;
        }
        console.warn('[nimi-shell] local App session invalidated', {
          method: property, reasonCode: first.reasonCode, retryable: first.retryable,
        });
        // Old App-owned work must stop even when the subsequent rebind fails.
        const rebound = await renew({ reasonCode: first.reasonCode, retryable: first.retryable });
        if (!isReadySessionOutcome(rebound)) {
          return rebound.status === 'error' ? rebound : untrustedNativeOutcome();
        }
        onSessionReady();
        if (!LOCAL_APP_BINDING_RETRY_SAFE_METHODS.has(property)) {
          return first;
        }
        const reboundGeneration = generation;
        const retried = await Reflect.apply(value, target, args) as NativeLocalAppOutcome;
        return reboundGeneration === generation ? retried : stale();
      };
    },
  });
}

async function boundedSessionRenew(
  binding: NimiElectronProtectedLocalBinding,
): Promise<NativeLocalAppOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      binding.localAppSessionRenew().catch(() => untrustedNativeOutcome()),
      new Promise<NativeLocalAppOutcome>((resolve) => {
        timer = setTimeout(() => resolve({
          status: 'error', reasonCode: 'runtime-service-unavailable', retryable: true,
        }), LOCAL_APP_SESSION_REBIND_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isSessionInvalidOutcome(outcome: NativeLocalAppOutcome): outcome is Extract<NativeLocalAppOutcome, { status: 'error' }> {
  return outcome?.status === 'error' && LOCAL_APP_SESSION_INVALID_REASONS.has(outcome.reasonCode);
}

function isReadySessionOutcome(outcome: NativeLocalAppOutcome): boolean {
  if (outcome?.status !== 'ok' || !isPlainRecord(outcome.value)) return false;
  if (!hasExactKeys(outcome.value, ['state', 'reasonCode', 'retryable', 'currentUser'])
    || outcome.value.state !== 'ready'
    || outcome.value.reasonCode !== 'action-executed'
    || outcome.value.retryable !== false
    || !isPlainRecord(outcome.value.currentUser)
    || !hasExactKeys(outcome.value.currentUser, ['state', 'value', 'reasonCode', 'retryable'])) return false;
  const currentUser = outcome.value.currentUser;
  if (currentUser.state === 'unavailable') {
    return currentUser.value === null
      && currentUser.reasonCode === 'current-user-display-unavailable'
      && currentUser.retryable === true;
  }
  return currentUser.state === 'ready'
    && isPlainRecord(currentUser.value)
    && hasExactKeys(currentUser.value, ['handle', 'displayName', 'avatarUrl'])
    && currentUser.reasonCode === 'action-executed'
    && currentUser.retryable === false;
}

function untrustedNativeOutcome(): NativeLocalAppOutcome {
  return { status: 'error', reasonCode: 'runtime-service-untrusted', retryable: false };
}

export type NimiElectronAppActivityLaunch = (openRequestId: string) => Promise<NimiElectronAppActivitySourceLaunchResult>;

const defaultAppActivityLaunch: NimiElectronAppActivityLaunch = (openRequestId) => (
  requestElectronAppActivitySourceLaunch({ openRequestId })
);

// Converts an ISO-8601 instant from the renderer carrier into the native
// Timestamp input pair.
function nativeTimestamp(value: unknown): { readonly seconds: string; readonly nanos: number } {
  const millis = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(millis)) throw new NimiElectronLocalAppHostError('invalid-payload', false);
  const seconds = Math.floor(millis / 1000);
  return { seconds: String(seconds), nanos: (millis - seconds * 1000) * 1_000_000 };
}

// Native optional fields are omitted rather than carried as null.
function presentNativeFields(
  fields: Readonly<Record<string, NimiElectronLocalAppJson | undefined>>,
): NimiElectronLocalAppRecord {
  const present: Record<string, NimiElectronLocalAppJson> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) present[name] = value;
  }
  return present;
}

class ElectronLocalAppHost implements NimiElectronLocalAppHost {
  private readonly binding: NimiElectronProtectedLocalBinding;
  private readonly onSessionReady: () => void;
  private readonly textTurnStreams = new Map<string, { sequence: bigint }>();
  // Outstanding synchronous Scenario calls by Host-generated native identity.
  private readonly scenarioExecutions = new Map<string, (error: NimiElectronLocalAppHostError) => void>();

  constructor(
    binding: NimiElectronProtectedLocalBinding,
    onSessionChange: () => void = () => undefined,
    onSessionReady: () => void = () => undefined,
    private readonly activityLaunch: NimiElectronAppActivityLaunch = defaultAppActivityLaunch,
  ) {
    this.onSessionReady = () => { notifySessionReady(this); onSessionReady(); };
    this.binding = withBoundedSessionRebind(binding, (cause) => {
      // Session invalidation cancels every outstanding call with the typed
      // invalidation reason before App-owned work is torn down.
      for (const cancel of [...this.scenarioExecutions.values()]) {
        cancel(new NimiElectronLocalAppHostError(cause.reasonCode, cause.retryable));
      }
      onSessionChange();
    }, this.onSessionReady);
  }

  async sessionStatus(): Promise<NimiElectronLocalAppRecord> {
    const status = await invokeRecord(() => this.binding.localAppSessionStatus());
    if (status.state === 'ready') this.onSessionReady();
    return status;
  }

  async renewTechnicalSession(): Promise<NimiElectronLocalAppRecord> {
    // @nimi-authority: rule.nimi.runtime.protected-session.r016
    // Runtime only renews a live session after revalidating the same context.
    // A successful renewal preserves resources and App-owned work.
    const status = await invokeRecord(() => this.binding.localAppSessionRenew());
    if (status.state === 'ready') this.onSessionReady();
    return status;
  }

  aiConfigGet(): Promise<NimiElectronLocalAppRecord> {
    return invokePortableAppAIConfig(() => this.binding.localAppAIConfigGet());
  }

  aiConfigOverwrite(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokePortableAppAIConfig(() => this.binding.localAppAIConfigOverwrite(input));
  }

  aiConfigLocalOptions(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokePortableAppAIConfig(() => this.binding.localAppAIConfigLocalOptions(input));
  }

  textGenerateCandidate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeTextCandidate(() => this.binding.localAppTextGenerateCandidate(input));
  }

  async textTurnSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    const opened = await invokeExactTextRecord(() => this.binding.localAppTextTurnSubscribe(input), ['streamId']);
    this.textTurnStreams.set(String(opened.streamId), { sequence: 0n });
    return opened;
  }

  async textTurnStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    const streamId = String(input.streamId);
    const state = this.textTurnStreams.get(streamId);
    if (!state) throw untrustedRuntimeError();
    const next = await invokeScenarioStreamNext(
      () => this.binding.localAppTextTurnStreamNext(input),
      validateTextTurnEvent,
    );
    if (next.completed === true) {
      this.textTurnStreams.delete(streamId);
      return next;
    }
    const event = next.event;
    if (!isPlainRecord(event) || typeof event.sequence !== 'string') throw untrustedRuntimeError();
    const sequence = BigInt(event.sequence);
    if (sequence !== state.sequence + 1n) throw untrustedRuntimeError();
    state.sequence = sequence;
    // @nimi-authority: rule.nimi.runtime.ai-provider.local-app-text-behaviors
    // The native carrier enforces the total on the original protobuf. Parsed
    // tool arguments cannot reproduce its byte size from their JSON spelling.
    return next;
  }

  async textTurnStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    this.textTurnStreams.delete(String(input.streamId));
    return invokeConversationStreamClose(() => this.binding.localAppTextTurnStreamClose(input));
  }

  // @nimi-authority: rule.nimi.sdks.feature-clients.scenario-execute-call-control
  scenarioExecute(
    input: NimiElectronLocalAppRecord,
    options: NimiElectronLocalAppCallOptions = {},
  ): Promise<NimiElectronLocalAppRecord> {
    let parsed: ReturnType<typeof scenarioExecuteInput>;
    try {
      parsed = scenarioExecuteInput(input);
    } catch (error) {
      return Promise.reject(error);
    }
    const { spec, timeoutMs, decide } = parsed;
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(scenarioExecuteCanceledError());
    const requestId = createScenarioExecuteRequestId();
    return new Promise<NimiElectronLocalAppRecord>((resolve, reject) => {
      let settled = false;
      let cancellation: Promise<unknown> | undefined;
      const settle = (complete: () => void) => {
        if (settled) return;
        settled = true;
        complete();
      };
      // An abort or session invalidation settles the caller at once and drops
      // the pending native Runtime call; its late result is never projected.
      const cancel = (error: NimiElectronLocalAppHostError) => {
        if (settled) return;
        cancellation ??= this.binding.localAppScenarioExecuteCancel({ requestId }).catch(() => undefined);
        settle(() => reject(error));
      };
      const onAbort = () => cancel(scenarioExecuteCanceledError());
      this.scenarioExecutions.set(requestId, cancel);
      signal?.addEventListener('abort', onAbort, { once: true });
      const native = (async () => this.binding.localAppScenarioExecute({
        spec,
        requestId,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      }))();
      // The native registration is released exactly once after its call settles.
      void native.then(() => undefined, () => undefined).then(async () => {
        signal?.removeEventListener('abort', onAbort);
        this.scenarioExecutions.delete(requestId);
        await cancellation;
        await this.binding.localAppScenarioExecuteRelease({ requestId }).catch(() => undefined);
      });
      invokeScenarioExecute(() => native, decide).then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
    });
  }

  scenarioJobSubmit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeScenarioJobSubmit(() => this.binding.localAppScenarioJobSubmit(input));
  }

  scenarioJobGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeScenarioJobGet(() => this.binding.localAppScenarioJobGet(input));
  }

  scenarioJobSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppScenarioJobSubscribe(input), ['streamId']);
  }

  scenarioJobStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeScenarioStreamNext(() => this.binding.localAppScenarioJobStreamNext(input), validateScenarioJobEvent);
  }

  scenarioJobStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationStreamClose(() => this.binding.localAppScenarioJobStreamClose(input));
  }

  scenarioJobCancel(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeScenarioJobEnvelope(() => this.binding.localAppScenarioJobCancel(input));
  }

  artifactRead(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeArtifactRead(() => this.binding.localAppArtifactRead(input));
  }

  artifactUpload(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    let prepared: NimiLocalAppArtifactUploadShellInput;
    try { prepared = validateNimiLocalAppArtifactUploadShellInput(input); }
    catch { throw untrustedRuntimeError(); }
    return invokeArtifactUpload(
      () => this.binding.localAppArtifactUpload({ mimeType: prepared.mimeType,
        ...(prepared.bytes ? { bytes: Buffer.from(prepared.bytes) } : {}),
        ...(prepared.source ? { source: prepared.source } : {}),
        ...(prepared.audioPreparation ? { audioPreparation: prepared.audioPreparation } : {}) }),
      prepared,
    );
  }

  voiceAssetsList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeVoiceAssetsList(() => this.binding.localAppVoiceAssetsList(input));
  }

  realmWorldCoreList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return invokeWorldCoreList(() => this.binding.localAppRealmWorldCoreList(input));
  }

  realmWorldCoreCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeWorldCore(() => this.binding.localAppRealmWorldCoreCreate({ body: input }));
  }

  realmWorldCreationEligibilityGet(): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppRealmWorldCreationEligibilityGet());
  }

  realmWorldCoreGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeWorldCreatorRecord(() => this.binding.localAppRealmWorldCoreGet(input));
  }

  realmWorldCoreReplace(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeWorldCreatorRecord(() => this.binding.localAppRealmWorldCoreReplace(input));
  }

  realmWorldCharacterList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return invokeWorldCreatorList(() => this.binding.localAppRealmWorldCharacterList(input));
  }

  realmWorldCharacterGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeWorldCreatorRecord(() => this.binding.localAppRealmWorldCharacterGet(input));
  }

  realmWorldCharacterCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeWorldCreatorRecord(() => this.binding.localAppRealmWorldCharacterCreate(input));
  }

  realmWorldCharacterReplace(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeWorldCreatorRecord(() => this.binding.localAppRealmWorldCharacterReplace(input));
  }

  realmWorldEntityList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return invokeWorldCreatorList(() => this.binding.localAppRealmWorldEntityList(input));
  }

  realmWorldEntityGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeWorldCreatorRecord(() => this.binding.localAppRealmWorldEntityGet(input));
  }

  realmWorldEntityCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeWorldCreatorRecord(() => this.binding.localAppRealmWorldEntityCreate(input));
  }

  realmWorldRelationshipList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return invokeWorldCreatorList(() => this.binding.localAppRealmWorldRelationshipList(input));
  }

  realmWorldRelationshipGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeWorldCreatorRecord(() => this.binding.localAppRealmWorldRelationshipGet(input));
  }

  realmPersonaCharacterListOwned(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    validatePersonaCharacterListInput(input);
    return invokePersonaCharacterList(() => this.binding.localAppRealmPersonaCharacterListOwned(input));
  }

  realmPersonaCharacterGetOwned(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    if (!hasExactKeys(input, ['personaCharacterId'])) throw untrustedRuntimeError();
    exactText(input.personaCharacterId);
    return invokePersonaCharacter(() => this.binding.localAppRealmPersonaCharacterGetOwned(input));
  }

  realmPersonaCharacterCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    validatePersonaCharacterWriteInput(input, false);
    return invokePersonaCharacter(() => this.binding.localAppRealmPersonaCharacterCreate({ body: input }));
  }

  realmPersonaCharacterReplace(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    const personaCharacterId = exactText(input.personaCharacterId);
    const body = input.body;
    if (!isPlainRecord(body)) throw untrustedRuntimeError();
    validatePersonaCharacterWriteInput({ personaCharacterId, ...body }, true);
    return invokePersonaCharacter(() => this.binding.localAppRealmPersonaCharacterReplace({ personaCharacterId, body }));
  }

  realmPersonaCharacterDelete(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    if (!hasExactKeys(input, ['personaCharacterId'])) throw untrustedRuntimeError();
    const personaCharacterId = exactText(input.personaCharacterId);
    return invokePersonaCharacterDelete(
      () => this.binding.localAppRealmPersonaCharacterDelete({ personaCharacterId }),
      personaCharacterId,
    );
  }

  agentReferenceList(): Promise<readonly NimiElectronLocalAppRecord[]> {
    return invokeAgentReferenceList(() => this.binding.localAppAgentReferenceList());
  }

  avatarHostTargetResolve(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    if (!hasExactKeys(input, ['agentHandle', 'conversationAnchorId'])) throw untrustedRuntimeError();
    const agentHandle = exactText(input.agentHandle);
    const conversationAnchorId = optionalExactText(input.conversationAnchorId);
    return invokeAvatarHostTargetResolve(() => this.binding.localAppAvatarHostTargetResolve({
      agentHandle,
      conversationAnchorId,
    }));
  }

  storageReadJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeStorageDocument(() => this.binding.localAppStorageReadJson(input));
  }

  storageWriteJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeStorageDocument(() => this.binding.localAppStorageWriteJson(input));
  }

  storageRemoveJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeStorageRemove(() => this.binding.localAppStorageRemoveJson(input));
  }

  assetStat(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetRecord(() => this.binding.localAppAssetStat(input));
  }

  assetList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetList(() => this.binding.localAppAssetList(input));
  }

  assetWriteOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppAssetWriteOpen(input), ['streamId']);
  }

  assetWriteChunk(input: Readonly<Record<string, unknown>>): Promise<NimiElectronLocalAppRecord> {
    if (typeof input.streamId !== 'string' || !(input.bodyChunk instanceof Uint8Array)
      || input.bodyChunk.byteLength === 0 || input.bodyChunk.byteLength > 1024 * 1024) throw untrustedRuntimeError();
    const bodyChunk = input.bodyChunk;
    return invokeExactBooleanRecord(
      () => this.binding.localAppAssetWriteChunk({ streamId: input.streamId as string, bodyChunk: Buffer.from(bodyChunk) }),
      'accepted',
    );
  }

  assetWriteCommit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetRecord(() => this.binding.localAppAssetWriteCommit(input));
  }

  assetWriteAbort(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactBooleanRecord(() => this.binding.localAppAssetWriteAbort(input), 'closed');
  }

  assetReadOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetReadOpen(() => this.binding.localAppAssetReadOpen(input));
  }

  assetReadNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppAssetReadNext> {
    return invokeAssetReadNext(() => this.binding.localAppAssetReadNext(input));
  }

  assetReadClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactBooleanRecord(() => this.binding.localAppAssetReadClose(input), 'closed');
  }

  assetRemove(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactBooleanRecord(() => this.binding.localAppAssetRemove(input), 'removed');
  }

  assetMove(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetRecord(() => this.binding.localAppAssetMove(input));
  }

  assetReveal(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactBooleanRecord(() => this.binding.localAppAssetReveal(input), 'revealed');
  }

  assetAdopt(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeAssetRecord(() => this.binding.localAppAssetAdopt(input));
  }

  conversationOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationOpen(() => this.binding.localAppConversationOpen(input));
  }

  conversationToolCallsList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppConversationToolCallsList(input));
  }
  conversationToolResultSubmit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppConversationToolResultSubmit(input), ['callId']);
  }
  conversationSendTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppConversationSendTurn(input), ['turnId']);
  }

  conversationAttachmentUpload(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    const bytes = validateByteArray(input.bytes);
    if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) throw untrustedRuntimeError();
    const displayName = input.displayName === undefined
      ? undefined
      : boundedExactText(input.displayName, 255, false);
    return invokeConversationAttachmentUpload(() => this.binding.localAppConversationAttachmentUpload({
      agentHandle: boundedExactText(input.agentHandle, 256, false),
      conversationAnchorId: boundedExactText(input.conversationAnchorId, 256, false),
      mimeType: boundedImageMime(input.mimeType),
      ...(displayName ? { displayName } : {}),
      bytes: Buffer.from(bytes),
    }));
  }

  conversationArtifactRead(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationArtifactRead(() => this.binding.localAppConversationArtifactRead(input));
  }

  conversationVoiceTranscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    if (input.action === 'cancel') {
      return invokeExactBooleanRecord(() => this.binding.localAppConversationVoiceTranscribeCancel({
        requestId: boundedExactText(input.requestId, 256, false),
      }), 'canceled');
    }
    const audioBytes = validateByteArray(input.audioBytes);
    const mimeType = boundedMime(input.mimeType);
    if (audioBytes.length === 0 || audioBytes.length > 6 * 1024 * 1024 || !mimeType.startsWith('audio/')) {
      throw untrustedRuntimeError();
    }
    return invokeExactTextRecord(() => this.binding.localAppConversationVoiceTranscribe({
      agentHandle: boundedExactText(input.agentHandle, 256, false),
      conversationAnchorId: boundedExactText(input.conversationAnchorId, 256, false),
      requestId: boundedExactText(input.requestId, 256, false),
      mimeType,
      audioBytes: Buffer.from(audioBytes),
    }), ['text']);
  }

  conversationVoiceRender(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppConversationVoiceRender(input));
  }

  conversationInterruptTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppConversationInterruptTurn(input), ['turnId']);
  }

  conversationSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppConversationSubscribe(input), ['streamId']);
  }

  conversationStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationStreamNext(() => this.binding.localAppConversationStreamNext(input));
  }

  conversationStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationStreamClose(() => this.binding.localAppConversationStreamClose(input));
  }

  conversationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationSnapshot(() => this.binding.localAppConversationSnapshot(input));
  }

  embodimentSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppEmbodimentSnapshot(input));
  }

  embodimentSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppEmbodimentSubscribe(input), ['streamId']);
  }

  activityPut(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    const occurredAt = nativeTimestamp(input.occurredAt);
    return invokeRecord(() => this.binding.localAppActivityPut(presentNativeFields({
      key: input.key, revision: input.revision, kind: input.kind, todoState: input.todoState,
      attention: input.attention, title: input.title, summary: input.summary, objectRef: input.objectRef,
      activityType: input.type, dataJson: input.dataJson,
      occurredAtSeconds: occurredAt.seconds, occurredAtNanos: occurredAt.nanos, agentHandle: input.agentHandle,
    })));
  }

  activityList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    const filter = (input.filter ?? {}) as Readonly<Record<string, NimiElectronLocalAppJson | undefined>>;
    const after = typeof filter.occurredAfter === 'string' ? nativeTimestamp(filter.occurredAfter) : undefined;
    const before = typeof filter.occurredBefore === 'string' ? nativeTimestamp(filter.occurredBefore) : undefined;
    return invokeRecord(() => this.binding.localAppActivityList(presentNativeFields({
      sourceRef: filter.sourceRef, kind: filter.kind,
      todoStates: Array.isArray(filter.todoStates) ? filter.todoStates : [],
      agentRef: filter.agentRef,
      occurredAfterSeconds: after?.seconds, occurredAfterNanos: after?.nanos,
      occurredBeforeSeconds: before?.seconds, occurredBeforeNanos: before?.nanos,
      pageSize: input.pageSize, pageToken: input.pageToken,
    })));
  }

  activitySubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppActivitySubscribe(presentNativeFields({ afterChangeSeq: input.afterChangeSeq })), ['streamId']);
  }

  activityMarkRead(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppActivityMarkRead(input));
  }

  // @nimi-authority: rule.nimi.platform.core-protocol.p-actv-005
  // The Host consumes the Runtime-issued open request id for the Desktop
  // launch; renderer code receives only the typed result.
  async activityOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    const opened = await invokeExactTextRecord(() => this.binding.localAppActivityOpen(presentNativeFields({ activityId: input.activityId })), ['streamId']);
    const streamId = String(opened.streamId);
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await invokeConversationStreamClose(() => this.binding.localAppRealtimeStreamClose({ streamId })).catch(() => undefined);
    };
    let launchFailure: NimiElectronLocalAppRecord | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let graceElapsed: Promise<{ kind: 'grace' }> | undefined;
    let launching: Promise<{ kind: 'launch'; value: NimiElectronAppActivitySourceLaunchResult }> | undefined;
    const readNext = () => invokeActivityStreamNext(
      () => this.binding.localAppRealtimeStreamNext({ streamId }),
      ACTIVITY_OPEN_EVENT_SHAPES,
    ).then(value => ({ kind: 'stream' as const, value }));
    let pending = readNext();
    try {
      while (true) {
        // A cold source can confirm before Desktop's launch promise settles.
        // Its Runtime result (including the deadline) remains authoritative.
        const outcome = await Promise.race([pending, ...(launching ? [launching] : []), ...(graceElapsed ? [graceElapsed] : [])]);
        if (outcome.kind === 'grace') return launchFailure!;
        if (outcome.kind === 'launch') {
          launching = undefined;
          if (outcome.value.status !== 'requested') {
            launchFailure = { outcome: outcome.value.status, reason: outcome.value.reason };
            graceElapsed = new Promise(resolve => {
              graceTimer = setTimeout(() => resolve({ kind: 'grace' }), NIMI_APP_ACTIVITY_LAUNCH_FAILURE_GRACE_MS);
            });
          }
          continue;
        }
        const next = outcome.value;
        if (next.completed === true) {
          closed = true;
          return launchFailure ?? { outcome: 'failed', reason: 'source-not-ready' };
        }
        const event = next.event as Record<string, NimiElectronLocalAppJson> | undefined;
        if (event && typeof event.openRequestId === 'string') {
          launching = this.activityLaunch(event.openRequestId)
            .catch(() => ({ status: 'failed' as const, reason: 'launch-failed' as const }))
            .then(value => ({ kind: 'launch' as const, value }));
          pending = readNext();
          continue;
        }
        const result = event?.result as Record<string, NimiElectronLocalAppJson> | undefined;
        if (result && typeof result.outcome === 'string' && typeof result.reason === 'string') {
          return { outcome: result.outcome, reason: result.reason };
        }
        throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
      }
    } finally {
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      pending.catch(() => undefined);
      await close();
    }
  }

  activityOpenDeliveriesSubscribe(): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppActivityOpenRequestsSubscribe({}), ['streamId']);
  }

  activityOpenDeliveryComplete(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppActivityOpenRequestComplete(input));
  }

  activityStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeActivityStreamNext(() => this.binding.localAppRealtimeStreamNext(input));
  }

  activityStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationStreamClose(() => this.binding.localAppRealtimeStreamClose(input));
  }

  realmChatList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppRealmChatList(input));
  }

  realmRealtimeOpen(): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppRealmRealtimeOpen());
  }

  realmRealtimeSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppRealmRealtimeSubscribe(input), ['streamId']);
  }

  realmRealtimeAck(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppRealmRealtimeAck(input));
  }

  realmRealtimeSubscriptionClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppRealmRealtimeSubscriptionClose(input));
  }

  realmRealtimeChannelClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppRealmRealtimeChannelClose(input));
  }

  aiRealtimeOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAiRealtimeOpen(input));
  }
  videoSessionOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return invokeRecord(() => this.binding.localAppVideoSessionOpen(input)); }
  videoSessionSubmit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return invokeRecord(() => this.binding.localAppVideoSessionSubmit(input)); }
  videoSessionRead(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return invokeRecord(() => this.binding.localAppVideoSessionRead(input)); }
  videoSessionClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return invokeRecord(() => this.binding.localAppVideoSessionClose(input)); }

  aiRealtimeAppendInput(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAiRealtimeAppendInput(input));
  }

  aiRealtimeSubmitOwnerControl(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAiRealtimeSubmitOwnerControl(input));
  }

  aiRealtimeSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppAiRealtimeSubscribe(input), ['streamId']);
  }

  aiRealtimeInterruptOutput(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAiRealtimeInterruptOutput(input));
  }

  aiRealtimeClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAiRealtimeClose(input));
  }

  agentRealtimeOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentRealtimeOpen(input));
  }

  agentRealtimeAppendInput(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentRealtimeAppendInput(input));
  }

  agentRealtimeSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeExactTextRecord(() => this.binding.localAppAgentRealtimeSubscribe(input), ['streamId']);
  }

  agentRealtimeStatus(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentRealtimeStatus(input));
  }

  agentRealtimeInterruptOutput(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentRealtimeInterruptOutput(input));
  }

  agentRealtimeClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentRealtimeClose(input));
  }

  realtimeStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRealtimeStreamNext(() => this.binding.localAppRealtimeStreamNext(input));
  }

  realtimeStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeConversationStreamClose(() => this.binding.localAppRealtimeStreamClose(input));
  }

  sharedAgentAIConfigGet(): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppSharedAgentAIConfigGet());
  }

  sharedAgentAIConfigOverwrite(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppSharedAgentAIConfigOverwrite(input));
  }

  sharedAgentAIConfigLocalOptions(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppSharedAgentAIConfigLocalOptions(input));
  }

  agentManagerSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentManagerSnapshot(input));
  }

  agentAutonomySnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentAutonomySnapshot(input));
  }

  agentUpdateAutonomy(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentUpdateAutonomy(input));
  }

  agentPresentationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentPresentationSnapshot(input));
  }

  agentPresentationReadAsset(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentPresentationReadAsset(input));
  }

  agentCommitPresentation(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return invokeRecord(() => this.binding.localAppAgentCommitPresentation(input));
  }

  agentMemoryInspect(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return invokeRecord(() => this.binding.localAppAgentMemoryInspect(input)); }
  agentMemoryCorrect(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return invokeRecord(() => this.binding.localAppAgentMemoryCorrect(input)); }
  agentMemoryForget(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return invokeRecord(() => this.binding.localAppAgentMemoryForget(input)); }
  agentMemorySwitch(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return invokeRecord(() => this.binding.localAppAgentMemorySwitch(input)); }
  agentMemoryDelete(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return invokeRecord(() => this.binding.localAppAgentMemoryDelete(input)); }

}

class LazyElectronLocalAppHost implements NimiElectronLocalAppHost {
  private host: NimiElectronLocalAppHost | undefined;

  constructor(private readonly onSessionChange: () => void = () => undefined) {}

  private resolve(): NimiElectronLocalAppHost {
    this.host ??= new ElectronLocalAppHost(loadPlatformBinding(), this.onSessionChange, () => notifySessionReady(this));
    return this.host;
  }

  sessionStatus(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().sessionStatus();
  }

  renewTechnicalSession(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().renewTechnicalSession();
  }

  aiConfigGet(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().aiConfigGet();
  }

  aiConfigOverwrite(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().aiConfigOverwrite(input);
  }

  aiConfigLocalOptions(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().aiConfigLocalOptions(input);
  }

  textGenerateCandidate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().textGenerateCandidate(input);
  }

  textTurnSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().textTurnSubscribe(input);
  }

  textTurnStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().textTurnStreamNext(input);
  }

  textTurnStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().textTurnStreamClose(input);
  }

  scenarioExecute(
    input: NimiElectronLocalAppRecord,
    options?: NimiElectronLocalAppCallOptions,
  ): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioExecute(input, options);
  }

  scenarioJobSubmit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobSubmit(input);
  }

  scenarioJobGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobGet(input);
  }

  scenarioJobSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobSubscribe(input);
  }

  scenarioJobStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobStreamNext(input);
  }

  scenarioJobStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobStreamClose(input);
  }

  scenarioJobCancel(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().scenarioJobCancel(input);
  }

  artifactRead(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().artifactRead(input);
  }

  artifactUpload(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().artifactUpload(input);
  }

  voiceAssetsList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().voiceAssetsList(input);
  }

  realmWorldCoreList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().realmWorldCoreList(input);
  }

  realmWorldCoreCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldCoreCreate(input);
  }

  realmWorldCreationEligibilityGet(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldCreationEligibilityGet();
  }

  realmWorldCoreGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldCoreGet(input);
  }

  realmWorldCoreReplace(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldCoreReplace(input);
  }

  realmWorldCharacterList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().realmWorldCharacterList(input);
  }

  realmWorldCharacterGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldCharacterGet(input);
  }

  realmWorldCharacterCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldCharacterCreate(input);
  }

  realmWorldCharacterReplace(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldCharacterReplace(input);
  }

  realmWorldEntityList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().realmWorldEntityList(input);
  }

  realmWorldEntityGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldEntityGet(input);
  }

  realmWorldEntityCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldEntityCreate(input);
  }

  realmWorldRelationshipList(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().realmWorldRelationshipList(input);
  }

  realmWorldRelationshipGet(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmWorldRelationshipGet(input);
  }

  realmPersonaCharacterListOwned(input: NimiElectronLocalAppRecord): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().realmPersonaCharacterListOwned(input);
  }

  realmPersonaCharacterGetOwned(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmPersonaCharacterGetOwned(input);
  }

  realmPersonaCharacterCreate(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmPersonaCharacterCreate(input);
  }

  realmPersonaCharacterReplace(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmPersonaCharacterReplace(input);
  }

  realmPersonaCharacterDelete(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().realmPersonaCharacterDelete(input);
  }

  agentReferenceList(): Promise<readonly NimiElectronLocalAppRecord[]> {
    return this.resolve().agentReferenceList();
  }
  avatarHostTargetResolve(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().avatarHostTargetResolve(input);
  }
  storageReadJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().storageReadJson(input);
  }

  storageWriteJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().storageWriteJson(input);
  }

  storageRemoveJson(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().storageRemoveJson(input);
  }

  assetStat(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetStat(input); }
  assetList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetList(input); }
  assetWriteOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetWriteOpen(input); }
  assetWriteChunk(input: Readonly<Record<string, unknown>>): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetWriteChunk(input); }
  assetWriteCommit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetWriteCommit(input); }
  assetWriteAbort(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetWriteAbort(input); }
  assetReadOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetReadOpen(input); }
  assetReadNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppAssetReadNext> { return this.resolve().assetReadNext(input); }
  assetReadClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetReadClose(input); }
  assetRemove(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetRemove(input); }
  assetMove(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetMove(input); }
  assetReveal(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetReveal(input); }
  assetAdopt(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().assetAdopt(input); }

  conversationOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationOpen(input);
  }

  conversationToolCallsList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().conversationToolCallsList(input); }
  conversationToolResultSubmit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().conversationToolResultSubmit(input); }
  conversationSendTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationSendTurn(input);
  }

  conversationAttachmentUpload(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationAttachmentUpload(input);
  }

  conversationArtifactRead(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationArtifactRead(input);
  }

  conversationVoiceTranscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationVoiceTranscribe(input);
  }

  conversationVoiceRender(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationVoiceRender(input);
  }

  conversationInterruptTurn(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationInterruptTurn(input);
  }

  conversationSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationSubscribe(input);
  }

  conversationStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationStreamNext(input);
  }

  conversationStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationStreamClose(input);
  }

  conversationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().conversationSnapshot(input);
  }

  embodimentSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().embodimentSnapshot(input);
  }

  embodimentSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().embodimentSubscribe(input);
  }

  activityPut(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().activityPut(input);
  }

  activityList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().activityList(input);
  }

  activitySubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().activitySubscribe(input);
  }

  activityMarkRead(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().activityMarkRead(input);
  }

  activityOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().activityOpen(input);
  }

  activityOpenDeliveriesSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().activityOpenDeliveriesSubscribe(input);
  }

  activityOpenDeliveryComplete(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().activityOpenDeliveryComplete(input);
  }

  activityStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().activityStreamNext(input);
  }

  activityStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().activityStreamClose(input);
  }

  realmChatList(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().realmChatList(input); }
  realmRealtimeOpen(): Promise<NimiElectronLocalAppRecord> { return this.resolve().realmRealtimeOpen(); }
  realmRealtimeSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().realmRealtimeSubscribe(input); }
  realmRealtimeAck(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().realmRealtimeAck(input); }
  realmRealtimeSubscriptionClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().realmRealtimeSubscriptionClose(input); }
  realmRealtimeChannelClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().realmRealtimeChannelClose(input); }

  aiRealtimeOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().aiRealtimeOpen(input); }
  videoSessionOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().videoSessionOpen(input); }
  videoSessionSubmit(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().videoSessionSubmit(input); }
  videoSessionRead(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().videoSessionRead(input); }
  videoSessionClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().videoSessionClose(input); }
  aiRealtimeAppendInput(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().aiRealtimeAppendInput(input); }
  aiRealtimeSubmitOwnerControl(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().aiRealtimeSubmitOwnerControl(input); }
  aiRealtimeSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().aiRealtimeSubscribe(input); }
  aiRealtimeInterruptOutput(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().aiRealtimeInterruptOutput(input); }
  aiRealtimeClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().aiRealtimeClose(input); }
  agentRealtimeOpen(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().agentRealtimeOpen(input); }
  agentRealtimeAppendInput(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().agentRealtimeAppendInput(input); }
  agentRealtimeSubscribe(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().agentRealtimeSubscribe(input); }
  agentRealtimeStatus(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().agentRealtimeStatus(input); }
  agentRealtimeInterruptOutput(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().agentRealtimeInterruptOutput(input); }
  agentRealtimeClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().agentRealtimeClose(input); }
  realtimeStreamNext(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().realtimeStreamNext(input); }
  realtimeStreamClose(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().realtimeStreamClose(input); }

  sharedAgentAIConfigGet(): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().sharedAgentAIConfigGet();
  }

  sharedAgentAIConfigOverwrite(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().sharedAgentAIConfigOverwrite(input);
  }

  sharedAgentAIConfigLocalOptions(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().sharedAgentAIConfigLocalOptions(input);
  }

  agentManagerSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentManagerSnapshot(input);
  }

  agentAutonomySnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentAutonomySnapshot(input);
  }

  agentUpdateAutonomy(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentUpdateAutonomy(input);
  }

  agentPresentationSnapshot(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentPresentationSnapshot(input);
  }

  agentPresentationReadAsset(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentPresentationReadAsset(input);
  }

  agentCommitPresentation(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> {
    return this.resolve().agentCommitPresentation(input);
  }
  agentMemoryInspect(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().agentMemoryInspect(input); }
  agentMemoryCorrect(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().agentMemoryCorrect(input); }
  agentMemoryForget(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().agentMemoryForget(input); }
  agentMemorySwitch(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().agentMemorySwitch(input); }
  agentMemoryDelete(input: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> { return this.resolve().agentMemoryDelete(input); }

}

export function createNimiElectronLocalAppHost(
  onSessionChange: () => void = () => undefined,
): NimiElectronLocalAppHost {
  return new LazyElectronLocalAppHost(onSessionChange);
}

/**
 * Starts the request-empty native session bootstrap from Electron main.
 * The renderer still receives only the sanitized status projection, while a
 * cold renderer build cannot consume the Runtime's exact process-bind window.
 */
export async function primeNimiElectronLocalAppHost(
  host: NimiElectronLocalAppHost,
): Promise<void> {
  await host.sessionStatus();
}

/** @internal Keeps Runtime-owned technical session rotation outside renderer state. */
export function startNimiElectronLocalAppHostMaintenance(
  host: NimiElectronLocalAppHost,
  intervalMs = LOCAL_APP_SESSION_ROTATION_INTERVAL_MS,
  onFailure: (failure: NimiElectronLocalAppMaintenanceFailure) => void = () => undefined,
): { readonly ready: Promise<void>; readonly close: () => void } {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error('Electron local-app session rotation interval is invalid');
  }
  let closed = false;
  let failed = false;
  let rotating = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stopTimer = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const close = () => {
    closed = true;
    stopTimer();
    observers.delete(recover);
    if (observers.size === 0) sessionReadyObservers.delete(host);
  };
  const fail = (error: unknown) => {
    if (failed) return;
    failed = true;
    stopTimer();
    const failure = error instanceof NimiElectronLocalAppHostError
      ? { reasonCode: error.reasonCode, retryable: error.retryable }
      : { reasonCode: 'runtime-service-untrusted', retryable: false };
    console.warn('[nimi-shell] local App session maintenance paused', failure);
    try {
      onFailure(Object.freeze(failure));
    } catch {
      // Reporting failure cannot make the rejected session live again.
    }
  };
  const rotate = async () => {
    if (closed || rotating) return;
    rotating = true;
    try {
      // A session the Runtime already invalidated, for example after an
      // account change, must surface through the rebind path as a session
      // change before renewal can install a fresh session for the App.
      await host.sessionStatus();
      await host.renewTechnicalSession();
    } catch (error) {
      fail(error);
    } finally {
      rotating = false;
    }
  };
  // @nimi-authority: rule.nimi.runtime.protected-session.r016
  // A failed renewal pauses maintenance. Only a later successful Host session
  // operation resumes it; no background retry or old App work is replayed.
  const recover = () => {
    if (closed || timer !== undefined) return;
    failed = false;
    timer = setInterval(() => void rotate(), intervalMs);
    timer.unref?.();
  };
  const observers = sessionReadyObservers.get(host) ?? new Set<() => void>();
  observers.add(recover);
  sessionReadyObservers.set(host, observers);
  const ready = primeNimiElectronLocalAppHost(host).then(() => {
    recover();
  }, (error: unknown) => {
    fail(error);
    throw error;
  });
  return { ready, close };
}

/** @internal Focused contract-test seam; not re-exported from the public main entrypoint. */
export function createNimiElectronLocalAppHostForBinding(
  binding: NimiElectronProtectedLocalBinding,
  onSessionChange: () => void = () => undefined,
  activityLaunch: NimiElectronAppActivityLaunch = defaultAppActivityLaunch,
): NimiElectronLocalAppHost {
  return new ElectronLocalAppHost(validateBinding(binding), onSessionChange, () => undefined, activityLaunch);
}

/** @internal Platform-package resolver used by release and fail-closed tests. */
export function resolveNimiElectronProtectedLocalBindingPackage(platform: string, architecture: string): string {
  if (platform === 'win32' && architecture === 'x64') return WINDOWS_X64_BINDING_PACKAGE;
  if (platform === 'darwin' && architecture === 'arm64') return MACOS_ARM64_BINDING_PACKAGE;
  throw new NimiElectronLocalAppHostError('protected-carrier-required', false);
}

function loadPlatformBinding(): NimiElectronProtectedLocalBinding {
  const packageName = resolveNimiElectronProtectedLocalBindingPackage(process.platform, process.arch);
  try {
    return validateBinding(loadNimiElectronProtectedLocalPackage(packageName));
  } catch (error) {
    if (error instanceof NimiElectronLocalAppHostError) throw error;
    throw new NimiElectronLocalAppHostError('protected-carrier-required', false);
  }
}

function validateBinding(value: unknown): NimiElectronProtectedLocalBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw untrustedRuntimeError();
  const candidate = value as Record<string, unknown>;
  if (LOCAL_APP_BINDING_METHODS.some((method) => typeof candidate[method] !== 'function')) {
    throw untrustedRuntimeError();
  }
  return candidate as NimiElectronProtectedLocalBinding;
}

async function invoke(call: () => Promise<NativeLocalAppOutcome>): Promise<unknown> {
  let outcome: NativeLocalAppOutcome;
  try {
    outcome = await call();
  } catch {
    throw untrustedRuntimeError();
  }
  if (outcome?.status === 'error') {
    const reasonCode = typeof outcome.reasonCode === 'string' ? outcome.reasonCode : '';
    if (!ADMITTED_REASON_CODES.has(reasonCode) || typeof outcome.retryable !== 'boolean') {
      throw untrustedRuntimeError();
    }
    throw new NimiElectronLocalAppHostError(
      reasonCode,
      outcome.retryable,
      validateReasonMetadata(outcome.reasonMetadata),
    );
  }
  if (outcome?.status !== 'ok' || !Object.hasOwn(outcome, 'value')) throw untrustedRuntimeError();
  return outcome.value;
}

async function invokeRecord(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  return validateProjection(await invoke(call));
}

async function invokePortableAppAIConfig(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invokeRecord(call);
  rejectPortableAppAIConfigProjection(value);
  return value;
}

function rejectPortableAppAIConfigProjection(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) rejectPortableAppAIConfigProjection(entry);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
    if (FORBIDDEN_PORTABLE_APP_AI_CONFIG_KEYS.has(normalized)) {
      throw untrustedRuntimeError();
    }
    rejectPortableAppAIConfigProjection(entry);
  }
}

async function invokeTextCandidate(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['text', 'finishReason', 'traceId'])
    || typeof value.text !== 'string'
    || !value.text.trim()
    || Buffer.byteLength(value.text, 'utf8') > 256 * 1024
    || (value.finishReason !== 'stop'
      && value.finishReason !== 'length'
      && value.finishReason !== 'content-filter')) {
    throw untrustedRuntimeError();
  }
  const traceId = exactText(value.traceId);
  return Object.freeze({ text: value.text, finishReason: value.finishReason, traceId });
}

async function invokeScenarioExecute(
  call: () => Promise<NativeLocalAppOutcome>,
  decide?: NimiLocalAppTextDecideShellSpec,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['output', 'traceId']) || !isPlainRecord(value.output)) {
    throw untrustedRuntimeError();
  }
  const traceId = boundedExactText(value.traceId, 512, false);
  const output = value.output;
  if ((output.type === 'text-decide') !== Boolean(decide)) throw untrustedRuntimeError();
  if (decide) {
    // @nimi-authority: rule.nimi.runtime.ai-provider.text-decision
    let decision: unknown;
    try {
      decision = validateNimiLocalAppTextDecideOutput(output, decide);
    } catch {
      throw untrustedRuntimeError();
    }
    return Object.freeze({ output: decision as NimiElectronLocalAppJson, traceId });
  }
  if (output.type === 'text-generate') {
    if (!hasExactKeys(output, ['type', 'items', 'finishReason']) || !Array.isArray(output.items)
      || output.items.length === 0 || !['stop', 'length', 'tool-calls', 'content-filter'].includes(String(output.finishReason))) throw untrustedRuntimeError();
    const ids = new Set<string>();
    const items = output.items.map((item) => {
      if (!isPlainRecord(item)) throw untrustedRuntimeError();
      if (item.type === 'text' && hasExactKeys(item, ['type', 'text'])) {
        return Object.freeze({ type: 'text', text: boundedUtf8Content(item.text, 256 * 1024) });
      }
      if (item.type === 'reasoning-continuity' && hasExactKeys(item, ['type', 'carrier'])) {
        return Object.freeze({ type: 'reasoning-continuity', carrier: validateTextContinuity(item.carrier) });
      }
      if (item.type !== 'tool-call' || !hasExactKeys(item, ['type', 'toolCall'])) throw untrustedRuntimeError();
      const toolCall = validateTextToolCall(item.toolCall);
      if (ids.has(String(toolCall.id))) throw untrustedRuntimeError();
      ids.add(String(toolCall.id));
      return Object.freeze({ type: 'tool-call', toolCall });
    });
    if (!items.some((item) => item.type === 'text' || item.type === 'tool-call') || (output.finishReason === 'tool-calls' && ids.size === 0)) throw untrustedRuntimeError();
    return Object.freeze({ output: Object.freeze({ type: 'text-generate', items: Object.freeze(items), finishReason: String(output.finishReason) }), traceId });
  }
  if (output.type === 'text-embed') {
    if (!hasExactKeys(output, ['type', 'vectors', 'spaceId']) || !Array.isArray(output.vectors)
      || output.vectors.length === 0 || output.vectors.length > 16) throw untrustedRuntimeError();
    const spaceId = boundedExactText(output.spaceId, 128, false);
    const vectors = output.vectors.map((vector) => {
      if (!Array.isArray(vector) || vector.length === 0 || vector.length > 8192
        || vector.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
        throw untrustedRuntimeError();
      }
      return Object.freeze([...vector]);
    });
    return Object.freeze({ output: Object.freeze({ type: 'text-embed', vectors: Object.freeze(vectors), spaceId }), traceId });
  }
  if (output.type === 'image-generate') {
    if (!hasExactKeys(output, ['type', 'artifacts']) || !Array.isArray(output.artifacts)) throw untrustedRuntimeError();
    return Object.freeze({
      output: Object.freeze({ type: 'image-generate', artifacts: validateScenarioArtifacts(output.artifacts) }),
      traceId,
    });
  }
  throw untrustedRuntimeError();
}

const MAX_SCENARIO_EXECUTE_TIMEOUT_MS = 120_000;
let scenarioExecuteRequestSequence = 0;

function scenarioExecuteInput(input: NimiElectronLocalAppRecord): {
  readonly spec: NimiElectronLocalAppJson;
  readonly timeoutMs?: number;
  readonly decide?: NimiLocalAppTextDecideShellSpec;
} {
  if (!isPlainRecord(input) || !Object.hasOwn(input, 'spec')
    || Object.keys(input).some((key) => key !== 'spec' && key !== 'timeoutMs')) {
    throw new NimiElectronLocalAppHostError('invalid-payload', false);
  }
  const timeoutMs = input.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > MAX_SCENARIO_EXECUTE_TIMEOUT_MS)) {
    throw new NimiElectronLocalAppHostError('invalid-payload', false);
  }
  let decide: NimiLocalAppTextDecideShellSpec | undefined;
  if (isPlainRecord(input.spec) && input.spec.type === 'text-decide') {
    try {
      decide = validateNimiLocalAppTextDecideShellSpec(input.spec);
    } catch {
      throw new NimiElectronLocalAppHostError('invalid-payload', false);
    }
  }
  return {
    // The validated carrier form omits absent optional fields for the native parser.
    spec: (decide ?? input.spec) as NimiElectronLocalAppJson,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(decide ? { decide } : {}),
  };
}

// The native call identity is Host-generated; renderer correlations never reach it.
function createScenarioExecuteRequestId(): string {
  scenarioExecuteRequestSequence += 1;
  return `local-app-scenario-execute-${Date.now().toString(36)}-${scenarioExecuteRequestSequence}`;
}

function scenarioExecuteCanceledError(): NimiElectronLocalAppHostError {
  return new NimiElectronLocalAppHostError('canceled', false);
}

async function invokeScenarioJobSubmit(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['job'])) throw untrustedRuntimeError();
  return Object.freeze({ job: validateScenarioJob(value.job) });
}

async function invokeScenarioJobGet(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['job', 'asset', 'voiceReference', ...(Object.hasOwn(value, 'visionLocate') ? ['visionLocate'] : [])])) {
    throw untrustedRuntimeError();
  }
  const job = validateScenarioJob(value.job);
  const visionLocate = value.visionLocate === undefined ? undefined : validateVisionLocateResult(value.visionLocate);
  if ((job.scenarioType === 'vision-locate' && job.status === 'completed') !== Boolean(visionLocate) || (visionLocate && (job.artifacts as readonly unknown[]).length !== 0)) throw untrustedRuntimeError();
  const asset = value.asset === null ? null : validateVoiceAsset(value.asset);
  const voiceReference = value.voiceReference === null
    ? null
    : validateVoiceAssetReference(value.voiceReference);
  if ((asset === null) !== (voiceReference === null)
    || (asset !== null && (asset.status !== 'active' || voiceReference?.voiceAssetId !== asset.voiceAssetId))
    || ((job.scenarioType === 'voice-create' && job.status === 'completed') !== (asset !== null))) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({
    job,
    asset,
    voiceReference,
    ...(visionLocate ? { visionLocate } : {}),
  });
}

async function invokeScenarioJobEnvelope(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['job'])) throw untrustedRuntimeError();
  return Object.freeze({ job: validateScenarioJob(value.job) });
}

async function invokeArtifactRead(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['bytes', 'mimeType', 'sizeBytes'])) {
    throw untrustedRuntimeError();
  }
  const bytes = validateByteArray(value.bytes);
  const sizeBytes = boundedInteger(value.sizeBytes, 0, 32 * 1024 * 1024);
  if (sizeBytes !== bytes.length) throw untrustedRuntimeError();
  return Object.freeze({ bytes, mimeType: boundedMime(value.mimeType), sizeBytes });
}

async function invokeArtifactUpload(
  call: () => Promise<NativeLocalAppOutcome>,
  input: NimiLocalAppArtifactUploadShellInput,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  try { return validateNimiLocalAppArtifactUploadResult(value, input) as NimiElectronLocalAppRecord; }
  catch { throw untrustedRuntimeError(); }
}

async function invokeConversationAttachmentUpload(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['artifactId', 'expiresAt'])) {
    throw untrustedRuntimeError();
  }
  const expiresAt = boundedExactText(value.expiresAt, 64, false);
  if (!Number.isFinite(Date.parse(expiresAt))) throw untrustedRuntimeError();
  return Object.freeze({
    artifactId: boundedExactText(value.artifactId, 256, false),
    expiresAt,
  });
}

async function invokeConversationArtifactRead(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['artifactId', 'bytes', 'mimeType', 'byteLength'])) {
    throw untrustedRuntimeError();
  }
  const bytes = validateByteArray(value.bytes);
  const byteLength = boundedInteger(value.byteLength, 1, 32 * 1024 * 1024);
  if (bytes.length !== byteLength) throw untrustedRuntimeError();
  return Object.freeze({
    artifactId: boundedExactText(value.artifactId, 256, false),
    bytes,
    mimeType: boundedMime(value.mimeType),
    byteLength,
  });
}

async function invokeVoiceAssetsList(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['assets', 'nextPageToken'])
    || !Array.isArray(value.assets) || value.assets.length > 200
    || typeof value.nextPageToken !== 'string' || !/^[0-9]{0,10}$/u.test(value.nextPageToken)) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({
    assets: Object.freeze(value.assets.map(validateVoiceAsset)),
    nextPageToken: value.nextPageToken,
  });
}

async function invokeScenarioStreamNext(
  call: () => Promise<NativeLocalAppOutcome>,
  validateEvent: (value: unknown) => NimiElectronLocalAppRecord,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || typeof value.completed !== 'boolean') throw untrustedRuntimeError();
  if (value.completed) {
    if (!hasExactKeys(value, ['completed'])) throw untrustedRuntimeError();
    return Object.freeze({ completed: true });
  }
  if (!hasExactKeys(value, ['completed', 'event'])) throw untrustedRuntimeError();
  return Object.freeze({ completed: false, event: validateEvent(value.event) });
}

function validateScenarioJob(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    ...(Object.hasOwn(value, 'recoveryExpiresAt') ? ['recoveryExpiresAt'] : []),
    'jobId', 'scenarioType', 'status', 'progressPercent', 'progressCurrentStep',
    'progressTotalSteps', 'reasonCode', 'reasonDetail', 'artifacts', 'traceId',
    'createdAt', 'updatedAt', 'transcriptionText',
    ...(Object.hasOwn(value, 'transcription') ? ['transcription'] : []),
    ...(Object.hasOwn(value, 'textAnnotation') ? ['textAnnotation'] : []),
    ...(Object.hasOwn(value, 'audioSeparation') ? ['audioSeparation'] : []),
    ...(Object.hasOwn(value, 'musicGeneration') ? ['musicGeneration'] : []),
    ...(Object.hasOwn(value, 'musicTranscription') ? ['musicTranscription'] : []),
    ...(Object.hasOwn(value, 'voiceConversion') ? ['voiceConversion'] : []),
    ...(Object.hasOwn(value, 'interruption') ? ['interruption'] : []),
    ...(Object.hasOwn(value, 'videoFaceSwapSummary') ? ['videoFaceSwapSummary'] : []),
  ])) throw untrustedRuntimeError();
  const scenarioTypes = [
    'video-face-swap',
    'image-face-swap',
    'vision-locate',
    'image-generate',
    'video-generate',
    'speech-synthesize',
    'speech-transcribe', 'text-annotate', 'audio-separate',
    'voice-create',
    'music-generate', 'music-transcribe', 'audio-voice-convert',
    'world-generate',
  ];
  const statuses = ['submitted', 'queued', 'running', 'completed', 'failed', 'canceled', 'timeout'];
  if (!scenarioTypes.includes(String(value.scenarioType)) || !statuses.includes(String(value.status))) {
    throw untrustedRuntimeError();
  }
  const progressPercent = boundedInteger(value.progressPercent, 0, 100);
  const progressCurrentStep = boundedInteger(value.progressCurrentStep, 0, Number.MAX_SAFE_INTEGER);
  const progressTotalSteps = boundedInteger(value.progressTotalSteps, 0, Number.MAX_SAFE_INTEGER);
  if (progressCurrentStep > progressTotalSteps) throw untrustedRuntimeError();
  if ((value.videoFaceSwapSummary !== undefined) !== (value.scenarioType === 'video-face-swap' && value.status === 'completed')) throw untrustedRuntimeError();
  const videoFaceSwapSummary = value.videoFaceSwapSummary === undefined ? undefined : validateVideoFaceSwapSummary(value.videoFaceSwapSummary);
  const interruption = value.interruption;
  if ((interruption !== undefined) !== (value.reasonCode === 'ai-execution-interrupted') || (interruption !== undefined && value.status !== 'failed')) throw untrustedRuntimeError();
  if (interruption !== undefined && (!isPlainRecord(interruption) || !hasExactKeys(interruption, ['cause', 'resubmitDisposition']) || interruption.cause !== 'runtime-restart' || interruption.resubmitDisposition !== 'caller-may-resubmit')) throw untrustedRuntimeError();
  const transcription = value.transcription === undefined ? undefined : validateNimiLocalAppSpeechTranscript(value.transcription);
  if (transcription && (value.scenarioType !== 'speech-transcribe' || value.status !== 'completed' || transcription.text !== value.transcriptionText)) throw untrustedRuntimeError();
  const artifacts = validateScenarioArtifacts(value.artifacts);
  if ((value.audioSeparation !== undefined) !== (value.scenarioType === 'audio-separate' && value.status === 'completed')) throw untrustedRuntimeError();
  if ((value.textAnnotation !== undefined) !== (value.scenarioType === 'text-annotate' && value.status === 'completed')) throw untrustedRuntimeError();
  const textAnnotation = value.textAnnotation === undefined ? undefined : validateNimiLocalAppTextAnnotationResult(value.textAnnotation);
  const audioSeparation = value.audioSeparation === undefined ? undefined : validateNimiLocalAppAudioSeparation(value.audioSeparation, artifacts);
  if ((value.musicGeneration !== undefined) !== (value.scenarioType === 'music-generate' && value.status === 'completed')) throw untrustedRuntimeError();
  if ((value.musicTranscription !== undefined) !== (value.scenarioType === 'music-transcribe' && value.status === 'completed')) throw untrustedRuntimeError();
  const musicTranscription = value.musicTranscription === undefined ? undefined : validateNimiLocalAppMusicTranscription(value.musicTranscription, artifacts);
  if ((value.voiceConversion !== undefined) !== (value.scenarioType === 'audio-voice-convert' && value.status === 'completed')) throw untrustedRuntimeError();
  const voiceConversion = value.voiceConversion === undefined ? undefined : validateNimiLocalAppVoiceConversion(value.voiceConversion, artifacts);
  const musicGeneration = value.musicGeneration === undefined ? undefined : validateNimiLocalAppMusicGeneration(value.musicGeneration, artifacts);
  const recoveryExpiresAt = value.recoveryExpiresAt === undefined ? undefined : validateTimestamp(value.recoveryExpiresAt);
  if (value.recoveryExpiresAt !== undefined && (!recoveryExpiresAt || !['music-generate', 'music-transcribe', 'audio-voice-convert'].includes(String(value.scenarioType)) || !['completed', 'failed', 'canceled', 'timeout'].includes(String(value.status)))) throw untrustedRuntimeError();
  return Object.freeze({
    ...(recoveryExpiresAt ? { recoveryExpiresAt } : {}),
    ...(textAnnotation ? { textAnnotation } : {}),
    ...(audioSeparation ? { audioSeparation } : {}),
    ...(musicGeneration ? { musicGeneration } : {}),
    ...(musicTranscription ? { musicTranscription } : {}),
    ...(voiceConversion ? { voiceConversion } : {}),
    ...(transcription ? { transcription } : {}),
    ...(videoFaceSwapSummary ? { videoFaceSwapSummary } : {}),
    ...(interruption !== undefined ? { interruption: Object.freeze({ ...(interruption as Record<string, unknown>) }) } : {}),
    jobId: boundedExactText(value.jobId, 128, false),
    scenarioType: value.scenarioType,
    status: value.status,
    progressPercent,
    progressCurrentStep,
    progressTotalSteps,
    reasonCode: boundedExactText(value.reasonCode, 128, true),
    reasonDetail: boundedExactText(value.reasonDetail, 1024, true),
    artifacts,
    traceId: boundedExactText(value.traceId, 512, true),
    createdAt: validateTimestamp(value.createdAt),
    updatedAt: validateTimestamp(value.updatedAt),
    transcriptionText: boundedUtf8Content(value.transcriptionText, 1 << 20, true),
  }) as NimiElectronLocalAppRecord;
}

function validateVideoFaceSwapSummary(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['totalFrames', 'transformedFrames', 'preservedFrames', 'durationUs', 'frameRate', 'audioPreserved'])) throw untrustedRuntimeError();
  const totalFrames = boundedInteger(value.totalFrames, 1, 9000);
  const transformedFrames = boundedInteger(value.transformedFrames, 0, totalFrames);
  const preservedFrames = boundedInteger(value.preservedFrames, 0, totalFrames);
  const frameRate = boundedInteger(value.frameRate, 24, 30);
  if (transformedFrames + preservedFrames !== totalFrames || ![24, 25, 30].includes(frameRate) || typeof value.audioPreserved !== 'boolean') throw untrustedRuntimeError();
  return Object.freeze({ totalFrames, transformedFrames, preservedFrames, frameRate, durationUs: boundedInteger(value.durationUs, 1, 300000000), audioPreserved: value.audioPreserved });
}

function validateVisionLocateResult(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['imageArtifactId', 'width', 'height', 'locations']) || !Array.isArray(value.locations)) throw untrustedRuntimeError();
  const locations = value.locations.map(entry => {
    if (!isPlainRecord(entry)) throw untrustedRuntimeError();
    const axes = entry.type === 'box' ? ['x1','y1','x2','y2'] : entry.type === 'point' ? ['x','y'] : [];
    if (!axes.length || !hasExactKeys(entry, ['type', ...axes, ...(Object.hasOwn(entry, 'label') ? ['label'] : [])])) throw untrustedRuntimeError();
    for (const axis of axes) if (typeof entry[axis] !== 'number' || !Number.isFinite(entry[axis]) || (entry[axis] as number) < 0 || (entry[axis] as number) > 1) throw untrustedRuntimeError();
    if (entry.type === 'box' && !((entry.x1 as number) < (entry.x2 as number) && (entry.y1 as number) < (entry.y2 as number))) throw untrustedRuntimeError();
    if (Object.hasOwn(entry, 'label') && typeof entry.label !== 'string') throw untrustedRuntimeError();
    return Object.freeze({ ...entry });
  });
  return Object.freeze({ imageArtifactId: boundedExactText(value.imageArtifactId, 128, false), width: boundedInteger(value.width, 1, 4294967295), height: boundedInteger(value.height, 1, 4294967295), locations: Object.freeze(locations) }) as NimiElectronLocalAppRecord;
}

function validateScenarioArtifacts(value: unknown): readonly NimiElectronLocalAppRecord[] {
  if (!Array.isArray(value) || value.length > 16) throw untrustedRuntimeError();
  return Object.freeze(value.map((entry) => {
    if (!isPlainRecord(entry)) throw untrustedRuntimeError();
    const hasSeed = Object.hasOwn(entry, 'seed');
    if (!hasExactKeys(entry, [
      'artifactId', 'mimeType', 'bytes', 'sizeBytes', 'sha256', 'durationMs',
      'width', 'height', 'sampleRateHz', 'channels', ...(Object.hasOwn(entry, 'frameCount') ? ['frameCount'] : []), ...(hasSeed ? ['seed'] : []),
    ])) throw untrustedRuntimeError();
    const bytes = validateByteArray(entry.bytes);
    const sizeBytes = boundedInteger(entry.sizeBytes, 0, Number.MAX_SAFE_INTEGER);
    if (bytes.length > 0 && sizeBytes !== bytes.length) throw untrustedRuntimeError();
    const mimeType = boundedMime(entry.mimeType);
    const seed = hasSeed ? boundedInteger(entry.seed, -2_147_483_648, 2_147_483_647) : undefined;
    if (hasSeed && !mimeType.startsWith('image/')) throw untrustedRuntimeError();
    const frameCount = entry.frameCount === undefined ? undefined : boundedInteger(entry.frameCount, 1, Number.MAX_SAFE_INTEGER);
    if (frameCount !== undefined && (!mimeType.startsWith('audio/') || !(Number(entry.sampleRateHz) > 0) || !(Number(entry.channels) > 0))) throw untrustedRuntimeError();
    return Object.freeze({
      artifactId: boundedExactText(entry.artifactId, 128, false),
      mimeType,
      bytes,
      sizeBytes,
      sha256: boundedExactText(entry.sha256, 128, true),
      durationMs: boundedInteger(entry.durationMs, 0, Number.MAX_SAFE_INTEGER),
      width: boundedInteger(entry.width, 0, Number.MAX_SAFE_INTEGER),
      height: boundedInteger(entry.height, 0, Number.MAX_SAFE_INTEGER),
      sampleRateHz: boundedInteger(entry.sampleRateHz, 0, Number.MAX_SAFE_INTEGER),
      channels: boundedInteger(entry.channels, 0, Number.MAX_SAFE_INTEGER),
      ...(frameCount !== undefined ? { frameCount } : {}),
      ...(seed !== undefined ? { seed } : {}),
    }) as NimiElectronLocalAppRecord;
  }));
}

function validateVoiceAsset(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'voiceAssetId', 'creationSource', 'status', 'createdAt', 'updatedAt', 'expiresAt',
  ]) || (value.creationSource !== 'reference-audio' && value.creationSource !== 'text-description')
    || !['active', 'expired', 'deleted', 'failed'].includes(String(value.status))) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({
    voiceAssetId: boundedExactText(value.voiceAssetId, 128, false),
    creationSource: value.creationSource,
    status: value.status,
    createdAt: validateTimestamp(value.createdAt),
    updatedAt: validateTimestamp(value.updatedAt),
    expiresAt: validateTimestamp(value.expiresAt),
  }) as NimiElectronLocalAppRecord;
}

function validateVoiceAssetReference(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['kind', 'voiceAssetId'])
    || value.kind !== 'voice_asset_id') {
    throw untrustedRuntimeError();
  }
  return Object.freeze({
    kind: 'voice_asset_id',
    voiceAssetId: boundedExactText(value.voiceAssetId, 128, false),
  });
}

function validateScenarioJobEvent(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['eventType', 'sequence', 'traceId', 'timestamp', 'job'])
    || !['submitted', 'queued', 'running', 'completed', 'failed', 'canceled', 'timeout'].includes(String(value.eventType))
    || typeof value.sequence !== 'string' || !/^[1-9][0-9]*$/u.test(value.sequence)) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({
    eventType: value.eventType,
    sequence: value.sequence,
    traceId: boundedExactText(value.traceId, 512, true),
    timestamp: validateTimestamp(value.timestamp),
    job: validateScenarioJob(value.job),
  }) as NimiElectronLocalAppRecord;
}

function validateTextContinuity(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['kind', 'version', 'payload'])
    || !Array.isArray(value.payload) || value.payload.length === 0 || value.payload.length > 64 * 1024
    || value.payload.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw untrustedRuntimeError();
  return Object.freeze({ kind: boundedExactText(value.kind, 128, false), version: boundedInteger(value.version, 1, 0xffff_ffff), payload: Object.freeze([...value.payload]) });
}

function validateTextTurnEvent(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || typeof value.type !== 'string'
    || typeof value.sequence !== 'string' || !/^[1-9][0-9]*$/u.test(value.sequence)) {
    throw untrustedRuntimeError();
  }
  const traceId = boundedExactText(value.traceId, 512, false);
  if (value.type === 'delta') {
    if (!hasExactKeys(value, ['type', 'sequence', 'traceId', 'text', 'itemIndex'])) throw untrustedRuntimeError();
    return Object.freeze({ type: 'delta', sequence: value.sequence, traceId,
      text: boundedUtf8Content(value.text, 64 * 1024), itemIndex: boundedInteger(value.itemIndex, 0, 4_294_967_295) });
  }
  if (value.type === 'tool-call') {
    if (!hasExactKeys(value, ['type', 'sequence', 'traceId', 'itemIndex', 'toolCall'])) throw untrustedRuntimeError();
    return Object.freeze({ type: 'tool-call', sequence: value.sequence, traceId,
      itemIndex: boundedInteger(value.itemIndex, 0, 4_294_967_295), toolCall: validateTextToolCall(value.toolCall) });
  }
  if (value.type === 'reasoning-continuity') {
    if (!hasExactKeys(value, ['type', 'sequence', 'traceId', 'itemIndex', 'carrier'])) throw untrustedRuntimeError();
    return Object.freeze({ type: 'reasoning-continuity', sequence: value.sequence, traceId,
      itemIndex: boundedInteger(value.itemIndex, 0, 4_294_967_295), carrier: validateTextContinuity(value.carrier) });
  }
  if (value.type === 'completed') {
    if (!hasExactKeys(value, ['type', 'sequence', 'traceId', 'finishReason'])
      || !['stop', 'length', 'tool-calls', 'content-filter'].includes(String(value.finishReason))) throw untrustedRuntimeError();
    return Object.freeze({ type: 'completed', sequence: value.sequence, traceId, finishReason: String(value.finishReason) });
  }
  if (value.type === 'failed') {
    if (!hasExactKeys(value, ['type', 'sequence', 'traceId', 'reasonCode', 'actionHint', ...(Object.hasOwn(value, 'interruption') ? ['interruption'] : [])])) throw untrustedRuntimeError();
    const interruption = value.interruption == null ? undefined : value.interruption;
    if ((interruption !== undefined) !== (value.reasonCode === 'ai-execution-interrupted')) throw untrustedRuntimeError();
    if (interruption !== undefined && (!isPlainRecord(interruption) || !hasExactKeys(interruption, ['cause', 'resubmitDisposition'])
      || interruption.cause !== 'runtime-restart' || interruption.resubmitDisposition !== 'caller-may-resubmit')) throw untrustedRuntimeError();
    return Object.freeze({ type: 'failed', sequence: value.sequence, traceId,
      reasonCode: boundedExactText(value.reasonCode, 128, false),
      actionHint: boundedExactText(value.actionHint, 512, true), ...(interruption ? { interruption: interruption as NimiElectronLocalAppRecord } : {}) });
  }
  throw untrustedRuntimeError();
}

function validateTextToolCall(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['id', 'name', 'arguments']) || !isPlainRecord(value.arguments)) throw untrustedRuntimeError();
  validateJsonValue(value.arguments);
  return Object.freeze({ id: boundedExactText(value.id, 128, false), name: boundedExactText(value.name, 128, false), arguments: value.arguments });
}

function validateTimestamp(value: unknown): NimiElectronLocalAppRecord | null {
  if (value === null) return null;
  if (!isPlainRecord(value) || !hasExactKeys(value, ['seconds', 'nanos'])
    || typeof value.seconds !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/u.test(value.seconds)) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ seconds: value.seconds, nanos: boundedInteger(value.nanos, 0, 999_999_999) });
}

function validateByteArray(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length > 32 * 1024 * 1024
    || value.some((entry) => !Number.isInteger(entry) || Number(entry) < 0 || Number(entry) > 255)) {
    throw untrustedRuntimeError();
  }
  return Object.freeze([...value] as number[]);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw untrustedRuntimeError();
  }
  return value;
}

function boundedExactText(value: unknown, maximumBytes: number, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!allowEmpty && !value) || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > maximumBytes || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw untrustedRuntimeError();
  }
  return value;
}

function boundedUtf8Content(value: unknown, maximumBytes: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value) || Buffer.byteLength(value, 'utf8') > maximumBytes || value.includes('\0')) {
    throw untrustedRuntimeError();
  }
  return value;
}

function boundedMime(value: unknown): string {
  const mime = boundedExactText(value, 128, false);
  if (!mime.includes('/')) throw untrustedRuntimeError();
  return mime;
}

function boundedImageMime(value: unknown): string {
  const mime = boundedMime(value);
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) {
    throw untrustedRuntimeError();
  }
  return mime;
}

async function invokeWorldCoreList(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<readonly NimiElectronLocalAppRecord[]> {
  const value = await invoke(call);
  if (!Array.isArray(value)) throw untrustedRuntimeError();
  return Object.freeze(value.map(worldCreatorRecord));
}

async function invokeAgentReferenceList(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<readonly NimiElectronLocalAppRecord[]> {
  const value = await invoke(call);
  if (!Array.isArray(value)) throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
  return Object.freeze(value.map((entry) => {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ['agentHandle', 'agentBinding', 'displayName', 'avatarUrl'])) {
      throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
    }
    validateProjectionValue(entry);
    if (typeof entry.agentBinding !== 'string' || !/^agent_binding_[A-Za-z0-9_-]{43}$/u.test(entry.agentBinding)
      || typeof entry.agentHandle !== 'string'
      || !/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(entry.agentHandle)
      || typeof entry.displayName !== 'string'
      || !entry.displayName
      || entry.displayName.trim() !== entry.displayName
      || Buffer.byteLength(entry.displayName, 'utf8') > 256
      || (entry.avatarUrl !== null && !safeAgentAvatarUrl(entry.avatarUrl))) {
      throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
    }
    return Object.freeze({
      agentHandle: entry.agentHandle,
      agentBinding: entry.agentBinding,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl as string | null,
    }) as NimiElectronLocalAppRecord;
  }));
}

async function invokeAvatarHostTargetResolve(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['avatarHostTargetRef']) ||
    typeof value.avatarHostTargetRef !== 'string' ||
    !/^avatar_target_[A-Za-z0-9_-]{43}$/u.test(value.avatarHostTargetRef)) {
    throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
  }
  return Object.freeze({ avatarHostTargetRef: value.avatarHostTargetRef });
}

async function invokeWorldCore(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  return worldCreatorRecord(await invoke(call));
}

async function invokePersonaCharacterList(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<readonly NimiElectronLocalAppRecord[]> {
  const value = await invoke(call);
  if (!Array.isArray(value) || value.length > 500) throw untrustedRuntimeError();
  return Object.freeze(value.map(validatePersonaCharacter));
}

async function invokePersonaCharacter(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  return validatePersonaCharacter(await invoke(call));
}

async function invokePersonaCharacterDelete(
  call: () => Promise<NativeLocalAppOutcome>,
  expectedPersonaCharacterId: string,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['personaCharacterId', 'deleted'])
    || value.personaCharacterId !== expectedPersonaCharacterId
    || value.deleted !== true) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ personaCharacterId: expectedPersonaCharacterId, deleted: true });
}

function validatePersonaCharacter(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  validateJsonValue(value);
  return Object.freeze({ ...value }) as NimiElectronLocalAppRecord;
}

function validatePersonaCharacterWriteInput(value: unknown, replace: boolean): void {
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  const keys = replace
    ? ['personaCharacterId', 'baseContentHash', 'worldId', 'visibility', 'origin', 'lorebookDeclaration', 'profile']
    : ['worldId', 'visibility', 'origin', 'lorebookDeclaration', 'profile'];
  if (!hasExactKeys(value, keys)) throw untrustedRuntimeError();
  exactText(value.worldId);
  if (!isPersonaWritableVisibility(value.visibility) || !isPlainRecord(value.origin) ||
    !isPlainRecord(value.lorebookDeclaration) || !isPlainRecord(value.profile)) {
    throw untrustedRuntimeError();
  }
  if (Object.hasOwn(value.profile, 'profileHash') || Object.hasOwn(value.profile, 'profileCoverage')) {
    throw untrustedRuntimeError();
  }
  if (replace && (typeof value.baseContentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.baseContentHash))) {
    throw untrustedRuntimeError();
  }
  if (replace) exactText(value.personaCharacterId);
  validateJsonValue(value);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PERSONA_REQUEST_BYTES) {
    throw new NimiElectronLocalAppHostError('request-too-large', false);
  }
}

function validatePersonaCharacterListInput(value: NimiElectronLocalAppRecord): void {
  if (Object.keys(value).some((key) => !['worldId', 'visibility', 'afterId', 'take'].includes(key))) {
    throw untrustedRuntimeError();
  }
  if (value.worldId !== undefined) exactText(value.worldId);
  if (value.afterId !== undefined) exactText(value.afterId);
  if (value.visibility !== undefined && !isPersonaWritableVisibility(value.visibility)) throw untrustedRuntimeError();
  if (value.take !== undefined && (typeof value.take !== 'number' || !Number.isSafeInteger(value.take) || value.take < 1 || value.take > 500)) {
    throw untrustedRuntimeError();
  }
}

function isPersonaWritableVisibility(value: unknown): value is 'private' | 'unlisted' | 'public' {
  return value === 'private' || value === 'unlisted' || value === 'public';
}

async function invokeStorageDocument(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['sizeBytes', 'value'])) {
    throw untrustedRuntimeError();
  }
  const sizeBytes = Number(value.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > 256 * 1024) {
    throw untrustedRuntimeError();
  }
  validateJsonValue(value.value);
  return Object.freeze({ value: value.value as NimiElectronLocalAppJson, sizeBytes });
}

async function invokeStorageRemove(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(['removed']) || typeof value.removed !== 'boolean') {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ removed: value.removed });
}

async function invokeAssetRecord(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  return validateAssetRecord(await invoke(call));
}

async function invokeAssetList(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['assets', 'nextCursor'])
    || !Array.isArray(value.assets) || value.assets.length > 500
    || typeof value.nextCursor !== 'string' || value.nextCursor.length > 4096) throw untrustedRuntimeError();
  const assets = Object.freeze(value.assets.map(validateAssetRecord));
  for (let index = 1; index < assets.length; index += 1) {
    if (String(assets[index - 1]!.relativePath) >= String(assets[index]!.relativePath)) throw untrustedRuntimeError();
  }
  return Object.freeze({ assets, nextCursor: value.nextCursor }) as NimiElectronLocalAppRecord;
}

async function invokeAssetReadOpen(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['streamId', 'asset', 'range']) || !isPlainRecord(value.range)) {
    throw untrustedRuntimeError();
  }
  const asset = validateAssetRecord(value.asset);
  if (!hasExactKeys(value.range, ['offset', 'length', 'totalSize'])) throw untrustedRuntimeError();
  const offset = boundedInteger(value.range.offset, 0, Number.MAX_SAFE_INTEGER);
  const length = boundedInteger(value.range.length, 0, Number.MAX_SAFE_INTEGER);
  const totalSize = boundedInteger(value.range.totalSize, 0, Number.MAX_SAFE_INTEGER);
  if (totalSize !== asset.sizeBytes || offset > totalSize || length > totalSize - offset) throw untrustedRuntimeError();
  return Object.freeze({ streamId: exactText(value.streamId), asset, range: Object.freeze({ offset, length, totalSize }) }) as NimiElectronLocalAppRecord;
}

async function invokeAssetReadNext(call: () => Promise<NativeLocalAppBytesOutcome>): Promise<NimiElectronLocalAppAssetReadNext> {
  let outcome: NativeLocalAppBytesOutcome;
  try { outcome = await call(); } catch { throw untrustedRuntimeError(); }
  if (outcome.status === 'error') {
    const reasonCode = typeof outcome.reasonCode === 'string' ? outcome.reasonCode : '';
    if (!ADMITTED_REASON_CODES.has(reasonCode) || typeof outcome.retryable !== 'boolean') throw untrustedRuntimeError();
    throw new NimiElectronLocalAppHostError(reasonCode, outcome.retryable, validateReasonMetadata(outcome.reasonMetadata));
  }
  if (outcome.status !== 'ok' || typeof outcome.completed !== 'boolean') throw untrustedRuntimeError();
  if (outcome.completed) {
    if (outcome.value !== null && outcome.value !== undefined) throw untrustedRuntimeError();
    return Object.freeze({ completed: true });
  }
  if (!(outcome.value instanceof Uint8Array) || outcome.value.byteLength === 0 || outcome.value.byteLength > 1024 * 1024) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ completed: false, bodyChunk: new Uint8Array(outcome.value) });
}

async function invokeExactBooleanRecord(
  call: () => Promise<NativeLocalAppOutcome>,
  key: string,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, [key]) || typeof value[key] !== 'boolean') throw untrustedRuntimeError();
  return Object.freeze({ [key]: value[key] }) as NimiElectronLocalAppRecord;
}

function validateAssetRecord(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'relativePath', 'mediaType', 'sizeBytes', 'sha256', 'createdAt', 'updatedAt',
  ])) throw untrustedRuntimeError();
  const relativePath = boundedExactText(value.relativePath, 240, false);
  if (relativePath.startsWith('/') || relativePath.endsWith('/') || relativePath.includes('\\')
    || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')) throw untrustedRuntimeError();
  const mediaType = value.mediaType === null ? null : boundedMime(value.mediaType);
  const sizeBytes = boundedInteger(value.sizeBytes, 0, Number.MAX_SAFE_INTEGER);
  if (typeof value.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.sha256)) throw untrustedRuntimeError();
  const createdAt = boundedExactText(value.createdAt, 64, false);
  const updatedAt = boundedExactText(value.updatedAt, 64, false);
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) throw untrustedRuntimeError();
  return Object.freeze({ relativePath, mediaType, sizeBytes, sha256: value.sha256, createdAt, updatedAt });
}

async function invokeConversationOpen(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['conversationAnchorId', 'activeTurnId'])) {
    throw untrustedRuntimeError();
  }
  const conversationAnchorId = exactText(value.conversationAnchorId);
  const activeTurnId = optionalExactText(value.activeTurnId);
  return Object.freeze({ conversationAnchorId, activeTurnId });
}

async function invokeExactTextRecord(
  call: () => Promise<NativeLocalAppOutcome>,
  keys: readonly string[],
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) throw untrustedRuntimeError();
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, exactText(value[key])]))) as NimiElectronLocalAppRecord;
}

async function invokeConversationStreamNext(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || typeof value.completed !== 'boolean') throw untrustedRuntimeError();
  if (value.completed) {
    if (!hasExactKeys(value, ['completed'])) throw untrustedRuntimeError();
    return Object.freeze({ completed: true });
  }
  if (!hasExactKeys(value, ['completed', 'event']) || !isPlainRecord(value.event)) throw untrustedRuntimeError();
  const event = validateConversationEvent(value.event);
  return Object.freeze({ completed: false, event });
}

// @nimi-authority: rule.nimi.sdks.realm-consumer.r048
async function invokeRealtimeStreamNext(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || typeof value.completed !== 'boolean') throw untrustedRuntimeError();
  if (value.completed) {
    if (!hasExactKeys(value, ['completed'])) throw untrustedRuntimeError();
    return Object.freeze({ completed: true });
  }
  if (!hasExactKeys(value, ['completed', 'event']) || !isPlainRecord(value.event)) {
    throw untrustedRuntimeError();
  }
  const isRuntimeEnvelope = hasExactKeys(value.event, ['control', 'event']);
  const isRealmEnvelope = hasExactKeys(value.event, [
    'realtimeSessionId', 'channelId', 'subscriptionId', 'generation', 'sequence',
    'correlationId', 'occurredAt', 'event',
  ]);
  if (!isRuntimeEnvelope && !isRealmEnvelope) throw untrustedRuntimeError();
  return Object.freeze({ completed: false, event: validateProjection(value.event) });
}

// Renderer-visible App activity pull streams carry exactly change and
// open-delivery events; publisher data stays opaque text inside a record.
const ACTIVITY_RENDERER_EVENT_SHAPES: readonly (readonly string[])[] = [
  ['changeSeq', 'kind', 'activityId', 'record'],
  ['changeSeq', 'kind', 'activityId'],
  ['deliveryId', 'activityId', 'objectRef', 'type'],
];
// The Host-private open stream carries the open request id and the result.
const ACTIVITY_OPEN_EVENT_SHAPES: readonly (readonly string[])[] = [['openRequestId'], ['result']];

async function invokeActivityStreamNext(
  call: () => Promise<NativeLocalAppOutcome>,
  shapes: readonly (readonly string[])[] = ACTIVITY_RENDERER_EVENT_SHAPES,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || typeof value.completed !== 'boolean') throw untrustedRuntimeError();
  if (value.completed) {
    if (!hasExactKeys(value, ['completed'])) throw untrustedRuntimeError();
    return Object.freeze({ completed: true });
  }
  if (!hasExactKeys(value, ['completed', 'event']) || !isPlainRecord(value.event)) throw untrustedRuntimeError();
  const event = value.event;
  if (!shapes.some((shape) => hasExactKeys(event, [...shape]))) throw untrustedRuntimeError();
  return Object.freeze({ completed: false, event: validateProjection(event) });
}

async function invokeConversationStreamClose(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['closed']) || typeof value.closed !== 'boolean') {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ closed: value.closed });
}

function validateConversationEvent(value: Record<string, unknown>): NimiElectronLocalAppRecord {
  if (typeof value.sequence !== 'string'
    || !/^[1-9][0-9]*$/u.test(value.sequence)
    || typeof value.type !== 'string') {
    throw untrustedRuntimeError();
  }
  exactText(value.conversationAnchorId);
  exactText(value.turnId);
  const common = ['type', 'conversationAnchorId', 'sequence', 'turnId'];
  switch (value.type) {
    case 'turn-accepted':
    case 'turn-started':
      if (!hasExactKeys(value, common)) throw untrustedRuntimeError();
      break;
    case 'text-delta':
      if (!hasExactKeys(value, [...common, 'delta'])) throw untrustedRuntimeError();
      boundedUtf8Content(value.delta, 16 * 1024);
      break;
    case 'reasoning-status':
      if (!hasExactKeys(value, [...common, 'state'])
        || !['started', 'active', 'completed'].includes(String(value.state))) throw untrustedRuntimeError();
      break;
    case 'live-action':
      if (!hasExactKeys(value, [...common, 'action'])) throw untrustedRuntimeError();
      validateConversationLiveChild(value.action, 'actionId');
      break;
    case 'live-tool':
      if (!hasExactKeys(value, [...common, 'tool'])) throw untrustedRuntimeError();
      validateConversationLiveChild(value.tool, 'toolId');
      break;
    case 'message-committed':
      if (!hasExactKeys(value, [...common, 'message'])) throw untrustedRuntimeError();
      validateConversationMessage(value.message);
      break;
    case 'action-planned':
    case 'action-started':
    case 'action-completed':
    case 'action-failed':
      if (!hasExactKeys(value, [...common, 'action'])) throw untrustedRuntimeError();
      validateConversationAction(value.action);
      break;
    case 'artifact-ready':
      if (!hasExactKeys(value, [...common, 'actionId', 'capabilityContract', 'projectionMessageId', 'artifactId'])
        || value.capabilityContract !== 'image.generate') throw untrustedRuntimeError();
      exactText(value.actionId);
      exactText(value.projectionMessageId);
      exactText(value.artifactId);
      break;
    case 'voice-ready':
    case 'voice-failed':
      if (!hasExactKeys(value, [...common, 'voice'])) throw untrustedRuntimeError();
      validateConversationVoice(value.voice);
      break;
    case 'turn-completed':
      if (!hasExactKeys(value, [...common, 'terminalReason'])
        || typeof value.terminalReason !== 'string'
        || !['', 'stop', 'length', 'tool_call', 'content_filter', 'error', 'unspecified'].includes(value.terminalReason)) {
        throw untrustedRuntimeError();
      }
      break;
    case 'turn-failed':
      if (!hasExactKeys(value, [...common, 'reasonCode', 'message'])
        || typeof value.reasonCode !== 'string'
        || !/^[A-Z0-9_-]{1,128}$/u.test(value.reasonCode)
        || (value.message !== null && typeof value.message !== 'string')) {
        throw untrustedRuntimeError();
      }
      if (typeof value.message === 'string') exactText(value.message);
      break;
    case 'turn-interrupted':
      if (!hasExactKeys(value, [...common, 'reason'])
        || typeof value.reason !== 'string'
        || !['user_cancel', 'room_closed', 'superseded_turn', 'budget_exhausted', 'timeout', 'gateway_revoked', 'policy_refusal'].includes(value.reason)) {
        throw untrustedRuntimeError();
      }
      break;
    default:
      throw untrustedRuntimeError();
  }
  return Object.freeze({ ...value }) as NimiElectronLocalAppRecord;
}

function validateConversationLiveChild(value: unknown, idField: 'actionId' | 'toolId'): void {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['turnId', idField, 'name', 'lifecycle', 'progress', 'result', 'reasonCode'])) {
    throw untrustedRuntimeError();
  }
  exactText(value.turnId);
  exactText(value[idField]);
  boundedExactText(value.name, 256, false);
  const lifecycle = value.lifecycle;
  if (!['started', 'updated', 'completed', 'failed'].includes(String(lifecycle))
    || (value.progress !== null && typeof value.progress !== 'string')
    || (value.result !== null && typeof value.result !== 'string')
    || (value.reasonCode !== null && (typeof value.reasonCode !== 'string' || !/^[A-Z0-9_-]{1,128}$/u.test(value.reasonCode)))) {
    throw untrustedRuntimeError();
  }
  if (typeof value.progress === 'string') boundedUtf8Content(value.progress, 16 * 1024);
  if (typeof value.result === 'string') boundedUtf8Content(value.result, 16 * 1024);
  const valid = lifecycle === 'started'
    ? value.progress === null && value.result === null && value.reasonCode === null
    : lifecycle === 'updated'
      ? ((value.progress === null) !== (value.result === null)) && value.reasonCode === null
      : lifecycle === 'completed'
        ? value.progress === null && value.reasonCode === null
        : value.result === null && value.reasonCode !== null;
  if (!valid) throw untrustedRuntimeError();
}

async function invokeConversationSnapshot(
  call: () => Promise<NativeLocalAppOutcome>,
): Promise<NimiElectronLocalAppRecord> {
  const value = await invoke(call);
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['conversationAnchorId', 'throughSequence', 'turns', 'messages', 'actions', 'voices', 'truncatedBefore'])
    || typeof value.throughSequence !== 'string'
    || !/^(0|[1-9][0-9]*)$/u.test(value.throughSequence)
    || !Array.isArray(value.turns)
    || value.turns.length > 201
    || !Array.isArray(value.messages)
    || value.messages.length > 203
    || !Array.isArray(value.actions)
    || value.actions.length > 201
    || !Array.isArray(value.voices)
    || value.voices.length > 201
    || typeof value.truncatedBefore !== 'boolean') {
    throw untrustedRuntimeError();
  }
  const conversationAnchorId = exactText(value.conversationAnchorId);
  const turns = value.turns.map(validateConversationTurn);
  const messages = value.messages.map(validateConversationMessage);
  const actions = value.actions.map(validateConversationAction);
  const voices = value.voices.map(validateConversationVoice);
  return Object.freeze({
    conversationAnchorId,
    throughSequence: value.throughSequence,
    turns: Object.freeze(turns),
    messages: Object.freeze(messages),
    actions: Object.freeze(actions),
    voices: Object.freeze(voices),
    truncatedBefore: value.truncatedBefore,
  });
}

function validateConversationMessage(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['messageId', 'turnId', 'role', 'parts'])
    || (value.role !== 'user' && value.role !== 'assistant' && value.role !== 'app')
    || !Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > 2) {
    throw untrustedRuntimeError();
  }
  const messageId = exactText(value.messageId);
  const turnId = exactText(value.turnId);
  let textCount = 0;
  let artifactCount = 0;
  const parts = value.parts.map((part) => {
    if (!isPlainRecord(part) || typeof part.kind !== 'string') throw untrustedRuntimeError();
    if (part.kind === 'text') {
      if (!hasExactKeys(part, ['kind', 'text'])) throw untrustedRuntimeError();
      textCount++;
      return Object.freeze({ kind: 'text', text: boundedUtf8Content(part.text, 64 * 1024) });
    }
    if (part.kind === 'artifact-ref') {
      if (!hasExactKeys(part, ['kind', 'artifactId', 'mediaKind', 'mimeType', 'displayName'])
        || part.mediaKind !== 'image'
        || typeof part.mimeType !== 'string'
        || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.mimeType)
        || (part.displayName !== null && typeof part.displayName !== 'string')) throw untrustedRuntimeError();
      artifactCount++;
      return Object.freeze({
        kind: 'artifact-ref',
        artifactId: exactText(part.artifactId),
        mediaKind: 'image',
        mimeType: part.mimeType,
        displayName: part.displayName === null ? null : exactText(part.displayName),
      });
    }
    throw untrustedRuntimeError();
  });
  if (textCount > 1 || artifactCount > 1 || (value.role === 'assistant' && textCount === 1 && artifactCount === 1)) {
    throw untrustedRuntimeError();
  }
  return Object.freeze({ messageId, turnId, role: value.role, parts: Object.freeze(parts) });
}

function validateConversationTurn(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['turnId', 'status', 'phase', 'terminalReason', 'reasonCode', 'message'])
    || !['active', 'completed', 'failed', 'interrupted'].includes(String(value.status))
    || (value.phase !== null && value.phase !== 'accepted' && value.phase !== 'started')
    || (value.terminalReason !== null && typeof value.terminalReason !== 'string')
    || (value.reasonCode !== null && (typeof value.reasonCode !== 'string' || !/^[A-Z0-9_-]{1,128}$/u.test(value.reasonCode)))
    || (value.message !== null && typeof value.message !== 'string')
    || ((value.status === 'active') !== (value.phase === 'accepted' || value.phase === 'started'))) throw untrustedRuntimeError();
  return Object.freeze({ ...value, turnId: exactText(value.turnId) }) as NimiElectronLocalAppRecord;
}

function validateConversationAction(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['actionId', 'turnId', 'capabilityContract', 'status', 'projectionMessageId', 'artifactId', 'reasonCode', 'message'])
    || value.capabilityContract !== 'image.generate'
    || !['planned', 'started', 'completed', 'failed'].includes(String(value.status))
    || (value.projectionMessageId !== null && typeof value.projectionMessageId !== 'string')
    || (value.artifactId !== null && typeof value.artifactId !== 'string')
    || (value.reasonCode !== null && (typeof value.reasonCode !== 'string' || !/^[A-Z0-9_-]{1,128}$/u.test(value.reasonCode)))
    || (value.message !== null && typeof value.message !== 'string')
    || ((value.status === 'completed') !== (value.projectionMessageId !== null && value.artifactId !== null))
    || ((value.status === 'failed') !== (value.reasonCode !== null))
    || (value.status !== 'failed' && value.message !== null)) throw untrustedRuntimeError();
  return Object.freeze({
    ...value,
    actionId: exactText(value.actionId),
    turnId: exactText(value.turnId),
    projectionMessageId: optionalExactText(value.projectionMessageId),
    artifactId: optionalExactText(value.artifactId),
  }) as NimiElectronLocalAppRecord;
}

function validateConversationVoice(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['voiceId', 'turnId', 'messageId', 'state', 'artifactId', 'reasonCode', 'message'])
    || (value.state !== 'ready' && value.state !== 'failed')
    || (value.artifactId !== null && typeof value.artifactId !== 'string')
    || (value.reasonCode !== null && (typeof value.reasonCode !== 'string' || !/^[A-Z0-9_-]{1,128}$/u.test(value.reasonCode)))
    || (value.message !== null && typeof value.message !== 'string')
    || ((value.state === 'ready') !== (value.artifactId !== null))
    || ((value.state === 'failed') !== (value.reasonCode !== null))) throw untrustedRuntimeError();
  return Object.freeze({
    ...value,
    voiceId: exactText(value.voiceId),
    turnId: exactText(value.turnId),
    messageId: exactText(value.messageId),
    artifactId: optionalExactText(value.artifactId),
  }) as NimiElectronLocalAppRecord;
}

function validateReasonMetadata(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!isPlainRecord(value) || Object.keys(value).length > ADMITTED_REASON_METADATA_KEYS.size) {
    throw untrustedRuntimeError();
  }
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!ADMITTED_REASON_METADATA_KEYS.has(key)
      || typeof entry !== 'string'
      || entry.length === 0
      || entry.length > 2048
      || entry.trim() !== entry
      || /[\u0000-\u001f\u007f]/u.test(entry)) {
      throw untrustedRuntimeError();
    }
    metadata[key] = entry;
  }
  return Object.freeze(metadata);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function safeAgentAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.search === ''
      && parsed.hash === ''
      && (parsed.port === '' || parsed.port === '443')
      && parsed.hostname !== 'localhost'
      && !parsed.hostname.endsWith('.localhost')
      && !parsed.hostname.endsWith('.local')
      && !parsed.hostname.endsWith('.internal')
      && !/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(parsed.hostname)
      && !parsed.hostname.includes(':');
  } catch {
    return false;
  }
}

function exactText(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 512) throw untrustedRuntimeError();
  return value;
}

function optionalExactText(value: unknown): string | null {
  if (value === null) return null;
  return exactText(value);
}

function validateJsonValue(value: unknown, depth = 0, budget = { nodes: 0 }): asserts value is NimiElectronLocalAppJson {
  budget.nodes += 1;
  if (depth > 32 || budget.nodes > 100_000) throw untrustedRuntimeError();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateJsonValue(entry, depth + 1, budget);
    return;
  }
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  for (const entry of Object.values(value)) validateJsonValue(entry, depth + 1, budget);
}

function validateProjection(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  validateProjectionValue(value);
  return Object.freeze({ ...value }) as NimiElectronLocalAppRecord;
}

function validateProjectionValue(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateProjectionValue(entry);
    return;
  }
  if (!isPlainRecord(value)) throw untrustedRuntimeError();
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PROJECTION_KEYS.has(key)) throw untrustedRuntimeError();
    validateProjectionValue(entry);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function untrustedRuntimeError(): NimiElectronLocalAppHostError {
  return new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
}

async function invokeWorldCreatorRecord(call: () => Promise<NativeLocalAppOutcome>): Promise<NimiElectronLocalAppRecord> {
  return worldCreatorRecord(await invoke(call));
}
async function invokeWorldCreatorList(call: () => Promise<NativeLocalAppOutcome>): Promise<readonly NimiElectronLocalAppRecord[]> {
  const value = await invoke(call);
  if (!Array.isArray(value) || value.length > 500) throw untrustedRuntimeError();
  return Object.freeze(value.map(worldCreatorRecord));
}
function worldCreatorRecord(value: unknown): NimiElectronLocalAppRecord {
  if (!isPlainRecord(value) || typeof value.id !== 'string' || !value.id) throw untrustedRuntimeError();
  validateJsonValue(value);
  const { core, profile, ...frame } = value;
  const frameKeys = ['id', 'schemaVersion', 'contentRevision', 'contentHash', 'origin', 'createdAt', 'updatedAt',
    'creatorId', 'worldId', 'visibility', 'lorebookDeclaration', 'worldEntityRef', 'validity', 'materializationReadiness', 'sourceHash',
    'kind', 'sourceEntityId', 'targetEntityId', 'type'];
  if (Object.keys(frame).some(key => !frameKeys.includes(key))) throw untrustedRuntimeError();
  validateProjectionValue(frame);
  const source = profile ?? core;
  if (isPlainRecord(source) && isPlainRecord(source.assets) && source.assets.externalRefs !== undefined) {
    validateProjectionValue(source.assets.externalRefs);
  }
  return Object.freeze({ ...value }) as NimiElectronLocalAppRecord;
}
