import type { LocalRuntimeAssetRecord, LocalRuntimeServiceDescriptor } from './types';

export type LocalRuntimeExecutionEntryKind = 'asset' | 'service' | 'node';

export type LocalRuntimeExecutionOptionDescriptor = {
  entryId: string;
  kind: LocalRuntimeExecutionEntryKind;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  title?: string;
  assetId?: string;
  repo?: string;
  serviceId?: string;
  nodeId?: string;
  engine?: string;
};

export type LocalRuntimeExecutionAlternativeDescriptor = {
  alternativeId: string;
  preferredEntryId?: string;
  options: LocalRuntimeExecutionOptionDescriptor[];
};

export type LocalRuntimeExecutionDeclarationDescriptor = {
  required?: LocalRuntimeExecutionOptionDescriptor[];
  optional?: LocalRuntimeExecutionOptionDescriptor[];
  alternatives?: LocalRuntimeExecutionAlternativeDescriptor[];
  preferred?: Partial<Record<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding', string>>;
};

export type LocalRuntimeExecutionEntryDescriptor = {
  entryId: string;
  kind: LocalRuntimeExecutionEntryKind;
  capability?: string;
  required: boolean;
  selected: boolean;
  preferred: boolean;
  modelId?: string;
  repo?: string;
  engine?: string;
  serviceId?: string;
  nodeId?: string;
  reasonCode?: string;
  warnings: string[];
};

export type LocalRuntimeGpuProfile = {
  available: boolean;
  vendor?: string;
  model?: string;
  totalVramBytes?: number;
  availableVramBytes?: number;
  memoryModel?: 'discrete' | 'unified' | 'unknown';
};

export type LocalRuntimePythonProfile = {
  available: boolean;
  version?: string;
};

export type LocalRuntimeNpuProfile = {
  available: boolean;
  ready: boolean;
  vendor?: string;
  runtime?: string;
  detail?: string;
};

export type LocalRuntimePortAvailability = {
  port: number;
  available: boolean;
};

export type LocalRuntimeDeviceProfile = {
  os: string;
  arch: string;
  totalRamBytes: number;
  availableRamBytes: number;
  gpu: LocalRuntimeGpuProfile;
  python: LocalRuntimePythonProfile;
  npu: LocalRuntimeNpuProfile;
  diskFreeBytes: number;
  ports: LocalRuntimePortAvailability[];
};

export type LocalRuntimePreflightDecision = {
  entryId?: string;
  target: string;
  check: string;
  ok: boolean;
  reasonCode: string;
  detail: string;
};

export type LocalRuntimeExecutionSelectionRationale = {
  entryId: string;
  selected: boolean;
  reasonCode: string;
  detail: string;
};

export type LocalRuntimeExecutionStageResult = {
  stage: string;
  ok: boolean;
  reasonCode?: string;
  detail?: string;
};

export type LocalRuntimeExecutionPlan = {
  planId: string;
  modId: string;
  capability?: string;
  deviceProfile: LocalRuntimeDeviceProfile;
  entries: LocalRuntimeExecutionEntryDescriptor[];
  selectionRationale: LocalRuntimeExecutionSelectionRationale[];
  preflightDecisions: LocalRuntimePreflightDecision[];
  warnings: string[];
  reasonCode?: string;
};

export type LocalRuntimeExecutionApplyResult = {
  planId: string;
  modId: string;
  entries: LocalRuntimeExecutionEntryDescriptor[];
  installedAssets: LocalRuntimeAssetRecord[];
  services: LocalRuntimeServiceDescriptor[];
  capabilities: string[];
  stageResults: LocalRuntimeExecutionStageResult[];
  preflightDecisions: LocalRuntimePreflightDecision[];
  rollbackApplied: boolean;
  warnings: string[];
  reasonCode?: string;
};
