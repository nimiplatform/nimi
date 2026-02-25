import { generateText, streamText } from 'ai';
import { classifyError } from '../../errors/classify';
import { isAbortError } from '../../errors/fallback-policy';
import type {
  InvokeRequest,
  InvokeResponse,
  LlmStreamEvent,
  ProviderAdapterConfig,
  ProviderType,
} from '../../types';
import {
  assertNotAborted,
  normalizeSdkUsage,
  type AdapterInvokeOptions,
} from '../base';
import {
  buildOpenAICompatibleProvider,
  resolveOpenAICompatibleMessages,
  resolveOpenAICompatibleProviderParams,
} from './request';
import { mapOpenAICompatibleFinishReason } from './response-map';

type OpenAICompatibleInvokeInput = {
  type: ProviderType;
  config: ProviderAdapterConfig;
  request: InvokeRequest;
  options?: AdapterInvokeOptions;
};

export async function invokeOpenAICompatible(
  input: OpenAICompatibleInvokeInput,
): Promise<InvokeResponse> {
  assertNotAborted(input.options?.signal);
  const provider = buildOpenAICompatibleProvider(input.config, input.options?.headers);
  const providerParams = resolveOpenAICompatibleProviderParams(input.config, input.request);
  const messages = resolveOpenAICompatibleMessages(input.config, input.request);

  try {
    const result = await generateText({
      model: provider(input.request.model),
      messages: messages as never,
      abortSignal: input.options?.signal,
      maxRetries: 1,
      temperature: input.request.temperature,
      maxOutputTokens: input.request.maxTokens,
      providerOptions: providerParams ? ({ openaiCompatible: providerParams } as never) : undefined,
    });

    return {
      content: result.text,
      finishReason: mapOpenAICompatibleFinishReason(result.finishReason),
      usage: normalizeSdkUsage(result.usage),
      raw: result,
    };
  } catch (error) {
    throw classifyError(error, {
      provider: input.type,
      model: input.request.model,
    });
  }
}

export async function* invokeOpenAICompatibleStream(
  input: OpenAICompatibleInvokeInput,
): AsyncIterable<LlmStreamEvent> {
  assertNotAborted(input.options?.signal);
  const provider = buildOpenAICompatibleProvider(input.config, input.options?.headers);
  const startedAt = Date.now();
  const providerParams = resolveOpenAICompatibleProviderParams(input.config, input.request);
  const messages = resolveOpenAICompatibleMessages(input.config, input.request);
  let streamResult: ReturnType<typeof streamText> | undefined;
  let doneEmitted = false;

  try {
    streamResult = streamText({
      model: provider(input.request.model),
      messages: messages as never,
      abortSignal: input.options?.signal,
      maxRetries: 1,
      temperature: input.request.temperature,
      maxOutputTokens: input.request.maxTokens,
      providerOptions: providerParams ? ({ openaiCompatible: providerParams } as never) : undefined,
    });

    for await (const part of streamResult.fullStream) {
      switch (part.type) {
        case 'text-delta':
          yield {
            type: 'text_delta',
            textDelta: part.text,
            raw: part,
          };
          break;

        case 'tool-call':
        case 'tool-input-start':
        case 'tool-input-delta':
        case 'tool-input-end':
        case 'tool-result':
        case 'tool-error':
        case 'tool-output-denied':
          yield {
            type: 'tool_use_delta',
            toolDelta: part,
            raw: part,
          };
          break;

        case 'finish':
          doneEmitted = true;
          yield {
            type: 'done',
            latencyMs: Date.now() - startedAt,
            usage: normalizeSdkUsage(part.totalUsage),
            raw: part,
          };
          break;

        case 'error':
          yield {
            type: 'error',
            raw: classifyError(part.error, {
              provider: input.type,
              model: input.request.model,
            }),
          };
          break;

        case 'abort':
          return;

        default:
          yield {
            type: 'metadata_delta',
            raw: part,
          };
      }
    }

    if (!doneEmitted && streamResult) {
      doneEmitted = true;
      yield {
        type: 'done',
        latencyMs: Date.now() - startedAt,
        usage: normalizeSdkUsage(await streamResult.totalUsage),
        raw: {
          finishReason: await streamResult.finishReason,
        },
      };
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }

    yield {
      type: 'error',
      raw: classifyError(error, {
        provider: input.type,
        model: input.request.model,
      }),
    };
  }
}
