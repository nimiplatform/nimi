import type { ProviderType } from '../../types';
import { createSpeechAdapter } from '../index';
import { SpeechAssetStore } from '../asset-store';
import type { SpeechSynthesizeRequest, SpeechSynthesizeResult } from '../types';
import { isSupportedSpeechProvider, withV1Endpoint } from './shared';

function resolveEndpointForProvider(providerType: ProviderType, endpoint: string): string {
  if (providerType === 'DASHSCOPE_COMPATIBLE' || providerType === 'VOLCENGINE_COMPATIBLE') {
    return endpoint;
  }
  return withV1Endpoint(endpoint);
}

export async function synthesizeSpeech(input: {
  providerType: ProviderType;
  endpoint: string;
  apiKey?: string;
  request: SpeechSynthesizeRequest;
  assetStore: SpeechAssetStore;
  fetchImpl?: typeof fetch;
}): Promise<SpeechSynthesizeResult> {
  if (!isSupportedSpeechProvider(input.providerType)) {
    throw new Error(`SPEECH_ADAPTER_UNSUPPORTED: provider type ${input.providerType} is not supported`);
  }
  const adapter = createSpeechAdapter(input.providerType, {
    name: String(input.providerType || '').toLowerCase(),
    endpoint: resolveEndpointForProvider(input.providerType, input.endpoint),
    headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : undefined,
    fetch: input.fetchImpl,
  });
  const response = await adapter.synthesize(input.request);
  return {
    ...response,
    audioUri: input.assetStore.register(response.audioUri),
  };
}
