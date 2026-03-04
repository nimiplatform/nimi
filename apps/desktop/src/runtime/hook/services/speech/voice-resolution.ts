import type { SpeechServiceInput } from './types.js';
import { normalizeSpeechProviderId } from './types.js';

type ResolveSpeechVoiceIdInput = {
  context: SpeechServiceInput;
  providerId?: string;
  routeSource: 'local-runtime' | 'token-api';
  connectorId?: string;
  model: string;
  providerEndpoint?: string;
  requestedVoiceId?: string;
};

const DASHSCOPE_VOICE_PRESETS = [
  'Cherry', 'Serena', 'Ethan', 'Chelsie', 'Aura', 'Breeze', 'Haruto', 'Maple', 'Sierra', 'River',
];

const VOLCENGINE_VOICE_PRESETS = [
  'BV001_streaming', 'BV002_streaming',
];

function normalizeVoiceId(value: unknown): string {
  return String(value || '').trim();
}

function resolveVoiceFromPresets(requested: string, presets: string[], fallback: string): string {
  const normalizedRequested = normalizeVoiceId(requested);
  if (!normalizedRequested) {
    return fallback;
  }
  const normalizedLower = normalizedRequested.toLowerCase();
  const matched = presets.find((voice) => voice.toLowerCase() === normalizedLower);
  if (matched) {
    return matched;
  }
  return fallback;
}

function resolveModelVoiceFallback(model: string, requested: string): string {
  const normalizedModel = normalizeVoiceId(model).toLowerCase();
  if (
    normalizedModel.includes('qwen3-tts')
    || normalizedModel.includes('qwen-tts')
    || normalizedModel.startsWith('dashscope/')
  ) {
    return resolveVoiceFromPresets(requested, DASHSCOPE_VOICE_PRESETS, 'Cherry');
  }
  if (
    normalizedModel.includes('volcengine')
    || normalizedModel.startsWith('volcengine/')
  ) {
    return resolveVoiceFromPresets(requested, VOLCENGINE_VOICE_PRESETS, 'BV001_streaming');
  }
  const normalizedRequested = normalizeVoiceId(requested);
  return normalizedRequested || 'alloy';
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
    if (available.length === 0) {
      return resolveModelVoiceFallback(input.model, requested);
    }
    const firstAvailable = available[0] ?? requested;
    if (!requested) {
      return resolveModelVoiceFallback(input.model, firstAvailable);
    }
    const requestedLower = requested.toLowerCase();
    const matched = available.find((voice) => (
      voice === requested
      || voice.toLowerCase() === requestedLower
    ));
    if (matched) {
      return resolveModelVoiceFallback(input.model, matched);
    }
    return resolveModelVoiceFallback(input.model, firstAvailable);
  } catch {
    return resolveModelVoiceFallback(input.model, requested);
  }
}
