import {
  asNimiError,
  createNimiError,
  type TextMessage,
  type TextStreamOutput,
} from '@nimiplatform/sdk/runtime';
import type { ConversationRuntimeTextMessage } from '@nimiplatform/nimi-kit/features/chat/headless';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type {
  LocalModelOptionV11,
  RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import { createResolveRuntimeBinding } from '@renderer/infra/bootstrap/runtime-bootstrap-route-resolvers';
import { localRuntime, type LocalRuntimeAssetHealth } from '@runtime/local-runtime';
import { invokeModLlm } from '@runtime/llm-adapter/execution';
import type { InvokeModLlmInput, InvokeModLlmOutput } from '@runtime/llm-adapter/execution';
import {
  buildRuntimeStreamOptions,
  ensureRuntimeLocalModelWarm,
  getRuntimeClient,
  resolveSourceAndModel,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import {
  pickChatCapableConnectorModel,
  pickPreferredChatLocalModel,
} from './chat-ai-thread-model';
import {
  resolveAiChatThinkingSupport,
  resolveChatThinkingConfig,
  type ChatThinkingPreference,
} from './chat-thinking';
import type { AiConversationRouteSnapshot } from './chat-shell-types';

export type ChatAiRuntimeInvokeInput = {
  routeSnapshot: AiConversationRouteSnapshot;
  prompt: string;
  messages?: readonly ConversationRuntimeTextMessage[];
  systemPrompt?: string | null;
  threadId: string;
  reasoningPreference: ChatThinkingPreference;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  signal?: AbortSignal;
};

export type ChatAiRuntimeInvokeResult = {
  text: string;
  traceId: string;
  promptTraceId: string;
};

export type ChatAiRuntimeStreamResult = {
  stream: TextStreamOutput['stream'];
  promptTraceId: string;
};

export type ChatAiRuntimeInvokeDeps = {
  invokeModLlmImpl?: (input: InvokeModLlmInput) => Promise<InvokeModLlmOutput>;
};

export type ChatAiRuntimeStreamDeps = {
  resolveInvokeInputImpl?: (input: ChatAiRuntimeInvokeInput) => Promise<InvokeModLlmInput>;
};

export const CORE_CHAT_AI_MOD_ID = 'core.chat-ai';

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

function toSdkTextMessage(message: ConversationRuntimeTextMessage): TextMessage {
  return {
    role: message.role,
    content: message.text,
    name: normalizeText(message.name) || undefined,
  };
}

function resolveRuntimeTextInput(input: ChatAiRuntimeInvokeInput): string | TextMessage[] {
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    return input.messages.map((message) => toSdkTextMessage(message));
  }
  return input.prompt;
}

function hasChatCapability(capabilities: readonly string[]): boolean {
  return capabilities.includes('chat');
}

function compareLocalModelPreference(left: LocalModelOptionV11, right: LocalModelOptionV11): number {
  const rank = (status: LocalModelOptionV11['status']) => {
    if (status === 'active') return 0;
    if (status === 'installed') return 1;
    if (status === 'unhealthy') return 2;
    return 3;
  };
  const rankDelta = rank(left.status) - rank(right.status);
  if (rankDelta !== 0) {
    return rankDelta;
  }
  return left.model.localeCompare(right.model);
}

function listChatLocalModels(state: RuntimeConfigStateV11 | null): LocalModelOptionV11[] {
  if (!state) {
    return [];
  }
  return state.local.models
    .filter((model) => model.status !== 'removed' && hasChatCapability(model.capabilities))
    .sort(compareLocalModelPreference);
}

function matchesConfiguredLocalModel(model: LocalModelOptionV11, configuredModel: string | null | undefined): boolean {
  const configured = normalizeText(configuredModel);
  if (!configured) {
    return false;
  }
  return normalizeText(model.model) === configured || normalizeText(model.localModelId) === configured;
}

export async function resolvePreferredChatLocalModel(
  state: RuntimeConfigStateV11 | null,
  preferredModel: string | null | undefined,
  deps: {
    healthLocalRuntimeAssetsImpl?: (localAssetId?: string) => Promise<readonly LocalRuntimeAssetHealth[]>;
  } = {},
): Promise<LocalModelOptionV11 | null> {
  const candidates = listChatLocalModels(state);
  if (candidates.length === 0) {
    return null;
  }

  const preferredCandidate = candidates.find((model) => matchesConfiguredLocalModel(model, preferredModel)) || null;
  try {
    const healthEntries = await (deps.healthLocalRuntimeAssetsImpl || localRuntime.health)();
    const healthByLocalId = new Map(
      healthEntries.map((entry) => [normalizeText(entry.localAssetId), entry] as const),
    );
    if (preferredCandidate && healthByLocalId.get(preferredCandidate.localModelId)?.status === 'active') {
      return preferredCandidate;
    }
    const healthyCandidate = candidates.find((candidate) => healthByLocalId.get(candidate.localModelId)?.status === 'active');
    if (healthyCandidate) {
      return healthyCandidate;
    }
  } catch {
    // Fall back to runtime-config state when authoritative health is unavailable.
  }

  return preferredCandidate || pickPreferredChatLocalModel(state);
}

async function resolveInvokeInput(
  input: ChatAiRuntimeInvokeInput,
): Promise<InvokeModLlmInput> {
  if (input.routeSnapshot.routeKind === 'local') {
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
      localModel && matchesConfiguredLocalModel(localModel, configuredLocalModel),
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
      modId: CORE_CHAT_AI_MOD_ID,
      binding: {
        source: 'local',
        connectorId: '',
        model: runtimeFields.localProviderModel,
      },
    });
    if (resolved.source !== 'local') {
      throw createNimiError({
        message: 'local AI route resolved to an invalid source',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'select_runtime_route_binding',
        source: 'runtime',
      });
    }
    return {
      modId: CORE_CHAT_AI_MOD_ID,
      provider: requireValue(
        resolved.provider,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'local AI route provider is missing',
      ),
      prompt: input.prompt,
      localProviderEndpoint: normalizeText(resolved.localProviderEndpoint) || undefined,
      localProviderModel: requireValue(
        resolved.localProviderModel || resolved.modelId || resolved.model,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'local AI route model is missing',
      ),
      localOpenAiEndpoint: normalizeText(resolved.localOpenAiEndpoint) || undefined,
    };
  }

  const connectorId = requireValue(
    input.routeSnapshot.connectorId,
    ReasonCode.AI_INPUT_INVALID,
    'select_runtime_route_binding',
    'cloud AI route connector is missing',
  );
  const provider = requireValue(
    input.routeSnapshot.provider,
    ReasonCode.AI_INPUT_INVALID,
    'select_runtime_route_binding',
    'cloud AI route provider is missing',
  );
  const connector = input.runtimeConfigState?.connectors.find((item) => item.id === connectorId) || null;
  const modelId = normalizeText(input.routeSnapshot.modelId)
    || (connector ? pickChatCapableConnectorModel(connector, null) : null)
    || '';
  const resolvedModelId = requireValue(
    modelId,
    ReasonCode.AI_INPUT_INVALID,
    'select_runtime_route_binding',
    'cloud AI route model is missing',
  );
  const resolveRuntimeBinding = createResolveRuntimeBinding(() => ({
    provider,
    runtimeModelType: 'chat',
    localProviderEndpoint: '',
    localProviderModel: resolvedModelId,
    localOpenAiEndpoint: '',
    connectorId,
  }));
  const resolved = await resolveRuntimeBinding({
    modId: CORE_CHAT_AI_MOD_ID,
    binding: {
      source: 'cloud',
      connectorId,
      provider,
      model: resolvedModelId,
      modelId: resolvedModelId,
    },
  });
  return {
    modId: CORE_CHAT_AI_MOD_ID,
    provider: requireValue(
      resolved.provider,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'cloud AI route provider is missing',
    ),
    prompt: input.prompt,
    connectorId: requireValue(
      resolved.connectorId || connectorId,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'cloud AI route connector is missing',
    ),
    localProviderModel: requireValue(
      resolved.modelId || resolved.model || resolvedModelId,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'cloud AI route model is missing',
    ),
  };
}

