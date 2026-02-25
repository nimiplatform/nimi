import type { ProviderType } from '../types';
import type { UsageRecord } from '../usage-tracker';

function numberFrom(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }

  if (typeof input === 'string' && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

export function normalizeUsage(
  raw: Record<string, unknown> | undefined,
  providerType: ProviderType,
): Pick<UsageRecord, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'totalTokens'> {
  const payload = raw ?? {};
  const promptTokensDetails =
    payload.prompt_tokens_details && typeof payload.prompt_tokens_details === 'object'
      ? (payload.prompt_tokens_details as Record<string, unknown>)
      : {};
  const cacheCreation =
    payload.cache_creation && typeof payload.cache_creation === 'object'
      ? (payload.cache_creation as Record<string, unknown>)
      : {};

  const inputGross = numberFrom(payload.inputTokens ?? payload.prompt_tokens ?? payload.input_tokens);
  const output = numberFrom(payload.outputTokens ?? payload.completion_tokens ?? payload.output_tokens);

  const cacheRead =
    providerType === 'OPENAI_COMPATIBLE' || providerType === 'CLOUD_API'
      ? numberFrom(
          promptTokensDetails.cached_tokens ??
            payload.cachedInputTokens ??
            payload.cache_read_input_tokens,
        )
      : numberFrom(payload.cache_read_input_tokens ?? payload.cachedInputTokens);

  const cacheWrite = numberFrom(
    payload.cache_creation_input_tokens ??
      cacheCreation.ephemeral_5m_input_tokens ??
      cacheCreation.ephemeral_1h_input_tokens,
  );

  return {
    inputTokens: inputGross,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: inputGross + output,
  };
}
