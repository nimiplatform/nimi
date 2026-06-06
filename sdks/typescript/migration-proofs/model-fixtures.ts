import type { NimiAiModel, NimiGenerateTextRequest, NimiGenerateTextResult } from '../core/ai';
import type { NimiRunEvent, NimiToolCall } from '../core/contracts';

export interface NimiProofModelFixture {
  readonly model: NimiAiModel;
  readonly calls: readonly NimiGenerateTextRequest[];
}

export function createNimiProofModel(options: {
  readonly modelId: string;
  readonly text?: string;
  readonly toolCalls?: readonly NimiToolCall[];
  readonly stream?: readonly NimiRunEvent[];
}): NimiProofModelFixture {
  const calls: NimiGenerateTextRequest[] = [];
  const result: NimiGenerateTextResult = {
    text: options.text ?? `${options.modelId}:ok`,
    finishReason: options.toolCalls && options.toolCalls.length > 0 ? 'tool-calls' : 'stop',
    usage: {
      promptTokens: 8,
      completionTokens: 4,
      totalTokens: 12,
    },
    toolCalls: options.toolCalls,
  };

  return {
    calls,
    model: {
      model: {
        providerId: 'proof',
        modelId: options.modelId,
      },
      async generateText(request) {
        calls.push(request);
        return result;
      },
      async *streamText() {
        const stream = options.stream ?? [
          { type: 'text-delta' as const, text: result.text },
          { type: 'done' as const, finishReason: result.finishReason, usage: result.usage },
        ];
        for (const event of stream) {
          yield event;
        }
      },
    },
  };
}
