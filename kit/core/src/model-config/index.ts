// kit/core/model-config public entry.
// Pure-logic seam for the model-config feature; renderer-free and runtime-free.

export type {
  AppModelConfigSurface,
  AggregateCountsLabels,
  AggregateSummary,
  CapabilityEvaluation,
  CapabilityItemOverride,
  ModelConfigBindingSnapshot,
  ModelConfigI18nBinding,
  ModelConfigI18nFormatter,
  ModelConfigLocalAssetDescriptor,
  ModelConfigLocalAssetSource,
  ModelConfigProfileApplyPath,
  ModelConfigProfileCopyCore,
  ModelConfigProfileControllerCoreInput,
  ModelConfigProfileOption,
  ModelConfigProfileOriginRef,
  ModelConfigProjectionResolver,
  ModelConfigProjectionStatus,
  ModelConfigProviderResolver,
  ModelConfigRouteProviderHandle,
  ModelConfigRouteSource,
  ModelConfigStatusTone,
  ResolveApplyPathInput,
  ResolveApplyPathNetworkErrorInput,
  SharedAIConfigService,
  SharedAIConfigSubscribeListener,
  SharedAIConfigUnsubscribe,
  UserProfilesSource,
} from './types.js';

export {
  summarizeAiModelAggregate,
  selectEnabledDescriptors,
} from './aggregate.js';

export type {
  ModelConfigProfileControllerCore,
} from './profile-controller-core.js';
export {
  createModelConfigProfileControllerCore,
} from './profile-controller-core.js';
