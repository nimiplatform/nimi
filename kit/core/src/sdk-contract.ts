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
 * `.nimi/spec/sdks/kernel/surface-contract.md`; Runtime, Realm, and AI execution
 * authority remains in their owning specs and services. This file is the Kit
 * package-local SDK coupling surface.
 *
 * Active SDK surfaces consumed by Kit
 * -----------------------------------
 *
 *   @nimiplatform/sdk          — root facade
 *     - createNimiClient / NimiClient explicit composition
 *   @nimiplatform/sdk/runtime — runtime type family
 *     - Runtime, text generation/streaming types, media scenario job helpers,
 *       route/model catalog projections, reason-code helpers, and local route
 *       option projections
 *     - Runtime catalog projection/client types and
 *       createNimiRuntimeModelCatalogClient
 *       (features/model-picker/src/runtime.ts:1-32)
 *   @nimiplatform/sdk/realm — realm typed surface
 *     - RealmModel, RealmHumanChatModule, and auth/realm helper values
 *     - resolveNimiRealmMediaUrl (chat/src/realm/attachments.ts)
 *   @nimiplatform/sdk/types — typed error envelope
 *     - NimiError and error helpers
 *   @nimiplatform/sdk/ai   — module-config projection and profile DX
 *     - NimiAIConfig, compact target refs, NimiAIProfile, requirement
 *       declarations, setup projection, apply/preview result types, and
 *       NimiAIScopeRef
 *   @nimiplatform/sdk/ai — Nimi-native AI developer experience
 *     - createNimiRuntimeAIModel, runNimiTextGenerate,
 *       runNimiTextTurn, streamNimiTextResponse, and event/handler types
 *   @nimiplatform/sdk/features/conversation — conversation primitives
 *     - history windows, text accumulation, and stream snapshots
 *   @nimiplatform/sdk/features/generation — Runtime media generation helpers
 *     - image parameter coercion and Runtime image.generate scenario runner
 *
 * Re-export strategy
 * ------------------
 *  - Type-only re-exports keep this file React-free + runtime-safe
 *    (kit/core hard boundary preserved).
 *  - vNext removes the SDK platform singleton. Kit feature code must receive
 *    Runtime/Realm/App surfaces explicitly.
 *  - Runtime classes, enums, error helpers, catalog client factories, and AI
 *    helper functions are value exports because Kit feature code invokes them
 *    directly.
 *  - Kit module-config has both type and value SDK surfaces from
 *    `@nimiplatform/sdk/ai`; we re-export the whole sub-path for
 *    that one consumer to match its existing star-import shape.
 *  - Kit chat uses `@nimiplatform/sdk/ai` and
 *    `@nimiplatform/sdk/features/conversation` for non-authoritative text
 *    generate/stream helpers and text-turn stream assembly; Kit maps the
 *    resulting events into reusable conversation headless events.
 *  - Kit generation uses `@nimiplatform/sdk/features/generation` and
 *    `@nimiplatform/sdk/runtime` only for non-authoritative media scenario job
 *    consumption; Kit maps the resulting Runtime job projection into reusable
 *    generation UI state.
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
export { NimiClient, createNimiClient } from '@nimiplatform/sdk';
export type { NimiClientConfig } from '@nimiplatform/sdk';

// --- Runtime type family ----------------------------------------------------
// `Runtime`, `ScenarioJobStatus`, catalog enums, and catalog client factories
// are runtime values, not type-only — keep their value-side export.
export { Runtime, createNimiRuntimeModelCatalogClient, getNimiRuntimeReasonCodeMessage, listNimiRuntimeRouteOptions, NIMI_RUNTIME_REASON_CODES, runNimiRuntimeScenarioJob, runtimeNimiRouteCapabilitiesMatch } from '@nimiplatform/sdk/runtime';
export { ExecutionMode, ScenarioJobEventType, ScenarioJobStatus, ScenarioType, CatalogModelSource, ModelCatalogProviderSource } from '@nimiplatform/sdk/runtime/generated';
export type { NimiRuntimeCatalogModelDetail, NimiRuntimeCatalogModelDetailResponse, NimiRuntimeCatalogModelSource, NimiRuntimeCatalogOverlayWarning, NimiRuntimeCatalogPricing, NimiRuntimeCatalogProviderModelsResponse, NimiRuntimeCatalogSourceRef, NimiRuntimeCatalogVideoGeneration, NimiRuntimeCatalogVoiceEntry, NimiRuntimeCatalogWorkflowBinding, NimiRuntimeCatalogWorkflowModel, NimiRuntimeCatalogModelSummary, NimiRuntimeModelCatalogClient, NimiRuntimeModelCatalogConnectorClient, NimiRuntimeModelCatalogProvider, NimiRuntimeModelCatalogProviderSource, NimiListRuntimeRouteOptionsInput, NimiRuntimeCanonicalCapability, NimiRuntimeRouteOptionsClient, NimiRuntimeRouteOptionsSnapshot, NimiRuntimeRouteTargetRef, NimiRuntimeTargetInventoryItem, RuntimeTargetInventoryProjection, NimiRuntimeScenarioArtifact, NimiRuntimeScenarioJob, NimiRuntimeScenarioJobClient, NimiRuntimeScenarioJobResult, NimiRuntimeScenarioJobSubmitRequest, NimiRuntimeSpeechVoiceReference } from '@nimiplatform/sdk/runtime';
export type { CatalogModelDetail, CatalogOverlayWarning, CatalogPricing, CatalogSourceRef, CatalogVideoGenerationCapability, CatalogVoiceEntry, CatalogWorkflowModel, CatalogModelWorkflowBinding, CatalogModelSummary, ModelCatalogProviderEntry } from '@nimiplatform/sdk/runtime/generated';

