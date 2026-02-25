import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export type AiSdkOpenAiCompatibleProviderInput = {
  name: string;
  baseURL: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
};

export function createAiSdkOpenAiCompatibleProvider(
  input: AiSdkOpenAiCompatibleProviderInput,
) {
  return createOpenAICompatible({
    name: input.name,
    baseURL: input.baseURL,
    headers: input.headers,
    fetch: input.fetchImpl,
  });
}
