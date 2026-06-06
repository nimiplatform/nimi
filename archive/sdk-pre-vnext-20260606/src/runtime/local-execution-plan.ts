import { asRecord } from '../internal/utils.js';
import type { LocalRuntimeRunnableAssetKindId } from './local-asset-kind.js';

export type LocalRuntimeExecutionEntryKind = 'asset' | 'service' | 'node';

export type LocalRuntimeExecutionOptionDescriptor = {
  entryId: string;
  kind: LocalRuntimeExecutionEntryKind;
  capability?: LocalRuntimeRunnableAssetKindId | string;
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
  preferred?: Partial<Record<LocalRuntimeRunnableAssetKindId, string>>;
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
  targetId: string;
  capability?: string;
  deviceProfile: LocalRuntimeDeviceProfile;
  entries: LocalRuntimeExecutionEntryDescriptor[];
  selectionRationale: LocalRuntimeExecutionSelectionRationale[];
  preflightDecisions: LocalRuntimePreflightDecision[];
  warnings: string[];
  reasonCode?: string;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeLocalRuntimeExecutionEntryKind(
  value: unknown,
): LocalRuntimeExecutionEntryKind {
  if (typeof value === 'number') {
    if (value === 2) return 'service';
    if (value === 3) return 'node';
    return 'asset';
  }
  const raw = asString(value).toLowerCase();
  if (raw === 'local_execution_entry_kind_service' || raw === '2') return 'service';
  if (raw === 'local_execution_entry_kind_node' || raw === '3') return 'node';
  if (raw === 'service' || raw === 'node') {
    return raw;
  }
  return 'asset';
}

export const normalizeExecutionEntryKind = normalizeLocalRuntimeExecutionEntryKind;

export function parseLocalRuntimeExecutionEntryDescriptor(
  value: unknown,
): LocalRuntimeExecutionEntryDescriptor {
  const record = asRecord(value);
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    entryId: asString(record.entryId),
    kind: normalizeLocalRuntimeExecutionEntryKind(record.kind),
    capability: asString(record.capability) || undefined,
    required: Boolean(record.required),
    selected: Boolean(record.selected),
    preferred: Boolean(record.preferred),
    modelId: asString(record.assetId) || undefined,
    repo: asString(record.repo) || undefined,
    engine: asString(record.engine) || undefined,
    serviceId: asString(record.serviceId) || undefined,
    nodeId: asString(record.nodeId) || undefined,
    reasonCode: asString(record.reasonCode) || undefined,
    warnings,
  };
}

export const parseExecutionEntryDescriptor = parseLocalRuntimeExecutionEntryDescriptor;

export function parseLocalRuntimeDeviceProfile(value: unknown): LocalRuntimeDeviceProfile {
  const record = asRecord(value);
  const gpu = asRecord(record.gpu);
  const python = asRecord(record.python);
  const npu = asRecord(record.npu);
  const portsRaw = Array.isArray(record.ports) ? record.ports : [];
  const diskFreeBytes = Number(record.diskFreeBytes);
  const totalRamBytes = Number(record.totalRamBytes);
  const availableRamBytes = Number(record.availableRamBytes);
  return {
    os: asString(record.os) || 'unknown',
    arch: asString(record.arch) || 'unknown',
    totalRamBytes: Number.isFinite(totalRamBytes) && totalRamBytes >= 0 ? totalRamBytes : 0,
    availableRamBytes: Number.isFinite(availableRamBytes) && availableRamBytes >= 0 ? availableRamBytes : 0,
    gpu: {
      available: Boolean(gpu.available),
      vendor: asString(gpu.vendor) || undefined,
      model: asString(gpu.model) || undefined,
      totalVramBytes: typeof gpu.totalVramBytes === 'number' ? gpu.totalVramBytes : undefined,
      availableVramBytes: typeof gpu.availableVramBytes === 'number' ? gpu.availableVramBytes : undefined,
      memoryModel: (asString(gpu.memoryModel) as 'discrete' | 'unified' | 'unknown') || 'unknown',
    },
    python: {
      available: Boolean(python.available),
      version: asString(python.version) || undefined,
    },
    npu: {
      available: Boolean(npu.available),
      ready: Boolean(npu.ready),
      vendor: asString(npu.vendor) || undefined,
      runtime: asString(npu.runtime) || undefined,
      detail: asString(npu.detail) || undefined,
    },
    diskFreeBytes: Number.isFinite(diskFreeBytes) && diskFreeBytes >= 0 ? diskFreeBytes : 0,
    ports: portsRaw.map((item) => {
      const portRow = asRecord(item);
      const port = Number(portRow.port);
      return {
        port: Number.isFinite(port) && port > 0 ? Math.floor(port) : 0,
        available: Boolean(portRow.available),
      };
    }).filter((item) => item.port > 0),
  };
}

export const parseDeviceProfile = parseLocalRuntimeDeviceProfile;

export function parseLocalRuntimePreflightDecision(
  value: unknown,
): LocalRuntimePreflightDecision {
  const record = asRecord(value);
  return {
    entryId: asString(record.entryId) || undefined,
    target: asString(record.target),
    check: asString(record.check),
    ok: Boolean(record.ok),
    reasonCode: asString(record.reasonCode),
    detail: asString(record.detail),
  };
}

export const parsePreflightDecision = parseLocalRuntimePreflightDecision;

export function parseLocalRuntimeExecutionSelectionRationale(
  value: unknown,
): LocalRuntimeExecutionSelectionRationale {
  const record = asRecord(value);
  return {
    entryId: asString(record.entryId),
    selected: Boolean(record.selected),
    reasonCode: asString(record.reasonCode),
    detail: asString(record.detail),
  };
}

export const parseExecutionSelectionRationale = parseLocalRuntimeExecutionSelectionRationale;

export function parseLocalRuntimeExecutionStageResult(
  value: unknown,
): LocalRuntimeExecutionStageResult {
  const record = asRecord(value);
  return {
    stage: asString(record.stage),
    ok: Boolean(record.ok),
    reasonCode: asString(record.reasonCode) || undefined,
    detail: asString(record.detail) || undefined,
  };
}

export const parseExecutionStageResult = parseLocalRuntimeExecutionStageResult;

export function parseLocalRuntimeExecutionPlan(value: unknown): LocalRuntimeExecutionPlan {
  const record = asRecord(value);
  const entries = Array.isArray(record.entries)
    ? record.entries.map((item) => parseLocalRuntimeExecutionEntryDescriptor(item))
    : [];
  const selectionRationale = Array.isArray(record.selectionRationale)
    ? record.selectionRationale.map((item) => parseLocalRuntimeExecutionSelectionRationale(item))
    : [];
  const preflightDecisions = Array.isArray(record.preflightDecisions)
    ? record.preflightDecisions.map((item) => parseLocalRuntimePreflightDecision(item))
    : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    planId: asString(record.planId),
    targetId: asString(record.targetId),
    capability: asString(record.capability) || undefined,
    deviceProfile: parseLocalRuntimeDeviceProfile(record.deviceProfile),
    entries,
    selectionRationale,
    preflightDecisions,
    warnings,
    reasonCode: asString(record.reasonCode) || undefined,
  };
}

export const parseExecutionPlan = parseLocalRuntimeExecutionPlan;
