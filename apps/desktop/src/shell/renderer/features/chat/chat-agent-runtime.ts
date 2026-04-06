import {
  asNimiError,
  createNimiError,
  type TextStreamOutput,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import { createResolveRuntimeBinding } from '@renderer/infra/bootstrap/runtime-bootstrap-route-resolvers';
import { createAgentCoreDataCapabilityHandlers } from '@renderer/infra/bootstrap/core-capabilities';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { invokeModLlm } from '@runtime/llm-adapter/execution';
import type { InvokeModLlmInput, InvokeModLlmOutput } from '@runtime/llm-adapter/execution';
import {
  buildRuntimeStreamOptions,
  ensureRuntimeLocalModelWarm,
  getRuntimeClient,
  resolveSourceAndModel,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import { resolvePreferredChatLocalModel } from './chat-ai-runtime';
import {
  resolveAgentChatThinkingSupport,
  resolveChatThinkingConfig,
  type ChatThinkingPreference,
} from './chat-thinking';

export type AgentChatRouteResult = {
  channel: 'CLOUD' | 'LOCAL';
  providerSelectable: boolean;
  reason: string;
  sessionClass: 'AGENT_LOCAL' | 'HUMAN_DIRECT';
};

export type ChatAgentRuntimeInvokeInput = {
  agentId: string;
  prompt: string;
  threadId: string;
  reasoningPreference: ChatThinkingPreference;
  routeResult: AgentChatRouteResult | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  signal?: AbortSignal;
};

export type ChatAgentRuntimeInvokeResult = {
  text: string;
  traceId: string;
  promptTraceId: string;
};

export type ChatAgentRuntimeStreamResult = {
  stream: TextStreamOutput['stream'];
  promptTraceId: string;
};

export type ChatAgentRuntimeInvokeDeps = {
  invokeModLlmImpl?: (input: InvokeModLlmInput) => Promise<InvokeModLlmOutput>;
  resolveInvokeInputImpl?: (input: ChatAgentRuntimeInvokeInput) => Promise<InvokeModLlmInput>;
};

export type ChatAgentRuntimeStreamDeps = {
  resolveInvokeInputImpl?: (input: ChatAgentRuntimeInvokeInput) => Promise<InvokeModLlmInput>;
};

export type ResolveAgentLocalRouteDeps = {
  resolveAgentChatRouteImpl?: (agentId: string) => Promise<unknown>;
};

export const CORE_CHAT_AGENT_MOD_ID = 'core.chat-agent';

const agentCapabilityHandlers = createAgentCoreDataCapabilityHandlers();

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isLocalProvider(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'llama'
    || normalized === 'media'
    || normalized === 'speech'
    || normalized === 'sidecar'
    || normalized.startsWith('local');
}

function requireValue(value: unknown, reasonCode: string, actionHint: string, message: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message,
      reasonCode,
      actionHint,
      source: 'runtime',
    });
  }
  return normalized;
}

function parseAgentChatRouteResult(value: unknown): AgentChatRouteResult {
  if (!value || typeof value !== 'object') {
    throw new Error('agent chat route returned invalid payload');
  }
  const record = value as Record<string, unknown>;
  const channel = String(record.channel || '').trim();
  const sessionClass = String(record.sessionClass || '').trim();
  if (channel !== 'LOCAL' && channel !== 'CLOUD') {
    throw new Error('agent chat route channel is invalid');
  }
  if (sessionClass !== 'AGENT_LOCAL' && sessionClass !== 'HUMAN_DIRECT') {
    throw new Error('agent chat route sessionClass is invalid');
  }
  if (typeof record.providerSelectable !== 'boolean') {
    throw new Error('agent chat route providerSelectable is invalid');
  }
  return {
    channel,
    providerSelectable: record.providerSelectable,
    reason: String(record.reason || ''),
    sessionClass,
  };
}

export async function resolveAgentLocalRoute(
  agentId: string,
  deps: ResolveAgentLocalRouteDeps = {},
): Promise<AgentChatRouteResult> {
  const normalizedAgentId = normalizeText(agentId);
  if (!normalizedAgentId) {
    throw new Error('agentId is required');
  }
  const resolveAgentChatRouteImpl = deps.resolveAgentChatRouteImpl
    || ((nextAgentId: string) => agentCapabilityHandlers.agentChatRouteResolve({ agentId: nextAgentId }));
  const result = await resolveAgentChatRouteImpl(normalizedAgentId);
  return parseAgentChatRouteResult(result);
}

export function isAgentLocalRouteReady(routeResult: AgentChatRouteResult | null | undefined): boolean {
  return Boolean(routeResult && routeResult.channel === 'LOCAL' && routeResult.sessionClass === 'AGENT_LOCAL');
}

