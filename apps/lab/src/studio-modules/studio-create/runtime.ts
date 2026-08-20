import type { RuntimeAIConsumeRuntime } from '@nimiplatform/kit/features/generation/runtime';
import type { NimiRuntimeAIScenarioClient } from '@nimiplatform/sdk/ai';
import type { NimiLocalAppTextTurnEvent } from '@nimiplatform/sdk/app';
import { ExecutionMode, FinishReason, ScenarioType } from '@nimiplatform/sdk/runtime/generated';
import type { StudioCapabilityRuntimeHandlers } from '../../ai-studio-core/runtime-dispatcher.js';
import {
  projectStudioRunnerNonSuccess,
  studioAbortError,
  type StudioCapabilityRuntimeContext,
} from '../../ai-studio-core/runtime.js';
import {
  nonEmptyEmbeddingInputs,
  type StudioEmbeddingParameters,
  type StudioTextGenerationParameters,
} from './parameters.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

type RuntimeStreamEvent = ReturnType<NimiRuntimeAIScenarioClient['streamScenario']> extends AsyncIterable<infer TEvent>
  ? TEvent
  : never;

export const studioCreateRuntimeHandlers: StudioCapabilityRuntimeHandlers = Object.freeze({
  'text.generate': runTextGenerate,
  'chat.stream': runChatStream,
  'text.embed': runTextEmbed,
});

async function runTextGenerate(context: StudioCapabilityRuntimeContext) {
  if (!context.prompt) return inputRequired(context);
  const parameters = context.input.parameters as StudioTextGenerationParameters | undefined;
  const result = await context.host.client.ai.text.generateCandidate({
    messages: [{ role: 'user', text: context.prompt }],
    ...textGenerationParameters(parameters),
  });
  return {
    ok: true as const,
    capabilityId: context.capability.id,
    capabilityLabel: context.capability.label,
    message: 'Runtime completed the protected foreground text candidate request.',
    output: {
      kind: 'text' as const,
      text: result.text,
      finishReason: result.finishReason,
      streamed: false,
    },
    trace: result.traceId ? { traceId: result.traceId } : undefined,
  };
}

async function runChatStream(context: StudioCapabilityRuntimeContext) {
  if (!context.prompt) return inputRequired(context);
  if (context.input.attachments?.length) {
    return context.host.nonSuccess(
      context.capability,
      'input-invalid',
      'The protected Local App text stream currently accepts text messages only.',
    );
  }
  const result = await context.host.runners.aiConsume({
    runtime: createLocalAppTextScenarioRuntime(context),
    appId: context.host.appId,
    capabilityId: 'chat.stream',
    prompt: context.prompt,
    ...(context.input.directive?.trim() ? { directive: context.input.directive.trim() } : {}),
    ...(context.input.parameters ? {
      parameters: textGenerationParameters(
        context.input.parameters as StudioTextGenerationParameters,
      ),
    } : {}),
    scenarioId: context.scenarioId,
    surfaceId: context.host.surfaceId,
    ...(context.input.onPartial ? { onPartial: context.input.onPartial } : {}),
  });
  if (result.ok === false) return projectStudioRunnerNonSuccess(context, result);
  if (result.output.kind !== 'text') {
    return context.host.nonSuccess(
      context.capability,
      'runtime-call-failed',
      'Runtime stream returned a non-text output.',
    );
  }
  return {
    ok: true as const,
    capabilityId: context.capability.id,
    capabilityLabel: context.capability.label,
    message: result.message,
    output: { ...result.output },
    ...(result.trace?.traceId ? { trace: { traceId: result.trace.traceId } } : {}),
  };
}

async function runTextEmbed(context: StudioCapabilityRuntimeContext) {
  const embeddingInputs = nonEmptyEmbeddingInputs(
    context.input.parameters as StudioEmbeddingParameters | undefined,
  );
  if (!context.prompt && embeddingInputs.length === 0) return inputRequired(context);
  const result = await context.host.client.ai.scenario.execute({
    type: 'text-embed',
    inputs: embeddingInputs.length > 0 ? embeddingInputs : [context.prompt],
  });
  if (result.output.type !== 'text-embed') {
    return context.host.nonSuccess(
      context.capability,
      'runtime-call-failed',
      'Runtime embedding returned an unexpected output type.',
    );
  }
  const first = result.output.vectors[0] ?? [];
  return {
    ok: true as const,
    capabilityId: context.capability.id,
    capabilityLabel: context.capability.label,
    message: `Runtime completed text.embed with ${result.output.vectors.length} vector(s).`,
    output: {
      kind: 'embedding' as const,
      vectorCount: result.output.vectors.length,
      dimensions: first.length,
      sample: [...first.slice(0, 8)],
    },
    ...(result.traceId ? { trace: { traceId: result.traceId } } : {}),
  };
}

function inputRequired(context: StudioCapabilityRuntimeContext) {
  return context.host.nonSuccess(
    context.capability,
    'input-invalid',
    `${context.capability.label} requires non-empty input.`,
  );
}

function createLocalAppTextScenarioRuntime(
  context: StudioCapabilityRuntimeContext,
): RuntimeAIConsumeRuntime {
  const ai: NimiRuntimeAIScenarioClient = {
    async executeScenario() {
      throw Object.assign(new Error('Local App text execution is stream-only on this adapter.'), {
        reasonCode: 'SDK_RUNTIME_METHOD_UNAVAILABLE',
      });
    },
    streamScenario(request, options) {
      return streamLocalAppTextEvents(context, request, options?.signal);
    },
  };
  return { ai };
}

