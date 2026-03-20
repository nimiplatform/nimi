import type { JsonObject } from './shared.js';

export type LocalRuntimeModelStatus = 'installed' | 'active' | 'unhealthy' | 'removed';
export type LocalRuntimeArtifactKind = 'vae' | 'ae' | 'llm' | 'clip' | 'controlnet' | 'lora' | 'auxiliary';
export type LocalRuntimeArtifactStatus = 'installed' | 'active' | 'unhealthy' | 'removed';

export type LocalRuntimeModelRecord = {
  localModelId: string;
  modelId: string;
  capabilities: string[];
  engine: string;
  entry: string;
  files: string[];
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  hashes: Record<string, string>;
  tags: string[];
  knownTotalSizeBytes?: number;
  endpoint: string;
  status: LocalRuntimeModelStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
  engineConfig?: JsonObject;
};

export type LocalRuntimeArtifactRecord = {
  localArtifactId: string;
  artifactId: string;
  kind: LocalRuntimeArtifactKind;
  engine: string;
  entry: string;
  files: string[];
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  hashes: Record<string, string>;
  status: LocalRuntimeArtifactStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
  metadata?: JsonObject;
};

export type LocalRuntimeInstallAcceptedResponse = {
  installSessionId: string;
  modelId: string;
  localModelId: string;
};

export type LocalRuntimeModelHealth = {
  localModelId: string;
  status: LocalRuntimeModelStatus;
  detail: string;
  endpoint: string;
};

export type LocalRuntimeModelsHealthResult = {
  models: LocalRuntimeModelHealth[];
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

export type LocalRuntimeInstallPayload = {
  modelId: string;
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

export type LocalRuntimeVerifiedModelDescriptor = {
  templateId: string;
  title: string;
  description: string;
  installKind: string;
  modelId: string;
  repo: string;
  revision: string;
  capabilities: string[];
  engine: string;
  entry: string;
  files: string[];
  license: string;
  hashes: Record<string, string>;
  endpoint: string;
  fileCount: number;
  totalSizeBytes?: number;
  tags: string[];
  engineConfig?: JsonObject;
};

export type LocalRuntimeVerifiedArtifactDescriptor = {
  templateId: string;
  title: string;
  description: string;
  artifactId: string;
  kind: LocalRuntimeArtifactKind;
  engine: string;
  entry: string;
  files: string[];
  license: string;
  repo: string;
  revision: string;
  hashes: Record<string, string>;
  fileCount: number;
  totalSizeBytes?: number;
  tags: string[];
  metadata?: JsonObject;
};

export type LocalRuntimeInstallVerifiedPayload = {
  templateId: string;
  endpoint?: string;
};

export type LocalRuntimeInstallVerifiedArtifactPayload = {
  templateId: string;
};

export type LocalRuntimeImportPayload = {
  manifestPath: string;
  endpoint?: string;
};

export type LocalRuntimeImportArtifactPayload = {
  manifestPath: string;
};

export type LocalRuntimeListArtifactsPayload = {
  status?: LocalRuntimeArtifactStatus;
  kind?: LocalRuntimeArtifactKind;
  engine?: string;
};

export type LocalRuntimeListVerifiedArtifactsPayload = {
  kind?: LocalRuntimeArtifactKind;
  engine?: string;
};
