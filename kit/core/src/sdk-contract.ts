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
 * `.nimi/spec/sdk/kernel/surface-contract.md`; Runtime, Realm, and AI execution
 * authority remains in their owning specs and services. This file is the Kit
 * package-local SDK coupling surface.
 *
 * Active SDK surfaces consumed by Kit
 * -----------------------------------
 *
 *   @nimiplatform/sdk          — root facade
 *     - getPlatformClient
 *   @nimiplatform/sdk/runtime — runtime type family
 *     - Runtime, text generation/streaming types, media scenario job helpers,
 *       route/model catalog projections, reason-code helpers, and local route
 *       option projections
 *     - Runtime catalog projection/client types and
 *       createRuntimeModelCatalogClient
 *       (features/model-picker/src/runtime.ts:1-32)
 *   @nimiplatform/sdk/realm — realm typed surface
 *     - RealmServiceRegistry, RealmModel, and auth/realm helper values
 *     - resolveRealmMediaUrl (chat/src/realm/helpers.ts)
 *   @nimiplatform/sdk/types — typed error envelope
 *     - NimiError and ReasonCode
 *   @nimiplatform/sdk/ai   — module-config projection and profile DX
 *     - AIConfig, AIProfile, apply/preview result types, and AIScopeRef
 *   @nimiplatform/sdk/ai-app — app AI developer experience
 *     - submitAppAiChat, streamAppAiChatResponse,
 *       runAppAiTextTurn, streamAppAiTextResponse, and event/handler types
 *     - buildAppAiHistoryWindow and history budget helpers
 *
 * Re-export strategy
 * ------------------
 *  - Type-only re-exports keep this file React-free + runtime-safe
 *    (kit/core hard boundary preserved).
 *  - The single value re-export `getPlatformClient` is the SDK root
 *    facade entrypoint.
 *  - Runtime classes, enums, error helpers, catalog client factories, and
 *    app-AI helper functions are value exports because Kit feature code invokes
 *    them directly.
 *  - Kit module-config has both type and value SDK surfaces from
 *    `@nimiplatform/sdk/ai`; we re-export the whole sub-path for
 *    that one consumer to match its existing star-import shape.
 *  - Kit chat uses `@nimiplatform/sdk/ai-app` only for non-authoritative
 *    app-AI text generate/stream helpers and text-turn stream assembly; Kit
 *    maps the resulting events into reusable conversation headless events.
 *  - Kit generation uses `@nimiplatform/sdk/runtime` only for
 *    non-authoritative media scenario job consumption; Kit maps the
 *    resulting Runtime job projection into reusable generation UI state.
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
export { getPlatformClient } from '@nimiplatform/sdk';
export type { getPlatformClient as GetPlatformClientFn } from '@nimiplatform/sdk';

// --- Runtime type family ----------------------------------------------------
// `Runtime`, `ScenarioJobStatus`, catalog enums, and catalog client factories
// are runtime values, not type-only — keep their value-side export.
export {
  Runtime,
  asNimiError,
  createNimiError,
  createRuntimeModelCatalogClient,
  getRuntimeReasonCodeMessage,
  isNimiError,
  listRuntimeRouteOptions,
  runtimeRouteCapabilitiesMatch,
  runRuntimeMediaGenerationJob,
  ScenarioJobStatus,
  CatalogModelSource,
  ModelCatalogProviderSource,
} from '@nimiplatform/sdk/runtime';
export type {
  TextGenerateInput,
  TextGenerateOutput,
  TextMessage,
  TextMessageContentPart,
  TextStreamInput,
  TextStreamOutput,
  TextStreamPart,
  SpeechVoiceReference,
  ScenarioJobSubmitInput,
  RuntimeMediaGenerationJob,
  RuntimeMediaGenerationJobResult,
  RuntimeMediaGenerationJobsModule,
  RuntimeMediaGenerationSubmitRequest,
  RuntimeMediaScenarioArtifact,
  CatalogModelDetail,
  CatalogOverlayWarning,
  CatalogPricing,
  CatalogSourceRef,
  CatalogVideoGenerationCapability,
  CatalogVoiceEntry,
  CatalogWorkflowModel,
  CatalogModelWorkflowBinding,
  CatalogModelSummary,
  ModelCatalogProviderEntry,
  RuntimeCatalogModelDetail,
  RuntimeCatalogModelDetailResponse,
  RuntimeCatalogModelSource,
  RuntimeCatalogOverlayWarning,
  RuntimeCatalogPricing,
  RuntimeCatalogProviderModelsResponse,
  RuntimeCatalogSourceRef,
  RuntimeCatalogVideoGeneration,
  RuntimeCatalogVoiceEntry,
  RuntimeCatalogWorkflowBinding,
  RuntimeCatalogWorkflowModel,
  RuntimeCatalogModelSummary,
  RuntimeModelCatalogClient,
  RuntimeModelCatalogProvider,
  RuntimeModelCatalogProviderSource,
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteOptionsClient,
  RuntimeRouteOptionsSnapshot,
  ListRuntimeRouteOptionsInput,
} from '@nimiplatform/sdk/runtime';

