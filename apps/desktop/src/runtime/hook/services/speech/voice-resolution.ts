import type { SpeechServiceInput } from './types.js';
import { normalizeSpeechProviderId } from './types.js';

type SpeechVoiceResolverContext = {
  speechEngine: Pick<SpeechServiceInput['speechEngine'], 'listVoices'>;
};

type ResolveSpeechVoiceIdInput = {
  context: SpeechVoiceResolverContext;
  providerId?: string;
  routeSource: 'local-runtime' | 'token-api';
  connectorId?: string;
  model: string;
  providerEndpoint?: string;
  requestedVoiceId?: string;
};

function normalizeVoiceId(value: unknown): string {
  return String(value || '').trim();
}

function resolveVoiceFromRuntimeList(requested: string, availableVoices: string[]): string {
  if (availableVoices.length === 0) {
    return requested;
  }
  if (!requested) {
    return availableVoices[0] ?? requested;
  }
  const requestedLower = requested.toLowerCase();
  const matched = availableVoices.find((voice) => (
    voice === requested
    || voice.toLowerCase() === requestedLower
  ));
  if (matched) {
    return matched;
  }
  return availableVoices[0] ?? requested;
}

export async function resolveSpeechVoiceId(input: ResolveSpeechVoiceIdInput): Promise<string> {
  const requested = normalizeVoiceId(input.requestedVoiceId);
  try {
    const voices = await input.context.speechEngine.listVoices({
      providerId: normalizeSpeechProviderId(input.providerId || 'openai-compatible'),
      model: normalizeVoiceId(input.model),
      routeSource: input.routeSource,
      connectorId: normalizeVoiceId(input.connectorId),
      providerEndpoint: normalizeVoiceId(input.providerEndpoint),
    });
    const available = voices
      .map((voice) => normalizeVoiceId(voice.id))
      .filter((voice): voice is string => Boolean(voice));
    return resolveVoiceFromRuntimeList(requested, available);
  } catch {
    return requested;
  }
}
