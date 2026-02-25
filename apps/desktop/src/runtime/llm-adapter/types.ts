import { z } from 'zod';

export const providerTypeSchema = z.enum([
  'OPENAI_COMPATIBLE',
  'DASHSCOPE_COMPATIBLE',
  'VOLCENGINE_COMPATIBLE',
  'LOCALAI_NATIVE',
  'CLOUD_API',
  'FALLBACK',
]);
export type ProviderType = z.infer<typeof providerTypeSchema>;

export const modelCapabilitySchema = z.enum([
  'chat',
  'chat-vision',
  'embedding',
  'image',
  'tts',
  'stt',
  'code',
  'rerank',
]);
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;

export const healthStatusSchema = z.enum(['healthy', 'unreachable', 'unsupported', 'unknown']);
export type ModelHealthStatus = z.infer<typeof healthStatusSchema>;

export type ChatMessage = {
  role: string;
  content: unknown;
  [key: string]: unknown;
};

export type ModelProfile = {
  id: string;
  providerType: ProviderType;
  model: string;
  endpoint: string;
  capabilities: ModelCapability[];
  constraints: {
    maxContextTokens?: number;
    maxOutputTokens?: number;
    allowStreaming?: boolean;
    allowToolUse?: boolean;
  };
  fingerprint?: {
    supportsStreaming?: boolean;
    supportsToolUse?: boolean;
    supportsVision?: boolean;
    maxInputTokens?: number;
    discoveredFrom?: 'provider-api' | 'template';
  };
  healthStatus: ModelHealthStatus;
  lastCheckedAt?: string;
};

export const credentialEntrySchema = z.object({
  refId: z.string(),
  provider: z.string(),
  profileId: z.string(),
  label: z.string(),
  createdAt: z.string(),
});

export type CredentialEntry = z.infer<typeof credentialEntrySchema>;

export type CredentialRef = {
  refId: string;
  provider: string;
  profileId: string;
};

export type ProfileRotationState = {
  refId: string;
  lastUsedAt?: number;
  cooldownUntil?: number;
  errorCount: number;
};

export const capabilityRequestSchema = z.object({
  capability: modelCapabilitySchema,
  preferredModelId: z.string().optional(),
  minContextTokens: z.number().int().positive().optional(),
  requireStreaming: z.boolean().optional(),
  requireToolUse: z.boolean().optional(),
  caller: z.string(),
});

export type CapabilityRequest = {
  capability: ModelCapability;
  preferredModelId?: string;
  minContextTokens?: number;
  requireStreaming?: boolean;
  requireToolUse?: boolean;
  caller: 'core' | `mod:${string}`;
};

export type RoutingDecision = {
  modelProfile: ModelProfile;
  credentialRef: CredentialRef;
  score: number;
  reason: string;
  fallbacks: string[];
};

export type NormalizedUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  total: number;
};

export type LlmStreamEvent = {
  type: 'text_delta' | 'tool_use_delta' | 'metadata_delta' | 'done' | 'error';
  textDelta?: string;
  toolDelta?: unknown;
  // only on type='done'
  latencyMs?: number;
  // only on type='done'
  usage?: NormalizedUsage;
  raw?: unknown;
};

export type InvokeRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: unknown[];
  stream?: boolean;
  providerParams?: Record<string, unknown>;
};

export type InvokeResponse = {
  content: string;
  toolCalls?: unknown[];
  usage?: NormalizedUsage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  raw?: unknown;
};

export type HealthResult = {
  status: 'healthy' | 'unreachable' | 'unsupported';
  detail: string;
  checkedAt: string;
  latencyMs?: number;
};

export type ProviderAdapterConfig = {
  name: string;
  endpoint: string;
  defaultModel?: string;
  headers?: Record<string, string>;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  transformRequest?: (params: Record<string, unknown>) => Record<string, unknown>;
  transformMessages?: (messages: InvokeRequest['messages']) => InvokeRequest['messages'];
};
