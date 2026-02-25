import type { InvokeResponse, ModelProfile, ProviderType } from '../../types';

export type OpenAIModelsResponse = {
  data?: Array<{
    id?: string;
    context_length?: number;
    max_context_tokens?: number;
    max_input_tokens?: number;
    max_output_tokens?: number;
    top_provider?: {
      context_length?: number;
      max_context_tokens?: number;
      max_input_tokens?: number;
      max_completion_tokens?: number;
      max_output_tokens?: number;
    };
  }>;
};

export function mapOpenAICompatibleFinishReason(
  reason: string | null | undefined,
): InvokeResponse['finishReason'] {
  if (reason === 'tool-calls') {
    return 'tool_calls';
  }

  if (reason === 'length') {
    return 'length';
  }

  if (reason === 'error') {
    return 'error';
  }

  return 'stop';
}

export function toOpenAICompatibleModelProfiles(
  type: ProviderType,
  endpoint: string,
  payload: OpenAIModelsResponse,
): ModelProfile[] {
  function toPositiveInt(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    const rounded = Math.floor(numeric);
    return rounded > 0 ? rounded : undefined;
  }

  function resolveContextTokens(
    item: NonNullable<OpenAIModelsResponse['data']>[number],
  ): number | undefined {
    const topProvider = item?.top_provider;
    return toPositiveInt(
      item?.max_context_tokens
      ?? item?.context_length
      ?? item?.max_input_tokens
      ?? topProvider?.max_context_tokens
      ?? topProvider?.context_length
      ?? topProvider?.max_input_tokens,
    );
  }

  function resolveOutputTokens(
    item: NonNullable<OpenAIModelsResponse['data']>[number],
  ): number | undefined {
    const topProvider = item?.top_provider;
    return toPositiveInt(
      item?.max_output_tokens
      ?? topProvider?.max_output_tokens
      ?? topProvider?.max_completion_tokens,
    );
  }

  const models = Array.isArray(payload?.data) ? payload.data : [];

  return models
    .map((item): ModelProfile | null => {
      const id = String(item?.id || '').trim();
      if (!id) return null;
      const maxContextTokens = resolveContextTokens(item);
      const maxOutputTokens = resolveOutputTokens(item);
      return {
        id: `${type.toLowerCase()}:${id}`,
        providerType: type,
        model: id,
        endpoint,
        capabilities: ['chat'],
        constraints: {
          ...(typeof maxContextTokens === 'number' ? { maxContextTokens } : {}),
          ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
          allowStreaming: true,
          allowToolUse: true,
        },
        fingerprint: {
          supportsStreaming: true,
          supportsToolUse: true,
          ...(typeof maxContextTokens === 'number' ? { maxInputTokens: maxContextTokens } : {}),
          discoveredFrom: 'provider-api',
        },
        healthStatus: 'unknown',
      };
    })
    .filter((item): item is ModelProfile => item !== null);
}
