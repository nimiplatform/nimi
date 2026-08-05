import type { NimiAiModel, NimiGenerateTextRequest, NimiGenerateTextResult } from '@nimiplatform/sdk/ai';
import type { NimiFinishReason, NimiRawChunk, NimiRunEvent, NimiToolCall, NimiUsage } from '@nimiplatform/sdk/contracts';

export const DEFAULT_USAGE: NimiUsage = { promptTokens: 2, completionTokens: 3, totalTokens: 5 };

interface UpstreamStep {
  readonly text?: string;
  readonly finishReason?: NimiFinishReason;
  readonly usage?: NimiUsage;
  readonly raw?: NimiGenerateTextResult['raw'];
  readonly content?: NimiGenerateTextResult['content'];
  readonly toolCalls?: readonly NimiToolCall[];
  readonly rawChunks?: readonly NimiRawChunk[];
  readonly events?: readonly NimiRunEvent[];
}

export function createUpstreamCompatModel(step: UpstreamStep | readonly UpstreamStep[]): {
  readonly model: NimiAiModel;
  readonly calls: NimiGenerateTextRequest[];
} {
  const steps = Array.isArray(step) ? [...step] : [step];
  const modelRef = { modelId: 'text.generate' as const };
  const calls: NimiGenerateTextRequest[] = [];
  let generateIndex = 0;
  let streamIndex = 0;
  const readStep = (index: number) => steps[Math.min(index, steps.length - 1)] ?? {};

  return {
    calls,
    model: {
      model: modelRef,
      async generateText(request) {
        calls.push(request);
        const current = readStep(generateIndex);
        generateIndex += 1;
        return {
          text: current.text ?? '',
          finishReason: current.finishReason ?? ((current.toolCalls?.length ?? 0) > 0 ? 'tool-calls' : 'stop'),
          usage: current.usage ?? DEFAULT_USAGE,
          ...(current.raw ? { raw: current.raw } : {}),
          ...(current.content ? { content: current.content } : {}),
          ...(current.toolCalls ? { toolCalls: current.toolCalls } : {}),
          ...(current.rawChunks ? { rawChunks: current.rawChunks } : {}),
        };
      },
      async *streamText(request) {
        calls.push(request);
        const current = readStep(streamIndex);
        streamIndex += 1;
        if (current.events) {
          yield* current.events;
          return;
        }
        yield { type: 'start', model: modelRef, traceId: 'stream-response-id' };
        if (current.text) {
          yield { type: 'text-delta', text: current.text };
        }
        for (const toolCall of current.toolCalls ?? []) {
          yield { type: 'tool-call', toolCall };
        }
        for (const rawChunk of current.rawChunks ?? []) {
          yield rawChunk;
        }
        yield {
          type: 'done',
          finishReason: current.finishReason ?? ((current.toolCalls?.length ?? 0) > 0 ? 'tool-calls' : 'stop'),
          usage: current.usage ?? DEFAULT_USAGE,
        };
      },
    },
  };
}