// --- Realm type family ------------------------------------------------------
export type { RealmHumanChatModule, NimiRealmAuthTokens, NimiRealmOAuthLoginResult } from '@nimiplatform/sdk/realm';
export type { RealmModel, RealmTypedClient } from '@nimiplatform/sdk/realm/generated';
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

// --- Module-config (kit/core/model-config + kit/features/model-config) ------
// `@nimiplatform/sdk/ai` consumers in kit:
//   - core/model-config/types.ts (NimiAIConfig, compact target refs,
//     requirement declarations, setup projection, NimiAIProfileApplyResult,
//     NimiAIProfileApplyOptions, NimiAIProfilePreviewResult,
//     NimiAIProfileOriginRef, NimiAIScopeRef)
//   - core/model-config/profile-controller-core.ts (NimiAIConfig,
//     NimiAIProfile, NimiAIProfileApplyResult, NimiAIProfilePreviewResult,
//     NimiAIProfileOriginRef)
//   - features/model-config/src/components/model-config-ai-model-hub.tsx
//     (NimiAIConfig)
//   - features/model-config/src/components/model-config-capability-detail.tsx
//     (NimiAIConfig)
//   - features/model-config/src/headless/use-model-config-profile-controller.ts
//     (NimiAIConfig, NimiAIProfile, NimiAIProfileApplyResult,
//      NimiAIProfilePreviewResult, NimiAIScopeRef)
export type {
  NimiAICapabilityRequirementDeclaration,
  NimiAICapabilityRequirementSlice,
  NimiAIConfig,
  NimiAIConfigSetupProjection,
  NimiAIConfigTargetRef,
  NimiAIProfile,
  NimiAIProfileApplyOptions,
  NimiAIProfileApplyResult,
  NimiAIProfileOriginRef,
  NimiAIProfilePreviewOptions,
  NimiAIProfilePreviewResult,
  NimiAIScopeRef,
} from '@nimiplatform/sdk/ai';

// --- Nimi AI developer-experience primitives --------------------------------
export {
  NIMI_RUNTIME_IMAGE_MODEL_FAMILY_OPTIONS,
  coerceNimiAITextGenerationParams,
  createNimiRuntimeEmbeddingClient,
  createNimiRuntimeAISchedulingClient,
  normalizeNimiRuntimeImageModelFamily,
  resolveNimiRuntimeImageCompanionSlots,
  resolveNimiAIConfigRuntimeBinding,
  createNimiRuntimeAIModel,
  runNimiTextGenerate,
  runNimiTextTurn,
  streamNimiTextResponse,
  toRuntimeDurableTargetRef,
} from '@nimiplatform/sdk/ai';
export type {
  NimiAIConfigRuntimeBinding,
  NimiAITextGenerationParameterSet,
  NimiAiModel,
  NimiGenerateTextRequest,
  NimiGenerateTextResult,
  NimiRuntimeAIScenarioClient,
  NimiRuntimeEmbeddingScenarioClient,
  NimiRuntimeAISchedulingClient,
  NimiRuntimeImageCompanionSlotContract,
  NimiRuntimeAIModelOptions,
  NimiRuntimeAIRoutePolicy,
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
  coerceNimiImageGenerationParams,
  runNimiRuntimeImageGeneration,
} from '@nimiplatform/sdk/features/generation';
export type {
  NimiImageGenerationCoercedParams,
  NimiRuntimeImageGenerationInput,
  NimiRuntimeImageGenerationResult,
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
export {
  fromNimiRuntimeProtoStruct,
  toNimiRuntimeProtoStruct,
} from '@nimiplatform/sdk/runtime';
export type {
  RuntimeDurableTargetRef,
} from '@nimiplatform/sdk/runtime';
export type {
  ReadArtifactBytesResponse,
  RuntimeTypedCallOptions,
  ScenarioArtifact,
  ScenarioExtension,
  ScenarioJob,
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
