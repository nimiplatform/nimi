import { getPlatformClient } from '@nimiplatform/sdk';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';

const ROUTE_POLICY_LOCAL = 1;
const ROUTE_POLICY_CLOUD = 2;
const SCENARIO_TYPE_TEXT_GENERATE = 1;
const EXECUTION_MODE_STREAM = 2;
const TEXT_TIMEOUT_MS = 120_000;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFinishReason(value: unknown): string {
  if (typeof value === 'number') {
    switch (value) {
    case 1:
      return 'stop';
    case 2:
      return 'max_tokens';
    case 3:
      return 'cancelled';
    case 4:
      return 'error';
    default:
      return 'unknown';
    }
  }
  return normalizeText(value) || 'unknown';
}

function createTraceId(prefix = 'polyinfo-analyst'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildScenarioHead(binding: RuntimeRouteBinding) {
  const modelId = normalizeText(binding.modelId || binding.model);
  if (!modelId) {
    throw new Error('当前聊天没有可用模型，请先去 Runtime 页面完成配置。');
  }
  if (binding.source === 'cloud') {
    const connectorId = normalizeText(binding.connectorId);
    if (!connectorId) {
      throw new Error('云端路由缺少连接器，请先去 Runtime 页面重新选择。');
    }
    return {
      modelId,
      routePolicy: ROUTE_POLICY_CLOUD,
      connectorId,
    };
  }
  return {
    modelId,
    routePolicy: ROUTE_POLICY_LOCAL,
    connectorId: '',
  };
}

export type StreamSectorAnalystInput = {
  binding: RuntimeRouteBinding;
  prompt: string;
  systemPrompt: string;
  subjectUserId?: string;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
};

export type StreamSectorAnalystResult = {
  text: string;
  reasoning: string;
  finishReason: string;
  traceId: string;
  modelResolved: string;
};

export async function streamSectorAnalyst(
  input: StreamSectorAnalystInput,
): Promise<StreamSectorAnalystResult> {
  const runtime = getPlatformClient().runtime;
  const head = buildScenarioHead(input.binding);
  const traceId = createTraceId();
  const stream = await runtime.ai.streamScenario({
    head: {
      appId: runtime.appId,
      modelId: head.modelId,
      routePolicy: head.routePolicy,
      timeoutMs: TEXT_TIMEOUT_MS,
      connectorId: head.connectorId,
      ...(normalizeText(input.subjectUserId) ? { subjectUserId: normalizeText(input.subjectUserId) } : {}),
    },
    scenarioType: SCENARIO_TYPE_TEXT_GENERATE,
    executionMode: EXECUTION_MODE_STREAM,
    spec: {
      spec: {
        oneofKind: 'textGenerate',
        textGenerate: {
          input: [{
            role: 'user',
            content: normalizeText(input.prompt),
            name: '',
            parts: [],
          }],
          systemPrompt: normalizeText(input.systemPrompt),
          tools: [],
          temperature: 0,
          topP: 0,
          maxTokens: 0,
        },
      },
    },
    extensions: [],
  }, {
    timeoutMs: TEXT_TIMEOUT_MS,
    signal: input.signal,
    metadata: {
      traceId,
      callerKind: 'third-party-app',
      callerId: 'polyinfo.sector-analyst',
      surfaceId: 'polyinfo.chat',
      ...(head.connectorId ? { keySource: 'managed' as const } : {}),
    },
  });

  let text = '';
  let reasoning = '';
  let finishReason = 'unknown';
  let responseTraceId = traceId;
  let modelResolved = '';

  for await (const event of stream) {
    switch (event.payload.oneofKind) {
    case 'started':
      responseTraceId = normalizeText(event.traceId) || responseTraceId;
      modelResolved = normalizeText(event.payload.started.modelResolved);
      break;
    case 'delta': {
      const deltaPayload = event.payload.delta.delta;
      if (deltaPayload?.oneofKind === 'text') {
        const delta = normalizeText(deltaPayload.text.text);
        if (delta) {
          text += delta;
          input.onTextDelta?.(delta);
        }
      }
      if (deltaPayload?.oneofKind === 'reasoning') {
        const delta = normalizeText(deltaPayload.reasoning.text);
        if (delta) {
          reasoning += delta;
          input.onReasoningDelta?.(delta);
        }
      }
      break;
    }
    case 'completed':
      finishReason = normalizeFinishReason(event.payload.completed.finishReason);
      responseTraceId = normalizeText(event.traceId) || responseTraceId;
      break;
    case 'failed': {
      const failed = event.payload.failed;
      throw new Error(
        normalizeText((failed as { reasonDetail?: string }).reasonDetail)
          || normalizeText((failed as { message?: string }).message)
          || normalizeText(failed.actionHint)
          || 'runtime stream failed',
      );
    }
    case undefined:
      break;
    }
  }

  return {
    text,
    reasoning,
    finishReason,
    traceId: responseTraceId,
    modelResolved,
  };
}