async function* streamLocalAppTextEvents(
  context: StudioCapabilityRuntimeContext,
  request: Parameters<NimiRuntimeAIScenarioClient['streamScenario']>[0],
  signal?: AbortSignal,
): AsyncIterable<RuntimeStreamEvent> {
  const spec = request.spec?.spec;
  if (
    request.scenarioType !== ScenarioType.TEXT_GENERATE
    || request.executionMode !== ExecutionMode.STREAM
    || request.extensions.length > 0
    || spec?.oneofKind !== 'textGenerate'
  ) {
    throw Object.assign(new Error('Local App text stream requires the closed textGenerate Scenario shape.'), {
      reasonCode: 'SDK_AI_INPUT_INVALID',
    });
  }
  const textSpec = spec.textGenerate;
  if (
    textSpec.tools.length > 0
    || textSpec.toolChoiceName
    || textSpec.input.some((message) => message.role !== 'user')
  ) {
    throw Object.assign(new Error('Local App text stream does not admit tools or advanced generation controls.'), {
      reasonCode: 'SDK_AI_INPUT_INVALID',
    });
  }
  const messages = [
    ...(textSpec.systemPrompt ? [{ role: 'system' as const, text: textSpec.systemPrompt }] : []),
    ...textSpec.input.map((message) => ({ role: 'user' as const, text: message.content })),
  ];
  const seed = localTextSeed(textSpec.seed);
  const subscription = await context.host.client.ai.text.streamTurn({
    messages,
    ...(textSpec.temperature !== undefined ? { temperature: textSpec.temperature } : {}),
    ...(textSpec.topP !== undefined ? { topP: textSpec.topP } : {}),
    ...(textSpec.maxTokens !== undefined ? { maxTokens: textSpec.maxTokens } : {}),
    ...(textSpec.topK !== undefined ? { topK: textSpec.topK } : {}),
    ...(textSpec.presencePenalty !== undefined ? { presencePenalty: textSpec.presencePenalty } : {}),
    ...(textSpec.frequencyPenalty !== undefined ? { frequencyPenalty: textSpec.frequencyPenalty } : {}),
    ...(textSpec.stop.length > 0 ? { stop: [...textSpec.stop] } : {}),
    ...(seed !== undefined ? { seed } : {}),
  });
  let canceled = false;
  const cancel = () => {
    if (canceled) return;
    canceled = true;
    void subscription.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) throw studioAbortError();
    let started = false;
    for await (const event of subscription) {
      if (!started) {
        started = true;
        yield {
          eventType: 1,
          sequence: event.sequence,
          traceId: event.traceId,
          payload: {
            oneofKind: 'started',
            started: { modelResolved: '', routeDecision: 0, voiceOutputMode: 0 },
          },
        };
      }
      if (event.type === 'delta') {
        yield localTextDeltaEvent(event);
        continue;
      }
      if (event.type === 'failed') {
        throw Object.assign(new Error(event.actionHint || 'Runtime Scenario stream failed.'), {
          reasonCode: event.reasonCode,
          actionHint: event.actionHint,
        });
      }
      yield {
        eventType: 6,
        sequence: event.sequence,
        traceId: event.traceId,
        payload: {
          oneofKind: 'completed',
          completed: {
            finishReason: localFinishReason(event.finishReason),
            streamSimulated: false,
          },
        },
      };
      return;
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
}

function localTextSeed(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seed = Number(value);
  if (!Number.isSafeInteger(seed)) {
    throw Object.assign(new Error('Local App text seed must be a safe integer.'), {
      reasonCode: 'SDK_AI_INPUT_INVALID',
    });
  }
  return seed;
}

function localTextDeltaEvent(
  event: Extract<NimiLocalAppTextTurnEvent, { type: 'delta' }>,
): RuntimeStreamEvent {
  return {
    eventType: 2,
    sequence: event.sequence,
    traceId: event.traceId,
    payload: {
      oneofKind: 'delta',
      delta: { delta: { oneofKind: 'text', text: { text: event.text } } },
    },
  };
}

function localFinishReason(
  reason: Extract<NimiLocalAppTextTurnEvent, { type: 'completed' }>['finishReason'],
): FinishReason {
  if (reason === 'length') return FinishReason.LENGTH;
  if (reason === 'content-filter') return FinishReason.CONTENT_FILTER;
  return FinishReason.STOP;
}

function textGenerationParameters(
  parameters: StudioTextGenerationParameters | undefined,
): StudioTextGenerationParameters {
  if (!parameters) return {};
  return {
    ...(parameters.temperature !== undefined ? { temperature: parameters.temperature } : {}),
    ...(parameters.topP !== undefined ? { topP: parameters.topP } : {}),
    ...(parameters.maxTokens !== undefined ? { maxTokens: parameters.maxTokens } : {}),
    ...(parameters.topK !== undefined ? { topK: parameters.topK } : {}),
    ...(parameters.presencePenalty !== undefined ? { presencePenalty: parameters.presencePenalty } : {}),
    ...(parameters.frequencyPenalty !== undefined ? { frequencyPenalty: parameters.frequencyPenalty } : {}),
    ...(parameters.stop !== undefined ? { stop: [...parameters.stop] } : {}),
    ...(parameters.seed !== undefined ? { seed: parameters.seed } : {}),
  };
}
