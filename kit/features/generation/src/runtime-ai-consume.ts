import {
  coerceNimiAITextGenerationParams,
  createNimiRuntimeAIModel,
  createNimiRuntimeEmbeddingClient,
  createNimiRuntimeAISchedulingClient,
  resolveNimiAIConfigRuntimeBinding,
  runNimiTextGenerate,
  streamNimiTextResponse,
  textPart,
  type NimiAIConfig,
  type NimiAIConfigRuntimeBinding,
  type NimiJsonObject,
  type NimiRuntimeEmbeddingScenarioClient,
  type NimiRuntimeAIScenarioClient,
  type NimiRuntimeAISchedulingClient,
} from '@nimiplatform/kit/core/sdk-contract';

export type RuntimeAIConsumeCapabilityId = 'text.generate' | 'chat.stream' | 'text.embed';

export type RuntimeAIConsumeUnavailableReason =
  | 'input-invalid'
  | 'ai-config-binding-missing'
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
  readonly runtimeRequest?: unknown;
};

export type RuntimeAIConsumeResult = RuntimeAIConsumeSuccess | RuntimeAIConsumeUnavailable;

export type RuntimeAIConsumeInput = {
  readonly runtime: RuntimeAIConsumeRuntime;
  readonly appId: string;
  readonly config: NimiAIConfig;
  readonly capabilityId: RuntimeAIConsumeCapabilityId;
  readonly bindingCapabilityId: string;
  readonly prompt: string;
  readonly directive?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly metadata?: Record<string, string | undefined>;
  readonly onPartial?: (accumulatedText: string) => void;
  readonly withScopes?: RuntimeAIConsumeScopeRunner;
};

export type RuntimeAIConsumeRuntime = {
  readonly ai: NimiRuntimeAIScenarioClient & NimiRuntimeEmbeddingScenarioClient;
  readonly scheduling?: NimiRuntimeAISchedulingClient;
  readonly generated?: NimiRuntimeAISchedulingClient;
};

export type RuntimeAIConsumeScopeRunner = <T>(
  scopes: readonly string[],
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
) => Promise<T>;

export async function runRuntimeAIConsumeCapability(
  input: RuntimeAIConsumeInput,
): Promise<RuntimeAIConsumeResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailable(input.capabilityId, 'input-invalid', `Scenario prompt is empty for ${input.capabilityId}.`);
  }

  const resolved = resolveNimiAIConfigRuntimeBinding({
    config: input.config,
    capabilityId: input.capabilityId,
    bindingCapabilityId: input.bindingCapabilityId,
  });
  if (resolved.ok === false) {
    return unavailable(input.capabilityId, 'ai-config-binding-missing', resolved.message);
  }

  if (input.capabilityId === 'text.generate') {
    return runTextGenerate(input, resolved.binding, prompt);
  }
  if (input.capabilityId === 'chat.stream') {
    return runChatStream(input, resolved.binding, prompt);
  }
  if (input.capabilityId === 'text.embed') {
    return runEmbedding(input, resolved.binding, prompt);
  }

  return unavailable(input.capabilityId, 'runtime-call-failed', `Runtime AI consume helper does not yet support ${input.capabilityId}.`);
}

async function runEmbedding(
  input: RuntimeAIConsumeInput,
  binding: NimiAIConfigRuntimeBinding,
  prompt: string,
): Promise<RuntimeAIConsumeResult> {
  const subjectUserId = normalizeText(input.subjectUserId);
  if (!subjectUserId) {
    return unavailable(
      input.capabilityId,
      'principal-unauthorized',
      'Runtime account subjectUserId is required before dispatch.',
    );
  }
  const scheduling = await ensureSchedulingPreflight(input, binding);
  if (scheduling.unavailable) {
    return scheduling.unavailable;
  }

  try {
    return await withSpendMeterScope(input, async (protectedOptions) => {
      const embedding = createNimiRuntimeEmbeddingClient({
        runtime: input.runtime,
        appId: input.appId,
        model: {
          modelId: binding.model,
          ...(binding.connectorId ? { providerId: binding.connectorId } : {}),
        },
        routePolicy: binding.routePolicy,
        connectorId: binding.connectorId,
        subjectUserId,
        targetRef: binding.targetRef,
        metadata: protectedOptions.metadata,
      });
      const output = await embedding.embedText({
        values: [prompt],
        metadata: buildMetadata(input, binding, scheduling.metadata),
      });
      const first = output.embeddings[0] || [];
      return {
        ok: true,
        capabilityId: input.capabilityId,
        message: `Runtime returned ${output.embeddings.length} vector(s) with ${first.length} dimensions.`,
        output: {
          kind: 'embedding',
          vectorCount: output.embeddings.length,
          dimensions: first.length,
          sample: first.slice(0, 8),
          totalTokens: output.usage?.totalTokens ?? output.usage?.promptTokens,
        },
        trace: pickTrace(output.raw),
      };
    });
  } catch (error) {
    return unavailableFromError(input.capabilityId, error);
  }
}

