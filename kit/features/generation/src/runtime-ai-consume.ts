import {
  ReasonCode,
  asNimiError,
  createNimiError,
  createNimiRuntimeAIModel,
  textPart,
  type NimiError,
  type NimiRuntimeAIScenarioClient,
  type NimiRuntimeEmbeddingScenarioClient,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  runtimeExecutionUnavailable,
  runtimeUnavailableReasonFromError,
} from './runtime-diagnostics.js';

export type RuntimeAIConsumeCapabilityId = 'text.generate' | 'chat.stream' | 'text.embed';

export type RuntimeAIConsumeUnavailableReason =
  | 'input-invalid'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export type RuntimeAIConsumeTrace = {
  readonly traceId?: string;
  readonly modelResolved?: string;
  readonly routeDecision?: string;
};

export type RuntimeAIConsumeOutput =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly finishReason: string;
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly totalTokens?: number;
      readonly streamed: boolean;
    }
  | {
      readonly kind: 'embedding';
      readonly vectorCount: number;
      readonly dimensions: number;
      readonly sample: readonly number[];
      readonly totalTokens?: number;
    };

export type RuntimeAIConsumeSuccess = {
  readonly ok: true;
  readonly capabilityId: RuntimeAIConsumeCapabilityId;
  readonly message: string;
  readonly output: RuntimeAIConsumeOutput;
  readonly trace?: RuntimeAIConsumeTrace;
};

export type RuntimeAIConsumeUnavailable = {
  readonly ok: false;
  readonly capabilityId: RuntimeAIConsumeCapabilityId;
  readonly reason: RuntimeAIConsumeUnavailableReason;
  readonly message: string;
  readonly error: NimiError;
};

export type RuntimeAIConsumeResult = RuntimeAIConsumeSuccess | RuntimeAIConsumeUnavailable;

export type RuntimeAIConsumeRuntime = {
  readonly ai: NimiRuntimeAIScenarioClient & NimiRuntimeEmbeddingScenarioClient;
};

export type RuntimeAIConsumeInput = {
  readonly runtime: RuntimeAIConsumeRuntime;
  readonly appId: string;
  readonly capabilityId: RuntimeAIConsumeCapabilityId;
  readonly prompt: string;
  readonly directive?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly metadata?: Readonly<Record<string, string | undefined>>;
  readonly onPartial?: (accumulatedText: string) => void;
  readonly signal?: AbortSignal;
};

/**
 * Executes owner-driven text.generate through the SDK Runtime AI model. The
 * request carries App/capability input only; AIConfig route, implementation,
 * target, ConnectorGrant, and machine selection remain Runtime-owned.
 */
export async function runRuntimeAIConsumeCapability(
  input: RuntimeAIConsumeInput,
): Promise<RuntimeAIConsumeResult> {
  if (input.capabilityId !== 'text.generate') {
    return {
      ok: false,
      capabilityId: input.capabilityId,
      ...runtimeExecutionUnavailable(input.capabilityId),
    };
  }
  if (!input.prompt.trim()) {
    const error = createNimiError({
      message: 'Text generation input is required.',
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint: 'provide_text_generation_input',
      source: 'sdk',
    });
    return {
      ok: false,
      capabilityId: input.capabilityId,
      reason: 'input-invalid',
      message: error.message,
      error,
    };
  }

  try {
    const model = createNimiRuntimeAIModel({
      runtime: input.runtime,
      appId: input.appId,
      subjectUserId: input.subjectUserId,
      metadata: runtimeConsumeMetadata(input),
    });
    const result = await model.generateText({
      messages: [
        ...(input.directive?.trim()
          ? [{ role: 'system' as const, content: [textPart(input.directive.trim())] }]
          : []),
        { role: 'user', content: [textPart(input.prompt)] },
      ],
      signal: input.signal,
    });
    const trace = runtimeConsumeTrace(result.raw);
    return {
      ok: true,
      capabilityId: input.capabilityId,
      message: result.text,
      output: {
        kind: 'text',
        text: result.text,
        finishReason: result.finishReason,
        ...(result.usage ? {
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        } : {}),
        streamed: false,
      },
      ...(trace ? { trace } : {}),
    };
  } catch (cause) {
    const error = asNimiError(cause, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'inspect_runtime_ai_execution',
      source: 'runtime',
    });
    return {
      ok: false,
      capabilityId: input.capabilityId,
      reason: runtimeUnavailableReasonFromError(error),
      message: error.message,
      error,
    };
  }
}

function runtimeConsumeMetadata(input: RuntimeAIConsumeInput): Record<string, string> {
  return Object.fromEntries(Object.entries({
    scenarioId: input.scenarioId,
    surfaceId: input.surfaceId,
    ...(input.metadata ?? {}),
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
}

function runtimeConsumeTrace(raw: unknown): RuntimeAIConsumeTrace | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const traceId = text(record.traceId);
  const modelResolved = text(record.modelResolved);
  const routeDecision = text(record.routeDecision);
  if (!traceId && !modelResolved && !routeDecision) return undefined;
  return {
    ...(traceId ? { traceId } : {}),
    ...(modelResolved ? { modelResolved } : {}),
    ...(routeDecision ? { routeDecision } : {}),
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
