// App-owned dispatcher that consumes the platform runtime client returned by
// the scaffold-managed AuthGate projection. Every capability lane wires to a
// real Runtime SDK call — no synthetic success, no fallback. Failures are
// translated to typed unavailable using the raw SDK error message so the
// developer sees verbatim what Runtime returned.

import {
  ReasonCode,
  type PlatformClient,
} from '@nimiplatform/sdk';
import type {
  ConversationRuntimeTextMessage,
  ConversationTurnEvent,
} from '@nimiplatform/kit/features/chat/headless';
import {
  createSdkConversationRuntimeAdapter,
  createSimpleAiConversationProvider,
} from '@nimiplatform/kit/features/chat/runtime';
import type {
  AIConfig,
} from '@nimiplatform/sdk/ai';
import {
  createAIConfigEvidence,
} from '@nimiplatform/sdk/ai';
import {
  runAppAiTextGenerate,
} from '@nimiplatform/sdk/ai-app';
import {
  createAIRuntimeEvidence,
  peekRuntimeSchedulingBatch,
  projectAIRuntimeEvidenceMetadata,
  resolveAIConfigRuntimeSchedulingTargetForCapability,
  type AISchedulingEvaluationTarget,
  type RuntimeRouteAppCapability,
  type RuntimeRouteBinding,
} from '@nimiplatform/sdk/runtime';
import type { TesterCapabilityId } from './tester-capabilities.js';
import { capabilityUnavailable, type TesterUnavailable, type TesterUnavailableReason } from './tester-unavailable.js';
import { getTesterCapability } from './tester-capabilities.js';
import { loadTesterAIConfig } from './tester-ai-config-store.js';
import { buildMultimodalInput, type MediaAttachment } from './tester-multimodal-input.js';

export type TesterScenarioInput = {
  prompt: string;
  scenarioId: string;
  /** Optional live-delta callback (chat.stream). Receives the accumulated text
   *  on each delta so the UI can render the stream token-by-token. */
  onPartial?: (accumulatedText: string) => void;
  /** Optional local media attachments for vision/multimodal text capabilities. */
  attachments?: MediaAttachment[];
  /** Optional app-composed instruction line (tone/length studio controls) that is
   *  prepended to the prompt before it is sent to the runtime as real input. */
  directive?: string;
};

export type TesterTrace = {
  traceId?: string;
  modelResolved?: string;
  routeDecision?: string;
};

export type TesterTypedOutput =
  | {
      kind: 'text';
      text: string;
      finishReason: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      streamed: boolean;
    }
  | {
      kind: 'embedding';
      vectorCount: number;
      dimensions: number;
      sample: number[];
      totalTokens?: number;
    }
  | {
      kind: 'artifacts';
      jobId: string;
      jobState: string;
      artifactCount: number;
      firstArtifact?: {
        artifactId?: string;
        mimeType?: string;
        url?: string;
        displayName?: string;
      };
    }
  | {
      kind: 'transcript';
      text: string;
      jobId: string;
      jobState: string;
      artifactCount: number;
    }
  | {
      kind: 'voice-catalog';
      modelResolved: string;
      voiceCount: number;
      sample: Array<{ voiceId: string; name: string; lang: string }>;
    };

export type TesterTypedSuccess = {
  ok: true;
  capabilityId: TesterCapabilityId;
  capabilityLabel: string;
  message: string;
  output: TesterTypedOutput;
  trace?: TesterTrace;
};

export type TesterInvocationResult = TesterTypedSuccess | TesterUnavailable;
type ConversationTurnCompletedEvent = Extract<ConversationTurnEvent, { type: 'turn-completed' }>;

const TESTER_APP_ID = 'nimi.tester';
const TEXT_GENERATION_BINDING_CAPABILITY: RuntimeRouteAppCapability = 'text.generate';
const EMBEDDING_BINDING_CAPABILITY: RuntimeRouteAppCapability = 'text.embed';

export type ResolvedLLMBinding = {
  bindingCapabilityId: RuntimeRouteAppCapability;
  binding: RuntimeRouteBinding;
  model: string;
  schedulingTarget: AISchedulingEvaluationTarget | null;
  metadata: Record<string, string>;
};

export type SchedulingPreflightResult = {
  unavailable: TesterUnavailable | null;
  evidenceMetadata: Record<string, string>;
};

export function isTesterUnavailable(value: ResolvedLLMBinding | TesterUnavailable): value is TesterUnavailable {
  return 'ok' in value && value.ok === false;
}

export function buildMetadata(surfaceId: string, extra?: Record<string, string | undefined>): Record<string, string> {
  const metadata: Record<string, string> = {
    callerKind: 'third-party-app',
    callerId: TESTER_APP_ID,
    surfaceId,
  };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value) metadata[key] = value;
  }
  return metadata;
}

