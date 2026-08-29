import { createNimiError } from '../../types';
import {
  validateNimiAppInventoryEntry,
  validateNimiAppStatus,
} from './inventory-types.js';
import type { NimiAppScopeRef } from './app-scope.js';
import type {
  NimiAppInventoryEntry,
  NimiAppStatus,
  NimiAppTransport,
} from './inventory-types.js';

export {
  NIMI_DESKTOP_OPEN_RESULT_REASON_CODES,
  NIMI_DESKTOP_OPEN_SCHEMA_VERSION,
  NIMI_DESKTOP_OPEN_SOURCE_HOSTS,
  NimiDesktopOpenIntentParseError,
  composeNimiDesktopOpenIntentEnvelope,
  createNimiDesktopOpenRequestId,
  isNimiDesktopOpenResultReasonCode,
  isNimiDesktopOpenSourceHost,
  parseNimiDesktopOpenIntent,
  parseNimiDesktopOpenIntentEnvelope,
  parseNimiDesktopOpenRendererRequest,
  parseNimiDesktopOpenResult,
  safeParseNimiDesktopOpenIntentEnvelope,
} from './desktop-open.js';
export type {
  ComposeNimiDesktopOpenIntentEnvelopeInput,
  NimiDesktopOpenAcceptedResult,
  NimiDesktopOpenAppsIntent,
  NimiDesktopOpenAppsSection,
  NimiDesktopOpenExploreIntent,
  NimiDesktopOpenExploreProductIntent,
  NimiDesktopOpenExploreSection,
  NimiDesktopOpenIntent,
  NimiDesktopOpenIntentEnvelope,
  NimiDesktopOpenIntentKind,
  NimiDesktopOpenIntentParseResult,
  NimiDesktopOpenParseReasonCode,
  NimiDesktopOpenRejectedResult,
  NimiDesktopOpenRejectedActionHint,
  NimiDesktopOpenRendererRequest,
  NimiDesktopOpenResult,
  NimiDesktopOpenResultReasonCode,
  NimiDesktopOpenRuntimeConfigAction,
  NimiDesktopOpenRuntimeConfigIntent,
  NimiDesktopOpenRuntimeConfigPage,
  NimiDesktopOpenSettingsIntent,
  NimiDesktopOpenSettingsSection,
  NimiDesktopOpenSourceHost,
} from './desktop-open.js';
export {
  createRuntimeAccountMediatedDesktopProductRealmTransport,
  createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport,
  createRuntimeAccountMediatedRealmTransport,
  NIMI_DESKTOP_PRODUCT_REALM_OPERATION_IDS,
  NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_IDS,
  type NimiDesktopProductRealmOperationID,
  type NimiDesktopSourceReadinessRealmOperationID,
  type RuntimeAccountMediatedRealmRuntime,
} from './runtime-account-realm.js';
export {
  createNimiLocalAppClient,
  createNimiLocalAppAIConsumptionRuntimeClient,
  createNimiLocalAppRuntimeScenarioJobClient,
  createNimiLocalAppVoiceAssetsRuntimeClient,
  createNimiLocalAppConversationRuntimeClient,
  createNimiLocalAppAgentReferencesRuntimeClient,
  createNimiLocalAppEmbodimentClient,
  createNimiLocalAppEmbodimentRuntimeClient,
  createNimiLocalAppAgentConfigureRuntimeShell,
  createNimiAiRealtimeRuntimeClient,
  createNimiAgentRealtimeRuntimeClient,
  createNimiRealmChatRuntimeClient,
  createNimiRealmRealtimeRuntimeClient,
  projectNimiLocalAppPersonaCharacter,
  projectNimiLocalAppPersonaCharacterDeleteResult,
  projectNimiLocalAppPersonaCharacterList,
  toNimiLocalAppPersonaCharacterProfileInput,
  validateNimiLocalAppPersonaCharacterWriteInput,
} from './local-app-runtime-platform.js';
export {
  isNimiLocalAppAgentSelectorMismatchError,
} from './local-app-agent-selector-error.js';
export {
  createNimiLocalAppAgentConfigureClient,
} from './local-app-runtime-platform-configure.js';
export type {
  NimiAppAuthMode,
  NimiAppAuthProjection,
  NimiAppAuthUnavailable,
  NimiAppLocalSessionProjection,
  NimiCurrentUserDisplay,
  NimiLocalAppClient,
  NimiLocalAppClientInput,
  NimiLocalAppAgentReferencesRuntime,
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
  NimiAgentRealtimeRuntime,
  NimiRealmChatRuntime,
  NimiRealmRealtimeRuntime,
  NimiLocalAppAIConfigClient,
  NimiLocalAppAIConfigShell,
  NimiLocalAppStandardShell,
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
  NimiRealmRealtimeClient,
  NimiRealmRealtimeChatEvent,
  NimiRealmRealtimeDataEvent,
  NimiRealmRealtimeEvent,
  NimiRealmRealtimeMessage,
  NimiRealmRealtimeMessagePayload,
  NimiRealmRealtimeShell,
  NimiRealmRealtimeSubscription,
  NimiRealmRealtimeTarget,
  NimiRealmChatAttachment,
  NimiRealmChatClient,
  NimiRealmChatListInput,
  NimiRealmChatListItem,
  NimiRealmChatListPage,
  NimiRealmChatShell,
  NimiRealmChatUserSnapshot,
  NimiRealmChatUserSummary,
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
  NimiLocalAppConversationRuntime,
  NimiLocalAppConversationScopeInput,
  NimiLocalAppConversationSendInput,
  NimiLocalAppConversationSendResult,
  NimiLocalAppConversationShellSubscription,
  NimiLocalAppConversationSnapshot,
  NimiLocalAppConversationSubscription,
  NimiLocalAppConversationTurn,
  NimiLocalAppConversationVoice,
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentReference,
  NimiLocalAppAgentReferencesClient,
  NimiLocalAppWorldCoreListInput,
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
  NimiLocalAppTextCandidateInput,
  NimiLocalAppTextCandidateMessage,
  NimiLocalAppTextCandidateResult,
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
  NimiAppRuntimeStorageDocument,
  NimiAppRuntimeStorageRemoveResult,
  NimiLocalAppAssetBody,
  NimiLocalAppAssetReadResult,
  NimiLocalAppAssetRecord,
  NimiLocalAppAssetsClient,
} from './local-app-runtime-platform.js';
export {
  NIMI_APP_AI_PROFILE_FACTORY_ROWS,
  loadNimiAppAIProfileFactoryRows,
} from './ai-profile-factory.generated.js';
export type { NimiAppAIProfileFactoryRow } from './ai-profile-factory.generated.js';
export * from './inventory-types.js';
export type { NimiAppScopeKind, NimiAppScopeRef } from './app-scope.js';

