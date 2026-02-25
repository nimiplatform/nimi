import type {
  HealthResult,
  InvokeRequest,
  InvokeResponse,
  LlmStreamEvent,
  ProviderAdapterConfig,
  ProviderType,
} from '../../types';
import {
  type AdapterInvokeOptions,
  type ProviderAdapter,
} from '../base';
import { invokeOpenAICompatible, invokeOpenAICompatibleStream } from './invoke';
import {
  healthCheckOpenAICompatible,
  listOpenAICompatibleModels,
} from './model-list';
import { normalizeOpenAICompatibleEndpoint } from './request';
import type { ModelProfile } from '../../types';

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly type: ProviderType;
  readonly config: ProviderAdapterConfig;

  constructor(type: ProviderType, config: ProviderAdapterConfig) {
    this.type = type;
    this.config = {
      ...config,
      endpoint: normalizeOpenAICompatibleEndpoint(config.endpoint),
    };
  }

  async invoke(request: InvokeRequest, options?: AdapterInvokeOptions): Promise<InvokeResponse> {
    return invokeOpenAICompatible({
      type: this.type,
      config: this.config,
      request,
      options,
    });
  }

  async *invokeStream(
    request: InvokeRequest,
    options?: AdapterInvokeOptions,
  ): AsyncIterable<LlmStreamEvent> {
    for await (const event of invokeOpenAICompatibleStream({
      type: this.type,
      config: this.config,
      request,
      options,
    })) {
      yield event;
    }
  }

  async healthCheck(model?: string): Promise<HealthResult> {
    return healthCheckOpenAICompatible(
      {
        type: this.type,
        config: this.config,
      },
      model,
    );
  }

  async listModels(): Promise<ModelProfile[]> {
    return listOpenAICompatibleModels({
      type: this.type,
      config: this.config,
    });
  }
}
