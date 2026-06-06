// App-owned dispatcher that consumes the platform runtime client returned by
// the scaffold-managed AuthGate projection. Every capability lane wires to a
// real Runtime SDK call — no synthetic success, no fallback. Failures are
// translated to typed unavailable using the raw SDK error message so the
// developer sees verbatim what Runtime returned.

import type {
  ConversationRuntimeTextMessage,
  ConversationTurnEvent,
} from '@nimiplatform/kit/features/chat/headless';
import {
  createSdkConversationRuntimeAdapter,
  createSimpleAiConversationProvider,
} from '@nimiplatform/kit/features/chat/runtime';
import {
  createNimiRuntimeAIModel,
  createNimiRuntimeAISchedulingClient,
  createNimiRuntimeEmbeddingClient,
  runNimiTextGenerate,
  versionNimiAIConfig,
  type NimiAIConfig,
  type NimiAIConfigTargetRef,
  type NimiAISchedulingProjection,
  type NimiAISchedulingTargetInput,
  type NimiRuntimeAIModelOptions,
  type NimiRuntimeAIScenarioClient,
  type NimiRuntimeAISchedulingClient,
  type NimiRuntimeEmbeddingScenarioClient,
} from '@nimiplatform/sdk/ai';
import {
  textPart,
  type NimiMessage,
} from '@nimiplatform/sdk/contracts';
import type { TesterCapabilityId } from './tester-capabilities.js';
import { capabilityUnavailable, type TesterUnavailable, type TesterUnavailableReason } from './tester-unavailable.js';
import { getTesterCapability } from './tester-capabilities.js';
import { loadTesterAIConfig } from './tester-ai-config-store.js';
import type { MediaAttachment } from './tester-multimodal-input.js';

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
export type TesterRuntimeInvocationClient = {
  readonly runtime: {
    readonly ai: NimiRuntimeAIScenarioClient & NimiRuntimeEmbeddingScenarioClient;
    readonly scheduling: NimiRuntimeAISchedulingClient;
    readonly media?: {
      readonly image?: { readonly generate: (input: unknown) => Promise<unknown> };
      readonly video?: { readonly generate: (input: unknown) => Promise<unknown> };
      readonly tts?: {
        readonly synthesize: (input: unknown) => Promise<unknown>;
        readonly listVoices: (input: unknown) => Promise<unknown>;
      };
      readonly stt?: { readonly transcribe: (input: unknown) => Promise<unknown> };
    };
  };
};

const TESTER_APP_ID = 'nimi.tester';
const TEXT_GENERATION_BINDING_CAPABILITY = 'text.generate';
const EMBEDDING_BINDING_CAPABILITY = 'text.embed';