// --- Realm type family ------------------------------------------------------
export type {
  RealmServiceRegistry,
  RealmModel,
} from '@nimiplatform/sdk/realm';
export { OAuthLoginState, OAuthProvider, resolveRealmMediaUrl } from '@nimiplatform/sdk/realm';

// --- Typed error envelope ---------------------------------------------------
export type { NimiError } from '@nimiplatform/sdk/types';
export { ReasonCode } from '@nimiplatform/sdk/types';

// --- Module-config (kit/core/model-config + kit/features/model-config) ------
// `@nimiplatform/sdk/ai` consumers in kit:
//   - core/model-config/types.ts (AIConfig, AIProfile, AIProfileApplyResult,
//     AIProfileApplyOptions, AIProfilePreviewResult, AIProfileRef, AIScopeRef)
//   - core/model-config/profile-controller-core.ts (AIConfig, AIProfile,
//     AIProfileApplyResult, AIProfilePreviewResult, AIProfileRef)
//   - features/model-config/src/components/model-config-ai-model-hub.tsx
//     (AIConfig)
//   - features/model-config/src/components/model-config-capability-detail.tsx
//     (AIConfig)
//   - features/model-config/src/headless/use-model-config-profile-controller.ts
//     (AIConfig, AIProfile, AIProfileApplyResult, AIProfilePreviewResult,
//      AIScopeRef)
export type {
  AIConfig,
  AIProfile,
  AIProfileApplyOptions,
  AIProfileApplyResult,
  AIProfilePreviewResult,
  AIProfileRef,
  AIScopeRef,
} from '@nimiplatform/sdk/ai';

// --- App AI developer-experience primitives --------------------------------
export {
  APP_AI_SESSION_COMPLETION_RESERVE,
  APP_AI_SESSION_HISTORY_BUDGET,
  buildAppAiHistoryWindow,
  estimateAppAiHistoryMessageChars,
  estimateAppAiHistoryTokenCountFromChars,
  measureAppAiHistoryWindowBudget,
  runAppAiTextTurn,
  streamAppAiTextResponse,
  streamAppAiChatResponse,
  submitAppAiChat,
  withDefaultAppAiChatMetadata,
} from '@nimiplatform/sdk/ai-app';
export type {
  AppAiChatDeltaPart,
  AppAiChatErrorPart,
  AppAiChatFinishPart,
  AppAiChatMetadataDefaults,
  AppAiChatPrompt,
  AppAiChatRequest,
  AppAiChatRuntimeOptions,
  AppAiChatStreamHandlers,
  AppAiChatStreamRequest,
  AppAiChatStreamResult,
  AppAiChatStreamSnapshot,
  AppAiHistoryTokenCounter,
  AppAiHistoryWindowBudget,
  AppAiHistoryWindowMessage,
  AppAiHistoryWindowResult,
  AppAiTextStreamDeltaPart,
  AppAiTextStreamErrorPart,
  AppAiTextStreamFinishPart,
  AppAiTextStreamResponseHandlers,
  AppAiTextStreamResponseResult,
  AppAiTextStreamResponseRuntime,
  AppAiTextStreamResponseSnapshot,
  AppAiTextTurnEvent,
  AppAiTextTurnRuntime,
} from '@nimiplatform/sdk/ai-app';
