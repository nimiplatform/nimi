import type { LocalRuntimeAssetRecord } from './types.js';
import type {
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileEntryDescriptor,
  LocalRuntimeProfileEntryKind,
  LocalRuntimeProfileEntryOverride,
  LocalRuntimeProfileExecutionBridge,
  LocalRuntimeProfileRequirementDescriptor,
  LocalRuntimeProfileTargetDescriptor,
} from '../local-profile-manifest.js';
import type {
  LocalRuntimeRunnableAssetKindId,
} from '../local-asset-kind.js';
import type {
  LocalRuntimeExecutionApplyResult,
  LocalRuntimeExecutionPlan,
  LocalRuntimeDeviceProfile,
} from './types-dependencies.js';

export type {
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileEntryDescriptor,
  LocalRuntimeProfileEntryKind,
  LocalRuntimeProfileEntryOverride,
  LocalRuntimeProfileExecutionBridge,
  LocalRuntimeProfileRequirementDescriptor,
  LocalRuntimeProfileTargetDescriptor,
};

export type LocalRuntimeProfileResolutionPlan = {
  planId: string;
  targetId: string;
  profileId: string;
  title: string;
  description?: string;
  recommended: boolean;
  consumeCapabilities: Array<LocalRuntimeRunnableAssetKindId | string>;
  requirements?: LocalRuntimeProfileRequirementDescriptor;
  executionPlan: LocalRuntimeExecutionPlan;
  assetEntries: LocalRuntimeProfileEntryDescriptor[];
  warnings: string[];
  reasonCode?: string;
};

export type LocalRuntimeProfileApplyResult = {
  planId: string;
  targetId: string;
  profileId: string;
  executionResult: LocalRuntimeExecutionApplyResult;
  installedAssets: LocalRuntimeAssetRecord[];
  warnings: string[];
  reasonCode?: string;
};

export type LocalRuntimeProfileResolvePayload = {
  targetId: string;
  profile: LocalRuntimeProfileDescriptor;
  capability?: LocalRuntimeRunnableAssetKindId | string;
  deviceProfile?: LocalRuntimeDeviceProfile;
  entryOverrides?: LocalRuntimeProfileEntryOverride[];
};

export type LocalRuntimeProfileInstallRequest = {
  targetId: string;
  profileId: string;
  confirmMessage?: string;
  entryOverrides?: LocalRuntimeProfileEntryOverride[];
};

export type LocalRuntimeProfileInstallRequestResult = {
  targetId: string;
  profileId: string;
  accepted: boolean;
  declined: boolean;
  plan?: LocalRuntimeProfileResolutionPlan;
  result?: LocalRuntimeProfileApplyResult;
  reasonCode?: string;
};
