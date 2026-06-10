import { Agent } from '@mastra/core/agent';

import type {
  NimiAiModel,
  NimiGenerateTextRequest,
  NimiGenerateTextResult,
} from '@nimiplatform/sdk/ai';
import type { NimiRunEvent } from '@nimiplatform/sdk/contracts';

type MastraAgentConfig = ConstructorParameters<typeof Agent>[0];

/**
 * Construct a real Mastra Agent for tests, defaulting the required `id` from
 * `name`. Mastra's modern AgentConfig requires an explicit id; tests only care
 * about name/instructions/model/tools, so this keeps them focused on behavior.
 */
export function createMastraTestAgent(config: Omit<MastraAgentConfig, 'id'> & { readonly name: string }) {
  return new Agent({ ...config, id: config.name } as MastraAgentConfig);
}

export interface NimiMastraModelFixture {
  readonly model: NimiAiModel;
  readonly calls: NimiGenerateTextRequest[];
}

export interface NimiFixtureOptions {
  readonly modelId?: string;
  // One result per generateText call, for multi-step Mastra agent loops. The last
  // entry is reused if Mastra issues more model calls than scripted results.
  readonly results?: readonly NimiGenerateTextResult[];
  // A single result for every generateText call.
  readonly result?: NimiGenerateTextResult;
  // Run events for streamText, so Mastra Agent.stream() can be driven deterministically.
  readonly stream?: readonly NimiRunEvent[];
  // One stream event script per streamText call, for multi-step Mastra stream loops.
  readonly streams?: readonly (readonly NimiRunEvent[])[];
}

const DEFAULT_USAGE = { promptTokens: 4, completionTokens: 6, totalTokens: 10 } as const;

/**
 * A NimiAiModel whose generateText/streamText return scripted, deterministic
 * output so a real Mastra Agent can drive it. `calls` records every
 * NimiGenerateTextRequest the adapter forwarded, letting tests assert what Mastra
 * sent to the model (messages, tools, toolChoice, responseFormat, parameters).
 */
export function createNimiFixtureModel(options: NimiFixtureOptions = {}): NimiMastraModelFixture {
  const calls: NimiGenerateTextRequest[] = [];
  let callIndex = 0;
  let streamIndex = 0;

  const nextResult = (): NimiGenerateTextResult => {
    if (options.results && options.results.length > 0) {
      const result = options.results[Math.min(callIndex, options.results.length - 1)];
      callIndex += 1;
      return result;
    }
    return options.result ?? { text: 'nimi-ok', finishReason: 'stop', usage: { ...DEFAULT_USAGE } };
  };

  return {
    calls,
    model: {
      model: { providerId: 'nimi-test', modelId: options.modelId ?? 'mastra-test-model' },
      async generateText(request) {
        calls.push(request);
        return nextResult();
      },
      async *streamText(request) {
        calls.push(request);
        const events: readonly NimiRunEvent[] =
          options.streams && options.streams.length > 0
            ? options.streams[Math.min(streamIndex++, options.streams.length - 1)] ?? []
            : options.stream ?? [
              { type: 'text-delta', text: 'nimi-ok' },
              { type: 'done', finishReason: 'stop', usage: { ...DEFAULT_USAGE } },
            ];
        for (const event of events) {
          yield event;
        }
      },
    },
  };
}

/** A NimiAiModel that exposes only generateText (no streamText), to test fail-closed streaming. */
export function createNonStreamingFixtureModel(text = 'no-stream'): NimiAiModel {
  return {
    model: { providerId: 'nimi-test', modelId: 'no-stream-model' },
    async generateText() {
      return { text, finishReason: 'stop', usage: { ...DEFAULT_USAGE } };
    },
  };
}
