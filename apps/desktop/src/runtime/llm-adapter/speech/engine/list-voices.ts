import {
  buildRuntimeRequestMetadata,
  getRuntimeClient,
} from '../../execution/runtime-ai-bridge';
import type { SpeechVoiceDescriptor } from '../types';

export type ListVoicesInput = {
  providerId?: string;
  model?: string;
  routeSource?: 'local-runtime' | 'token-api';
  credentialRefId?: string;
  providerEndpoint?: string;
};

const FALLBACK_VOICES: readonly SpeechVoiceDescriptor[] = Object.freeze([
  { id: 'alloy', providerId: 'openai-compatible', name: 'Alloy', lang: 'en' },
  { id: 'nova', providerId: 'openai-compatible', name: 'Nova', lang: 'en' },
  { id: 'shimmer', providerId: 'openai-compatible', name: 'Shimmer', lang: 'en' },
]);

export async function listSpeechVoices(input?: ListVoicesInput): Promise<SpeechVoiceDescriptor[]> {
  const providerId = String(input?.providerId || 'openai-compatible').trim() || 'openai-compatible';
  const model = String(input?.model || '').trim();

  if (!model) {
    return FALLBACK_VOICES.map((v) => ({ ...v, providerId }));
  }

  try {
    const runtime = getRuntimeClient();
    const result = await runtime.media.tts.listVoices({
      model,
      route: input?.routeSource || 'local-runtime',
      fallback: 'deny',
      metadata: await buildRuntimeRequestMetadata({
        source: input?.routeSource || 'local-runtime',
        credentialRefId: input?.credentialRefId,
        providerEndpoint: input?.providerEndpoint,
      }),
    });

    if (result.voices.length === 0) {
      return FALLBACK_VOICES.map((v) => ({ ...v, providerId }));
    }

    return result.voices.map((v) => ({
      id: v.voiceId,
      providerId,
      name: v.name,
      lang: v.lang,
      langs: v.supportedLangs,
    }));
  } catch {
    return FALLBACK_VOICES.map((v) => ({ ...v, providerId }));
  }
}