async function runTextGenerate(
  input: RuntimeAIConsumeInput,
  binding: NimiAIConfigRuntimeBinding,
  prompt: string,
): Promise<RuntimeAIConsumeResult> {
  const subjectUserId = normalizeText(input.subjectUserId);
  if (!subjectUserId) {
    return unavailable(
      input.capabilityId,
      'principal-unauthorized',
      'Runtime account subjectUserId is required before dispatch.',
    );
  }
  const textParams = coerceNimiAITextGenerationParams(binding.selectedParams);
  if (textParams.ok === false) {
    return unavailable(input.capabilityId, 'input-invalid', textParams.message);
  }
  const scheduling = await ensureSchedulingPreflight(input, binding);
  if (scheduling.unavailable) {
    return scheduling.unavailable;
  }

  return withSpendMeterScope(input, async (protectedOptions) => {
    const model = createNimiRuntimeAIModel({
      runtime: input.runtime,
      appId: input.appId,
      model: {
        modelId: binding.model,
        ...(binding.connectorId ? { providerId: binding.connectorId } : {}),
      },
      routePolicy: binding.routePolicy,
      connectorId: binding.connectorId,
      subjectUserId,
      timeoutMs: textParams.value.timeoutMs,
      targetRef: binding.targetRef,
      metadata: protectedOptions.metadata,
    });
    const result = await runNimiTextGenerate({
      runtime: { model },
      request: {
        model: model.model,
        messages: [{
          role: 'user',
          content: [textPart(input.directive ? `${input.directive}\n\n${prompt}` : prompt)],
        }],
        parameters: {
          ...textParams.value.parameters,
          metadata: buildMetadata(input, binding, scheduling.metadata),
        },
      },
    });
    if (result.ok === false) {
      return unavailable(input.capabilityId, 'runtime-call-failed', result.error.message);
    }
    const output = result.result;
    return {
      ok: true,
      capabilityId: input.capabilityId,
      message: `Runtime accepted the prompt and returned ${result.text.length} characters.`,
      output: {
        kind: 'text',
        text: result.text,
        finishReason: output.finishReason,
        inputTokens: output.usage?.promptTokens,
        outputTokens: output.usage?.completionTokens,
        totalTokens: output.usage?.totalTokens,
        streamed: false,
      },
      trace: pickTrace(output.raw),
    };
  });
}

async function runChatStream(
  input: RuntimeAIConsumeInput,
  binding: NimiAIConfigRuntimeBinding,
  prompt: string,
): Promise<RuntimeAIConsumeResult> {
  const subjectUserId = normalizeText(input.subjectUserId);
  if (!subjectUserId) {
    return unavailable(
      input.capabilityId,
      'principal-unauthorized',
      'Runtime account subjectUserId is required before dispatch.',
    );
  }
  const textParams = coerceNimiAITextGenerationParams(binding.selectedParams);
  if (textParams.ok === false) {
    return unavailable(input.capabilityId, 'input-invalid', textParams.message);
  }
  const scheduling = await ensureSchedulingPreflight(input, binding);
  if (scheduling.unavailable) {
    return scheduling.unavailable;
  }

  let accumulated = '';
  try {
    return await withSpendMeterScope(input, async (protectedOptions) => {
      const model = createNimiRuntimeAIModel({
        runtime: input.runtime,
        appId: input.appId,
        model: {
          modelId: binding.model,
          ...(binding.connectorId ? { providerId: binding.connectorId } : {}),
        },
        routePolicy: binding.routePolicy,
        connectorId: binding.connectorId,
        subjectUserId,
        timeoutMs: textParams.value.timeoutMs,
        targetRef: binding.targetRef,
        metadata: protectedOptions.metadata,
      });
      const streamed = await streamNimiTextResponse(
        {
          runtime: { model },
          request: {
            model: model.model,
            messages: [{
              role: 'user',
              content: [textPart(input.directive ? `${input.directive}\n\n${prompt}` : prompt)],
            }],
            parameters: {
              ...textParams.value.parameters,
              metadata: buildMetadata(input, binding, scheduling.metadata),
            },
          },
        },
        {
          onDelta: (text) => {
            accumulated += text;
            input.onPartial?.(accumulated);
          },
        },
      );
      return {
        ok: true,
        capabilityId: input.capabilityId,
        message: `Stream completed with ${streamed.text.length} characters (finishReason=${streamed.finishReason || 'stop'}).`,
        output: {
          kind: 'text',
          text: streamed.text,
          finishReason: String(streamed.finishReason || 'stop'),
          inputTokens: streamed.usage?.promptTokens,
          outputTokens: streamed.usage?.completionTokens,
          totalTokens: streamed.usage?.totalTokens,
          streamed: true,
        },
        trace: {
          traceId: streamed.traceId,
          modelResolved: model.model.modelId,
          routeDecision: binding.routePolicy,
        },
      };
    });
  } catch (error) {
    return unavailableFromError(input.capabilityId, error);
  }
}

