import { asRecord } from '../internal/utils.js';
import {
  DEFAULT_LOCAL_PROVIDER_ADAPTER_ID,
  normalizeLocalProviderAdapterId,
  type LocalProviderAdapter,
} from '../ai/types.js';

export type LocalRuntimeServiceStatus = 'installed' | 'active' | 'unhealthy' | 'removed';
export type LocalRuntimeServiceArtifactType = 'python-env' | 'binary' | 'attached-endpoint';
export type LocalRuntimeProviderAdapter = LocalProviderAdapter;

export type LocalRuntimeProviderLlamaHints = {
  preferredAdapter?: LocalRuntimeProviderAdapter;
  whisperVariant?: string;
};

export type LocalRuntimeProviderMediaHints = {
  preferredAdapter?: LocalRuntimeProviderAdapter;
  deviceId?: string;
  driver?: string;
  family?: string;
  policyGate?: string;
};

export type LocalRuntimeProviderSpeechHints = {
  preferredAdapter?: LocalRuntimeProviderAdapter;
  backend?: string;
  family?: string;
  driver?: string;
  deviceId?: string;
  policyGate?: string;
};

export type LocalRuntimeProviderSidecarHints = {
  preferredAdapter?: LocalRuntimeProviderAdapter;
};

export type LocalRuntimeProviderHints = {
  llama?: LocalRuntimeProviderLlamaHints;
  media?: LocalRuntimeProviderMediaHints;
  speech?: LocalRuntimeProviderSpeechHints;
  sidecar?: LocalRuntimeProviderSidecarHints;
  extra?: Record<string, unknown>;
} & Record<string, unknown>;

export type LocalRuntimeServiceDescriptor = {
  serviceId: string;
  title: string;
  engine: string;
  artifactType?: LocalRuntimeServiceArtifactType;
  endpoint?: string;
  capabilities: string[];
  localAssetId?: string;
  status: LocalRuntimeServiceStatus;
  detail?: string;
  reasonCode?: string;
  installedAt: string;
  updatedAt: string;
};

