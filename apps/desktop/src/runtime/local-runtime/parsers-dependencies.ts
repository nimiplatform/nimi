import type {
  LocalRuntimeExecutionEntryKind,
  LocalRuntimeExecutionEntryDescriptor,
  LocalRuntimeDeviceProfile,
  LocalRuntimePreflightDecision,
  LocalRuntimeExecutionSelectionRationale,
  LocalRuntimeExecutionStageResult,
  LocalRuntimeExecutionPlan,
} from './types';
import { asRecord, asString } from './parser-primitives';

export function normalizeExecutionEntryKind(value: unknown): LocalRuntimeExecutionEntryKind {
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

export function parseExecutionEntryDescriptor(value: unknown): LocalRuntimeExecutionEntryDescriptor {
  const record = asRecord(value);
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    entryId: asString(record.entryId),
    kind: normalizeExecutionEntryKind(record.kind),
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

export function parseDeviceProfile(value: unknown): LocalRuntimeDeviceProfile {
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

export function parsePreflightDecision(value: unknown): LocalRuntimePreflightDecision {
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

export function parseExecutionSelectionRationale(value: unknown): LocalRuntimeExecutionSelectionRationale {
  const record = asRecord(value);
  return {
    entryId: asString(record.entryId),
    selected: Boolean(record.selected),
    reasonCode: asString(record.reasonCode),
    detail: asString(record.detail),
  };
}

export function parseExecutionStageResult(value: unknown): LocalRuntimeExecutionStageResult {
  const record = asRecord(value);
  return {
    stage: asString(record.stage),
    ok: Boolean(record.ok),
    reasonCode: asString(record.reasonCode) || undefined,
    detail: asString(record.detail) || undefined,
  };
}

export function parseExecutionPlan(value: unknown): LocalRuntimeExecutionPlan {
  const record = asRecord(value);
  const entries = Array.isArray(record.entries)
    ? record.entries.map((item) => parseExecutionEntryDescriptor(item))
    : [];
  const selectionRationale = Array.isArray(record.selectionRationale)
    ? record.selectionRationale.map((item) => parseExecutionSelectionRationale(item))
    : [];
  const preflightDecisions = Array.isArray(record.preflightDecisions)
    ? record.preflightDecisions.map((item) => parsePreflightDecision(item))
    : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    planId: asString(record.planId),
    modId: asString(record.modId),
    capability: asString(record.capability) || undefined,
    deviceProfile: parseDeviceProfile(record.deviceProfile),
    entries,
    selectionRationale,
    preflightDecisions,
    warnings,
    reasonCode: asString(record.reasonCode) || undefined,
  };
}