export type ResolvedLLMBinding = {
  bindingCapabilityId: string;
  targetRef: NimiAIConfigTargetRef;
  model: string;
  routePolicy: Exclude<NimiRuntimeAIModelOptions['routePolicy'], 'unspecified'>;
  connectorId?: string;
  schedulingTarget: NimiAISchedulingTargetInput | null;
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
    case 'AUTH_CONTEXT_MISSING':
      return 'auth-context-missing';
    case 'PRINCIPAL_UNAUTHORIZED':
    case 'SESSION_EXPIRED':
    case 'APP_TOKEN_EXPIRED':
    case 'APP_TOKEN_REVOKED':
      return 'principal-unauthorized';
    case 'SDK_RUNTIME_METHOD_UNAVAILABLE':
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

function bindingCapabilityFor(capabilityId: TesterCapabilityId): string | null {
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

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function targetRefModel(targetRef: NimiAIConfigTargetRef): string {
  if (targetRef.kind === 'cloud-connector') {
    return normalizeText(targetRef.providerModelId);
  }
  if (targetRef.kind === 'local-runtime') {
    return normalizeText(targetRef.profileId) || normalizeText(targetRef.targetId) || normalizeText(targetRef.readinessRef);
  }
  return '';
}

function targetRefSchedulingInput(
  capability: string,
  targetRef: NimiAIConfigTargetRef,
): NimiAISchedulingTargetInput | null {
  if (targetRef.kind === 'profile-slice') {
    return null;
  }
  return { capability, targetRef };
}

export function resolveTesterLLMBinding(
  capabilityId: TesterCapabilityId,
  config: NimiAIConfig = loadTesterAIConfig(),
): ResolvedLLMBinding | TesterUnavailable {
  const bindingCapabilityId = bindingCapabilityFor(capabilityId);
  if (!bindingCapabilityId) {
    return unavailableFromAIConfig(capabilityId, `Capability ${capabilityId} does not have an NimiAIConfig LLM binding path.`);
  }
  const targetRef = config.capabilities.targetRefs[bindingCapabilityId] || null;
  if (!targetRef) {
    return unavailableFromAIConfig(
      capabilityId,
      `NimiAIConfig targetRef is required for ${bindingCapabilityId}; Runtime invocation failed closed before request dispatch.`,
    );
  }
  if (targetRef.kind === 'profile-slice') {
    return unavailableFromAIConfig(
      capabilityId,
      `NimiAIConfig targetRef for ${bindingCapabilityId} still points to profile-slice ${targetRef.sliceId}; apply/materialize a live Runtime target before dispatch.`,
    );
  }
  const model = targetRefModel(targetRef);
  if (!model) {
    return unavailableFromAIConfig(
      capabilityId,
      `NimiAIConfig targetRef for ${bindingCapabilityId} does not include a Runtime model id.`,
    );
  }
  const connectorId = targetRef.kind === 'cloud-connector' ? normalizeText(targetRef.connectorId) : '';
  const routePolicy = targetRef.kind === 'cloud-connector' ? 'cloud' : 'local';
  const scopeRef = config.scopeRef;
  return {
    bindingCapabilityId,
    targetRef,
    model,
    routePolicy,
    ...(connectorId ? { connectorId } : {}),
    schedulingTarget: targetRefSchedulingInput(bindingCapabilityId, targetRef),
    metadata: {
      aiConfigScopeKind: scopeRef.kind,
      aiConfigScopeOwnerId: scopeRef.ownerId,
      aiConfigScopeSurfaceId: scopeRef.surfaceId || '',
      aiConfigProfileId: config.profileOrigin?.profileId || '',
      aiConfigProfileTitle: config.profileOrigin?.title || '',
      aiConfigCapabilityId: capabilityId,
      aiConfigBindingCapabilityId: bindingCapabilityId,
      aiConfigBindingSource: routePolicy,
      aiConfigBindingConnectorId: connectorId,
      aiConfigBindingModel: model,
      aiConfigTargetRefKind: targetRef.kind,
      aiConfigHash: versionNimiAIConfig(config),
      aiConfigBindingKeys: Object.keys(config.capabilities.targetRefs).sort().join(','),
    },
  };
}

export async function ensureSchedulingPreflight(
  client: TesterRuntimeInvocationClient,
  capabilityId: TesterCapabilityId,
  resolved: ResolvedLLMBinding,
): Promise<SchedulingPreflightResult> {
  if (!resolved.schedulingTarget) {
    return { unavailable: null, evidenceMetadata: {} };
  }
  try {
    const scheduling = createNimiRuntimeAISchedulingClient({
      runtime: client.runtime,
      appId: TESTER_APP_ID,
      targets: [resolved.schedulingTarget],
    });
    const batch = await scheduling.peek();
    const judgement = batch.aggregateJudgement;
    const evidenceMetadata = schedulingEvidenceMetadata(batch);
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

function schedulingEvidenceMetadata(batch: NimiAISchedulingProjection): Record<string, string> {
  const judgement = batch.aggregateJudgement;
  if (!judgement) {
    return {};
  }
  const metadata: Record<string, string> = {
    runtimeSchedulingState: judgement.state,
  };
  if (judgement.detail) {
    metadata.runtimeSchedulingDetail = judgement.detail;
  }
  if (judgement.resourceWarnings.length > 0) {
    metadata.runtimeSchedulingWarnings = judgement.resourceWarnings.join(',');
  }
  return metadata;
}

export function routeInput(resolved: ResolvedLLMBinding): {
  model: string;
  connectorId?: string;
  route: 'local' | 'cloud';
} {
  if (resolved.routePolicy === 'cloud') {
    return {
      model: resolved.model,
      connectorId: resolved.connectorId,
      route: 'cloud',
    };
  }
  return {
    model: resolved.model,
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

function unsupportedTextAttachments(
  capabilityId: Extract<TesterCapabilityId, 'text.generate' | 'chat.stream'>,
  attachments: readonly MediaAttachment[] | undefined,
): TesterUnavailable | null {
  if (!attachments || attachments.length === 0) {
    return null;
  }
  return unavailableFromValidation(
    capabilityId,
    'Runtime text Scenario currently accepts text-only input; remove media attachments or use a media capability lane.',
  );
}

function buildNimiUserMessages(prompt: string): NimiMessage[] {
  return [{ role: 'user', content: [textPart(prompt)] }];
}

function buildChatRuntimeUserMessage(prompt: string): ConversationRuntimeTextMessage {
  return {
    role: 'user',
    text: prompt,
    content: prompt,
    name: null,
  };
}

function createTesterTextModel(client: TesterRuntimeInvocationClient, resolved: ResolvedLLMBinding) {
  return createNimiRuntimeAIModel({
    runtime: client.runtime,
    appId: TESTER_APP_ID,
    model: {
      modelId: resolved.model,
      ...(resolved.connectorId ? { providerId: resolved.connectorId } : {}),
    },
    routePolicy: resolved.routePolicy,
    connectorId: resolved.connectorId,
  });
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

export async function invokeTextGenerate(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('text.generate', 'Scenario prompt is empty — supply a request body before running text.generate.');
  }
  const attachmentUnavailable = unsupportedTextAttachments('text.generate', input.attachments);
  if (attachmentUnavailable) return attachmentUnavailable;
  const resolved = resolveTesterLLMBinding('text.generate');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'text.generate', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const directedPrompt = input.directive ? `${input.directive}\n\n${prompt}` : prompt;
  const model = createTesterTextModel(client, resolved);
  const result = await runNimiTextGenerate({
    runtime: { model },
    request: {
      model: model.model,
      messages: buildNimiUserMessages(directedPrompt),
      parameters: {
        metadata: buildMetadata('nimi.tester.ai.text.generate', {
          ...resolved.metadata,
          ...schedulingPreflight.evidenceMetadata,
        }),
      },
    },
  });
  if (result.ok === false) {
    return unavailableFromError('text.generate', result.error.cause ?? result.error);
  }
  const output = result.result;
  return {
    ok: true,
    capabilityId: 'text.generate',
    capabilityLabel: getTesterCapability('text.generate').label,
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
}

export async function invokeChatStream(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('chat.stream', 'Scenario prompt is empty — supply a chat turn before running chat.stream.');
  }
  const attachmentUnavailable = unsupportedTextAttachments('chat.stream', input.attachments);
  if (attachmentUnavailable) return attachmentUnavailable;
  const resolved = resolveTesterLLMBinding('chat.stream');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'chat.stream', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const route = routeInput(resolved);
  try {
    const scenarioId = stableTesterIdPart(input.scenarioId);
    const provider = createSimpleAiConversationProvider({
      runtimeAdapter: createSdkConversationRuntimeAdapter({
        runtime: client.runtime,
        appId: TESTER_APP_ID,
      }),
      resolveRuntimeUserMessage: () => buildChatRuntimeUserMessage(prompt),
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

export async function invokeEmbedding(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('text.embed', 'Scenario prompt is empty — supply at least one input string for embedding.');
  }
  const resolved = resolveTesterLLMBinding('text.embed');
  if (isTesterUnavailable(resolved)) return resolved;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'text.embed', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  try {
    const embedding = createNimiRuntimeEmbeddingClient({
      runtime: client.runtime,
      appId: TESTER_APP_ID,
      model: {
        modelId: resolved.model,
        ...(resolved.connectorId ? { providerId: resolved.connectorId } : {}),
      },
      routePolicy: resolved.routePolicy,
      connectorId: resolved.connectorId,
    });
    const output = await embedding.embedText({
      values: [prompt],
      metadata: buildMetadata('nimi.tester.ai.embedding.generate', {
        ...resolved.metadata,
        ...schedulingPreflight.evidenceMetadata,
      }),
    });
    const first = output.embeddings[0] || [];
    return {
      ok: true,
      capabilityId: 'text.embed',
      capabilityLabel: getTesterCapability('text.embed').label,
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
  } catch (error) {
    return unavailableFromError('text.embed', error);
  }
}
