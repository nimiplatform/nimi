import type {
  LocalAiArtifactKind,
  LocalAiArtifactRecord,
} from './types';
import type {
  LocalAiExecutionDeclarationDescriptor,
  LocalAiExecutionApplyResult,
  LocalAiExecutionPlan,
  LocalAiDeviceProfile,
} from './types-dependencies';

export type LocalAiProfileEntryKind = 'model' | 'artifact' | 'service' | 'node';

export type LocalAiProfileRequirementDescriptor = {
  minGpuMemoryGb?: number;
  minDiskBytes?: number;
  platforms?: string[];
  notes?: string[];
};

export type LocalAiProfileEntryDescriptor = {
  entryId: string;
  kind: LocalAiProfileEntryKind;
  title?: string;
  description?: string;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  required?: boolean;
  preferred?: boolean;
  modelId?: string;
  repo?: string;
  serviceId?: string;
  nodeId?: string;
  engine?: string;
  artifactId?: string;
  artifactKind?: LocalAiArtifactKind;
  templateId?: string;
  revision?: string;
  tags?: string[];
};

export type LocalAiProfileDescriptor = {
  id: string;
  title: string;
  description?: string;
  recommended: boolean;
  consumeCapabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string>;
  entries: LocalAiProfileEntryDescriptor[];
  requirements?: LocalAiProfileRequirementDescriptor;
};

export type LocalAiProfileTargetDescriptor = {
  modId: string;
  modName: string;
  consumeCapabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string>;
  profiles: LocalAiProfileDescriptor[];
};

export type LocalAiProfileArtifactPlanEntry = LocalAiProfileEntryDescriptor & {
  kind: 'artifact';
  installed: boolean;
};

export type LocalAiProfileResolutionPlan = {
  planId: string;
  modId: string;
  profileId: string;
  title: string;
  description?: string;
  recommended: boolean;
  consumeCapabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string>;
  requirements?: LocalAiProfileRequirementDescriptor;
  executionPlan: LocalAiExecutionPlan;
  artifactEntries: LocalAiProfileArtifactPlanEntry[];
  warnings: string[];
  reasonCode?: string;
};

export type LocalAiProfileApplyResult = {
  planId: string;
  modId: string;
  profileId: string;
  executionResult: LocalAiExecutionApplyResult;
  installedArtifacts: LocalAiArtifactRecord[];
  warnings: string[];
  reasonCode?: string;
};

export type LocalAiProfileInstallStatus = {
  modId: string;
  profileId: string;
  status: 'ready' | 'missing' | 'degraded';
  warnings: string[];
  missingEntries: string[];
  updatedAt: string;
};

export type LocalAiProfileResolvePayload = {
  modId: string;
  profile: LocalAiProfileDescriptor;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  deviceProfile?: LocalAiDeviceProfile;
};

export type LocalAiProfileInstallRequest = {
  modId: string;
  profileId: string;
  confirmMessage?: string;
};

export type LocalAiProfileInstallRequestResult = {
  modId: string;
  profileId: string;
  accepted: boolean;
  declined: boolean;
  plan?: LocalAiProfileResolutionPlan;
  result?: LocalAiProfileApplyResult;
  reasonCode?: string;
};

export type LocalAiProfileExecutionBridge = {
  runtimeEntries?: LocalAiExecutionDeclarationDescriptor;
  artifacts: LocalAiProfileEntryDescriptor[];
};
