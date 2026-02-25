import type { InvokeRequest, ProviderAdapterConfig } from '../../types';
import { createAiSdkOpenAiCompatibleProvider } from '../ai-sdk-factory';

export function normalizeOpenAICompatibleEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, '');
}

export function buildOpenAICompatibleProvider(
  config: ProviderAdapterConfig,
  extraHeaders?: Record<string, string>,
) {
  const mergedHeaders = {
    ...(config.headers ?? {}),
    ...(extraHeaders ?? {}),
  };

  return createAiSdkOpenAiCompatibleProvider({
    name: config.name,
    baseURL: config.endpoint,
    headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
    fetchImpl: config.fetch as typeof fetch,
  });
}

export function resolveOpenAICompatibleProviderParams(
  config: ProviderAdapterConfig,
  request: InvokeRequest,
) {
  return config.transformRequest
    ? config.transformRequest(request.providerParams ?? {})
    : request.providerParams;
}

export function resolveOpenAICompatibleMessages(
  config: ProviderAdapterConfig,
  request: InvokeRequest,
) {
  return config.transformMessages
    ? config.transformMessages(request.messages)
    : request.messages;
}