export function toChatAiRuntimeError(error: unknown): { code: string; message: string } {
  const normalized = asNimiError(error);
  return {
    code: String(normalized.reasonCode || ReasonCode.RUNTIME_CALL_FAILED).trim() || ReasonCode.RUNTIME_CALL_FAILED,
    message: String(normalized.message || 'AI response failed').trim() || 'AI response failed',
  };
}

export async function streamChatAiRuntime(
  input: ChatAiRuntimeInvokeInput,
  deps: ChatAiRuntimeStreamDeps = {},
): Promise<ChatAiRuntimeStreamResult> {
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
    input: resolveRuntimeTextInput(input),
    system: normalizeText(input.systemPrompt) || undefined,
    reasoning: resolveChatThinkingConfig(
      input.reasoningPreference,
      resolveAiChatThinkingSupport(input.routeSnapshot),
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

export async function invokeChatAiRuntime(
  input: ChatAiRuntimeInvokeInput,
  deps: ChatAiRuntimeInvokeDeps = {},
): Promise<ChatAiRuntimeInvokeResult> {
  const invokeModLlmImpl = deps.invokeModLlmImpl || invokeModLlm;
  const invokeInput = await resolveInvokeInput(input);
  const result = await invokeModLlmImpl(invokeInput);
  return {
    text: String(result.text || ''),
    traceId: String(result.traceId || ''),
    promptTraceId: String(result.promptTraceId || ''),
  };
}
