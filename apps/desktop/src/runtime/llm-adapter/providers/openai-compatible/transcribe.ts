import { normalizeOpenAICompatibleEndpoint } from './request';

type OpenAICompatibleTranscribeInput = {
  endpoint: string;
  model: string;
  audioUri?: string;
  audioBase64?: string;
  mimeType?: string;
  language?: string;
  providerParams?: Record<string, string>;
  apiKey?: string;
  abortSignal?: AbortSignal;
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

type OpenAICompatibleTranscribeResponse = {
  text?: unknown;
};

function trimErrorBody(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.length > 200 ? `${normalized.slice(0, 200)}...` : normalized;
}

function normalizeBase64(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.includes(',') ? String(raw.split(',').slice(-1)[0] || '').trim() : raw;
}

function decodeBase64ToBytes(value: string): Uint8Array {
  const normalized = normalizeBase64(value);
  if (!normalized) {
    return new Uint8Array();
  }

  if (typeof Buffer !== 'undefined') {
    try {
      return new Uint8Array(Buffer.from(normalized, 'base64'));
    } catch {
      return new Uint8Array();
    }
  }

  if (typeof atob === 'function') {
    try {
      const binary = atob(normalized);
      const output = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        output[i] = binary.charCodeAt(i);
      }
      return output;
    } catch {
      return new Uint8Array();
    }
  }

  return new Uint8Array();
}

function defaultFileExtension(mimeType: string): string {
  const normalized = String(mimeType || '').trim().toLowerCase();
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('ogg') || normalized.includes('opus')) return 'ogg';
  if (normalized.includes('flac')) return 'flac';
  return 'bin';
}

async function resolveAudioBytes(
  input: OpenAICompatibleTranscribeInput,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const normalizedMimeType = String(input.mimeType || '').trim() || 'application/octet-stream';

  const fromAudioBase64 = decodeBase64ToBytes(String(input.audioBase64 || ''));
  if (fromAudioBase64.length > 0) {
    return {
      bytes: fromAudioBase64,
      mimeType: normalizedMimeType,
    };
  }

  const uri = String(input.audioUri || '').trim();
  if (!uri) {
    throw new Error('PLAY_PROVIDER_UNAVAILABLE: transcribe audio payload required');
  }

  if (uri.startsWith('data:')) {
    const [, mimePart = '', payload = ''] = uri.match(/^data:([^;,]*)(?:;base64)?,(.*)$/i) || [];
    if (!payload) {
      throw new Error('PLAY_PROVIDER_UNAVAILABLE: transcribe data uri is invalid');
    }
    return {
      bytes: decodeBase64ToBytes(payload),
      mimeType: mimePart || normalizedMimeType,
    };
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    const response = await input.fetchImpl(uri, {
      method: 'GET',
      signal: input.abortSignal,
    });
    if (!response.ok) {
      throw new Error(`PLAY_PROVIDER_UNAVAILABLE: transcribe audio fetch failed HTTP_${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      bytes: new Uint8Array(arrayBuffer),
      mimeType: String(response.headers.get('content-type') || normalizedMimeType).trim() || normalizedMimeType,
    };
  }

  throw new Error('PLAY_PROVIDER_UNAVAILABLE: transcribe audio uri must be data/http(s)');
}

export async function invokeOpenAICompatibleTranscribe(
  input: OpenAICompatibleTranscribeInput,
): Promise<string> {
  const endpoint = normalizeOpenAICompatibleEndpoint(String(input.endpoint || '').trim());
  if (!endpoint) {
    throw new Error('PLAY_PROVIDER_UNAVAILABLE: transcribe endpoint required');
  }

  const model = String(input.model || '').trim();
  if (!model) {
    throw new Error('PLAY_PROVIDER_UNAVAILABLE: transcribe model required');
  }

  const resolvedAudio = await resolveAudioBytes(input);
  if (!resolvedAudio.bytes.length) {
    throw new Error('PLAY_PROVIDER_UNAVAILABLE: transcribe audio payload is empty');
  }

  const headers: Record<string, string> = {};
  const apiKey = String(input.apiKey || '').trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const formData = new FormData();
  const fileExtension = defaultFileExtension(resolvedAudio.mimeType);
  const byteBuffer = resolvedAudio.bytes.buffer.slice(
    resolvedAudio.bytes.byteOffset,
    resolvedAudio.bytes.byteOffset + resolvedAudio.bytes.byteLength,
  ) as ArrayBuffer;
  const file = new Blob([byteBuffer], { type: resolvedAudio.mimeType });
  formData.append('file', file, `audio.${fileExtension}`);
  formData.append('model', model);
  const language = String(input.language || '').trim();
  if (language) {
    formData.append('language', language);
  }
  const providerParams = input.providerParams || {};
  for (const [key, value] of Object.entries(providerParams)) {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = String(value || '').trim();
    if (!normalizedKey || !normalizedValue) continue;
    formData.append(normalizedKey, normalizedValue);
  }

  const response = await input.fetchImpl(`${endpoint}/audio/transcriptions`, {
    method: 'POST',
    headers,
    body: formData,
    signal: input.abortSignal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `PLAY_PROVIDER_UNAVAILABLE: transcribe request failed HTTP_${response.status} ${trimErrorBody(body)}`,
    );
  }

  const payload = (await response.json()) as OpenAICompatibleTranscribeResponse;
  const text = String(payload?.text || '').trim();
  if (!text) {
    throw new Error('PLAY_PROVIDER_UNAVAILABLE: transcribe response missing text');
  }

  return text;
}
