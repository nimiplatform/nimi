import type {
  HealthResult,
  InvokeRequest,
  InvokeResponse,
  LlmStreamEvent,
  ModelProfile,
  ProviderAdapterConfig,
} from '../types';
import { assertNotAborted, type AdapterInvokeOptions, type ProviderAdapter } from './base';

function extractLastUserMessage(request: InvokeRequest) {
  const reversed = [...request.messages].reverse();
  const userMessage = reversed.find((message) => String(message.role).toLowerCase() === 'user');

  if (!userMessage) {
    return 'No input message.';
  }

  const content = userMessage.content;
  if (typeof content === 'string') {
    return content;
  }

  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export class FallbackAdapter implements ProviderAdapter {
  readonly type = 'FALLBACK' as const;
  readonly config: ProviderAdapterConfig;

  constructor(config: ProviderAdapterConfig) {
    this.config = config;
  }

  async invoke(request: InvokeRequest, options?: AdapterInvokeOptions): Promise<InvokeResponse> {
    assertNotAborted(options?.signal);

    const content = `(fallback) ${extractLastUserMessage(request)}`;

    return {
      content,
      finishReason: 'stop',
      usage: {
        input: 0,
        output: 0,
        total: 0,
      },
      raw: {
        provider: 'fallback',
      },
    };
  }

  async *invokeStream(
    request: InvokeRequest,
    options?: AdapterInvokeOptions,
  ): AsyncIterable<LlmStreamEvent> {
    assertNotAborted(options?.signal);

    const content = `(fallback) ${extractLastUserMessage(request)}`;

    yield {
      type: 'text_delta',
      textDelta: content,
      raw: {
        provider: 'fallback',
      },
    };

    yield {
      type: 'done',
      latencyMs: 0,
      usage: {
        input: 0,
        output: 0,
        total: 0,
      },
      raw: {
        provider: 'fallback',
      },
    };
  }

  async healthCheck(): Promise<HealthResult> {
    return {
      status: 'unsupported',
      detail: 'fallback adapter has no remote health endpoint',
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
    };
  }

  async listModels(): Promise<ModelProfile[]> {
    return [
      {
        id: 'fallback:echo',
        providerType: 'FALLBACK',
        model: 'fallback-echo',
        endpoint: this.config.endpoint,
        capabilities: ['chat'],
        constraints: {
          allowStreaming: true,
          allowToolUse: false,
        },
        fingerprint: {
          supportsStreaming: true,
          supportsToolUse: false,
          discoveredFrom: 'template',
        },
        healthStatus: 'unsupported',
      },
    ];
  }
}
