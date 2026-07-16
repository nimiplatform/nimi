import {
  createNimiLocalAppStandardShellSurface,
  hasElectronRuntime,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { createNimiAppRuntimePlatformClient } from '@nimiplatform/kit/core/sdk-contract';
import {
  createRuntimeAgentConversationProjectionState,
  reduceRuntimeAgentConversationProjectionEvent,
  streamRuntimeAgentTurnRunnerPartsAsConversationEvents,
  type ConversationTurnEvent,
  type RuntimeAgentArtifactPreviewInput,
  type RuntimeAgentConversationProjectionState,
  type RuntimeAgentTurnRunnerPartLike,
} from '@nimiplatform/kit/features/chat/headless';
import {
  createNimiRuntimeAgentTurnsModule,
  runNimiRuntimeAgentTurn,
  Runtime,
  type NimiRuntimeAgentTurnRequest,
  type NimiRuntimeAgentTurnRunnerModule,
} from '@nimiplatform/sdk/runtime';
import type { ZhiyuConversationHomeStatus } from '../agent/conversation-home';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  createZhiyuRuntimeAgentBindingScopeRunner,
  resolveZhiyuRuntimeAgentBindingDecision,
  resolveZhiyuRuntimeAgentBindingDecisionFromHost,
  scopedBindingForRuntimeAgentRequest,
  withZhiyuRuntimeAgentBindingScopes,
  type ZhiyuRuntimeAgentBindingDecision,
} from './runtime-agent-binding';

const ZHIYU_RUNTIME_AGENT_TURN_SCOPES = [
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
] as const;

export type ZhiyuRuntimeAgentChatRouteEvidence = Pick<
  ZhiyuEvidence['route'],
  'ready' | 'reasonCode' | 'actionHint' | 'source' | 'message' | 'executionBinding'
>;

export type ZhiyuRuntimeAgentChatState =
  | 'idle'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'canceled';

export type ZhiyuRuntimeAgentChatTurnResult = {
  readonly transport: 'electron-ipc';
  readonly ready: boolean;
  readonly state: ZhiyuRuntimeAgentChatState;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId: string | null;
  readonly runtimeSourceRef: string | null;
  readonly localAgentRef: string | null;
  readonly conversationAnchorId: string | null;
  readonly requestId: string | null;
  readonly events: readonly ConversationTurnEvent[];
  readonly messages: RuntimeAgentConversationProjectionState['messages'];
  readonly reasoningText: string | null;
  readonly outputText: string | null;
  readonly diagnostics: RuntimeAgentConversationProjectionState['diagnostics'];
};

