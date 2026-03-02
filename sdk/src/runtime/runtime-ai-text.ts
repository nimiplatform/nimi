import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import {
  FinishReason,
  Modal,
  RoutePolicy,
  type GenerateRequest,
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
  toEmbeddingVectors,
  toFallbackPolicy,
  toFinishReason,
  toRoutePolicy,
  toRuntimeMessages,
  toTraceInfo,
  toUsage,
} from './helpers.js';

export async function runtimeGenerateText(
  ctx: RuntimeInternalContext,
  input: TextGenerateInput,
): Promise<TextGenerateOutput> {
  const subjectUserId = await ctx.resolveSubjectUserId(input.subjectUserId);
  const prompt = toRuntimeMessages(input.input, input.system);
  const request: GenerateRequest = {
    appId: ctx.appId,
    subjectUserId,
    modelId: ensureText(input.model, 'model'),
    modal: Modal.TEXT,
    input: prompt.input,
    systemPrompt: prompt.systemPrompt,
    tools: [],
    temperature: Number(input.temperature || 0),
    topP: Number(input.topP || 0),
    maxTokens: Number(input.maxTokens || 0),
    routePolicy: toRoutePolicy(input.route),
    fallback: toFallbackPolicy(input.fallback),
    timeoutMs: Number(input.timeoutMs || ctx.options.timeoutMs || 0),
    connectorId: '',
  };

  const response = await ctx.invokeWithClient(async (client) => client.ai.generate(
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
    route: trace.routeDecision || 'local-runtime',
    model: request.modelId,
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
  const subjectUserId = await ctx.resolveSubjectUserId(input.subjectUserId);
  const prompt = toRuntimeMessages(input.input, input.system);

  const stream = await ctx.invokeWithClient(async (client) => client.ai.streamGenerate(
    {
      appId: ctx.appId,
      subjectUserId,
      modelId: ensureText(input.model, 'model'),
      modal: Modal.TEXT,
      input: prompt.input,
      systemPrompt: prompt.systemPrompt,
      tools: [],
      temperature: Number(input.temperature || 0),
      topP: Number(input.topP || 0),
      maxTokens: Number(input.maxTokens || 0),
      routePolicy: toRoutePolicy(input.route),
      fallback: toFallbackPolicy(input.fallback),
      timeoutMs: Number(input.timeoutMs || ctx.options.timeoutMs || 0),
      connectorId: '',
    },
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
      let streamRouteDecision: RoutePolicy = RoutePolicy.LOCAL_RUNTIME;
      let streamUsage: unknown = undefined;

      yield { type: 'start' as const };
      for await (const event of stream) {
        const payloadKind = normalizeText(asRecord(event.payload).oneofKind);

        if (payloadKind === 'started') {
          const started = asRecord(asRecord(event.payload).started);
          streamModelResolved = normalizeText(started.modelResolved);
          const routeDecision = Number(started.routeDecision);
          streamRouteDecision = routeDecision === RoutePolicy.TOKEN_API
            ? RoutePolicy.TOKEN_API
            : RoutePolicy.LOCAL_RUNTIME;
          ctxRef.emitTelemetry('ai.route.decision', {
            route: fromRoutePolicy(streamRouteDecision),
            model: streamModelResolved || ensureText(input.model, 'model'),
            traceId: normalizeText(event.traceId) || undefined,
          });
          continue;
        }

        if (payloadKind === 'delta') {
          const delta = normalizeText(asRecord(asRecord(event.payload).delta).text);
          if (delta) {
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
  const subjectUserId = await ctx.resolveSubjectUserId(input.subjectUserId);
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

  const response = await ctx.invokeWithClient(async (client) => client.ai.embed(
    {
      appId: ctx.appId,
      subjectUserId,
      modelId: ensureText(input.model, 'model'),
      inputs: values,
      routePolicy: toRoutePolicy(input.route),
      fallback: toFallbackPolicy(input.fallback),
      timeoutMs: Number(input.timeoutMs || ctx.options.timeoutMs || 0),
      connectorId: '',
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
    route: trace.routeDecision || 'local-runtime',
    model: ensureText(input.model, 'model'),
    traceId: trace.traceId,
  });

  return {
    vectors: toEmbeddingVectors(response.vectors),
    usage: toUsage(response.usage),
    trace,
  };
}