export type LocalRuntimeNodeDescriptor = {
  nodeId: string;
  title: string;
  serviceId: string;
  capabilities: string[];
  provider: string;
  adapter: LocalRuntimeProviderAdapter;
  backend?: string;
  backendSource?: string;
  available: boolean;
  reasonCode?: string;
  providerHints?: LocalRuntimeProviderHints;
  policyGate?: string;
  apiPath?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  readOnly: boolean;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function normalizeLocalRuntimeServiceStatus(value: unknown): LocalRuntimeServiceStatus {
  if (typeof value === 'number') {
    if (value === 2) return 'active';
    if (value === 3) return 'unhealthy';
    if (value === 4) return 'removed';
    return 'installed';
  }
  const raw = asString(value).toLowerCase();
  if (raw === 'local_service_status_active' || raw === '2') return 'active';
  if (raw === 'local_service_status_unhealthy' || raw === '3') return 'unhealthy';
  if (raw === 'local_service_status_removed' || raw === '4') return 'removed';
  if (raw === 'active' || raw === 'unhealthy' || raw === 'removed') {
    return raw;
  }
  return 'installed';
}

export function normalizeLocalRuntimeServiceArtifactType(
  value: unknown,
): LocalRuntimeServiceArtifactType | undefined {
  const raw = asString(value).toLowerCase();
  if (raw === 'python-env' || raw === 'binary' || raw === 'attached-endpoint') {
    return raw;
  }
  return undefined;
}

export function normalizeLocalRuntimeProviderAdapter(
  value: unknown,
): LocalRuntimeProviderAdapter {
  const raw = asString(value);
  return normalizeLocalProviderAdapterId(raw, DEFAULT_LOCAL_PROVIDER_ADAPTER_ID)
    ?? DEFAULT_LOCAL_PROVIDER_ADAPTER_ID;
}

export const normalizeProviderAdapter = normalizeLocalRuntimeProviderAdapter;

export function parseLocalRuntimeProviderHints(
  value: unknown,
): LocalRuntimeProviderHints | undefined {
  const record = asRecord(value);
  const llama = asRecord(record.llama);
  const media = asRecord(record.media);
  const speech = asRecord(record.speech);
  const sidecar = asRecord(record.sidecar);
  const passthrough = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== 'llama' && key !== 'media' && key !== 'speech' && key !== 'sidecar'),
  );
  if (
    Object.keys(llama).length === 0
    && Object.keys(media).length === 0
    && Object.keys(speech).length === 0
    && Object.keys(sidecar).length === 0
    && Object.keys(passthrough).length === 0
  ) {
    return undefined;
  }
  const llamaPreferredAdapter = asString(llama.preferredAdapter || llama.preferred_adapter);
  const mediaPreferredAdapter = asString(media.preferredAdapter || media.preferred_adapter);
  const speechPreferredAdapter = asString(speech.preferredAdapter || speech.preferred_adapter);
  const sidecarPreferredAdapter = asString(sidecar.preferredAdapter || sidecar.preferred_adapter);
  const parsed: LocalRuntimeProviderHints = { ...passthrough };
  if (Object.keys(llama).length > 0) {
    parsed.llama = {
      preferredAdapter: llamaPreferredAdapter ? normalizeLocalRuntimeProviderAdapter(llamaPreferredAdapter) : undefined,
      whisperVariant: asString(llama.whisperVariant || llama.whisper_variant) || undefined,
    };
  }
  if (Object.keys(media).length > 0) {
    parsed.media = {
      preferredAdapter: mediaPreferredAdapter ? normalizeLocalRuntimeProviderAdapter(mediaPreferredAdapter) : undefined,
      driver: asString(media.driver) || undefined,
      family: asString(media.family) || undefined,
      deviceId: asString(media.deviceId || media.device_id) || undefined,
      policyGate: asString(media.policyGate || media.policy_gate) || undefined,
    };
  }
  if (Object.keys(speech).length > 0) {
    parsed.speech = {
      preferredAdapter: speechPreferredAdapter ? normalizeLocalRuntimeProviderAdapter(speechPreferredAdapter) : undefined,
      backend: asString(speech.backend) || undefined,
      family: asString(speech.family) || undefined,
      driver: asString(speech.driver) || undefined,
      deviceId: asString(speech.deviceId || speech.device_id) || undefined,
      policyGate: asString(speech.policyGate || speech.policy_gate) || undefined,
    };
  }
  if (Object.keys(sidecar).length > 0) {
    parsed.sidecar = {
      preferredAdapter: sidecarPreferredAdapter
        ? normalizeLocalRuntimeProviderAdapter(sidecarPreferredAdapter)
        : undefined,
    };
  }
  const extra = asPlainRecord(record.extra);
  if (extra) {
    parsed.extra = extra;
  }
  return parsed;
}

export function parseLocalRuntimeServiceDescriptor(
  value: unknown,
): LocalRuntimeServiceDescriptor {
  const record = asRecord(value);
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    serviceId: asString(record.serviceId),
    title: asString(record.title),
    engine: asString(record.engine),
    artifactType: normalizeLocalRuntimeServiceArtifactType(record.artifactType),
    endpoint: asString(record.endpoint) || undefined,
    capabilities,
    localAssetId: asString(record.localAssetId) || undefined,
    status: normalizeLocalRuntimeServiceStatus(record.status),
    detail: asString(record.detail) || undefined,
    reasonCode: asString(record.reasonCode) || undefined,
    installedAt: asString(record.installedAt),
    updatedAt: asString(record.updatedAt),
  };
}

export const parseServiceDescriptor = parseLocalRuntimeServiceDescriptor;

export function parseLocalRuntimeNodeDescriptor(value: unknown): LocalRuntimeNodeDescriptor {
  const record = asRecord(value);
  return {
    nodeId: asString(record.nodeId),
    title: asString(record.title),
    serviceId: asString(record.serviceId),
    capabilities: Array.isArray(record.capabilities)
      ? record.capabilities.map((item) => asString(item)).filter(Boolean)
      : [],
    provider: asString(record.provider),
    adapter: normalizeLocalRuntimeProviderAdapter(record.adapter),
    backend: asString(record.backend) || undefined,
    backendSource: asString(record.backendSource) || undefined,
    available: Boolean(record.available),
    reasonCode: asString(record.reasonCode) || undefined,
    providerHints: parseLocalRuntimeProviderHints(record.providerHints),
    policyGate: asString(record.policyGate) || undefined,
    apiPath: asString(record.apiPath) || undefined,
    inputSchema: asPlainRecord(record.inputSchema),
    outputSchema: asPlainRecord(record.outputSchema),
    readOnly: Boolean(record.readOnly),
  };
}

export const parseNodeDescriptor = parseLocalRuntimeNodeDescriptor;