export type ZhiyuRuntimeAgentChatStreamTurn = (
  request: NimiRuntimeAgentTurnRequest,
  options?: {
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly stream: AsyncIterable<RuntimeAgentTurnRunnerPartLike | unknown>;
}>;

export type ZhiyuRuntimeAgentChatTurnInput = {
  readonly conversation: ZhiyuConversationHomeStatus;
  readonly route: ZhiyuRuntimeAgentChatRouteEvidence;
  readonly runtimeBinding?: ZhiyuRuntimeAgentBindingDecision;
  readonly text: unknown;
  readonly requestId?: unknown;
  readonly attachments?: readonly unknown[];
  readonly expectedConversationAnchorId?: unknown;
  readonly signal?: AbortSignal;
  readonly streamTurn?: ZhiyuRuntimeAgentChatStreamTurn;
  readonly resolveArtifactPreviewUri?: (
    artifact: RuntimeAgentArtifactPreviewInput,
  ) => Promise<string | null | undefined> | string | null | undefined;
  readonly onEvent?: (
    event: ConversationTurnEvent,
    state: RuntimeAgentConversationProjectionState,
  ) => void;
};

export {
  resolveZhiyuRuntimeAgentBindingDecision,
};

export async function runZhiyuAgentChatTurn(
  input: ZhiyuRuntimeAgentChatTurnInput,
): Promise<ZhiyuRuntimeAgentChatTurnResult> {
  const identity = conversationIdentity(input.conversation);
  if (!identity) {
    return chatUnavailable({
      reasonCode: 'zhiyu-conversation-anchor-required',
      actionHint: 'open_runtime_conversation_anchor',
      source: input.conversation.source,
      message: 'Zhiyu requires a Runtime-owned conversation anchor before sending a chat turn.',
      ownerUserId: input.conversation.ownerUserId,
      runtimeSourceRef: input.conversation.runtimeSourceRef,
      localAgentRef: input.conversation.localAgentRef,
      conversationAnchorId: input.conversation.conversationAnchorId,
      requestId: stringOr(input.requestId, null),
    });
  }

  const expectedConversationAnchorId = stringOr(input.expectedConversationAnchorId, null);
  if (expectedConversationAnchorId && expectedConversationAnchorId !== identity.conversationAnchorId) {
    return chatUnavailable({
      reasonCode: 'zhiyu-conversation-anchor-mismatch',
      actionHint: 'refresh_runtime_conversation_anchor',
      source: 'renderer',
      message: 'Runtime Agent chat turn was blocked because the active conversation anchor changed.',
      ...identity,
      requestId: stringOr(input.requestId, null),
    });
  }

  // Display-evidence gate only: the runtime resolves each turn against its
  // committed Runtime Agent AI Config (K-AGCORE-147); Zhiyu just refuses to
  // submit while the projected text.generate readiness is not 'ready'.
  if (!input.route.ready) {
    return chatUnavailable({
      reasonCode: input.route.reasonCode === 'not-probed'
        ? 'zhiyu-runtime-agent-ai-config-readiness-required'
        : input.route.reasonCode,
      actionHint: input.route.actionHint || 'configure_runtime_agent_ai_config',
      source: input.route.source,
      message: input.route.message,
      ...identity,
      requestId: stringOr(input.requestId, null),
    });
  }

  const text = stringOr(input.text, '');
  if (!text) {
    return chatUnavailable({
      reasonCode: 'zhiyu-turn-text-required',
      actionHint: 'enter_runtime_agent_turn_text',
      source: 'renderer',
      message: 'Runtime Agent chat turn text is required.',
      ...identity,
      requestId: stringOr(input.requestId, null),
    });
  }

  if (input.attachments && input.attachments.length > 0) {
    return chatUnavailable({
      reasonCode: 'zhiyu-runtime-agent-chat-attachments-not-admitted',
      actionHint: 'remove_runtime_agent_chat_attachments',
      source: 'renderer',
      message: 'Runtime Agent chat attachments are not admitted for Zhiyu yet.',
      ...identity,
      requestId: stringOr(input.requestId, null),
    });
  }

  const runtimeBinding = input.runtimeBinding ?? resolveZhiyuRuntimeAgentBindingDecisionFromHost(ZHIYU_RUNTIME_AGENT_TURN_SCOPES);
  if (runtimeBinding.kind === 'missing') {
    return chatUnavailable({
      reasonCode: runtimeBinding.reasonCode,
      actionHint: runtimeBinding.actionHint,
      source: 'runtime',
      message: runtimeBinding.message,
      ...identity,
      requestId: stringOr(input.requestId, null),
    });
  }
  try {
    await withZhiyuRuntimeAgentBindingScopes(runtimeBinding, ZHIYU_RUNTIME_AGENT_TURN_SCOPES, async () => undefined);
  } catch (error) {
    return chatUnavailable({
      reasonCode: errorReasonCode(error),
      actionHint: errorActionHint(error),
      source: errorSource(error),
      message: errorMessage(error),
      ...identity,
      requestId: stringOr(input.requestId, null),
    });
  }

  const requestId = stringOr(input.requestId, createTurnRequestId());
  const request = buildRuntimeAgentTurnRequest({
    ...identity,
    route: input.route,
    requestId,
    text,
    runtimeBinding,
  });
  const streamTurn = input.streamTurn
    ?? createElectronRuntimeAgentStreamTurn(identity.ownerUserId, runtimeBinding);
  const initialProjection = createRuntimeAgentConversationProjectionState({
    modeId: 'runtime-agent-chat-v1',
    threadId: identity.threadId,
    turnId: requestId,
    sessionId: identity.conversationAnchorId,
    targetId: identity.localAgentRef,
    conversationAnchorId: identity.conversationAnchorId,
    localAgentRef: identity.localAgentRef,
    userMessage: {
      id: `${requestId}:user`,
      text,
    },
    assistantMessageId: `${requestId}:assistant`,
    assistantName: 'Zhiyu Agent',
  });

  try {
    const streamed = await streamTurn(request, { signal: input.signal });
    const resolveArtifactPreviewUri = input.resolveArtifactPreviewUri
      ?? (input.streamTurn ? undefined : createElectronRuntimeArtifactPreviewResolver(runtimeBinding));
    let projection = initialProjection;
    for await (const event of streamRuntimeAgentTurnRunnerPartsAsConversationEvents({
      modeId: 'runtime-agent-chat-v1',
      threadId: identity.threadId,
      turnId: requestId,
      parts: streamed.stream,
      resolveArtifactPreviewUri,
    })) {
      projection = reduceRuntimeAgentConversationProjectionEvent(projection, event);
      input.onEvent?.(event, projection);
    }
    return chatResultFromProjection(projection, {
      ...identity,
      requestId,
    });
  } catch (error) {
    return chatUnavailable({
      reasonCode: errorReasonCode(error),
      actionHint: 'inspect_runtime_agent_chat_stream',
      source: errorSource(error),
      message: errorMessage(error),
      ...identity,
      requestId,
      events: initialProjection.events,
      messages: initialProjection.messages,
    });
  }
}

// Turn requests never carry model bindings: the runtime resolves each turn
// against its committed Runtime Agent AI Config (K-AGCORE-147). The local text
// binding gate above is route-readiness display evidence only.
function buildRuntimeAgentTurnRequest(input: {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
  readonly threadId: string;
  readonly route: ZhiyuRuntimeAgentChatRouteEvidence;
  readonly requestId: string;
  readonly text: string;
  readonly runtimeBinding: Exclude<ZhiyuRuntimeAgentBindingDecision, { readonly kind: 'missing' }>;
}): NimiRuntimeAgentTurnRequest {
  const scopedBinding = scopedBindingForRuntimeAgentRequest(input.runtimeBinding);
  const reasoning = runtimeAgentReasoningRequest(input.route);
  return {
    ownerUserId: input.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef,
    localAgentRef: input.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    requestId: input.requestId,
    threadId: input.threadId,
    messages: [
      {
        role: 'user',
        content: input.text,
      },
    ],
    ...(reasoning ? { reasoning } : {}),
    ...(scopedBinding ? { scopedBinding } : {}),
  };
}

function runtimeAgentReasoningRequest(
  route: ZhiyuRuntimeAgentChatRouteEvidence,
): NimiRuntimeAgentTurnRequest['reasoning'] | undefined {
  return route.ready && route.executionBinding?.route === 'local'
    ? {
      mode: 'on',
      traceMode: 'separate',
    }
    : undefined;
}

function createElectronRuntimeAgentStreamTurn(
  ownerUserId: string,
  runtimeBinding: Exclude<ZhiyuRuntimeAgentBindingDecision, { readonly kind: 'missing' }>,
): ZhiyuRuntimeAgentChatStreamTurn {
  if (runtimeBinding.kind === 'local-app-carrier') {
    return createLocalAppRuntimeAgentStreamTurn(ownerUserId);
  }
  return async (request, options) => {
    if (typeof window === 'undefined' || !hasElectronRuntime()) {
      throw Object.assign(new Error('Electron Runtime bridge is not available.'), {
        reasonCode: 'electron-runtime-bridge-unavailable',
        actionHint: 'restart_zhiyu_electron_shell',
        source: 'renderer',
      });
    }
    const runtime = new Runtime({
      appId: 'nimi.zhiyu',
      transport: { type: 'electron-ipc' },
    });
    const turns = createNimiRuntimeAgentTurnsModule({
      runtime: {
        appId: 'nimi.zhiyu',
        auth: runtime.auth,
        agents: runtime.agents,
        appMessages: runtime.appMessages,
      },
      getSubjectUserId: () => ownerUserId,
      withScopes: createZhiyuRuntimeAgentBindingScopeRunner(() => runtimeBinding),
    });
    return runNimiRuntimeAgentTurn({
      turns,
      subscribe: {
        ownerUserId: request.ownerUserId,
        runtimeSourceRef: request.runtimeSourceRef,
        localAgentRef: request.localAgentRef,
        conversationAnchorId: request.conversationAnchorId,
        includeAgentEvents: false,
        ...(request.scopedBinding ? { scopedBinding: request.scopedBinding } : {}),
      },
      request,
      signal: options?.signal,
      interruptReason: 'user_cancel',
    });
  };
}

function createLocalAppRuntimeAgentStreamTurn(ownerUserId: string): ZhiyuRuntimeAgentChatStreamTurn {
  return async (request, options) => {
    if (typeof window === 'undefined' || !hasElectronRuntime()) {
      throw localAppTurnError('protected-carrier-required', 'restart_zhiyu_electron_shell');
    }
    const platform = createNimiAppRuntimePlatformClient({
      standardShell: createNimiLocalAppStandardShellSurface(),
    });
    const agentId = stringOr(request.localAgentRef, '');
    const conversationAnchorId = stringOr(request.conversationAnchorId, '');
    const resourceRef = `agent:${agentId}/conversation:${conversationAnchorId}`;
    await ensureLocalAppPermission(
      platform,
      'runtime_agent.conversation.turn_send',
      resourceRef,
      'Send a message to this Runtime-owned conversation',
    );
    await ensureLocalAppPermission(
      platform,
      'runtime_agent.conversation.turn_subscribe',
      resourceRef,
      'Read the resulting Runtime-owned conversation events',
    );
    const turns: NimiRuntimeAgentTurnRunnerModule = {
      subscribe: async () => subscribeLocalAppTurn(platform, agentId, conversationAnchorId),
      request: async (turnRequest) => platform.agent.sendTurn({
        agentId,
        conversationAnchorId,
        clientTurnId: stringOr(turnRequest.requestId, ''),
        userText: localAppUserText(turnRequest),
      }),
      interrupt: async () => {
        throw localAppTurnError('local-app-operation-unavailable', 'wait_for_current_turn');
      },
      getSessionSnapshot: async () => platform.agent.getConversationSnapshot({
        agentId,
        conversationAnchorId,
      }),
    };
    const { scopedBinding: _scopedBinding, ...localRequest } = request;
    return runNimiRuntimeAgentTurn({
      turns,
      subscribe: {
        ownerUserId,
        runtimeSourceRef: request.runtimeSourceRef,
        localAgentRef: agentId,
        conversationAnchorId,
        includeAgentEvents: false,
      },
      request: localRequest,
      signal: options?.signal,
      interruptReason: 'user_cancel',
    });
  };
}

async function* subscribeLocalAppTurn(
  platform: ReturnType<typeof createNimiAppRuntimePlatformClient>,
  agentId: string,
  conversationAnchorId: string,
) {
  let cursor: string | undefined;
  for (;;) {
    const page = await platform.agent.subscribeTurn({
      agentId,
      conversationAnchorId,
      ...(cursor ? { cursor } : {}),
    });
    cursor = page.cursor;
    yield page.events[0];
  }
}

async function ensureLocalAppPermission(
  platform: ReturnType<typeof createNimiAppRuntimePlatformClient>,
  operationId: string,
  resourceRef: string,
  purpose: string,
): Promise<void> {
  const posture = await platform.permissions.posture({ operationId, resourceRef });
  if (posture.state === 'granted') return;
  if (posture.state !== 'pending') {
    const requested = await platform.permissions.request({ operationId, resourceRef, purpose });
    if (requested.state === 'granted') return;
  }
  throw localAppTurnError(
    posture.state === 'pending' ? 'local-app-grant-pending' : posture.reasonCode,
    'approve_local_app_operation_in_desktop',
  );
}

function localAppUserText(request: NimiRuntimeAgentTurnRequest): string {
  const message = [...request.messages].reverse().find((candidate) => candidate.role === 'user');
  const content = typeof message?.content === 'string' ? message.content.trim() : '';
  if (!content) throw localAppTurnError('zhiyu-turn-text-required', 'enter_runtime_agent_turn_text');
  return content;
}

function localAppTurnError(reasonCode: string, actionHint: string): Error {
  return Object.assign(new Error(reasonCode), { reasonCode, actionHint, source: 'runtime' });
}

function createElectronRuntimeArtifactPreviewResolver(
  runtimeBinding: Exclude<ZhiyuRuntimeAgentBindingDecision, { readonly kind: 'missing' }>,
): (artifact: RuntimeAgentArtifactPreviewInput) => Promise<string | null> {
  return async (artifact) => {
    const artifactId = stringOr(artifact.artifactId, '');
    const declaredMimeType = stringOr(artifact.mimeType, '');
    if (!artifactId || !declaredMimeType.toLowerCase().startsWith('image/')) {
      return null;
    }
    if (typeof window === 'undefined' || !hasElectronRuntime()) {
      throw Object.assign(new Error('Electron Runtime bridge is not available for Runtime artifact preview.'), {
        reasonCode: 'electron-runtime-bridge-unavailable',
        actionHint: 'restart_zhiyu_electron_shell',
        source: 'renderer',
      });
    }
    if (runtimeBinding.kind === 'local-app-carrier') {
      const platform = createNimiAppRuntimePlatformClient({
        standardShell: createNimiLocalAppStandardShellSurface(),
      });
      const response = await platform.artifacts.readRuntimeBytes(artifactId);
      if (!response.mimeType.toLowerCase().startsWith('image/') || response.bytes.byteLength === 0) return null;
      return `data:${response.mimeType};base64,${bytesToBase64(response.bytes)}`;
    }
    const runtime = new Runtime({
      appId: 'nimi.zhiyu',
      transport: { type: 'electron-ipc' },
    });
    const response = await withZhiyuRuntimeAgentBindingScopes(
      runtimeBinding,
      ['runtime.artifact.read-bytes'],
      (options) => runtime.artifacts.readArtifactBytes({ artifactId }, options),
    );
    const mimeType = stringOr(response.mimeType, declaredMimeType);
    if (!mimeType.toLowerCase().startsWith('image/')) {
      return null;
    }
    const bytes = byteArray(response.bytes);
    if (bytes.byteLength === 0) {
      return null;
    }
    return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
  };
}

function byteArray(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value.filter((item): item is number => Number.isInteger(item) && item >= 0 && item <= 255));
  }
  return new Uint8Array();
}

function bytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (globalThis as typeof globalThis & {
    readonly Buffer?: {
      readonly from: (input: Uint8Array) => { toString: (encoding: 'base64') => string };
    };
  }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(bytes).toString('base64');
  }
  if (typeof btoa !== 'function') {
    throw Object.assign(new Error('Browser base64 encoder is not available for Runtime artifact preview.'), {
      reasonCode: 'zhiyu-runtime-artifact-preview-encoder-unavailable',
      actionHint: 'retry_in_browser_runtime',
      source: 'renderer',
    });
  }
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function conversationIdentity(conversation: ZhiyuConversationHomeStatus): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
  readonly threadId: string;
} | null {
  if (!conversation.ready) {
    return null;
  }
  const ownerUserId = stringOr(conversation.ownerUserId, '');
  const runtimeSourceRef = stringOr(conversation.runtimeSourceRef, '');
  const localAgentRef = stringOr(conversation.localAgentRef, '');
  const conversationAnchorId = stringOr(conversation.conversationAnchorId, '');
  const threadId = stringOr(conversation.threadId, '');
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef || !conversationAnchorId || !threadId) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    conversationAnchorId,
    threadId,
  };
}

function chatResultFromProjection(
  projection: RuntimeAgentConversationProjectionState,
  identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
    readonly conversationAnchorId: string;
    readonly requestId: string;
  },
): ZhiyuRuntimeAgentChatTurnResult {
  return {
    transport: 'electron-ipc',
    ready: projection.status === 'completed',
    state: projection.status,
    reasonCode: projection.reasonCode,
    actionHint: projection.status === 'completed'
      ? 'review_runtime_agent_chat_message'
      : 'inspect_runtime_agent_chat_stream',
    source: 'runtime',
    message: projection.message,
    ownerUserId: identity.ownerUserId,
    runtimeSourceRef: identity.runtimeSourceRef,
    localAgentRef: identity.localAgentRef,
    conversationAnchorId: identity.conversationAnchorId,
    requestId: identity.requestId,
    events: projection.events,
    messages: projection.messages,
    reasoningText: projection.reasoningText || null,
    outputText: projection.outputText || null,
    diagnostics: projection.diagnostics,
  };
}

function chatUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
  readonly conversationAnchorId?: string | null;
  readonly requestId?: string | null;
  readonly events?: readonly ConversationTurnEvent[];
  readonly messages?: RuntimeAgentConversationProjectionState['messages'];
}): ZhiyuRuntimeAgentChatTurnResult {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'failed',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: input.localAgentRef ?? null,
    conversationAnchorId: input.conversationAnchorId ?? null,
    requestId: input.requestId ?? null,
    events: input.events || [],
    messages: input.messages || [],
    reasoningText: null,
    outputText: null,
    diagnostics: null,
  };
}

function errorReasonCode(error: unknown): string {
  const record = errorRecord(error);
  return stringOr(record.reasonCode, 'zhiyu-runtime-agent-chat-stream-failed');
}

function errorSource(error: unknown): string {
  return stringOr(errorRecord(error).source, 'sdk');
}

function errorActionHint(error: unknown): string {
  return stringOr(errorRecord(error).actionHint, 'inspect_runtime_agent_chat_stream');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'Runtime Agent chat stream failed.';
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === 'object' ? error as Record<string, unknown> : {};
}

function createTurnRequestId(): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `zhiyu-turn-${randomId}`;
}

function stringOr(value: unknown, fallback: string): string;
function stringOr(value: unknown, fallback: null): string | null;
function stringOr(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
