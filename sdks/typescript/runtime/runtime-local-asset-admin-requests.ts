import {
  LocalExecutionEntryKind,
  type LocalDeviceProfile as GeneratedLocalDeviceProfile,
  type LocalExecutionPlan as GeneratedLocalExecutionPlan,
  type LocalInstallPlanDescriptor as GeneratedLocalInstallPlanDescriptor,
  type LocalProfileDescriptor as GeneratedLocalProfileDescriptor,
  type LocalProfileEntryDescriptor as GeneratedLocalProfileEntryDescriptor,
  type LocalProfileResolutionPlan as GeneratedLocalProfileResolutionPlan,
  type ProfileEntryOverride,
} from '../core-generated/runtime-typed-client';
import { toNimiRuntimeProtoStruct } from './runtime-agent-values';
import {
  toNimiRuntimeLocalAssetKindRequestValue,
  toNimiRuntimeLocalEngineRuntimeModeRequestValue,
  toNimiRuntimeLocalGpuMemoryModelRequestValue,
  toNimiRuntimeLocalProfileEntryKindRequestValue,
} from './local-asset-vocabulary';
import type {
  NimiRuntimeLocalDeviceProfile,
  NimiRuntimeLocalExecutionPlan,
  NimiRuntimeLocalInstallPlanDescriptor,
  NimiRuntimeLocalProfileResolutionPlan,
} from './runtime-local-asset-admin-types';
import type {
  NimiRuntimeLocalProfileDescriptor,
  NimiRuntimeLocalProfileEntryDescriptor,
  NimiRuntimeLocalProfileEntryOverride,
} from './runtime-local-profile-manifest';
import {
  int64String,
  normalizeText,
  parseNimiRuntimeLocalExecutionEntryKind,
  stringRecord,
  textList,
  toCanonicalNimiRuntimeLocalAssetId,
} from './runtime-local-asset-admin-values';

export function toGeneratedNimiRuntimeLocalInstallPlan(
  plan: NimiRuntimeLocalInstallPlanDescriptor,
): GeneratedLocalInstallPlanDescriptor {
  return {
    planId: normalizeText(plan.planId),
    itemId: normalizeText(plan.itemId),
    source: normalizeText(plan.source),
    templateId: normalizeText(plan.templateId),
    modelId: normalizeText(plan.modelId),
    repo: normalizeText(plan.repo),
    revision: normalizeText(plan.revision),
    capabilities: textList(plan.capabilities),
    engine: normalizeText(plan.engine),
    engineRuntimeMode: toNimiRuntimeLocalEngineRuntimeModeRequestValue(plan.engineRuntimeMode),
    installKind: normalizeText(plan.installKind),
    installAvailable: Boolean(plan.installAvailable),
    endpoint: normalizeText(plan.endpoint),
    providerHints: undefined,
    entry: normalizeText(plan.entry),
    files: textList(plan.files),
    license: normalizeText(plan.license),
    hashes: stringRecord(plan.hashes),
    warnings: textList(plan.warnings),
    reasonCode: normalizeText(plan.reasonCode),
    engineConfig: plan.engineConfig ? toNimiRuntimeProtoStruct(plan.engineConfig) : undefined,
  };
}

export function toGeneratedNimiRuntimeLocalProfileDescriptor(
  profile: NimiRuntimeLocalProfileDescriptor,
): GeneratedLocalProfileDescriptor {
  return {
    id: normalizeText(profile.id),
    title: normalizeText(profile.title),
    description: normalizeText(profile.description),
    recommended: Boolean(profile.recommended),
    consumeCapabilities: textList(profile.consumeCapabilities),
    entries: profile.entries.map(toGeneratedNimiRuntimeLocalProfileEntryDescriptor),
    requirements: profile.requirements
      ? {
        minGpuMemoryGb: Number(profile.requirements.minGpuMemoryGb || 0),
        minDiskBytes: int64String(profile.requirements.minDiskBytes),
        platforms: textList(profile.requirements.platforms),
        notes: textList(profile.requirements.notes),
      }
      : undefined,
  };
}

function toGeneratedNimiRuntimeLocalProfileEntryDescriptor(
  entry: NimiRuntimeLocalProfileEntryDescriptor,
): GeneratedLocalProfileEntryDescriptor {
  return {
    entryId: normalizeText(entry.entryId),
    kind: toNimiRuntimeLocalProfileEntryKindRequestValue(entry.kind),
    title: normalizeText(entry.title),
    description: normalizeText(entry.description),
    capability: normalizeText(entry.capability),
    required: entry.required,
    preferred: entry.preferred,
    repo: normalizeText(entry.repo),
    serviceId: normalizeText(entry.serviceId),
    nodeId: normalizeText(entry.nodeId),
    engine: normalizeText(entry.engine),
    templateId: normalizeText(entry.templateId),
    revision: normalizeText(entry.revision),
    tags: textList(entry.tags),
    assetId: toCanonicalNimiRuntimeLocalAssetId(entry.assetId),
    assetKind: toNimiRuntimeLocalAssetKindRequestValue(entry.assetKind),
    engineSlot: normalizeText(entry.engineSlot),
  };
}

