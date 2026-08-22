// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-030
/**
 * `@nimiplatform/kit/core/sdk-contract`
 *
 * SDK to Kit boundary contract.
 *
 * Purpose
 * -------
 * Every Kit-to-SDK consumption boundary references this file, never
 * `@nimiplatform/sdk*` directly from Kit feature code. If the upstream SDK
 * changes a shape Kit depends on, the breakage surfaces at this contract file
 * instead of being scattered through feature modules.
 *
 * This file is not platform authority. SDK public surface admission remains in
 * `.nimi/spec/sdks/client-core.authority.yaml`; Runtime, Realm, and AI execution
 * authority remains in their owning specs and services. This file is the Kit
 * package-local SDK coupling surface.
 *
 * Active SDK surfaces consumed by Kit
 * -----------------------------------
 *
 *   @nimiplatform/sdk          — root facade
 *     - createNimiClient / NimiClient explicit composition
 *   @nimiplatform/sdk/runtime — Runtime type family, Scenario Job status and
 *       result projections, reason-code helpers, and Runtime Agent projections
 *   @nimiplatform/sdk/realm — realm typed surface
 *     - RealmModel, RealmHumanChatModule, and auth/realm helper values
 *     - resolveNimiRealmMediaUrl (chat/src/realm/attachments.ts)
 *   @nimiplatform/sdk/types — typed error envelope
 *     - NimiError and error helpers
 *   @nimiplatform/sdk/ai — canonical capability configuration plus Nimi-native
 *       text-generation developer experience
 *   @nimiplatform/sdk/features/conversation — conversation primitives
 *     - history windows, text accumulation, and stream snapshots
 *   @nimiplatform/sdk/features/generation — neutral Scenario identity and
 *       media request payload types; image/video/speech generation executes
 *       through the owner-driven Scenario job runner
 *   @nimiplatform/sdk/app — protected App and Desktop Open data surfaces
 *     - the single nominal NimiLocalAppAgentHandle projected by Runtime
 *     - bounded Local App Agent configure client types used by Agent Center
 *     - closed Desktop Open intent parser, renderer request parser, envelope
 *       composition, and result parser
 *
 * Re-export strategy
 * ------------------
 *  - Type-only re-exports keep this file React-free + runtime-safe
 *    (kit/core hard boundary preserved).
 *  - vNext removes the SDK platform singleton. Kit feature code must receive
 *    Runtime/Realm/App surfaces explicitly.
 *  - Runtime classes, enums, error helpers, and active AI helper functions are
 *    value exports because Kit feature code invokes them directly.
 *  - Kit chat uses `@nimiplatform/sdk/ai` and
 *    `@nimiplatform/sdk/features/conversation` for non-authoritative text
 *    generate/stream helpers and text-turn stream assembly; Kit maps the
 *    resulting events into reusable conversation headless events.
 *  - Kit generation keeps request/result contracts and owner-scoped voice
 *    references; image/video/speech media capabilities submit owner-driven
 *    Scenario jobs through the SDK typed runners.
 *
 * Dynamic-import rule
 * -------------------
 *  Kit chat may lazy-load this contract file to defer platform-client wiring
 *  until the runtime adapter is invoked. New dynamic SDK imports inside Kit
 *  must target this file or be admitted explicitly before implementation.
 *
 * Review rule
 * -----------
 *  New Kit SDK consumption must add or reuse exports here, keep feature modules
 *  free of direct `@nimiplatform/sdk*` imports, and update the relevant Kit
 *  boundary tests.
 */

// --- Root facade ------------------------------------------------------------
export {
  NimiClient,
  createNimiClient,
  createNimiLocalAppRuntimeScenarioJobClient,
} from '@nimiplatform/sdk';
export type {
  NimiClientConfig,
  NimiLocalAppClient,
  NimiLocalAppScenarioJobSpec,
  NimiLocalAppTextTurnEvent,
} from '@nimiplatform/sdk';
export {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
} from '@nimiplatform/sdk/ai';
export type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
  NimiAIConfigLocalLoadoutOption,
  NimiAIConfigCloudConnectorOption,
  NimiAIConfigCloudTargetOption,
  NimiAIConfigOptionsQuery,
  NimiAIConfigOptionsResult,
  NimiAIConfigOverwriteInput,
  NimiAIConfigOverwriteResult,
  NimiAIConfigSnapshot,
  NimiCloudAIConfigCapabilityInput,
  NimiPortableAppAIConfig,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk/ai';