function withSpendMeterScope<T>(
  input: RuntimeAIConsumeInput,
  operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
): Promise<T> {
  if (!input.withScopes) {
    return operation({});
  }
  return input.withScopes(['ai.spend.meter'], operation);
}

type SchedulingPreflight = {
  readonly unavailable: RuntimeAIConsumeUnavailable | null;
  readonly metadata: Record<string, string>;
};

async function ensureSchedulingPreflight(
  input: RuntimeAIConsumeInput,
  binding: NimiAIConfigRuntimeBinding,
): Promise<SchedulingPreflight> {
  if (!binding.schedulingTarget) {
    return { unavailable: null, metadata: {} };
  }
  try {
    const scheduling = createNimiRuntimeAISchedulingClient({
      runtime: input.runtime,
      appId: input.appId,
      targets: [binding.schedulingTarget],
    });
    const batch = await scheduling.peek();
    if (batch.aggregateJudgement?.state === 'denied') {
      return {
        unavailable: unavailable(
          input.capabilityId,
          'runtime-call-failed',
          `Runtime scheduling denied ${binding.bindingCapabilityId}: ${batch.aggregateJudgement.detail || 'denied'}`,
        ),
        metadata: schedulingMetadata(batch),
      };
    }
    return { unavailable: null, metadata: schedulingMetadata(batch) };
  } catch (error) {
    return { unavailable: unavailableFromError(input.capabilityId, error), metadata: {} };
  }
}

function schedulingMetadata(batch: {
  readonly aggregateJudgement?: {
    readonly state: string;
    readonly detail?: string | null;
    readonly resourceWarnings?: readonly string[];
  } | null;
}): Record<string, string> {
  const judgement = batch.aggregateJudgement;
  if (!judgement) return {};
  return {
    runtimeSchedulingState: judgement.state,
    ...(judgement.detail ? { runtimeSchedulingDetail: judgement.detail } : {}),
    ...(judgement.resourceWarnings && judgement.resourceWarnings.length > 0
      ? { runtimeSchedulingWarnings: judgement.resourceWarnings.join(',') }
      : {}),
  };
}

function buildMetadata(
  input: RuntimeAIConsumeInput,
  binding: NimiAIConfigRuntimeBinding,
  scheduling: Record<string, string>,
): NimiJsonObject {
  return {
    surfaceId: input.surfaceId,
    scenarioId: input.scenarioId,
    ...binding.metadata,
    ...scheduling,
    ...stringMetadata(input.metadata),
  };
}

function stringMetadata(metadata: Record<string, string | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);
    if (normalizedKey && normalizedValue) {
      out[normalizedKey] = normalizedValue;
    }
  }
  return out;
}

function pickTrace(value: unknown): RuntimeAIConsumeTrace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return {
    traceId: typeof record.traceId === 'string' ? record.traceId : undefined,
    modelResolved: typeof record.modelResolved === 'string' ? record.modelResolved : undefined,
    routeDecision: typeof record.routeDecision === 'string' ? record.routeDecision : undefined,
  };
}

function unavailableFromError(
  capabilityId: RuntimeAIConsumeCapabilityId,
  error: unknown,
): RuntimeAIConsumeUnavailable {
  const reasonCode = error && typeof error === 'object'
    ? String(
      (error as { reasonCode?: unknown }).reasonCode
      || (error as { code?: unknown }).code
      || '',
    )
    : '';
  const reason: RuntimeAIConsumeUnavailableReason = reasonCode === 'SDK_RUNTIME_METHOD_UNAVAILABLE'
    ? 'sdk-method-unavailable'
    : reasonCode === 'AUTH_CONTEXT_MISSING'
      || reasonCode === 'PRINCIPAL_UNAUTHORIZED'
      || reasonCode === 'SESSION_EXPIRED'
      || reasonCode === 'APP_TOKEN_EXPIRED'
      || reasonCode === 'APP_TOKEN_REVOKED'
        ? 'principal-unauthorized'
        : 'runtime-call-failed';
  return unavailable(capabilityId, reason, describeError(error));
}

function unavailable(
  capabilityId: RuntimeAIConsumeCapabilityId,
  reason: RuntimeAIConsumeUnavailableReason,
  message: string,
): RuntimeAIConsumeUnavailable {
  return {
    ok: false,
    capabilityId,
    reason,
    message,
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const reasonCode = (error as { reasonCode?: string }).reasonCode;
    const code = reasonCode || (error.name && error.name !== 'Error' ? error.name : '');
    return code ? `${code}: ${error.message}` : error.message;
  }
  return String(error || 'Runtime SDK call failed.');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
