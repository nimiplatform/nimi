// Relay media module — re-export key functions for use by chat pipeline

export { evaluateNsfwMediaPolicy, isMediaGenerationAllowed, isPromptLikelyNsfw, isNsfwMediaAllowed } from './nsfw-media-policy.js';
export type { NsfwMediaPolicy } from './nsfw-media-policy.js';

export {
  buildMediaGenerationSpec,
  compileMediaExecution,
  createMediaSpecHash,
  createMediaExecutionCacheKey,
  buildMediaArtifactShadow,
  buildMediaDisplayPrompt,
  RELAY_MEDIA_COMPILER_REVISION,
} from './media-spec.js';
export type { MediaIntent } from './media-spec.js';

export { collectMediaContextSnapshot, enrichMediaIntent } from './media-context-enricher.js';
export type { CharacterVisualAnchor, MediaContextSnapshot } from './media-context-enricher.js';

export { planMediaTurn } from './media-planner.js';
export type { MediaPlannerDecision, MediaPlannerResult, MediaPlannerTrigger } from './media-planner.js';

export {
  isMediaRouteReady,
  resolveMediaRouteConfig,
  resolveMediaRouteFromOptions,
  preflightResolveMediaRoute,
  buildMediaSettingsRevision,
  resolveConfiguredImageGenerateTarget,
  resolveConfiguredImageWorkflowExtensions,
} from './media-route.js';

export { decideMediaExecution } from './media-decision-policy.js';
export type { DecideMediaExecutionInput } from './media-decision-policy.js';

export { executeMediaDecision } from './media-execution-pipeline.js';
export type { ExecuteMediaDecisionInput } from './media-execution-pipeline.js';