async function resolveInvokeInput(
  input: ChatAgentRuntimeInvokeInput,
): Promise<InvokeModLlmInput> {
  // When routeResult is provided, validate it; when null, skip (route readiness
  // is checked at the adapter layer via runtimeConfigState before submit).
  if (input.routeResult && !isAgentLocalRouteReady(input.routeResult)) {
    throw createNimiError({
      message: 'local agent route is not ready',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_route_binding',
      source: 'runtime',
    });
  }

  const configuredLocalModel = normalizeText(input.runtimeFields.localProviderModel);
  const localModel = await resolvePreferredChatLocalModel(
    input.runtimeConfigState,
    configuredLocalModel,
  );
  const fallbackProvider = localModel?.engine || 'llama';
  const fallbackModel = localModel?.model || '';
  const fallbackEndpoint = normalizeText(localModel?.endpoint)
    || normalizeText(input.runtimeConfigState?.local.endpoint);
  const shouldUseConfiguredLocalModel = Boolean(
    localModel
    && (normalizeText(localModel.model) === configuredLocalModel
      || normalizeText(localModel.localModelId) === configuredLocalModel),
  );
  const runtimeFields = {
    provider: isLocalProvider(input.runtimeFields.provider)
      ? input.runtimeFields.provider
      : fallbackProvider,
    runtimeModelType: 'chat',
    localProviderEndpoint: normalizeText(input.runtimeFields.localProviderEndpoint) || fallbackEndpoint,
    localProviderModel: shouldUseConfiguredLocalModel ? configuredLocalModel : fallbackModel,
    localOpenAiEndpoint: normalizeText(input.runtimeFields.localOpenAiEndpoint)
      || normalizeText(input.runtimeFields.localProviderEndpoint)
      || fallbackEndpoint,
    connectorId: '',
  };
  const resolveRuntimeBinding = createResolveRuntimeBinding(() => runtimeFields);
  const resolved = await resolveRuntimeBinding({
    modId: CORE_CHAT_AGENT_MOD_ID,
    binding: {
      source: 'local',
      connectorId: '',
      model: runtimeFields.localProviderModel,
    },
  });
  if (resolved.source !== 'local') {
    throw createNimiError({
      message: 'agent local route resolved to an invalid source',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_route_binding',
      source: 'runtime',
    });
  }
  return {
    modId: CORE_CHAT_AGENT_MOD_ID,
    provider: requireValue(
      resolved.provider,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'agent local route provider is missing',
    ),
    prompt: input.prompt,
    agentId: requireValue(
      input.agentId,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'agentId is missing',
    ),
    localProviderEndpoint: normalizeText(resolved.localProviderEndpoint) || undefined,
    localProviderModel: requireValue(
      resolved.localProviderModel || resolved.modelId || resolved.model,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'agent local route model is missing',
    ),
    localOpenAiEndpoint: normalizeText(resolved.localOpenAiEndpoint) || undefined,
  };
}

export function toChatAgentRuntimeError(error: unknown): { code: string; message: string } {
  const normalized = asNimiError(error);
  return {
    code: String(normalized.reasonCode || ReasonCode.RUNTIME_CALL_FAILED).trim() || ReasonCode.RUNTIME_CALL_FAILED,
    message: String(normalized.message || 'Agent response failed').trim() || 'Agent response failed',
  };
}

export async function streamChatAgentRuntime(
  input: ChatAgentRuntimeInvokeInput,
  deps: ChatAgentRuntimeStreamDeps = {},
): Promise<ChatAgentRuntimeStreamResult> {
  const invokeInput = await (deps.resolveInvokeInputImpl || resolveInvokeInput)(input);
  const resolved = resolveSourceAndModel(invokeInput);
  const timeoutMs = 120_000;

  await ensureRuntimeLocalModelWarm({
    modId: invokeInput.modId,
    source: resolved.source,
    modelId: resolved.modelId,
    engine: resolved.provider,
    endpoint: resolved.endpoint,
    timeoutMs,
  });

  const callOptions = await buildRuntimeStreamOptions({
    modId: invokeInput.modId,
    timeoutMs,
    signal: input.signal,
    source: resolved.source,
    connectorId: invokeInput.connectorId,
    providerEndpoint: resolved.endpoint,
  });
  const streamOutput = await getRuntimeClient().ai.text.stream({
    model: resolved.modelId,
    route: resolved.source,
    connectorId: invokeInput.connectorId,
    input: invokeInput.prompt,
    reasoning: resolveChatThinkingConfig(
      input.reasoningPreference,
      resolveAgentChatThinkingSupport(),
    ),
    timeoutMs: callOptions.timeoutMs,
    signal: callOptions.signal,
    metadata: callOptions.metadata,
  });

  return {
    stream: streamOutput.stream,
    promptTraceId: String(callOptions.metadata.traceId || ''),
  };
}

export async function invokeChatAgentRuntime(
  input: ChatAgentRuntimeInvokeInput,
  deps: ChatAgentRuntimeInvokeDeps = {},
): Promise<ChatAgentRuntimeInvokeResult> {
  const invokeModLlmImpl = deps.invokeModLlmImpl || invokeModLlm;
  const invokeInput = await (deps.resolveInvokeInputImpl || resolveInvokeInput)(input);
  const result = await invokeModLlmImpl(invokeInput);
  return {
    text: String(result.text || ''),
    traceId: String(result.traceId || ''),
    promptTraceId: String(result.promptTraceId || ''),
  };
}
