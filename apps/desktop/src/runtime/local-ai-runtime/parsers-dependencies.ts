import type {
  LocalAiDependencyKind,
  LocalAiDependencyDescriptor,
  LocalAiDeviceProfile,
  LocalAiPreflightDecision,
  LocalAiDependencySelectionRationale,
  LocalAiDependencyApplyStageResult,
  LocalAiDependencyResolutionPlan,
} from './types';
import { asRecord, asString } from './parser-primitives';

export function normalizeDependencyKind(value: unknown): LocalAiDependencyKind {
  if (typeof value === 'number') {
    if (value === 2) return 'service';
    if (value === 3) return 'node';
    return 'model';
  }
  const raw = asString(value).toLowerCase();
  if (raw === 'local_dependency_kind_service' || raw === '2') return 'service';
  if (raw === 'local_dependency_kind_node' || raw === '3') return 'node';
  if (raw === 'service' || raw === 'node') {
    return raw;
  }
  return 'model';
}

export function parseDependencyDescriptor(value: unknown): LocalAiDependencyDescriptor {
  const record = asRecord(value);
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    dependencyId: asString(record.dependencyId),
    kind: normalizeDependencyKind(record.kind),
    capability: asString(record.capability) || undefined,
    required: Boolean(record.required),
    selected: Boolean(record.selected),
    preferred: Boolean(record.preferred),
    modelId: asString(record.modelId) || undefined,
    repo: asString(record.repo) || undefined,
    engine: asString(record.engine) || undefined,
    serviceId: asString(record.serviceId) || undefined,
    nodeId: asString(record.nodeId) || undefined,
    reasonCode: asString(record.reasonCode) || undefined,
    warnings,
  };
}

export function parseDeviceProfile(value: unknown): LocalAiDeviceProfile {
  const record = asRecord(value);
  const gpu = asRecord(record.gpu);
  const python = asRecord(record.python);
  const npu = asRecord(record.npu);
  const portsRaw = Array.isArray(record.ports) ? record.ports : [];
  const diskFreeBytes = Number(record.diskFreeBytes);
  return {
    os: asString(record.os) || 'unknown',
    arch: asString(record.arch) || 'unknown',
    gpu: {
      available: Boolean(gpu.available),
      vendor: asString(gpu.vendor) || undefined,
      model: asString(gpu.model) || undefined,
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

export function parsePreflightDecision(value: unknown): LocalAiPreflightDecision {
  const record = asRecord(value);
  return {
    dependencyId: asString(record.dependencyId) || undefined,
    target: asString(record.target),
    check: asString(record.check),
    ok: Boolean(record.ok),
    reasonCode: asString(record.reasonCode),
    detail: asString(record.detail),
  };
}

export function parseSelectionRationale(value: unknown): LocalAiDependencySelectionRationale {
  const record = asRecord(value);
  return {
    dependencyId: asString(record.dependencyId),
    selected: Boolean(record.selected),
    reasonCode: asString(record.reasonCode),
    detail: asString(record.detail),
  };
}

export function parseApplyStageResult(value: unknown): LocalAiDependencyApplyStageResult {
  const record = asRecord(value);
  return {
    stage: asString(record.stage),
    ok: Boolean(record.ok),
    reasonCode: asString(record.reasonCode) || undefined,
    detail: asString(record.detail) || undefined,
  };
}

export function parseDependencyResolutionPlan(value: unknown): LocalAiDependencyResolutionPlan {
  const record = asRecord(value);
  const dependencies = Array.isArray(record.dependencies)
    ? record.dependencies.map((item) => parseDependencyDescriptor(item))
    : [];
  const selectionRationale = Array.isArray(record.selectionRationale)
    ? record.selectionRationale.map((item) => parseSelectionRationale(item))
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
    dependencies,
    selectionRationale,
    preflightDecisions,
    warnings,
    reasonCode: asString(record.reasonCode) || undefined,
  };
}
