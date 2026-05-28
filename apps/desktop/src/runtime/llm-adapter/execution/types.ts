import type {
  CheckModelHealthRequest,
  CheckModelHealthResponse,
} from '@nimiplatform/sdk/runtime';
import type { RuntimeResolvedBinding } from '@nimiplatform/sdk/ai';

export const TEXT_GENERATE_TIMEOUT_MS = 120_000;

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ProviderHealth = {
  provider: string;
  endpoint: string | null;
  model: string;
  status: 'healthy' | 'degraded' | 'unsupported' | 'unreachable';
  detail: string;
  checkedAt: string;
};

export type CheckLlmHealthInput = {
  provider: string;
  capability?: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  localModelId?: string;
  goRuntimeLocalModelId?: string;
  connectorId?: string;
  runtimeModelHealth?: (request: CheckModelHealthRequest) => Promise<CheckModelHealthResponse>;
};

export type InvokeRuntimeLlmInput = {
  targetId: string;
  resolvedBinding: RuntimeResolvedBinding;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  mode?: 'STORY' | 'SCENE_TURN';
  worldId?: string;
  agentId?: string;
  abortSignal?: AbortSignal;
  fetchImpl?: FetchImpl;
};

export type InvokeRuntimeLlmOutput = {
  text: string;
  promptTraceId: string;
  traceId: string;
};
