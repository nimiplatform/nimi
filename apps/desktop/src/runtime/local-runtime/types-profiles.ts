import type {
  LocalRuntimeAssetKind,
  LocalRuntimeAssetRecord,
} from './types';
import type {
  LocalRuntimeExecutionDeclarationDescriptor,
  LocalRuntimeExecutionApplyResult,
  LocalRuntimeExecutionPlan,
  LocalRuntimeDeviceProfile,
} from './types-dependencies';

export type LocalRuntimeProfileEntryKind = 'asset' | 'service' | 'node';
export type LocalRuntimeProfileEntryOverride = {
  entryId: string;
  localAssetId: string;
};

export type LocalRuntimeProfileRequirementDescriptor = {
  minGpuMemoryGb?: number;
  minDiskBytes?: number;
  platforms?: string[];
  notes?: string[];
};

export type LocalRuntimeProfileEntryDescriptor = {
  entryId: string;
  kind: LocalRuntimeProfileEntryKind;
  title?: string;
  description?: string;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  required?: boolean;
  preferred?: boolean;
  assetId?: string;
  assetKind?: LocalRuntimeAssetKind;
  engineSlot?: string;
  repo?: string;
  serviceId?: string;
  nodeId?: string;
  engine?: string;
  templateId?: string;
  revision?: string;
  tags?: string[];
};

export type LocalRuntimeProfileDescriptor = {
  id: string;
  title: string;
  description?: string;
  recommended: boolean;
  consumeCapabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string>;
  entries: LocalRuntimeProfileEntryDescriptor[];
  requirements?: LocalRuntimeProfileRequirementDescriptor;
};

export type LocalRuntimeProfileTargetDescriptor = {
  modId: string;
  modName: string;
  consumeCapabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string>;
  profiles: LocalRuntimeProfileDescriptor[];
};

export type LocalRuntimeProfileResolutionPlan = {
  planId: string;
  modId: string;
  profileId: string;
  title: string;
  description?: string;
  recommended: boolean;
  consumeCapabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string>;
  requirements?: LocalRuntimeProfileRequirementDescriptor;
  executionPlan: LocalRuntimeExecutionPlan;
  assetEntries: LocalRuntimeProfileEntryDescriptor[];
  warnings: string[];
  reasonCode?: string;
};

export type LocalRuntimeProfileApplyResult = {
  planId: string;
  modId: string;
  profileId: string;
  executionResult: LocalRuntimeExecutionApplyResult;
  installedAssets: LocalRuntimeAssetRecord[];
  warnings: string[];
  reasonCode?: string;
};

export type LocalRuntimeProfileInstallStatus = {
  modId: string;
  profileId: string;
  status: 'ready' | 'missing' | 'degraded';
  warnings: string[];
  missingEntries: string[];
  updatedAt: string;
};

export type LocalRuntimeProfileResolvePayload = {
  modId: string;
  profile: LocalRuntimeProfileDescriptor;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  deviceProfile?: LocalRuntimeDeviceProfile;
  entryOverrides?: LocalRuntimeProfileEntryOverride[];
};

export type LocalRuntimeProfileInstallRequest = {
  modId: string;
  profileId: string;
  confirmMessage?: string;
  entryOverrides?: LocalRuntimeProfileEntryOverride[];
};

export type LocalRuntimeProfileInstallRequestResult = {
  modId: string;
  profileId: string;
  accepted: boolean;
  declined: boolean;
  plan?: LocalRuntimeProfileResolutionPlan;
  result?: LocalRuntimeProfileApplyResult;
  reasonCode?: string;
};

export type LocalRuntimeProfileExecutionBridge = {
  runtimeEntries?: LocalRuntimeExecutionDeclarationDescriptor;
  assets: LocalRuntimeProfileEntryDescriptor[];
};
