import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import {
  ExecutionMode,
  FinishReason,
  RoutePolicy,
  ScenarioType,
  type ExecuteScenarioRequest,
  type StreamScenarioRequest,
} from './generated/runtime/v1/ai';
import type { RuntimeInternalContext } from './internal-context.js';
import type {
  EmbeddingGenerateInput,
  EmbeddingGenerateOutput,
  TextGenerateInput,
  TextGenerateOutput,
  TextStreamInput,
  TextStreamOutput,
} from './types.js';
import {
  asRecord,
  ensureText,
  extractGenerateText,
  fromRoutePolicy,
  normalizeText,
  toFallbackPolicy,
  toFinishReason,
  toRoutePolicy,
  toRuntimeMessages,
  toTraceInfo,
  toUsage,
} from './helpers.js';
import { runtimeAiRequestRequiresSubject } from './runtime-guards.js';

export async function runtimeGenerateText(
  ctx: RuntimeInternalContext,
  input: TextGenerateInput,
): Promise<TextGenerateOutput> {
  const routePolicy = toRoutePolicy(input.route);
  const connectorId = normalizeText(input.connectorId);
  const modelId = ensureText(input.model, 'model');
  const subjectUserId = runtimeAiRequestRequiresSubject({
    request: {
      head: {
        routePolicy,
        connectorId,
      },
    },
    metadata: input.metadata,
  })
    ? await ctx.resolveSubjectUserId(input.subjectUserId)
    : await ctx.resolveOptionalSubjectUserId(input.subjectUserId);
  const prompt = toRuntimeMessages(input.input, input.system);
  const request: ExecuteScenarioRequest = {
    head: {
      appId: ctx.appId,
      subjectUserId: subjectUserId || '',
      modelId,
      routePolicy,
      fallback: toFallbackPolicy(input.fallback),
      timeoutMs: Number(input.timeoutMs || ctx.options.timeoutMs || 0),
      connectorId,
    },
    scenarioType: ScenarioType.TEXT_GENERATE,
    executionMode: ExecutionMode.SYNC,
    spec: {
      spec: {
        oneofKind: 'textGenerate' as const,
        textGenerate: {
          input: prompt.input,
          systemPrompt: prompt.systemPrompt,
          tools: [],
          temperature: Number(input.temperature || 0),
          topP: Number(input.topP || 0),
          maxTokens: Number(input.maxTokens || 0),
        },
      },
    },
    extensions: [],
  };

  const response = await ctx.invokeWithClient(async (client) => client.ai.executeScenario(
    request,
    ctx.resolveRuntimeCallOptions({
      timeoutMs: input.timeoutMs,
      metadata: input.metadata,
    }),
  ));

  const trace = toTraceInfo({
    traceId: response.traceId,
    modelResolved: response.modelResolved,
    routeDecision: response.routeDecision,
  });

  ctx.emitTelemetry('ai.route.decision', {
    route: trace.routeDecision || 'local',
    model: modelId,
    traceId: trace.traceId,
  });

  return {
    text: extractGenerateText(response.output),
    finishReason: toFinishReason(response.finishReason),
    usage: toUsage(response.usage),
    trace,
  };
}

export async function runtimeStreamText(
  ctx: RuntimeInternalContext,
  input: TextStreamInput,
): Promise<TextStreamOutput> {
  const routePolicy = toRoutePolicy(input.route);
  const connectorId = normalizeText(input.connectorId);
  const modelId = ensureText(input.model, 'model');
  const subjectUserId = runtimeAiRequestRequiresSubject({
    request: {
      head: {
        routePolicy,
        connectorId,
      },
    },
    metadata: input.metadata,
  })
    ? await ctx.resolveSubjectUserId(input.subjectUserId)
    : await ctx.resolveOptionalSubjectUserId(input.subjectUserId);
  const prompt = toRuntimeMessages(input.input, input.system);

  const stream = await ctx.invokeWithClient(async (client) => client.ai.streamScenario(
    {
      head: {
        appId: ctx.appId,
        subjectUserId: subjectUserId || '',
        modelId,
        routePolicy,
        fallback: toFallbackPolicy(input.fallback),
        timeoutMs: Number(input.timeoutMs || ctx.options.timeoutMs || 0),
        connectorId,
      },
      scenarioType: ScenarioType.TEXT_GENERATE,
      executionMode: ExecutionMode.STREAM,
      spec: {
        spec: {
          oneofKind: 'textGenerate' as const,
          textGenerate: {
            input: prompt.input,
            systemPrompt: prompt.systemPrompt,
            tools: [],
            temperature: Number(input.temperature || 0),
            topP: Number(input.topP || 0),
            maxTokens: Number(input.maxTokens || 0),
          },
        },
      },
      extensions: [],
    } satisfies StreamScenarioRequest,
    ctx.resolveRuntimeStreamOptions({
      timeoutMs: input.timeoutMs,
      metadata: input.metadata,
      signal: input.signal,
    }),
  ));

  const ctxRef = ctx;
  const wrapped: AsyncIterable<TextStreamOutput['stream'] extends AsyncIterable<infer Part> ? Part : never> = {
    async *[Symbol.asyncIterator]() {
      let streamModelResolved = '';
      let streamRouteDecision: RoutePolicy = RoutePolicy.LOCAL;
      let streamUsage: unknown = undefined;

      yield { type: 'start' as const };
      for await (const event of stream) {
        const payloadKind = normalizeText(asRecord(event.payload).oneofKind);

        if (payloadKind === 'started') {
          const started = asRecord(asRecord(event.payload).started);
          streamModelResolved = normalizeText(started.modelResolved);
          const routeDecision = Number(started.routeDecision);
          streamRouteDecision = routeDecision === RoutePolicy.CLOUD
            ? RoutePolicy.CLOUD
            : RoutePolicy.LOCAL;
          ctxRef.emitTelemetry('ai.route.decision', {
            route: fromRoutePolicy(streamRouteDecision),
            model: streamModelResolved || modelId,
            traceId: normalizeText(event.traceId) || undefined,
          });
          continue;
        }

        if (payloadKind === 'delta') {
          const deltaValue = asRecord(asRecord(event.payload).delta).text;
          const delta = typeof deltaValue === 'string'
            ? deltaValue
            : (deltaValue == null ? '' : String(deltaValue));
          if (delta.length > 0) {
            yield { type: 'delta' as const, text: delta };
          }
          continue;
        }

        if (payloadKind === 'usage') {
          streamUsage = asRecord(asRecord(event.payload).usage);
          continue;
        }

        if (payloadKind === 'completed') {
          const trace = toTraceInfo({
            traceId: event.traceId,
            modelResolved: streamModelResolved,
            routeDecision: streamRouteDecision,
          });
          yield {
            type: 'finish' as const,
            finishReason: toFinishReason(asRecord(asRecord(event.payload).completed).finishReason as FinishReason),
            usage: toUsage(streamUsage),
            trace,
          };
          continue;
        }

        if (payloadKind === 'failed') {
          const failed = asRecord(asRecord(event.payload).failed);
          yield {
            type: 'error' as const,
            error: createNimiError({
              message: normalizeText(failed.actionHint) || 'runtime stream failed',
              reasonCode: normalizeText(failed.reasonCode) || ReasonCode.AI_STREAM_BROKEN,
              actionHint: 'retry_or_switch_route',
              source: 'runtime',
            }),
          };
        }
      }
    },
  };

  return {
    stream: wrapped,
  };
}

