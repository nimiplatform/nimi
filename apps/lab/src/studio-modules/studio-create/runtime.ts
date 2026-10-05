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
  type StudioTextCandidateParameters,
  type StudioTextTurnParameters,
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
  const parameters = context.input.parameters as StudioTextCandidateParameters | undefined;
  const attachments = context.input.attachments ?? [];
  if (attachments.length > 0) {
    const image = attachments[0];
    if (attachments.length !== 1 || !image || !['image/jpeg', 'audio/wav', 'audio/mpeg', 'video/mp4'].includes(image.mimeType)) {
      return context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('Studio.profiles.textGenerate.imageInvalid'));
    }
    const prefix = `data:${image.mimeType};base64,`;
    if (!image.dataUrl.startsWith(prefix) || image.dataUrl.length > prefix.length + 4 * Math.ceil(32 * 1024 * 1024 / 3)) {
      return context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('Studio.profiles.textGenerate.imageTooLarge'));
    }
    if (context.input.signal?.aborted) {
      return context.host.nonSuccess(context.capability, 'operation-aborted', context.host.translate('Studio.profiles.textGenerate.imageStopped'));
    }
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(image.dataUrl.slice(prefix.length)), (char) => char.charCodeAt(0));
    } catch {
      return context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('Studio.profiles.textGenerate.imageInvalid'));
    }
    if (bytes.byteLength === 0 || bytes.byteLength > 32 * 1024 * 1024) {
      return context.host.nonSuccess(context.capability, 'input-invalid', context.host.translate('Studio.profiles.textGenerate.imageTooLarge'));
    }
    const upload = await context.host.client.ai.artifacts.upload({
      bytes,
      mimeType: image.mimeType as Parameters<typeof context.host.client.ai.artifacts.upload>[0]['mimeType'],
    });
    if (context.input.signal?.aborted) {
      return context.host.nonSuccess(context.capability, 'operation-aborted', context.host.translate('Studio.profiles.textGenerate.imageStopped'));
    }
    const response = await context.host.client.ai.scenario.execute({
      type: 'text-generate',
      messages: [{
        role: 'user',
        text: '',
        parts: [
          { type: 'text', text: context.prompt },
          { type: 'artifact-ref', artifactId: upload.artifactId, mediaType: image.mimeType as 'image/jpeg' | 'audio/wav' | 'audio/mpeg' | 'video/mp4', displayName: image.name },
        ],
      }],
      ...textCandidateParameters(parameters),
    }, { signal: context.input.signal });
    if (context.input.signal?.aborted) {
      return context.host.nonSuccess(context.capability, 'operation-aborted', context.host.translate('Studio.profiles.textGenerate.imageStopped'));
    }
    // This one-turn image request has no follow-up turn to carry opaque state into.
    const items = response.output.type === 'text-generate'
      ? response.output.items.filter((item) => item.type !== 'reasoning-continuity') : [];
    const answer = items.length === 1 && items[0]?.type === 'text' ? items[0].text : '';
    if (response.output.type !== 'text-generate' || response.output.finishReason !== 'stop' || !answer.trim()) {
      return context.host.nonSuccess(context.capability, 'runtime-call-failed', context.host.translate('Studio.profiles.textGenerate.imageOutputInvalid'));
    }
    const extension = image.mimeType === 'audio/wav' ? 'wav' : image.mimeType === 'audio/mpeg' ? 'mp3' : image.mimeType === 'video/mp4' ? 'mp4' : 'jpg';
    const relativePath = `studio/text-generate-inputs/${crypto.randomUUID()}.${extension}`;
    let sourceImage;
    let message = context.host.translate('Studio.profiles.textGenerate.imageCompleted');
    try {
      const saved = await context.host.client.storage.assets.write({
        relativePath, body: bytes, mediaType: image.mimeType, overwrite: false,
      });
      if (context.input.signal?.aborted) {
        await context.host.client.storage.assets.remove(relativePath).catch(() => undefined);
        return context.host.nonSuccess(context.capability, 'operation-aborted', context.host.translate('Studio.profiles.textGenerate.imageStopped'));
      }
      if (saved.relativePath !== relativePath || saved.sizeBytes !== bytes.byteLength ||
        !/^sha256:[0-9a-f]{64}$/u.test(saved.sha256)) {
        await context.host.client.storage.assets.remove(relativePath).catch(() => undefined);
        throw new Error('saved image identity mismatch');
      }
      sourceImage = {
        relativePath: saved.relativePath, mediaType: image.mimeType, sizeBytes: saved.sizeBytes,
        sha256: saved.sha256, displayName: image.name, previewSource: 'managed-asset' as const,
      };
    } catch {
      if (context.input.signal?.aborted) {
        return context.host.nonSuccess(context.capability, 'operation-aborted', context.host.translate('Studio.profiles.textGenerate.imageStopped'));
      }
      message = context.host.translate('Studio.profiles.textGenerate.imageCompletedWithoutSource');
    }
    return {
      ok: true as const,
      capabilityId: context.capability.id,
      capabilityLabel: context.capability.label,
      message,
      output: {
        kind: 'text' as const,
        text: answer,
        finishReason: response.output.finishReason,
        streamed: false,
        ...(sourceImage ? { sourceImage } : {}),
      },
      trace: response.traceId ? { traceId: response.traceId } : undefined,
    };
  }
  const result = await context.host.client.ai.text.generateCandidate({
    messages: [{ role: 'user', text: context.prompt }],
    ...textCandidateParameters(parameters),
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
      parameters: textTurnParameters(
        context.input.parameters as StudioTextTurnParameters,
      ),
    } : {}),
    scenarioId: context.scenarioId,
    surfaceId: context.host.surfaceId,
    ...(context.input.onPartial ? { onPartial: context.input.onPartial } : {}),
    ...(context.input.signal ? { signal: context.input.signal } : {}),
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
  const parameters = context.input.parameters as StudioEmbeddingParameters | undefined;
  const embeddingInputs = nonEmptyEmbeddingInputs(
    parameters,
  );
  if (!context.prompt && embeddingInputs.length === 0) return inputRequired(context);
  const result = await context.host.client.ai.scenario.execute({
    type: 'text-embed',
    inputs: embeddingInputs.length > 0 ? embeddingInputs : [context.prompt],
    ...(parameters?.dimensions !== undefined ? { dimensions: parameters.dimensions } : {}),
  });
  if (result.output.type !== 'text-embed') {
    return context.host.nonSuccess(
      context.capability,
      'runtime-call-failed',
      'Runtime embedding returned an unexpected output type.',
    );
  }
  // Equal dimensions do not make vectors comparable; only the owner-reported
  // space identifies them, so a result without it is not a reusable result.
  const spaceId = typeof result.output.spaceId === 'string' ? result.output.spaceId.trim() : '';
  if (!spaceId) {
    return context.host.nonSuccess(
      context.capability,
      'runtime-call-failed',
      'Runtime embedding omitted its embedding space.',
    );
  }
  const first = result.output.vectors[0] ?? [];
  return {
    ok: true as const,
    capabilityId: context.capability.id,
    capabilityLabel: context.capability.label,
    message: `Runtime completed text.embed with ${result.output.vectors.length} vector(s) in space ${spaceId}.`,
    output: {
      kind: 'embedding' as const,
      vectorCount: result.output.vectors.length,
      dimensions: first.length,
      spaceId,
      sample: [...first.slice(0, 8)],
      ...(result.output.usage ? { totalTokens: result.output.usage.totalTokens } : {}),
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
    let textItemOpened = false;
    for await (const event of subscription) {
      // This one-turn text surface has no follow-up turn to carry opaque state into.
      if (event.type === 'reasoning-continuity') continue;
      if (event.type === 'reasoning-summary') {
        throw Object.assign(new Error('The text-only Studio request received an unrequested reasoning summary.'), { reasonCode: 'SDK_AI_RUNTIME_OUTPUT_INVALID' });
      }
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
        textItemOpened = true;
        yield localTextDeltaEvent(event);
        continue;
      }
      if (event.type === 'failed') {
        throw Object.assign(new Error(event.actionHint || 'Runtime Scenario stream failed.'), {
          reasonCode: event.reasonCode,
          actionHint: event.actionHint,
        });
      }
      if (event.type === 'tool-call' || event.finishReason === 'tool-calls') {
        throw Object.assign(new Error('The text-only Studio request received undeclared tool output.'), {
          reasonCode: 'SDK_AI_RUNTIME_OUTPUT_INVALID',
        });
      }
      if (textItemOpened) {
        yield localTextCompletionDeltaEvent(event);
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
    if (signal?.aborted) throw studioAbortError();
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
      delta: {
        delta: {
          oneofKind: 'textOutputItem',
          textOutputItem: {
            itemIndex: 0,
            delta: { oneofKind: 'text', text: { text: event.text } },
            itemCompleted: false,
          },
        },
      },
    },
  };
}

