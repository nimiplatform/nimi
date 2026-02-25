import type { ProviderType } from '../types';
import type {
  SpeechAdapter,
  SpeechAdapterConfig,
  SpeechHealthResult,
  SpeechSynthesizeRequest,
  SpeechSynthesizeResult,
} from './types';

function normalizeEndpoint(endpoint: string): string {
  return String(endpoint || '').replace(/\/+$/, '');
}

export class VolcengineCompatibleSpeechAdapter implements SpeechAdapter {
  readonly type: ProviderType = 'VOLCENGINE_COMPATIBLE';
  readonly config: SpeechAdapterConfig;

  constructor(type: ProviderType, config: SpeechAdapterConfig) {
    void type;
    this.config = {
      ...config,
      endpoint: normalizeEndpoint(config.endpoint),
    };
  }

  async synthesize(request: SpeechSynthesizeRequest): Promise<SpeechSynthesizeResult> {
    const fetchImpl = this.config.fetch ?? fetch;
    const appid = String(
      (request.providerParams?.appid as string)
      || (this.config.headers?.['X-Volcengine-AppId'])
      || '',
    ).trim();
    const cluster = String(
      (request.providerParams?.cluster as string)
      || 'volcano_tts',
    ).trim();

    const body = {
      app: {
        appid,
        cluster,
      },
      user: {
        uid: 'nimi-runtime',
      },
      audio: {
        voice_type: request.voice || 'BV001_streaming',
        encoding: request.format || 'mp3',
        speed_ratio: request.speed || 1.0,
        sample_rate: request.sampleRateHz || 24000,
      },
      request: {
        text: request.text,
        operation: 'query',
      },
    };

    const response = await fetchImpl('https://openspeech.bytedance.com/api/v1/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`VOLCENGINE_TTS_FAILED: HTTP_${response.status} ${bodyText || response.statusText}`);
    }

    const payload = await response.json();
    const audioBase64 = payload?.data;
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      throw new Error('VOLCENGINE_TTS_FAILED: response missing data (base64 audio)');
    }

    const binaryString = atob(audioBase64);
    const audioBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      audioBytes[i] = binaryString.charCodeAt(i);
    }

    const outputFormat = request.format ?? 'mp3';
    const mimeType = outputFormat === 'wav' ? 'audio/wav'
      : outputFormat === 'opus' ? 'audio/ogg'
        : outputFormat === 'pcm' ? 'audio/pcm'
          : 'audio/mpeg';

    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error('VOLCENGINE_TTS_FAILED: URL.createObjectURL is unavailable');
    }
    const audioUri = URL.createObjectURL(new Blob([audioBytes], { type: mimeType }));

    return {
      audioUri,
      format: outputFormat,
      mimeType,
      sampleRateHz: request.sampleRateHz,
      raw: {
        endpoint: 'https://openspeech.bytedance.com/api/v1/tts',
        cluster,
      },
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
      return {
        status: model ? 'healthy' : 'healthy',
        detail: model ? `model assumed: ${model}` : 'reachable',
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
