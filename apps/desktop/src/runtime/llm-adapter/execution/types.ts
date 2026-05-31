import type {
  CheckModelHealthRequest,
  CheckModelHealthResponse,
  RuntimeRouteHostHealthInput,
  RuntimeRouteProviderHealthProjection,
} from '@nimiplatform/sdk/runtime';

export const TEXT_GENERATE_TIMEOUT_MS = 120_000;

export type ProviderHealth = RuntimeRouteProviderHealthProjection;

export type CheckLlmHealthInput = RuntimeRouteHostHealthInput & {
  runtimeModelHealth?: (request: CheckModelHealthRequest) => Promise<CheckModelHealthResponse>;
};
