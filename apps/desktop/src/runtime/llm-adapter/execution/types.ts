import type {
  CheckModelHealthRequest,
  CheckModelHealthResponse,
} from '@nimiplatform/sdk/runtime';

export const TEXT_GENERATE_TIMEOUT_MS = 120_000;

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