function describeSdkError(error: unknown): string {
  if (!error) return 'Runtime SDK call failed with no error message.';
  if (error instanceof Error) {
    const message = error.message || error.name || 'Runtime SDK call failed.';
    const reasonCode = (error as { reasonCode?: string }).reasonCode;
    return reasonCode ? `${reasonCode}: ${message}` : message;
  }
  return String(error);
}

// Map the SDK ReasonCode to a precise tester reason. The runtime fails closed
// with a typed reasonCode; the cockpit must surface that class verbatim instead
// of blanket-labelling everything as a missing SDK method. Only a genuine
// SDK_RUNTIME_METHOD_UNAVAILABLE is an SDK surface gap.
function reasonFromSdkError(error: unknown): TesterUnavailableReason {
  const reasonCode = error && typeof error === 'object'
    ? String(
      (error as { reasonCode?: unknown }).reasonCode
      || (error as { code?: unknown }).code
      || '',
    )
    : '';
  switch (reasonCode) {
    case ReasonCode.AUTH_CONTEXT_MISSING:
      return 'auth-context-missing';
    case ReasonCode.PRINCIPAL_UNAUTHORIZED:
    case ReasonCode.SESSION_EXPIRED:
    case ReasonCode.APP_TOKEN_EXPIRED:
    case ReasonCode.APP_TOKEN_REVOKED:
      return 'principal-unauthorized';
    case ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE:
      return 'sdk-method-unavailable';
    default:
      return 'runtime-call-failed';
  }
}

export function unavailableFromError(capabilityId: TesterCapabilityId, error: unknown): TesterUnavailable {
  const capability = getTesterCapability(capabilityId);
  return capabilityUnavailable(capability, reasonFromSdkError(error), describeSdkError(error));
}

export function unavailableFromValidation(capabilityId: TesterCapabilityId, message: string): TesterUnavailable {
  const capability = getTesterCapability(capabilityId);
  return capabilityUnavailable(capability, 'input-invalid', message);
}

export function unavailableFromAIConfig(capabilityId: TesterCapabilityId, message: string): TesterUnavailable {
  const capability = getTesterCapability(capabilityId);
  return capabilityUnavailable(capability, 'ai-config-binding-missing', message);
}

function bindingCapabilityFor(capabilityId: TesterCapabilityId): ResolvedLLMBinding['bindingCapabilityId'] | null {
  if (capabilityId === 'text.generate' || capabilityId === 'chat.stream') {
    return TEXT_GENERATION_BINDING_CAPABILITY;
  }
  if (capabilityId === 'text.embed') {
    return EMBEDDING_BINDING_CAPABILITY;
  }
  if (capabilityId === 'speech.bundle') {
    return 'audio.synthesize';
  }
  if (
    capabilityId === 'image.generate'
    || capabilityId === 'video.generate'
    || capabilityId === 'audio.synthesize'
    || capabilityId === 'audio.transcribe'
  ) {
    return capabilityId;
  }
  return null;
}

function bindingModel(binding: RuntimeRouteBinding): string {
  return String(binding.model || binding.modelId || binding.localModelId || '').trim();
}

export function resolveTesterLLMBinding(
  capabilityId: TesterCapabilityId,
  config: AIConfig = loadTesterAIConfig(),
): ResolvedLLMBinding | TesterUnavailable {
  const bindingCapabilityId = bindingCapabilityFor(capabilityId);
  if (!bindingCapabilityId) {
    return unavailableFromAIConfig(capabilityId, `Capability ${capabilityId} does not have an AIConfig LLM binding path.`);
  }
  const binding = config.capabilities.selectedBindings[bindingCapabilityId] || null;
  if (!binding) {
    return unavailableFromAIConfig(
      capabilityId,
      `AIConfig binding is required for ${bindingCapabilityId}; Runtime invocation failed closed before request dispatch.`,
    );
  }
  const model = bindingModel(binding);
  if (!model) {
    return unavailableFromAIConfig(
      capabilityId,
      `AIConfig binding for ${bindingCapabilityId} does not include a runtime model id.`,
    );
  }
  const connectorId = String(binding.connectorId || '').trim();
  if (binding.source === 'local' && connectorId) {
    return unavailableFromAIConfig(
      capabilityId,
      `AIConfig binding for ${bindingCapabilityId} is local but includes connectorId; Runtime local bindings must use connectorId="" and route by model id.`,
    );
  }
  if (binding.source === 'cloud' && !connectorId) {
    return unavailableFromAIConfig(
      capabilityId,
      `AIConfig binding for ${bindingCapabilityId} is cloud but does not include a runtime connectorId.`,
    );
  }
  if (binding.source !== 'local' && binding.source !== 'cloud') {
    return unavailableFromAIConfig(
      capabilityId,
      `AIConfig binding for ${bindingCapabilityId} has unsupported source "${String(binding.source)}".`,
    );
  }
  const evidence = createAIConfigEvidence(config);
  const scopeRef = config.scopeRef;
  return {
    bindingCapabilityId,
    binding,
    model,
    schedulingTarget: resolveAIConfigRuntimeSchedulingTargetForCapability(config, bindingCapabilityId),
    metadata: {
      aiConfigScopeKind: scopeRef.kind,
      aiConfigScopeOwnerId: scopeRef.ownerId,
      aiConfigScopeSurfaceId: scopeRef.surfaceId || '',
      aiConfigProfileId: config.profileOrigin?.profileId || '',
      aiConfigProfileTitle: config.profileOrigin?.title || '',
      aiConfigCapabilityId: capabilityId,
      aiConfigBindingCapabilityId: bindingCapabilityId,
      aiConfigBindingSource: binding.source,
      aiConfigBindingConnectorId: binding.connectorId || '',
      aiConfigBindingModel: model,
      aiConfigHash: evidence.configHash,
      aiConfigBindingKeys: evidence.capabilityBindingKeys.join(','),
    },
  };
}

