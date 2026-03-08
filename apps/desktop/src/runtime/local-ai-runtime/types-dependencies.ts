import type { LocalAiModelRecord, LocalAiServiceDescriptor } from './types';

export type LocalAiDependencyKind = 'model' | 'service' | 'node';

export type LocalAiDependencyOptionDescriptor = {
  dependencyId: string;
  kind: LocalAiDependencyKind;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  title?: string;
  modelId?: string;
  repo?: string;
  serviceId?: string;
  nodeId?: string;
  engine?: string;
};

export type LocalAiDependencyAlternativeDescriptor = {
  alternativeId: string;
  preferredDependencyId?: string;
  options: LocalAiDependencyOptionDescriptor[];
};

export type LocalAiDependenciesDeclarationDescriptor = {
  required?: LocalAiDependencyOptionDescriptor[];
  optional?: LocalAiDependencyOptionDescriptor[];
  alternatives?: LocalAiDependencyAlternativeDescriptor[];
  preferred?: Partial<Record<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding', string>>;
};

export type LocalAiDependencyDescriptor = {
  dependencyId: string;
  kind: LocalAiDependencyKind;
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

export type LocalAiGpuProfile = {
  available: boolean;
  vendor?: string;
  model?: string;
};

export type LocalAiPythonProfile = {
  available: boolean;
  version?: string;
};

export type LocalAiNpuProfile = {
  available: boolean;
  ready: boolean;
  vendor?: string;
  runtime?: string;
  detail?: string;
};

export type LocalAiPortAvailability = {
  port: number;
  available: boolean;
};

export type LocalAiDeviceProfile = {
  os: string;
  arch: string;
  gpu: LocalAiGpuProfile;
  python: LocalAiPythonProfile;
  npu: LocalAiNpuProfile;
  diskFreeBytes: number;
  ports: LocalAiPortAvailability[];
};

export type LocalAiPreflightDecision = {
  dependencyId?: string;
  target: string;
  check: string;
  ok: boolean;
  reasonCode: string;
  detail: string;
};

export type LocalAiDependencySelectionRationale = {
  dependencyId: string;
  selected: boolean;
  reasonCode: string;
  detail: string;
};

export type LocalAiDependencyApplyStageResult = {
  stage: string;
  ok: boolean;
  reasonCode?: string;
  detail?: string;
};

export type LocalAiDependencyResolutionPlan = {
  planId: string;
  modId: string;
  capability?: string;
  deviceProfile: LocalAiDeviceProfile;
  dependencies: LocalAiDependencyDescriptor[];
  selectionRationale: LocalAiDependencySelectionRationale[];
  preflightDecisions: LocalAiPreflightDecision[];
  warnings: string[];
  reasonCode?: string;
};

export type LocalAiDependencyApplyResult = {
  planId: string;
  modId: string;
  dependencies: LocalAiDependencyDescriptor[];
  installedModels: LocalAiModelRecord[];
  services: LocalAiServiceDescriptor[];
  capabilities: string[];
  stageResults: LocalAiDependencyApplyStageResult[];
  preflightDecisions: LocalAiPreflightDecision[];
  rollbackApplied: boolean;
  warnings: string[];
  reasonCode?: string;
};