export async function runtimeGenerateEmbedding(
  ctx: RuntimeInternalContext,
  input: EmbeddingGenerateInput,
): Promise<EmbeddingGenerateOutput> {
  const routePolicy = toRoutePolicy(input.route);
  const connectorId = normalizeText(input.connectorId);
  const subjectUserId = runtimeAiRequestRequiresSubject({
    request: {
      head: {
        routePolicy,
        connectorId,
      },
    },
    metadata: input.metadata,
  })
    ? await ctx.resolveSubjectUserId(input.subjectUserId)
    : await ctx.resolveOptionalSubjectUserId(input.subjectUserId);
  const values = Array.isArray(input.input)
    ? input.input.map((value) => normalizeText(value)).filter((value) => value.length > 0)
    : [normalizeText(input.input)].filter((value) => value.length > 0);

  if (values.length === 0) {
    throw createNimiError({
      message: 'embedding input is required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_embedding_input',
      source: 'sdk',
    });
  }

  const response = await ctx.invokeWithClient(async (client) => client.ai.executeScenario(
    {
      head: {
        appId: ctx.appId,
        subjectUserId: subjectUserId || '',
        modelId: ensureText(input.model, 'model'),
        routePolicy,
        fallback: toFallbackPolicy(input.fallback),
        timeoutMs: Number(input.timeoutMs || ctx.options.timeoutMs || 0),
        connectorId,
      },
      scenarioType: ScenarioType.TEXT_EMBED,
      executionMode: ExecutionMode.SYNC,
      spec: {
        spec: {
          oneofKind: 'textEmbed' as const,
          textEmbed: {
            inputs: values,
          },
        },
      },
      extensions: [],
    },
    ctx.resolveRuntimeCallOptions({
      timeoutMs: input.timeoutMs,
      metadata: input.metadata,
    }),
  ));

  const trace = toTraceInfo({
    traceId: response.traceId,
    modelResolved: response.modelResolved,
    routeDecision: response.routeDecision,
  });

  ctx.emitTelemetry('ai.route.decision', {
    route: trace.routeDecision || 'local',
    model: ensureText(input.model, 'model'),
    traceId: trace.traceId,
  });

  return {
    vectors: toEmbeddingVectorsFromOutput(response.output),
    usage: toUsage(response.usage),
    trace,
  };
}

function toEmbeddingVectorsFromOutput(output: unknown): number[][] {
  const vectors = asRecord(asRecord(output).fields).vectors;
  const vectorKind = asRecord(asRecord(vectors).kind);
  const values = vectorKind.oneofKind === 'listValue'
    ? asRecord(vectorKind.listValue).values
    : [];
  const normalized = Array.isArray(values) ? values.map((value: unknown) => {
    const listKind = asRecord(value).kind;
    if (asRecord(listKind).oneofKind !== 'listValue') {
      return { values: [] };
    }
    return asRecord(listKind).listValue;
  }) : [];
  return normalized.map((entry) => {
    const items = Array.isArray(asRecord(entry).values) ? asRecord(entry).values as unknown[] : [];
    return items.map((item: unknown) => {
      const kind = asRecord(item).kind;
      if (asRecord(kind).oneofKind === 'numberValue') {
        const parsed = Number(asRecord(kind).numberValue);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    }).filter((value: number | null): value is number => value !== null);
  });
}
