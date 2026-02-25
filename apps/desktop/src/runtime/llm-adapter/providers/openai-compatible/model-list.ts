import { classifyError } from '../../errors/classify';
import type {
  HealthResult,
  ModelProfile,
  ProviderAdapterConfig,
  ProviderType,
} from '../../types';
import { fetchJson } from '../base';
import {
  type OpenAIModelsResponse,
  toOpenAICompatibleModelProfiles,
} from './response-map';

type OpenAICompatibleModelListInput = {
  type: ProviderType;
  config: ProviderAdapterConfig;
};

export async function healthCheckOpenAICompatible(
  input: OpenAICompatibleModelListInput,
  model?: string,
): Promise<HealthResult> {
  const startedAt = Date.now();

  try {
    const payload = await fetchJson<OpenAIModelsResponse>(`${input.config.endpoint}/models`, {
      headers: input.config.headers,
      fetch: input.config.fetch,
    });

    const modelCount = Array.isArray(payload?.data) ? payload.data.length : 0;
    const hasModel = model ? Boolean(payload?.data?.some((item) => item?.id === model)) : true;

    return {
      status: hasModel ? 'healthy' : 'unsupported',
      detail: hasModel ? `reachable (${modelCount} models)` : `model not found: ${model}`,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const classified = classifyError(error, {
      provider: input.type,
      model,
    });

    return {
      status: classified.code === 'MODEL_NOT_FOUND' ? 'unsupported' : 'unreachable',
      detail: classified.message,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
  }
}

export async function listOpenAICompatibleModels(
  input: OpenAICompatibleModelListInput,
): Promise<ModelProfile[]> {
  const payload = await fetchJson<OpenAIModelsResponse>(`${input.config.endpoint}/models`, {
    headers: input.config.headers,
    fetch: input.config.fetch,
  });

  return toOpenAICompatibleModelProfiles(input.type, input.config.endpoint, payload);
}
