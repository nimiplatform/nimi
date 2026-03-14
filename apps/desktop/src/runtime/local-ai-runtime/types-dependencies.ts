import type { LocalAiModelRecord, LocalAiServiceDescriptor } from './types';

export type LocalAiExecutionEntryKind = 'model' | 'service' | 'node';

export type LocalAiExecutionOptionDescriptor = {
  entryId: string;
  kind: LocalAiExecutionEntryKind;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  title?: string;
  modelId?: string;
  repo?: string;
  serviceId?: string;
  nodeId?: string;
  engine?: string;
};

export type LocalAiExecutionAlternativeDescriptor = {
  alternativeId: string;
  preferredEntryId?: string;
  options: LocalAiExecutionOptionDescriptor[];
};

export type LocalAiExecutionDeclarationDescriptor = {
  required?: LocalAiExecutionOptionDescriptor[];
  optional?: LocalAiExecutionOptionDescriptor[];
  alternatives?: LocalAiExecutionAlternativeDescriptor[];
  preferred?: Partial<Record<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding', string>>;
};

export type LocalAiExecutionEntryDescriptor = {
  entryId: string;
  kind: LocalAiExecutionEntryKind;
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
  entryId?: string;
  target: string;
  check: string;
  ok: boolean;
  reasonCode: string;
  detail: string;
};

export type LocalAiExecutionSelectionRationale = {
  entryId: string;
  selected: boolean;
  reasonCode: string;
  detail: string;
};

export type LocalAiExecutionStageResult = {
  stage: string;
  ok: boolean;
  reasonCode?: string;
  detail?: string;
};

export type LocalAiExecutionPlan = {
  planId: string;
  modId: string;
  capability?: string;
  deviceProfile: LocalAiDeviceProfile;
  entries: LocalAiExecutionEntryDescriptor[];
  selectionRationale: LocalAiExecutionSelectionRationale[];
  preflightDecisions: LocalAiPreflightDecision[];
  warnings: string[];
  reasonCode?: string;
};

export type LocalAiExecutionApplyResult = {
  planId: string;
  modId: string;
  entries: LocalAiExecutionEntryDescriptor[];
  installedModels: LocalAiModelRecord[];
  services: LocalAiServiceDescriptor[];
  capabilities: string[];
  stageResults: LocalAiExecutionStageResult[];
  preflightDecisions: LocalAiPreflightDecision[];
  rollbackApplied: boolean;
  warnings: string[];
  reasonCode?: string;
};
