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
  coerceNimiAITextGenerationParams,
  resolveNimiAIConfigRuntimeBinding,
  runNimiTextGenerate,
  type NimiAIConfig,
  type NimiAIConfigRuntimeBinding,
  type NimiAITextGenerationParameterSet,
  type NimiAISchedulingProjection,
  type NimiRuntimeAIScenarioClient,
  type NimiRuntimeAISchedulingClient,
  type NimiRuntimeEmbeddingScenarioClient,
} from '@nimiplatform/sdk/ai';
import type { NimiRuntimeLocalModelCenterRpc, NimiRuntimeScenarioJobClient } from '@nimiplatform/sdk/runtime';
import type { ListVoiceAssetsRequest, ListVoiceAssetsResponse } from '@nimiplatform/sdk/runtime/generated';
import {
  textPart,
  type NimiMessage,
} from '@nimiplatform/sdk/contracts';
import type { TesterCapabilityId } from './tester-capabilities.js';
import { capabilityUnavailable, type TesterUnavailable, type TesterUnavailableReason } from './tester-unavailable.js';
import { getTesterCapability, getTesterRuntimeBindingCapabilityId } from './tester-capabilities.js';
import { loadTesterAIConfig } from './tester-ai-config-store.js';
import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';

export type TesterScenarioInput = {
  prompt: string;
  scenarioId: string;
  /** Runtime account subject resolved by the app auth projection. */
  subjectUserId?: string;
  /** Optional live-delta callback (chat.stream). Receives the accumulated text
   *  on each delta so the UI can render the stream token-by-token. */
  onPartial?: (accumulatedText: string) => void;
  /** Optional local media attachments for vision/multimodal text capabilities. */
  attachments?: BrowserDataUrlAttachment[];
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
  readonly runtimeSubjectUserId?: string;
  readonly runtime: {
    readonly ai: NimiRuntimeAIScenarioClient & NimiRuntimeEmbeddingScenarioClient & NimiRuntimeScenarioJobClient & {
      readonly listPresetVoices?: (request: {
        readonly appId: string;
        readonly subjectUserId: string;
        readonly modelId: string;
        readonly targetModelId: string;
        readonly connectorId: string;
      }) => Promise<{
        readonly voices: readonly { readonly voiceId?: string; readonly name?: string; readonly lang?: string }[];
        readonly modelResolved?: string;
        readonly traceId?: string;
      }>;
      readonly listVoiceAssets?: (
        request: ListVoiceAssetsRequest,
      ) => Promise<ListVoiceAssetsResponse>;
    };
    readonly scheduling: NimiRuntimeAISchedulingClient;
    readonly local?: NimiRuntimeLocalModelCenterRpc;
    readonly artifacts?: {
      readonly readArtifactBytes: (request: {
        readonly artifactId: string;
      }) => Promise<{
        readonly bytes?: unknown;
        readonly mimeType?: string;
        readonly sizeBytes?: string | number;
      }>;
    };
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

export const TESTER_APP_ID = 'nimi.tester';
export type ResolvedLLMBinding = NimiAIConfigRuntimeBinding;

export type SchedulingPreflightResult = {
  unavailable: TesterUnavailable | null;
  evidenceMetadata: Record<string, string>;
};

export function isTesterUnavailable(value: unknown): value is TesterUnavailable {
  return Boolean(value && typeof value === 'object' && 'ok' in value && value.ok === false);
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

function asErrorRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseEmbeddedJsonRecord(value: unknown): Record<string, unknown> {
  const text = normalizeText(value);
  if (!text) return {};
  const parse = (candidate: string): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return asErrorRecord(parsed);
    } catch {
      return {};
    }
  };
  const direct = parse(text);
  if (Object.keys(direct).length > 0) return direct;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return parse(text.slice(start, end + 1));
  }
  return {};
}

function sdkErrorDiagnosticRecords(error: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const direct = asErrorRecord(error);
  if (Object.keys(direct).length > 0) {
    records.push(direct);
    const details = asErrorRecord(direct.details);
    if (Object.keys(details).length > 0) records.push(details);
    const parsedDetails = parseEmbeddedJsonRecord(direct.details);
    if (Object.keys(parsedDetails).length > 0) records.push(parsedDetails);
    const nestedError = asErrorRecord(direct.error);
    if (Object.keys(nestedError).length > 0) records.push(nestedError);
  }
  if (error instanceof Error) {
    const cause = asErrorRecord(error.cause);
    if (Object.keys(cause).length > 0) records.push(cause);
    const parsedMessage = parseEmbeddedJsonRecord(error.message);
    if (Object.keys(parsedMessage).length > 0) records.push(parsedMessage);
  } else {
    const parsedText = parseEmbeddedJsonRecord(error);
    if (Object.keys(parsedText).length > 0) records.push(parsedText);
  }
  return records;
}

