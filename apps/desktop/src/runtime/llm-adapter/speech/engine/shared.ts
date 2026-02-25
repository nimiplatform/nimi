import type { ProviderType } from '../../types';

export function withV1Endpoint(endpoint: string): string {
  const normalized = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!normalized) return normalized;
  if (normalized.endsWith('/v1')) return normalized;
  return `${normalized}/v1`;
}

export function inferVoiceLang(voiceId: string): string | undefined {
  const prefix = String(voiceId || '').split('_')[0]?.toLowerCase() || '';
  if (prefix === 'af' || prefix === 'am' || prefix === 'bf' || prefix === 'bm') return 'en';
  if (prefix === 'zf' || prefix === 'zm') return 'zh';
  if (prefix === 'jf' || prefix === 'jm') return 'ja';
  if (prefix === 'ef' || prefix === 'em') return 'es';
  if (prefix === 'ff' || prefix === 'fm') return 'fr';
  if (prefix === 'if' || prefix === 'im') return 'it';
  if (prefix === 'pf' || prefix === 'pm') return 'pt';
  return undefined;
}

export function isOpenAiCompatibleProvider(providerType: ProviderType): boolean {
  return providerType === 'OPENAI_COMPATIBLE'
    || providerType === 'CLOUD_API'
    || providerType === 'DASHSCOPE_COMPATIBLE'
    || providerType === 'VOLCENGINE_COMPATIBLE';
}

export function isSupportedSpeechProvider(providerType: ProviderType): boolean {
  return isOpenAiCompatibleProvider(providerType);
}

export function buildStreamId(): string {
  return `speech-stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isStreamUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('SPEECH_STREAM_UNSUPPORTED');
}