// @nimi-authority: rule.nimi.sdks.feature-clients.r020
export class NimiAppClient {
  constructor(private readonly transport: NimiAppTransport) {
    if (!transport || typeof transport.list !== 'function' || typeof transport.get !== 'function' || typeof transport.status !== 'function') {
      appError('SDK_APP_TRANSPORT_INVALID', 'NimiAppClient requires explicit read-projection transport', 'provide_app_transport');
    }
  }

  async list(): Promise<readonly NimiAppInventoryEntry[]> {
    try {
      const entries = await this.transport.list();
      if (!Array.isArray(entries)) {
        appError('SDK_APP_RESPONSE_INVALID', 'Nimi app list response must be an array', 'fix_app_transport_response');
      }
      for (const entry of entries) {
        validateNimiAppInventoryEntry(entry);
      }
      return entries;
    } catch (error) {
      throw wrapTransportError(error, 'list Nimi apps');
    }
  }

  async get(appId: string): Promise<NimiAppInventoryEntry> {
    const normalizedAppId = requireText(appId, 'appId is required', 'SDK_APP_ID_REQUIRED', 'set_app_id');
    try {
      const entry = await this.transport.get(normalizedAppId);
      validateNimiAppInventoryEntry(entry);
      if (entry.appId !== normalizedAppId) {
        appError('SDK_APP_RESPONSE_INVALID', 'Nimi app inventory entry appId does not match request', 'fix_app_transport_response');
      }
      return entry;
    } catch (error) {
      throw wrapTransportError(error, 'get Nimi app');
    }
  }

  async status(appId: string): Promise<NimiAppStatus> {
    const normalizedAppId = requireText(appId, 'appId is required', 'SDK_APP_ID_REQUIRED', 'set_app_id');
    try {
      const status = await this.transport.status(normalizedAppId);
      validateNimiAppStatus(status, normalizedAppId);
      return status;
    } catch (error) {
      throw wrapTransportError(error, 'get Nimi app status');
    }
  }
}

export function createNimiAppClient(transport: NimiAppTransport): NimiAppClient {
  return new NimiAppClient(transport);
}

export function createAppScopeRef(input: {
  readonly appId: unknown;
  readonly surfaceId?: unknown;
}): NimiAppScopeRef {
  return {
    kind: 'app',
    ownerId: requireText(input.appId, 'scope appId is required', 'SDK_APP_ID_REQUIRED', 'set_app_id'),
    ...(normalizeText(input.surfaceId) ? { surfaceId: normalizeText(input.surfaceId) } : {}),
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(value: unknown, message: string, code: string, actionHint: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    appError(code, message, actionHint);
  }
  return normalized;
}

function wrapTransportError(error: unknown, action: string): never {
  if (isNimiSdkError(error)) {
    throw error;
  }
  appError('SDK_APP_TRANSPORT_FAILED', `failed to ${action}`, 'check_app_transport', error);
}

function isNimiSdkError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && typeof (error as { reasonCode?: unknown }).reasonCode === 'string');
}

function appError(code: string, message: string, actionHint: string, cause?: unknown): never {
  throw createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
    details: cause === undefined ? undefined : { cause: String(cause instanceof Error ? cause.message : cause) },
  });
}