function providerDetailFromSdkError(error: unknown): string {
  for (const record of sdkErrorDiagnosticRecords(error)) {
    const details = asErrorRecord(record.details);
    const candidates = [record, details];
    for (const candidate of candidates) {
      const detail = normalizeText(candidate.provider_message ?? candidate.providerMessage);
      if (detail) return detail;
    }
  }
  return '';
}

function describeSdkError(error: unknown): string {
  if (!error) return 'Runtime SDK call failed with no error message.';
  const providerDetail = providerDetailFromSdkError(error);
  const withProviderDetail = (message: string): string => {
    if (!providerDetail || message.includes(providerDetail)) return message;
    return `${message}\nProvider detail: ${providerDetail}`;
  };
  if (error instanceof Error) {
    const message = error.message || error.name || 'Runtime SDK call failed.';
    const reasonCode = (error as { reasonCode?: string }).reasonCode;
    return withProviderDetail(reasonCode ? `${reasonCode}: ${message}` : message);
  }
  return withProviderDetail(String(error));
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

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveTextGenerationParameters(
  capabilityId: Extract<TesterCapabilityId, 'text.generate' | 'chat.stream'>,
  resolved: ResolvedLLMBinding,
): NimiAITextGenerationParameterSet | TesterUnavailable {
  const coerced = coerceNimiAITextGenerationParams(resolved.selectedParams);
  if (coerced.ok === false) {
    return unavailableFromValidation(capabilityId, coerced.message);
  }
  return coerced.value;
}

export function resolveTesterLLMBinding(
  capabilityId: TesterCapabilityId,
  config: NimiAIConfig = loadTesterAIConfig(),
): ResolvedLLMBinding | TesterUnavailable {
  const resolved = resolveNimiAIConfigRuntimeBinding({
    config,
    capabilityId,
    bindingCapabilityId: getTesterRuntimeBindingCapabilityId(capabilityId),
  });
  if (resolved.ok === false) {
    return unavailableFromAIConfig(capabilityId, resolved.message);
  }
  return resolved.binding;
}

export function runtimeRoutePayload(resolved: ResolvedLLMBinding): {
  model: string;
  connectorId?: string;
  route: 'local' | 'cloud';
} {
  return {
    model: resolved.model,
    route: resolved.routePolicy,
    ...(resolved.connectorId ? { connectorId: resolved.connectorId } : {}),
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
  attachments: readonly BrowserDataUrlAttachment[] | undefined,
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

function createTesterTextModel(client: TesterRuntimeInvocationClient, resolved: ResolvedLLMBinding, timeoutMs?: number) {
  return createNimiRuntimeAIModel({
    runtime: client.runtime,
    appId: TESTER_APP_ID,
    model: {
      modelId: resolved.model,
      ...(resolved.connectorId ? { providerId: resolved.connectorId } : {}),
    },
    routePolicy: resolved.routePolicy,
    connectorId: resolved.connectorId,
    subjectUserId: requireRuntimeSubjectUserId('text.generate', client),
    timeoutMs,
  });
}

export function requireRuntimeSubjectUserId(
  capabilityId: TesterCapabilityId,
  client: TesterRuntimeInvocationClient,
): string {
  const subjectUserId = normalizeText(client.runtimeSubjectUserId);
  if (subjectUserId) {
    return subjectUserId;
  }
  throw unavailableFromAIConfig(
    capabilityId,
    'Runtime account subjectUserId is required for Runtime AI Scenario calls; complete Runtime account login before dispatch.',
  );
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
  const textParams = resolveTextGenerationParameters('text.generate', resolved);
  if (isTesterUnavailable(textParams)) return textParams;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'text.generate', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const directedPrompt = input.directive ? `${input.directive}\n\n${prompt}` : prompt;
  const model = createTesterTextModel(client, resolved, textParams.timeoutMs);
  const result = await runNimiTextGenerate({
    runtime: { model },
    request: {
      model: model.model,
      messages: buildNimiUserMessages(directedPrompt),
      parameters: {
        ...textParams.parameters,
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
  const textParams = resolveTextGenerationParameters('chat.stream', resolved);
  if (isTesterUnavailable(textParams)) return textParams;
  const schedulingPreflight = await ensureSchedulingPreflight(client, 'chat.stream', resolved);
  if (schedulingPreflight.unavailable) return schedulingPreflight.unavailable;
  const route = runtimeRoutePayload(resolved);
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
        subjectUserId: requireRuntimeSubjectUserId('chat.stream', client),
        temperature: textParams.parameters.temperature,
        topP: textParams.parameters.topP,
        maxTokens: textParams.parameters.maxTokens,
        timeoutMs: textParams.timeoutMs,
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
      subjectUserId: requireRuntimeSubjectUserId('text.embed', client),
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
