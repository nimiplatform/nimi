import { createNimiClientId } from '../core/ids.js';
import type { JsonObject } from '../internal/utils.js';
import {
  isLocalRuntimeRunnableAssetKindId,
  type LocalRuntimeRunnableAssetKindId,
} from './local-asset-kind.js';
import {
  normalizeLocalProviderAdapterId,
  type LocalProviderAdapterId,
  type LocalProviderHints,
} from './runtime-route-types.js';

export const RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT = '';

export type RuntimeConfigProviderStatus = 'idle' | 'healthy' | 'unreachable' | 'unsupported' | 'degraded';
export type RuntimeConfigLocalModelStatus = 'installed' | 'active' | 'unhealthy' | 'removed';
export type RuntimeConfigLocalModelIntegrityMode = 'verified' | 'local_unverified';

export type RuntimeConfigLocalModelProjection = {
  localModelId: string;
  engine: string;
  model: string;
  endpoint: string;
  capabilities: LocalRuntimeRunnableAssetKindId[];
  status: RuntimeConfigLocalModelStatus;
  integrityMode?: RuntimeConfigLocalModelIntegrityMode;
  hash?: string;
  installedAt?: string;
  updatedAt?: string;
  recommendation?: unknown;
};

export type RuntimeConfigLocalNodeCapability =
  | LocalRuntimeRunnableAssetKindId
  | 'rerank'
  | 'cv'
  | 'diarize';

export type RuntimeConfigLocalProviderHints = LocalProviderHints;

export type RuntimeConfigLocalNodeMatrixEntryProjection = {
  nodeId: string;
  capability: RuntimeConfigLocalNodeCapability;
  serviceId: string;
  provider: string;
  adapter?: LocalProviderAdapterId;
  backend?: string;
  backendSource?: string;
  available: boolean;
  reasonCode?: string;
  policyGate?: string;
  providerHints?: RuntimeConfigLocalProviderHints;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dedupeProjectionStrings(values: readonly unknown[]): string[] {
  return Array.from(new Set(values.map((item) => normalizeText(item)).filter(Boolean)));
}

export function normalizeRuntimeConfigEndpoint(value: unknown, fallback = RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT): string {
  return (normalizeText(value) || fallback).replace(/\/+$/, '');
}

function normalizeRuntimeConfigLocalModelStatus(value: unknown): RuntimeConfigLocalModelStatus {
  if (value === 'active' || value === 'unhealthy' || value === 'removed') {
    return value;
  }
  return 'installed';
}

export function normalizeRuntimeConfigLocalModelProjection(
  raw: Partial<RuntimeConfigLocalModelProjection>,
): RuntimeConfigLocalModelProjection {
  const localModelId = normalizeText(raw.localModelId) || normalizeText(raw.model) || createNimiClientId('local-model');
  const capabilities = (Array.isArray(raw.capabilities) ? raw.capabilities : [])
    .map((value) => normalizeText(value).toLowerCase())
    .filter(isLocalRuntimeRunnableAssetKindId);
  return {
    localModelId,
    engine: normalizeText(raw.engine),
    model: normalizeText(raw.model) || localModelId,
    endpoint: normalizeRuntimeConfigEndpoint(raw.endpoint),
    capabilities: capabilities.length > 0 ? capabilities : ['chat'],
    status: normalizeRuntimeConfigLocalModelStatus(raw.status),
    integrityMode: raw.integrityMode === 'local_unverified' ? 'local_unverified' : 'verified',
    hash: normalizeText(raw.hash) || undefined,
    installedAt: normalizeText(raw.installedAt) || undefined,
    updatedAt: normalizeText(raw.updatedAt) || undefined,
    recommendation: raw.recommendation,
  };
}

function normalizeRuntimeConfigLocalNodeCapability(value: unknown): RuntimeConfigLocalNodeCapability {
  const capability = normalizeText(value).toLowerCase();
  if (
    isLocalRuntimeRunnableAssetKindId(capability)
    || capability === 'rerank'
    || capability === 'cv'
    || capability === 'diarize'
  ) {
    return capability;
  }
  return 'chat';
}

function normalizeRuntimeConfigLocalProviderHints(value: unknown): RuntimeConfigLocalProviderHints | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as RuntimeConfigLocalProviderHints & JsonObject;
}

export function normalizeRuntimeConfigLocalNodeMatrixEntryProjection(
  raw: Partial<RuntimeConfigLocalNodeMatrixEntryProjection>,
): RuntimeConfigLocalNodeMatrixEntryProjection {
  return {
    nodeId: normalizeText(raw.nodeId) || createNimiClientId('node'),
    capability: normalizeRuntimeConfigLocalNodeCapability(raw.capability),
    serviceId: normalizeText(raw.serviceId),
    provider: normalizeText(raw.provider).toLowerCase(),
    adapter: normalizeLocalProviderAdapterId(raw.adapter),
    backend: normalizeText(raw.backend) || undefined,
    backendSource: normalizeText(raw.backendSource) || undefined,
    available: Boolean(raw.available),
    reasonCode: normalizeText(raw.reasonCode) || undefined,
    policyGate: normalizeText(raw.policyGate) || undefined,
    providerHints: normalizeRuntimeConfigLocalProviderHints(raw.providerHints),
  };
}

function runtimeConfigLocalModelSupportsCapability(
  model: RuntimeConfigLocalModelProjection,
  capability: LocalRuntimeRunnableAssetKindId,
): boolean {
  return model.capabilities.includes(capability);
}

function runtimeConfigLocalModelStatusRank(status: RuntimeConfigLocalModelStatus): number {
  if (status === 'active') return 0;
  if (status === 'installed') return 1;
  if (status === 'unhealthy') return 2;
  return 3;
}

export function pickPreferredRuntimeConfigLocalModel(input: {
  models: readonly RuntimeConfigLocalModelProjection[];
  capability?: LocalRuntimeRunnableAssetKindId;
}): RuntimeConfigLocalModelProjection | null {
  const capability = input.capability || 'chat';
  const models = input.models
    .filter((model) => model.status !== 'removed' && runtimeConfigLocalModelSupportsCapability(model, capability))
    .sort((left, right) => {
      const rankDelta = runtimeConfigLocalModelStatusRank(left.status) - runtimeConfigLocalModelStatusRank(right.status);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return left.model.localeCompare(right.model);
    });
  return models[0] || null;
}

export function normalizeRuntimeConfigStringList(values: readonly unknown[]): string[] {
  return dedupeProjectionStrings(values);
}
