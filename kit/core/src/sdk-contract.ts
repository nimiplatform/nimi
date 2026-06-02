/**
 * `@nimiplatform/kit/core/sdk-contract`
 *
 * SDK ↔ kit boundary contract (wave-b fork F3 formalization).
 *
 * Goal
 * ----
 * Every kit-to-SDK consumption boundary references this file, never
 * `@nimiplatform/sdk*` directly. If the upstream SDK breaks the
 * shape kit depends on, the breakage surfaces as a compile-time
 * error here, not deep in feature code. This is the single audit
 * surface for kit's SDK coupling.
 *
 * Audited inventory (wave-a kit-audit-report.md §SDK consumption
 * summary by sub-module = 28 unique import sites across 5 admitted
 * S-SURFACE-001 sub-paths):
 *
 *   @nimiplatform/sdk          — root facade
 *     - getPlatformClient (kit/features/chat/src/runtime.ts:1,
 *       kit/features/chat/src/realm/service.ts:1,
 *       kit/features/commerce/src/realm.ts:1,
 *       kit/features/generation/src/runtime.ts:1,
 *       kit/features/model-picker/src/runtime.ts:1)
 *   @nimiplatform/sdk/runtime — runtime type family
 *     - Runtime, TextGenerateInput, TextGenerateOutput, TextMessage,
 *       TextStreamInput, TextStreamPart  (chat/src/runtime.ts:8-15,
 *       chat/src/runtime/orchestration.ts:6)
 *     - TextMessageContentPart (chat/src/orchestration/contracts.ts:1)
 *     - SpeechVoiceReference (core/model-config/types.ts:20,
 *       features/model-config/src/types.ts:2,
 *       features/model-config/src/components/audio-synthesize-params-editor.tsx:2,
 *       features/model-config/src/components/model-config-capability-detail.tsx:37)
 *     - ScenarioJobStatus, ScenarioJobSubmitInput,
 *       runRuntimeMediaGenerationJob, RuntimeMediaGenerationJob*
 *       (features/generation/src/runtime.ts:3-7)
 *     - Runtime catalog projection/client types and
 *       createRuntimeModelCatalogClient
 *       (features/model-picker/src/runtime.ts:1-32)
 *   @nimiplatform/sdk/realm — realm typed surface
 *     - RealmServiceRegistry (chat/src/realm/types.ts:1)
 *     - RealmModel (chat/src/realm/codec.ts:1,
 *       commerce/src/realm.ts:2,
 *       auth/src/hooks/use-auth-flow.ts:2,
 *       auth/src/logic/auth-email-flow.ts:1,
 *       auth/src/logic/auth-menu-handlers.ts:2,
 *       auth/src/platform/auth-platform-adapter.ts:2)
 *     - OAuthLoginState (auth/src/logic/auth-menu-handlers.ts:3)
 *     - resolveRealmMediaUrl (chat/src/realm/helpers.ts)
 *   @nimiplatform/sdk/types — typed error envelope
 *     - NimiError (chat/src/runtime.ts:16)
 *     - ReasonCode (reserved for kit SDK-boundary consumers)
 *   @nimiplatform/sdk/ai   — module-config authority
 *     - * (re-exports) (core/model-config/types.ts:19,
 *       core/model-config/profile-controller-core.ts:20)
 *     - AIConfig (features/model-config/src/components/model-config-ai-model-hub.tsx:3,
 *       features/model-config/src/components/model-config-capability-detail.tsx:12)
 *     - AIProfileApplyResult, AIProfilePreviewResult, AIScopeRef
 *       (features/model-config/src/headless/use-model-config-profile-controller.ts)
 *   @nimiplatform/sdk/ai-app — app AI developer experience
 *     - runAppAiTextTurn and AppAiTextTurnEvent
 *       (features/chat/src/runtime/orchestration.ts)
 *     - buildAppAiHistoryWindow and history budget helpers
 *       (features/chat/src/orchestration/history-window.ts)
 *
 * Authority cross-reference
 * --------------------------
 *  S-SURFACE-001 admittance: `.nimi/spec/sdk/kernel/surface-contract.md`
 *  lines 9-16. All 5 sub-paths consumed by kit are admitted; kit does
 *  not consume `/world`, `/ai-provider`, or `/scope` (3 of 8 admitted
 *  sub-paths intentionally unused).
 *
 *  Runtime escape hatch (`new Runtime({ appId, transport })` at
 *  kit/features/model-picker/src/runtime.ts:363) is documented at
 *  `.nimi/spec/sdk/kernel/runtime-contract.md:7`. The `Runtime`
 *  re-export below is the canonical contract for that escape hatch.
 *
 * Re-export strategy
 * ------------------
 *  - Type-only re-exports keep this file React-free + runtime-safe
 *    (kit/core hard boundary preserved).
 *  - The single value re-export `getPlatformClient` is the SDK root
 *    facade entrypoint; everything else is `export type`.
 *  - Kit module-config has both type and value SDK surfaces from
 *    `@nimiplatform/sdk/ai`; we re-export the whole sub-path for
 *    that one consumer to match its existing star-import shape.
 *  - Kit chat uses `@nimiplatform/sdk/ai-app` only for non-authoritative
 *    text-turn stream assembly; Kit maps the resulting events into
 *    reusable conversation headless events.
 *  - Kit generation uses `@nimiplatform/sdk/runtime` only for
 *    non-authoritative media scenario job consumption; Kit maps the
 *    resulting Runtime job projection into reusable generation UI state.
 *
 * Dynamic-import boundary (wave-c carry-forward concern 1)
 * --------------------------------------------------------
 *  `kit/features/chat/src/runtime/orchestration.ts:199` lazy-loads
 *  the SDK root facade to defer the platform-client wiring cost
 *  until the runtime adapter is actually invoked. It routes through
 *  `import('@nimiplatform/kit/core/sdk-contract')` so the
 *  dynamic-import path is bounded by this contract surface. There is
 *  no other admitted dynamic SDK import inside kit; new dynamic
 *  imports must target this file or be admitted here explicitly.
 *
 * Cross-feature edges (wave-c carry-forward concern 2)
 * ----------------------------------------------------
 *  The `chat → avatar` cross-feature dependency is admitted as a
 *  documented one-way feature composition (avatar headless surface
 *  consumed by chat domain types and the canonical character rail
 *  component). Importing-file count: 2.
 *    - kit/features/chat/src/types.ts:2
 *    - kit/features/chat/src/components/canonical-character-rail.tsx:8
 *  The `model-config → model-picker` cross-feature dependency is
 *  retained as a documented one-way feature composition as well.
 *  Both edges are part of the v1.0.0 public-surface contract; future
 *  audits keep them documented here unless the edge is removed.
 *
 * Counting vocabulary (wave-c carry-forward concern 3)
 * ----------------------------------------------------
 *  Audits of SDK consumption MUST distinguish three counts:
 *    - importing-file count: number of consumer files (e.g. 21 for
 *      static `@nimiplatform/sdk*` consumers prior to wave-b).
 *    - import-statement count: number of `from '@nimiplatform/sdk*'`
 *      statements (e.g. 28 unique sites in wave-a inventory).
 *    - export-statement count: number of `export` declarations in
 *      this file (the single-boundary surface).
 *  Each count answers a different question; do not conflate them.
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
  RuntimeAgentPresentationLipsyncFrameBatchEvent,
  RuntimeAgentPresentationVoicePlaybackRequestedEvent,
  RuntimeAgentTimelineEnvelope,
  RuntimeCanonicalCapability,
  RuntimeRouteOptionsClient,
  RuntimeRouteOptionsSnapshot,
  ListRuntimeRouteOptionsInput,
} from '@nimiplatform/sdk/runtime';

// --- Realm type family ------------------------------------------------------
export type {
  RealmServiceRegistry,
  RealmModel,
} from '@nimiplatform/sdk/realm';
export { OAuthLoginState, resolveRealmMediaUrl } from '@nimiplatform/sdk/realm';

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
} from '@nimiplatform/sdk/ai-app';
export type {
  AppAiHistoryTokenCounter,
  AppAiHistoryWindowBudget,
  AppAiHistoryWindowMessage,
  AppAiHistoryWindowResult,
  AppAiTextTurnEvent,
  AppAiTextTurnRuntime,
} from '@nimiplatform/sdk/ai-app';
