export type LocalAiModelStatus = 'installed' | 'active' | 'unhealthy' | 'removed';
export type LocalAiArtifactKind = 'vae' | 'llm' | 'clip' | 'controlnet' | 'lora' | 'auxiliary';
export type LocalAiArtifactStatus = 'installed' | 'active' | 'unhealthy' | 'removed';

export type LocalAiModelRecord = {
  localModelId: string;
  modelId: string;
  capabilities: string[];
  engine: string;
  entry: string;
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  hashes: Record<string, string>;
  endpoint: string;
  status: LocalAiModelStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
  engineConfig?: Record<string, unknown>;
};

export type LocalAiArtifactRecord = {
  localArtifactId: string;
  artifactId: string;
  kind: LocalAiArtifactKind;
  engine: string;
  entry: string;
  files: string[];
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  hashes: Record<string, string>;
  status: LocalAiArtifactStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
  metadata?: Record<string, unknown>;
};

export type LocalAiInstallAcceptedResponse = {
  installSessionId: string;
  modelId: string;
  localModelId: string;
};

export type LocalAiModelHealth = {
  localModelId: string;
  status: LocalAiModelStatus;
  detail: string;
  endpoint: string;
};

export type LocalAiModelsHealthResult = {
  models: LocalAiModelHealth[];
};

export type LocalAiInferenceAuditEventType =
  | 'inference_invoked'
  | 'inference_failed'
  | 'fallback_to_cloud';

export type LocalAiInferenceAuditModality =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding';

export type LocalAiInferenceAuditPayload = {
  eventType: LocalAiInferenceAuditEventType;
  modId: string;
  source: 'local' | 'cloud';
  routeSource?: 'local' | 'cloud';
  provider: string;
  modality: LocalAiInferenceAuditModality;
  adapter: 'openai_compat_adapter' | 'localai_native_adapter' | string;
  traceId?: string;
  model?: string;
  localModelId?: string;
  endpoint?: string;
  reasonCode?: string;
  detail?: string;
  policyGate?: string | Record<string, unknown>;
  extra?: Record<string, unknown>;
};

export type LocalAiAuditEvent = {
  id: string;
  eventType: string;
  occurredAt: string;
  source?: string;
  modality?: string;
  reasonCode?: string;
  detail?: string;
  modelId?: string;
  localModelId?: string;
  payload?: Record<string, unknown>;
};

export type LocalAiAuditTimeRange = {
  from?: string;
  to?: string;
};

export type LocalAiDownloadProgressEvent = {
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

export type LocalAiDownloadSessionSummary = {
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

export type LocalAiAuditListPayload = {
  limit?: number;
  eventType?: string;
  eventTypes?: string[];
  source?: string;
  modality?: string;
  localModelId?: string;
  modId?: string;
  reasonCode?: string;
  timeRange?: LocalAiAuditTimeRange;
};

export type LocalAiInstallPayload = {
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
  engineConfig?: Record<string, unknown>;
};

export type LocalAiVerifiedModelDescriptor = {
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
  engineConfig?: Record<string, unknown>;
};

export type LocalAiVerifiedArtifactDescriptor = {
  templateId: string;
  title: string;
  description: string;
  artifactId: string;
  kind: LocalAiArtifactKind;
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
  metadata?: Record<string, unknown>;
};

export type LocalAiInstallVerifiedPayload = {
  templateId: string;
  endpoint?: string;
};

export type LocalAiInstallVerifiedArtifactPayload = {
  templateId: string;
};

export type LocalAiImportPayload = {
  manifestPath: string;
  endpoint?: string;
};

export type LocalAiImportArtifactPayload = {
  manifestPath: string;
};

export type LocalAiListArtifactsPayload = {
  status?: LocalAiArtifactStatus;
  kind?: LocalAiArtifactKind;
  engine?: string;
};

export type LocalAiListVerifiedArtifactsPayload = {
  kind?: LocalAiArtifactKind;
  engine?: string;
};
