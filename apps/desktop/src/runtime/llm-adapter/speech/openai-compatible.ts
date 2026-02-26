import type {
  SpeechAdapter,
  SpeechAdapterConfig,
  SpeechFormat,
  SpeechHealthResult,
  SpeechNativeStreamResponse,
  SpeechSynthesizeRequest,
  SpeechSynthesizeResult,
} from './types';
import type { ProviderType } from '../types';

function normalizeEndpoint(endpoint: string): string {
  return String(endpoint || '').replace(/\/+$/, '');
}

function formatToResponseFormat(format: SpeechFormat): string {
  if (format === 'wav') return 'wav';
  if (format === 'opus') return 'opus';
  if (format === 'pcm') return 'pcm';
  return 'mp3';
}

function inferFormatFromMimeType(mimeType: string): SpeechFormat {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('opus') || normalized.includes('ogg')) return 'opus';
  if (normalized.includes('pcm')) return 'pcm';
  return 'mp3';
}

function makeRequestHeaders(config: SpeechAdapterConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(config.headers ?? {}),
  };
}

function toSpeechPayload(
  config: SpeechAdapterConfig,
  request: SpeechSynthesizeRequest,
): Record<string, unknown> {
  const format = request.format ?? 'mp3';
  const payloadBase: Record<string, unknown> = {
    model: request.model,
    input: request.text,
    voice: request.voice || 'alloy',
    response_format: formatToResponseFormat(format),
  };
  if (typeof request.speed === 'number') payloadBase.speed = request.speed;
  const providerParams = config.transformRequest
    ? config.transformRequest(request.providerParams ?? {})
    : (request.providerParams ?? {});
  return {
    ...payloadBase,
    ...providerParams,
  };
}

export class OpenAICompatibleSpeechAdapter implements SpeechAdapter {
  readonly type: ProviderType;
  readonly config: SpeechAdapterConfig;

  constructor(type: ProviderType, config: SpeechAdapterConfig) {
    this.type = type;
    this.config = {
      ...config,
      endpoint: normalizeEndpoint(config.endpoint),
    };
  }

  async synthesize(request: SpeechSynthesizeRequest): Promise<SpeechSynthesizeResult> {
    const fetchImpl = this.config.fetch ?? fetch;
    const response = await fetchImpl(`${this.config.endpoint}/audio/speech`, {
      method: 'POST',
      headers: makeRequestHeaders(this.config),
      body: JSON.stringify(toSpeechPayload(this.config, request)),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`SPEECH_SYNTHESIZE_FAILED: HTTP_${response.status} ${bodyText || response.statusText}`);
    }

    const audioBytes = new Uint8Array(await response.arrayBuffer());
    const mimeType = String(response.headers.get('content-type') || 'audio/mpeg');
    const outputFormat = request.format ?? inferFormatFromMimeType(mimeType);
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error('SPEECH_OUTPUT_INVALID: URL.createObjectURL is unavailable');
    }
    const audioUri = URL.createObjectURL(new Blob([audioBytes], { type: mimeType }));

    return {
      audioUri,
      format: outputFormat,
      mimeType,
      sampleRateHz: request.sampleRateHz,
      raw: {
        status: response.status,
        endpoint: `${this.config.endpoint}/audio/speech`,
      },
    };
  }

  async stream(request: SpeechSynthesizeRequest): Promise<SpeechNativeStreamResponse> {
    const fetchImpl = this.config.fetch ?? fetch;
    const response = await fetchImpl(`${this.config.endpoint}/audio/speech`, {
      method: 'POST',
      headers: makeRequestHeaders(this.config),
      body: JSON.stringify(toSpeechPayload(this.config, request)),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`SPEECH_SYNTHESIZE_FAILED: HTTP_${response.status} ${bodyText || response.statusText}`);
    }

    if (!response.body || typeof response.body.getReader !== 'function') {
      throw new Error('SPEECH_STREAM_UNSUPPORTED: response body stream unavailable');
    }

    const reader = response.body.getReader();
    const mimeType = String(response.headers.get('content-type') || 'audio/mpeg');
    const outputFormat = request.format ?? inferFormatFromMimeType(mimeType);
    const providerTraceId = String(
      response.headers.get('x-request-id')
      || response.headers.get('x-trace-id')
      || '',
    ).trim() || undefined;

    async function* chunksFromReader(): AsyncIterable<Uint8Array> {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          yield value instanceof Uint8Array ? value : new Uint8Array(value);
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // noop
        }
      }
    }

    return {
      format: outputFormat,
      mimeType,
      sampleRateHz: request.sampleRateHz,
      channels: 1,
      providerTraceId,
      chunks: chunksFromReader(),
    };
  }

  async healthCheck(model?: string): Promise<SpeechHealthResult> {
    const fetchImpl = this.config.fetch ?? fetch;
    const startedAt = Date.now();
    try {
      const response = await fetchImpl(`${this.config.endpoint}/models`, {
        headers: this.config.headers,
      });
      if (!response.ok) {
        return {
          status: 'unreachable',
          detail: `HTTP_${response.status}: ${response.statusText}`,
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
        };
      }

      if (!model) {
        return {
          status: 'healthy',
          detail: 'reachable',
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
        };
      }

      const payload = await response.json().catch(() => ({ data: [] }));
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const found = data.some((item: unknown) => String((item as { id?: unknown })?.id || '') === model);
      return {
        status: found ? 'healthy' : 'unsupported',
        detail: found ? `model found: ${model}` : `model not found: ${model}`,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        status: 'unreachable',
        detail: error instanceof Error ? error.message : String(error || 'unknown error'),
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}