export async function ensureSchedulingPreflight(
  client: PlatformClient,
  capabilityId: TesterCapabilityId,
  resolved: ResolvedLLMBinding,
): Promise<SchedulingPreflightResult> {
  if (!resolved.schedulingTarget) {
    return { unavailable: null, evidenceMetadata: {} };
  }
  try {
    const batch = await peekRuntimeSchedulingBatch({
      appId: TESTER_APP_ID,
      targets: [resolved.schedulingTarget],
      peekScheduling: (request, options) => client.runtime.ai.peekScheduling(request, options),
    });
    const judgement = batch?.aggregateJudgement ?? null;
    const evidenceMetadata = projectAIRuntimeEvidenceMetadata(
      createAIRuntimeEvidence({ schedulingJudgement: judgement }),
    );
    if (judgement?.state === 'denied') {
      return {
        unavailable: capabilityUnavailable(
          getTesterCapability(capabilityId),
          'runtime-call-failed',
          `Runtime scheduling denied ${resolved.bindingCapabilityId}: ${judgement.detail || 'denied'}`,
        ),
        evidenceMetadata,
      };
    }
    return { unavailable: null, evidenceMetadata };
  } catch (error) {
    return { unavailable: unavailableFromError(capabilityId, error), evidenceMetadata: {} };
  }
}

export function routeInput(binding: RuntimeRouteBinding, model: string): {
  model: string;
  connectorId?: string;
  route: 'local' | 'cloud';
} {
  const connectorId = String(binding.connectorId || '').trim();
  if (binding.source === 'cloud') {
    return {
      model,
      connectorId,
      route: 'cloud',
    };
  }
  return {
    model,
    route: 'local',
  };
}

export function pickTrace(value: unknown): TesterTrace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return {
    traceId: typeof record.traceId === 'string' ? record.traceId : undefined,
    modelResolved: typeof record.modelResolved === 'string' ? record.modelResolved : undefined,
    routeDecision: typeof record.routeDecision === 'string' ? record.routeDecision : undefined,
  };
}

function stableTesterIdPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'scenario';
}

function buildChatRuntimeUserMessage(prompt: string, attachments: readonly MediaAttachment[]): ConversationRuntimeTextMessage {
  const multimodalInput = buildMultimodalInput(prompt, [...attachments]);
  if (Array.isArray(multimodalInput)) {
    const [message] = multimodalInput;
    return {
      role: 'user',
      text: prompt,
      content: message?.content ?? prompt,
      name: null,
    };
  }
  return {
    role: 'user',
    text: multimodalInput,
    name: null,
  };
}

function conversationRuntimeFailure(code: string, message: string): Error & {
  code: string;
  reasonCode: string;
} {
  const error = new Error(message) as Error & { code: string; reasonCode: string };
  error.name = code;
  error.code = code;
  error.reasonCode = code;
  return error;
}

