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
  runRuntimeAIConsumeCapability,
  type RuntimeAIConsumeResult,
  type RuntimeAIConsumeUnavailable,
  type RuntimeVoiceCatalogRuntime,
} from '@nimiplatform/kit/features/generation/runtime';
import {
  createNimiRuntimeAISchedulingClient,
  coerceNimiAITextGenerationParams,
  resolveNimiAIConfigRuntimeBinding,
  type NimiAIConfig,
  type NimiAIConfigRuntimeBinding,
  type NimiAITextGenerationParameterSet,
  type NimiAISchedulingProjection,
  type NimiRuntimeAIScenarioClient,
  type NimiRuntimeAISchedulingClient,
  type NimiRuntimeEmbeddingScenarioClient,
} from '@nimiplatform/sdk/ai';
import type { NimiRuntimeLocalModelCenterRpc, NimiRuntimeScenarioJobClient } from '@nimiplatform/sdk/runtime';
import type { TesterCapabilityId } from './tester-capabilities.js';
import { capabilityUnavailable, type TesterUnavailable, type TesterUnavailableReason } from './tester-unavailable.js';
import { getTesterCapability, getTesterRuntimeBindingCapabilityId } from './tester-capabilities.js';
import {
  hydrateTesterAIConfigFromStandardShell,
  loadTesterAIConfig,
} from './tester-ai-config-store.js';
import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import { resolveTesterRuntimeHostKind } from '../shell/auth/runtime-transport.js';

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
type RuntimeRequestDiagnostics = NonNullable<TesterUnavailable['runtimeRequest']>;
export type TesterRuntimeInvocationClient = {
  readonly runtimeSubjectUserId?: string;
  readonly runtime: {
    readonly ai: NimiRuntimeAIScenarioClient & NimiRuntimeEmbeddingScenarioClient & NimiRuntimeScenarioJobClient & {
      readonly listPresetVoices?: RuntimeVoiceCatalogRuntime['ai']['listPresetVoices'];
    };
    readonly scheduling: NimiRuntimeAISchedulingClient;
    readonly local?: NimiRuntimeLocalModelCenterRpc;
  };
};

export const TESTER_APP_ID = 'nimi.tester';
export type ResolvedLLMBinding = NimiAIConfigRuntimeBinding;
const SHELL_HOST_OWNED_IDENTITY_METADATA_KEYS = new Set([
  'appId',
  'participantId',
  'callerKind',
  'callerId',
  'x-nimi-app-id',
  'x-nimi-participant-id',
  'x-nimi-caller-kind',
  'x-nimi-caller-id',
]);

export type SchedulingPreflightResult = {
  unavailable: TesterUnavailable | null;
  evidenceMetadata: Record<string, string>;
};

export function isTesterUnavailable(value: unknown): value is TesterUnavailable {
  return Boolean(value && typeof value === 'object' && 'ok' in value && value.ok === false);
}

export function buildMetadata(surfaceId: string, extra?: Record<string, string | undefined>): Record<string, string> {
  const shellHostOwnsIdentity = resolveTesterRuntimeHostKind() !== 'node';
  const metadata: Record<string, string> = shellHostOwnsIdentity
    ? { surfaceId }
    : {
        callerKind: 'third-party-app',
        callerId: TESTER_APP_ID,
        surfaceId,
      };
  for (const [key, value] of Object.entries(extra || {})) {
    if (shellHostOwnsIdentity && SHELL_HOST_OWNED_IDENTITY_METADATA_KEYS.has(key)) continue;
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
  targetRef: ResolvedLLMBinding['targetRef'];
  route: 'local' | 'cloud';
} {
  return {
    model: resolved.model,
    route: resolved.routePolicy,
    targetRef: resolved.targetRef,
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

function buildChatRuntimeUserMessage(prompt: string): ConversationRuntimeTextMessage {
  return {
    role: 'user',
    text: prompt,
    content: prompt,
    name: null,
  };
}

function unavailableFromRuntimeAIConsume(
  result: RuntimeAIConsumeUnavailable,
  runtimeRequest?: RuntimeRequestDiagnostics,
): TesterUnavailable {
  const unavailable = capabilityUnavailable(
    getTesterCapability(result.capabilityId),
    result.reason as TesterUnavailableReason,
    result.message,
  );
  if (!runtimeRequest?.request) return unavailable;
  return {
    ...unavailable,
    runtimeRequest,
  };
}

function successFromRuntimeAIConsume(result: Extract<RuntimeAIConsumeResult, { ok: true }>): TesterTypedSuccess {
  return {
    ok: true,
    capabilityId: result.capabilityId,
    capabilityLabel: getTesterCapability(result.capabilityId).label,
    message: result.message,
    output: result.output.kind === 'embedding'
      ? {
        kind: 'embedding',
        vectorCount: result.output.vectorCount,
        dimensions: result.output.dimensions,
        sample: [...result.output.sample],
        totalTokens: result.output.totalTokens,
      }
      : result.output,
    trace: result.trace,
  };
}

async function invokeRuntimeAIConsume(
  client: TesterRuntimeInvocationClient,
  input: TesterScenarioInput,
  capabilityId: Extract<TesterCapabilityId, 'text.generate' | 'text.embed'>,
  emptyPromptMessage: string,
  surfaceId: string,
): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation(capabilityId, emptyPromptMessage);
  }
  if (capabilityId === 'text.generate') {
    const attachmentUnavailable = unsupportedTextAttachments('text.generate', input.attachments);
    if (attachmentUnavailable) return attachmentUnavailable;
  }

  let runtimeRequestDiagnostics: RuntimeRequestDiagnostics | undefined;
  const bindingCapabilityId = getTesterRuntimeBindingCapabilityId(capabilityId);
  if (!bindingCapabilityId) {
    return unavailableFromAIConfig(capabilityId, `Capability ${capabilityId} does not have an AIConfig runtime binding path.`);
  }
  const result = await runRuntimeAIConsumeCapability({
    runtime: client.runtime,
    appId: TESTER_APP_ID,
    config: await hydrateTesterAIConfigFromStandardShell(),
    capabilityId,
    bindingCapabilityId,
    prompt,
    directive: capabilityId === 'text.generate' ? input.directive : undefined,
    scenarioId: input.scenarioId,
    subjectUserId: client.runtimeSubjectUserId,
    surfaceId,
    metadata: buildMetadata(surfaceId),
    onRuntimeRequest: (diagnostics) => {
      runtimeRequestDiagnostics = diagnostics;
    },
  });
  if (result.ok === false) {
    return unavailableFromRuntimeAIConsume(result, runtimeRequestDiagnostics);
  }
  return successFromRuntimeAIConsume(result);
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
  return invokeRuntimeAIConsume(
    client,
    input,
    'text.generate',
    'Scenario prompt is empty — supply a request body before running text.generate.',
    'nimi.tester.ai.text.generate',
  );
}

export async function invokeChatStream(client: TesterRuntimeInvocationClient, input: TesterScenarioInput): Promise<TesterInvocationResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return unavailableFromValidation('chat.stream', 'Scenario prompt is empty — supply a chat turn before running chat.stream.');
  }
  const attachmentUnavailable = unsupportedTextAttachments('chat.stream', input.attachments);
  if (attachmentUnavailable) return attachmentUnavailable;
  const config = await hydrateTesterAIConfigFromStandardShell();
  const resolved = resolveTesterLLMBinding('chat.stream', config);
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
  return invokeRuntimeAIConsume(
    client,
    input,
    'text.embed',
    'Scenario prompt is empty — supply at least one input string for embedding.',
    'nimi.tester.ai.embedding.generate',
  );
}
