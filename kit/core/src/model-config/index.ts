// kit/core/model-config public entry.
// Pure-logic seam for the model-config feature; renderer-free and runtime-free.

export type {
  AppModelConfigSurface,
  AggregateCountsLabels,
  AggregateSummary,
  CapabilityEvaluation,
  CapabilityItemOverride,
  ModelConfigBindingSummary,
  ModelConfigBindingSnapshot,
  ModelConfigCapabilityPatch,
  ModelConfigI18nBinding,
  ModelConfigI18nFormatter,
  ModelConfigDiffRow,
  ModelConfigLocalAssetDescriptor,
  ModelConfigLocalAssetSource,
  ModelConfigPreviewState,
  ModelConfigProfileApplyPath,
  ModelConfigProfileCopyCore,
  ModelConfigProfileControllerCoreInput,
  ModelConfigProfileOption,
  ModelConfigProfileOriginRef,
  ModelConfigProjectionResolver,
  ModelConfigProjectionStatus,
  ModelConfigProviderResolver,
  ModelConfigRouteProviderHandle,
  ModelConfigStatusTone,
  ModelConfigTargetRef,
  ModelConfigRequirementEvaluation,
  SharedAIConfigService,
  SharedAIConfigSubscribeListener,
  SharedAIConfigUnsubscribe,
  UserProfilesSource,
} from './types.js';

export {
  applyModelConfigCapabilityPatch,
  hasModelConfigTargetRef,
  readModelConfigTargetRef,
  selectRequirementDescriptors,
  summarizeTargetRef,
} from './target-ref.js';

export {
  summarizeAiModelAggregate,
} from './aggregate.js';

export type {
  ModelConfigProfileControllerCore,
} from './profile-controller-core.js';
export {
  createModelConfigProfileControllerCore,
  summarizeProfilePreview,
} from './profile-controller-core.js';