export async function invokeTextGenerate(client: PlatformClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('text.generate', 'Scenario prompt is empty — supply a request body before running text.generate.');
  }
  const resolved = resolveTesterLLMBinding('text.generate');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'text.generate', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const route = routeInput(resolved.binding, resolved.model);
  const directedPrompt = input.directive ? `${input.directive}\n\n${prompt}` : prompt;
  const result = await runAppAiTextGenerate({
    runtime: {
      generateText: (request) => client.runtime.ai.text.generate(request),
    },
    request: {
      ...route,
      input: buildMultimodalInput(directedPrompt, input.attachments ?? []),
      metadata: buildMetadata('nimi.tester.ai.text.generate', {
        ...resolved.metadata,
        ...schedulingPreflight.evidenceMetadata,
      }),
    },
  });
  if (result.ok === false) {
    return unavailableFromError('text.generate', result.error.cause ?? result.error);
  }
  const output = result.output;
  return {
    ok: true,
    capabilityId: 'text.generate',
    capabilityLabel: getTesterCapability('text.generate').label,
    message: `Runtime accepted the prompt and returned ${result.text.length} characters.`,
    output: {
      kind: 'text',
      text: result.text,
      finishReason: output.finishReason,
      inputTokens: output.usage?.inputTokens,
      outputTokens: output.usage?.outputTokens,
      totalTokens: output.usage?.totalTokens,
      streamed: false,
    },
    trace: pickTrace(output.trace),
  };
}

export async function invokeChatStream(client: PlatformClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('chat.stream', 'Scenario prompt is empty — supply a chat turn before running chat.stream.');
  }
  const resolved = resolveTesterLLMBinding('chat.stream');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'chat.stream', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const route = routeInput(resolved.binding, resolved.model);
  try {
    const scenarioId = stableTesterIdPart(input.scenarioId);
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter: createSdkConversationRuntimeAdapter(client.runtime),
      resolveRuntimeUserMessage: () => buildChatRuntimeUserMessage(prompt, input.attachments ?? []),
      resolveRuntimeRequest: () => ({
        ...route,
        metadata: buildMetadata('nimi.tester.ai.chat.stream', {
          ...resolved.metadata,
          ...schedulingPreflight.evidenceMetadata,
        }),
      }),
    });
    let streamedText = '';
    let completed: ConversationTurnCompletedEvent | null = null;
    for await (const event of provider.runTurn({
      modeId: 'simple-ai',
      threadId: `tester:${scenarioId}:chat.stream`,
      turnId: `tester:${scenarioId}:chat.stream:turn`,
      userMessage: {
        id: `tester:${scenarioId}:chat.stream:user`,
        text: prompt,
        attachments: input.attachments ?? [],
      },
      history: [],
      metadata: {
        capabilityId: 'chat.stream',
      },
    })) {
      if (event.type === 'text-delta') {
        streamedText += event.textDelta;
        input.onPartial?.(streamedText);
      } else if (event.type === 'turn-completed') {
        completed = event;
      } else if (event.type === 'turn-failed') {
        return unavailableFromError(
          'chat.stream',
          conversationRuntimeFailure(event.error.code, event.error.message),
        );
      } else if (event.type === 'turn-canceled') {
        return unavailableFromError(
          'chat.stream',
          conversationRuntimeFailure('AI_STREAM_CANCELED', 'Runtime canceled the chat.stream turn.'),
        );
      }
    }
    if (!completed) {
      return unavailableFromError(
        'chat.stream',
        conversationRuntimeFailure('RUNTIME_STREAM_INCOMPLETE', 'Kit conversation provider ended without a completed turn.'),
      );
    }
    return {
      ok: true,
      capabilityId: 'chat.stream',
      capabilityLabel: getTesterCapability('chat.stream').label,
      message: `Stream completed with ${completed.outputText.length} characters (finishReason=${completed.finishReason || 'stop'}).`,
      output: {
        kind: 'text',
        text: completed.outputText,
        finishReason: String(completed.finishReason || 'stop'),
        inputTokens: completed.usage?.inputTokens,
        outputTokens: completed.usage?.outputTokens,
        totalTokens: completed.usage?.totalTokens,
        streamed: true,
      },
      trace: pickTrace(completed.trace),
    };
  } catch (error) {
    return unavailableFromError('chat.stream', error);
  }
}

export async function invokeEmbedding(client: PlatformClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('text.embed', 'Scenario prompt is empty — supply at least one input string for embedding.');
  }
  const resolved = resolveTesterLLMBinding('text.embed');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'text.embed', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const route = routeInput(resolved.binding, resolved.model);
  try {
    const output = await client.runtime.ai.embedding.generate({
      ...route,
      input: prompt,
      metadata: buildMetadata('nimi.tester.ai.embedding.generate', {
        ...resolved.metadata,
        ...schedulingPreflight.evidenceMetadata,
      }),
    });
    const first = output.vectors[0] || [];
    return {
      ok: true,
      capabilityId: 'text.embed',
      capabilityLabel: getTesterCapability('text.embed').label,
      message: `Runtime returned ${output.vectors.length} vector(s) with ${first.length} dimensions.`,
      output: {
        kind: 'embedding',
        vectorCount: output.vectors.length,
        dimensions: first.length,
        sample: first.slice(0, 8),
        totalTokens: output.usage?.totalTokens,
      },
      trace: pickTrace(output.trace),
    };
  } catch (error) {
    return unavailableFromError('text.embed', error);
  }
}