function localTextCompletionDeltaEvent(
  event: Extract<NimiLocalAppTextTurnEvent, { type: 'completed' }>,
): RuntimeStreamEvent {
  return {
    eventType: 2,
    sequence: event.sequence,
    traceId: event.traceId,
    payload: {
      oneofKind: 'delta',
      delta: {
        delta: {
          oneofKind: 'textOutputItem',
          textOutputItem: {
            itemIndex: 0,
            delta: { oneofKind: undefined },
            itemCompleted: true,
          },
        },
      },
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

function textCandidateParameters(
  parameters: StudioTextCandidateParameters | undefined,
): StudioTextCandidateParameters {
  if (!parameters) return {};
  return {
    ...(parameters.temperature !== undefined ? { temperature: parameters.temperature } : {}),
    ...(parameters.topP !== undefined ? { topP: parameters.topP } : {}),
    ...(parameters.maxTokens !== undefined ? { maxTokens: parameters.maxTokens } : {}),
  };
}

function textTurnParameters(
  parameters: StudioTextTurnParameters | undefined,
): StudioTextTurnParameters {
  if (!parameters) return {};
  return {
    ...textCandidateParameters(parameters),
    ...(parameters.topK !== undefined ? { topK: parameters.topK } : {}),
    ...(parameters.presencePenalty !== undefined ? { presencePenalty: parameters.presencePenalty } : {}),
    ...(parameters.frequencyPenalty !== undefined ? { frequencyPenalty: parameters.frequencyPenalty } : {}),
    ...(parameters.stop !== undefined ? { stop: [...parameters.stop] } : {}),
    ...(parameters.seed !== undefined ? { seed: parameters.seed } : {}),
  };
}