export function toGeneratedNimiRuntimeLocalProfileEntryOverride(
  entry: NimiRuntimeLocalProfileEntryOverride,
): ProfileEntryOverride {
  return {
    entryId: normalizeText(entry.entryId),
    localAssetId: normalizeText(entry.localAssetId),
  };
}

export function toGeneratedNimiRuntimeLocalProfileResolutionPlan(
  plan: NimiRuntimeLocalProfileResolutionPlan,
): GeneratedLocalProfileResolutionPlan {
  return {
    planId: normalizeText(plan.planId),
    targetId: normalizeText(plan.targetId),
    profileId: normalizeText(plan.profileId),
    title: normalizeText(plan.title),
    description: normalizeText(plan.description),
    recommended: Boolean(plan.recommended),
    consumeCapabilities: textList(plan.consumeCapabilities),
    requirements: plan.requirements
      ? {
        minGpuMemoryGb: Number(plan.requirements.minGpuMemoryGb || 0),
        minDiskBytes: int64String(plan.requirements.minDiskBytes),
        platforms: textList(plan.requirements.platforms),
        notes: textList(plan.requirements.notes),
      }
      : undefined,
    executionPlan: toGeneratedNimiRuntimeLocalExecutionPlan(plan.executionPlan),
    warnings: textList(plan.warnings),
    reasonCode: normalizeText(plan.reasonCode),
  };
}

function toGeneratedNimiRuntimeLocalExecutionPlan(
  plan: NimiRuntimeLocalExecutionPlan,
): GeneratedLocalExecutionPlan {
  return {
    planId: normalizeText(plan.planId),
    targetId: normalizeText(plan.targetId),
    capability: normalizeText(plan.capability),
    deviceProfile: toGeneratedNimiRuntimeLocalDeviceProfile(plan.deviceProfile),
    entries: plan.entries.map((entry) => ({
      entryId: normalizeText(entry.entryId),
      kind: toGeneratedNimiRuntimeLocalExecutionEntryKind(entry.kind),
      capability: normalizeText(entry.capability),
      required: Boolean(entry.required),
      selected: Boolean(entry.selected),
      preferred: Boolean(entry.preferred),
      modelId: normalizeText(entry.modelId),
      repo: normalizeText(entry.repo),
      engine: normalizeText(entry.engine),
      serviceId: normalizeText(entry.serviceId),
      nodeId: normalizeText(entry.nodeId),
      reasonCode: normalizeText(entry.reasonCode),
      warnings: textList(entry.warnings),
    })),
    selectionRationale: [],
    preflightDecisions: plan.preflightDecisions.map((decision) => ({
      entryId: normalizeText(decision.entryId),
      target: normalizeText(decision.target),
      check: normalizeText(decision.check),
      ok: Boolean(decision.ok),
      reasonCode: normalizeText(decision.reasonCode),
      detail: normalizeText(decision.detail),
    })),
    warnings: textList(plan.warnings),
    reasonCode: normalizeText(plan.reasonCode),
  };
}

export function toGeneratedNimiRuntimeLocalDeviceProfile(
  profile: NimiRuntimeLocalDeviceProfile,
): GeneratedLocalDeviceProfile {
  return {
    os: normalizeText(profile.os),
    arch: normalizeText(profile.arch),
    totalRamBytes: int64String(profile.totalRamBytes),
    availableRamBytes: int64String(profile.availableRamBytes),
    diskFreeBytes: int64String(profile.diskFreeBytes),
    ports: profile.ports.map((port) => ({
      port: Math.trunc(Number(port.port) || 0),
      available: Boolean(port.available),
    })),
    gpu: {
      available: Boolean(profile.gpu.available),
      vendor: normalizeText(profile.gpu.vendor),
      model: normalizeText(profile.gpu.model),
      totalVramBytes: int64String(profile.gpu.totalVramBytes),
      availableVramBytes: int64String(profile.gpu.availableVramBytes),
      memoryModel: toNimiRuntimeLocalGpuMemoryModelRequestValue(profile.gpu.memoryModel),
    },
    python: {
      available: Boolean(profile.python.available),
      version: normalizeText(profile.python.version),
    },
    npu: {
      available: Boolean(profile.npu.available),
      ready: Boolean(profile.npu.ready),
      vendor: normalizeText(profile.npu.vendor),
      runtime: normalizeText(profile.npu.runtime),
      detail: normalizeText(profile.npu.detail),
    },
  };
}

function toGeneratedNimiRuntimeLocalExecutionEntryKind(value: unknown): LocalExecutionEntryKind {
  const parsed = parseNimiRuntimeLocalExecutionEntryKind(value);
  if (parsed === 'model') return LocalExecutionEntryKind.MODEL;
  if (parsed === 'service') return LocalExecutionEntryKind.SERVICE;
  if (parsed === 'node') return LocalExecutionEntryKind.NODE;
  return LocalExecutionEntryKind.UNSPECIFIED;
}
