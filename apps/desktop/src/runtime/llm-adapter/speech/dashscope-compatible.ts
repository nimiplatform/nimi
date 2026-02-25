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

function normalizeDashScopeLanguageType(lang: unknown): string | undefined {
  const value = String(lang || '').trim().toLowerCase();
  if (!value) return undefined;
  if (value === 'chinese' || value.startsWith('zh')) return 'Chinese';
  if (value === 'english' || value.startsWith('en')) return 'English';
  if (value === 'japanese' || value.startsWith('ja')) return 'Japanese';
  if (value === 'korean' || value.startsWith('ko')) return 'Korean';
  if (value === 'french' || value.startsWith('fr')) return 'French';
  if (value === 'german' || value.startsWith('de')) return 'German';
  if (value === 'russian' || value.startsWith('ru')) return 'Russian';
  if (value === 'italian' || value.startsWith('it')) return 'Italian';
  if (value === 'spanish' || value.startsWith('es')) return 'Spanish';
  if (value === 'portuguese' || value.startsWith('pt')) return 'Portuguese';
  return value;
}

export class DashScopeCompatibleSpeechAdapter implements SpeechAdapter {
  readonly type: ProviderType = 'DASHSCOPE_COMPATIBLE';
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
    let origin: string;
    try {
      origin = new URL(this.config.endpoint).origin;
    } catch {
      origin = this.config.endpoint;
    }

    const pp = request.providerParams ?? {};
    const modelId = request.model || 'qwen3-tts-instruct-flash';

    // DashScope Qwen3-TTS API: voice/language_type/instructions go in `input`
    const input: Record<string, unknown> = {
      text: request.text,
      voice: request.voice || 'Cherry',
    };
    const languageType = normalizeDashScopeLanguageType(pp.language);
    if (languageType) input.language_type = languageType;

    // instructions for instruct models (qwen3-tts-instruct-flash)
    const instructions = String(pp.instruct || '').trim();
    if (instructions) input.instructions = instructions;

    const body = { model: modelId, input };

    const response = await fetchImpl(
      `${origin}/api/v1/services/aigc/multimodal-generation/generation`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'disable',
          ...(this.config.headers ?? {}),
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`DASHSCOPE_TTS_FAILED: HTTP_${response.status} ${bodyText || response.statusText}`);
    }

    const payload = await response.json();

    // Non-streaming response: output.audio.url (valid 24h)
    const audioObj = payload?.output?.audio;
    const audioUrl = typeof audioObj === 'string' ? audioObj : String(audioObj?.url || '').trim();
    if (!audioUrl) {
      throw new Error('DASHSCOPE_TTS_FAILED: response missing output.audio.url');
    }

    // Return the audio URL directly — HTMLAudioElement can load cross-origin
    // audio without CORS restrictions, avoiding both CORS fetch issues and
    // binary data corruption through proxyFetch (text-only body).
    const outputFormat = request.format ?? 'mp3';
    return {
      audioUri: audioUrl,
      format: outputFormat,
      mimeType: `audio/${outputFormat === 'mp3' ? 'mpeg' : outputFormat}`,
      sampleRateHz: request.sampleRateHz,
      raw: {
        endpoint: `${origin}/api/v1/services/aigc/multimodal-generation/generation`,
        model: modelId,
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
