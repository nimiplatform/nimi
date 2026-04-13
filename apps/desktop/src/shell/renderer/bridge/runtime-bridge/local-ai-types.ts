import type { JsonObject } from './shared.js';

export type LocalRuntimeAssetStatus = 'installed' | 'active' | 'unhealthy' | 'removed';
export type LocalRuntimeAssetKind = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | 'vae' | 'clip' | 'lora' | 'controlnet' | 'auxiliary';
export type LocalRuntimeIntegrityMode = 'verified' | 'local_unverified';
export type LocalRuntimeTransferSessionKind = 'download' | 'import';

export type LocalRuntimeAssetRecord = {
  localAssetId: string;
  assetId: string;
  kind: LocalRuntimeAssetKind;
  engine: string;
  endpoint?: string;
  entry: string;
  files: string[];
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  integrityMode: LocalRuntimeIntegrityMode;
  hashes: Record<string, string>;
  status: LocalRuntimeAssetStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
  capabilities?: string[];
  logicalModelId?: string;
  family?: string;
  artifactRoles?: string[];
  preferredEngine?: string;
  fallbackEngines?: string[];
  engineConfig?: JsonObject;
  metadata?: JsonObject;
};

export type LocalRuntimeAssetHealth = {
  localAssetId: string;
  status: LocalRuntimeAssetStatus;
  detail: string;
  endpoint: string;
};

export type LocalRuntimeAssetsHealthResult = {
  assets: LocalRuntimeAssetHealth[];
};

export type LocalRuntimeInferenceAuditEventType =
  | 'inference_invoked'
  | 'inference_failed'
  | 'fallback_to_cloud';

export type LocalRuntimeInferenceAuditModality =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding';

export type LocalRuntimeInferenceAuditPayload = {
  eventType: LocalRuntimeInferenceAuditEventType;
  modId: string;
  source: 'local' | 'cloud';
  routeSource?: 'local' | 'cloud';
  provider: string;
  modality: LocalRuntimeInferenceAuditModality;
  adapter: 'openai_compat_adapter' | 'llama_native_adapter' | 'media_native_adapter' | 'speech_native_adapter' | 'sidecar_music_adapter' | string;
  traceId?: string;
  model?: string;
  localModelId?: string;
  endpoint?: string;
  reasonCode?: string;
  detail?: string;
  policyGate?: string | JsonObject;
  extra?: JsonObject;
};

export type LocalRuntimeAuditEvent = {
  id: string;
  eventType: string;
  occurredAt: string;
  source?: string;
  modality?: string;
  reasonCode?: string;
  detail?: string;
  modelId?: string;
  localModelId?: string;
  payload?: JsonObject;
};

export type LocalRuntimeAuditTimeRange = {
  from?: string;
  to?: string;
};

export type LocalRuntimeDownloadProgressEvent = {
  installSessionId: string;
  modelId: string;
  localModelId?: string;
  sessionKind: LocalRuntimeTransferSessionKind;
  phase: string;
  bytesReceived: number;
  bytesTotal?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  message?: string;
  state: 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';
  reasonCode?: string;
  retryable?: boolean;
  done: boolean;
  success: boolean;
};

export type LocalRuntimeDownloadSessionSummary = {
  installSessionId: string;
  modelId: string;
  localModelId: string;
  sessionKind: LocalRuntimeTransferSessionKind;
  phase: string;
  state: 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';
  bytesReceived: number;
  bytesTotal?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  message?: string;
  reasonCode?: string;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LocalRuntimeAuditListPayload = {
  limit?: number;
  eventType?: string;
  eventTypes?: string[];
  source?: string;
  modality?: string;
  localModelId?: string;
  modId?: string;
  reasonCode?: string;
  timeRange?: LocalRuntimeAuditTimeRange;
};

export type LocalRuntimeListAssetsPayload = {
  status?: LocalRuntimeAssetStatus;
  kind?: LocalRuntimeAssetKind;
  engine?: string;
};

export type LocalRuntimeListVerifiedAssetsPayload = {
  kind?: LocalRuntimeAssetKind;
  engine?: string;
};

export type LocalRuntimeInstallPayload = {
  modelId: string;
  kind: LocalRuntimeAssetKind;
  repo: string;
  revision?: string;
  capabilities?: string[];
  engine?: string;
  entry?: string;
  files?: string[];
  license?: string;
  hashes?: Record<string, string>;
  endpoint?: string;
  engineConfig?: JsonObject;
};

export type LocalRuntimeVerifiedAssetDescriptor = {
  templateId: string;
  title: string;
  description: string;
  installKind?: string;
  assetId: string;
  kind: LocalRuntimeAssetKind;
  logicalModelId?: string;
  repo: string;
  revision: string;
  capabilities?: string[];
  engine: string;
  entry: string;
  files: string[];
  license: string;
  hashes: Record<string, string>;
  endpoint?: string;
  fileCount: number;
  totalSizeBytes?: number;
  tags: string[];
  artifactRoles?: string[];
  preferredEngine?: string;
  fallbackEngines?: string[];
  engineConfig?: JsonObject;
  metadata?: JsonObject;
};

export type LocalRuntimeInstallVerifiedAssetPayload = {
  templateId: string;
  endpoint?: string;
};

export type LocalRuntimeImportAssetPayload = {
  manifestPath: string;
  endpoint?: string;
};