// --- Runtime type family ----------------------------------------------------
// `Runtime` and `ScenarioJobStatus` are runtime values, not type-only.
export {
  NIMI_RUNTIME_REASON_CODES,
  Runtime,
  createNimiHostRuntimeAgentInspectSurface,
  getNimiRuntimeScenarioJobTerminalStatusFromError,
  getNimiRuntimeReasonCodeMessage,
  toNimiRuntimeVoiceReference,
  runNimiRuntimeScenarioJob,
} from '@nimiplatform/sdk/runtime';
export {
  NIMI_RUNTIME_AGENT_RESOLVED_STATUS_CUE_MOODS,
  NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER,
  assertNimiRuntimeAgentContextProjectionCorrelation,
  decodeNimiRuntimeAgentSourceContextStatus,
  decodeNimiRuntimeAgentTurnContextSummary,
  withNimiRuntimeIdempotencyMetadata,
} from '@nimiplatform/sdk/runtime';
export {
  ExecutionMode,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
} from '@nimiplatform/sdk/runtime/generated';
export type {
  NimiRuntimeAgentAutonomyConfigInput,
  NimiRuntimeAgentAutonomyMode,
  NimiRuntimeAgentAutonomySnapshot,
  NimiRuntimeAgentCanonicalMemoryInspect,
  NimiRuntimeAgentSourceContextStatus,
  NimiRuntimeAgentSourceKind,
  NimiRuntimeAgentTurnContextSummary,
  NimiRuntimeAgentTurnContextLaneId,
  NimiRuntimeAgentTurnContextLaneSummary,
  NimiRuntimeAgentInspectSnapshot,
  NimiRuntimeAgentInspectSurface,
  NimiRuntimeAgentMemoryObservatoryRecord,
  NimiRuntimeAgentMemoryObservatorySnapshot,
  NimiRuntimeAgentPendingHookInspect,
  NimiRuntimeAgentPresentationProfileProjection,
  NimiRuntimeAgentResolvedStatusCueMood,
  NimiRuntimeAgentStateSnapshot,
  NimiRuntimeScenarioArtifact,
  NimiScenarioJobClient,
  NimiRuntimeScenarioJob,
  NimiRuntimeScenarioJobClient,
  NimiProtectedLocalScenarioJobClient,
  NimiRuntimeScenarioJobResult,
  NimiRuntimeSpeechVoiceReference,
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/sdk/runtime';

// --- Realm type family ------------------------------------------------------
export type {
  RealmHumanChatModule,
  NimiRealmAuthTokens,
  NimiRealmOAuthLoginInput,
  NimiRealmOAuthLoginResult,
} from '@nimiplatform/sdk/realm';
export type { RealmPublicGeneratedClient } from '@nimiplatform/sdk/realm';
export type { RealmModel } from '@nimiplatform/sdk/realm/generated';
export {
  NIMI_REALM_OAUTH_LOGIN_STATE,
  NIMI_REALM_OAUTH_PROVIDER,
  normalizeNimiRealmAuthTokens,
  normalizeNimiRealmOAuthLoginResult,
  readNimiRealmOAuthLoginTokens,
  resolveNimiRealmMediaUrl,
  toNimiRealmAuthUserRecord,
} from '@nimiplatform/sdk/realm';

// --- Typed error envelope ---------------------------------------------------
export type { NimiError } from '@nimiplatform/sdk/types';
export { asNimiError, createNimiError, isNimiError, ReasonCode } from '@nimiplatform/sdk/types';

// --- Nimi AI developer-experience primitives --------------------------------
export {
  coerceNimiAITextGenerationParams,
  createNimiRuntimeAIModel,
  createNimiRuntimeEmbeddingClient,
  runNimiTextGenerate,
  runNimiTextTurn,
  streamNimiTextResponse,
} from '@nimiplatform/sdk/ai';
export type {
  NimiAITextGenerationParameterSet,
  NimiAiModel,
  NimiGenerateTextRequest,
  NimiGenerateTextResult,
  NimiRuntimeAIScenarioClient,
  NimiRuntimeEmbeddingScenarioClient,
  NimiRuntimeAIModelOptions,
  NimiRuntimeAIReasoningOptions,
  NimiTextError,
  NimiTextGenerateInput,
  NimiTextGenerateResult,
  NimiTextRuntime,
  NimiTextStreamHandlers,
  NimiTextStreamResponseResult,
  NimiTextTurnEvent,
  NimiTextTurnInput,
} from '@nimiplatform/sdk/ai';
export {
  buildNimiRuntimeScenarioJobIdentity,
  runNimiRuntimeImageGeneration,
  runNimiRuntimeSpeechSynthesis,
  runNimiRuntimeSpeechTranscription,
  runNimiRuntimeVideoGeneration,
} from '@nimiplatform/sdk/features/generation';
export type {
  NimiRuntimeSpeechTranscriptionAudioSource,
  NimiRuntimeVideoContentPart,
  NimiRuntimeVideoGenerationOptions,
} from '@nimiplatform/sdk/features/generation';
export type {
  NimiJsonObject,
  NimiJsonValue,
  NimiMessage,
  NimiMessagePart,
  NimiMessageRole,
  NimiModelRef,
  NimiRunEvent,
} from '@nimiplatform/sdk/contracts';
export {
  dataPart,
  textPart,
} from '@nimiplatform/sdk/contracts';
export type {
  BeginLoginResponse,
  CompleteLoginResponse,
  GetAccountSessionStatusResponse,
  InvokeRealmUnaryResponse,
  LogoutResponse,
  SwitchAccountResponse,
} from '@nimiplatform/sdk/runtime/generated';
export type {
  ListVoiceAssetsRequest,
  ListVoiceAssetsResponse,
  RuntimeTypedCallOptions,
  ScenarioJob,
  SubmitScenarioJobRequest,
} from '@nimiplatform/sdk/runtime/generated';
export {
  AccountReasonCode,
  AccountSessionState,
  ReasonCode as RuntimeReasonCode,
  RoutePolicy,
  VoiceAssetStatus,
  VoiceCreationSource,
  VoiceReferenceKind,
} from '@nimiplatform/sdk/runtime/generated';
export {
  NIMI_CONVERSATION_SESSION_COMPLETION_RESERVE,
  NIMI_CONVERSATION_SESSION_HISTORY_BUDGET,
  buildNimiConversationHistoryWindow,
  buildNimiConversationHistoryWindowResult,
  buildNimiConversationHistoryMessages,
  estimateNimiConversationMessageChars,
  estimateNimiConversationTokenEstimateFromChars,
  estimateNimiConversationTokens,
  measureNimiConversationHistoryWindow,
} from '@nimiplatform/sdk/features/conversation';
export type {
  NimiConversationHistoryBudget,
  NimiConversationHistoryMessageInput,
  NimiConversationHistoryTokenCounter,
  NimiConversationHistoryWindowMeasurement,
  NimiConversationHistoryWindowResult,
  NimiConversationMessage,
  NimiConversationTextAccumulatorSnapshot,
} from '@nimiplatform/sdk/features/conversation';

// --- Protected App Agent + Desktop Open data surfaces ----------------------
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
} from '@nimiplatform/sdk/app';
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
  NimiLocalAppAgentAutonomyProjection,
  NimiLocalAppAgentAutonomyMode,
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentPresentationBackendKind,
  NimiLocalAppAgentPresentationIntent,
  NimiLocalAppAgentPresentationProfile,
  NimiLocalAppAgentPresentationProjection,
} from '@nimiplatform/sdk/app';
