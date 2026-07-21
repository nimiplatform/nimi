import { createNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import {
  runNimiRuntimeSpeechTranscription,
  type NimiRuntimeGenerationRoutePolicy,
} from '@nimiplatform/sdk/features/generation';
import {
  desktopRuntimeRouteAccess,
} from '../../infra/runtime-route-host-access';
import {
  getDesktopAppId,
  getDesktopRuntime,
} from '../../infra/sdk/desktop-nimi-client-session';
import type {
  AgentRuntimeResolvedBinding,
  ChatAgentTranscribeRuntimeInvokeDeps,
  ChatAgentTranscribeRuntimeInvokeInput,
  ChatAgentTranscribeRuntimeInvokeResult,
} from './chat-agent-runtime-types';
import {
  normalizeText,
  requireValue,
  resolveExecutionSlice,
} from './chat-agent-runtime-shared';

export async function transcribeChatAgentVoiceRuntime(
  input: ChatAgentTranscribeRuntimeInvokeInput,
  deps: ChatAgentTranscribeRuntimeInvokeDeps = {},
): Promise<ChatAgentTranscribeRuntimeInvokeResult> {
  if (!(input.audioBytes instanceof Uint8Array) || input.audioBytes.length === 0) {
    throw createNimiError({
      message: 'agent voice transcription requires audio bytes',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'record_voice_input',
      source: 'runtime',
    });
  }
  const mimeType = normalizeText(input.mimeType);
  if (!mimeType) {
    throw createNimiError({
      message: 'agent voice transcription requires an audio mimeType',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'record_voice_input',
      source: 'runtime',
    });
  }
  const slice = resolveExecutionSlice(input.transcribeExecutionSnapshot, 'audio.transcribe');
  const resolved = slice.resolvedTarget as AgentRuntimeResolvedBinding;
  const model = requireValue(
    resolved.providerModelId || resolved.modelId || resolved.model || resolved.localAssetId,
    ReasonCode.AI_INPUT_INVALID,
    'select_runtime_route_binding',
    'agent voice transcribe route model is missing',
  );
  const connectorId = normalizeText(resolved.connectorId) || undefined;
  const providerEndpoint = normalizeText(resolved.endpoint)
    || normalizeText(resolved.localProviderEndpoint)
    || normalizeText(resolved.localOpenAiEndpoint)
    || undefined;
  const timeoutMs = normalizePositiveTimeoutMs(input.timeoutMs);
  const routeCallOptions = await (deps.buildRuntimeCallOptionsImpl || desktopRuntimeRouteAccess.buildCallOptions)({
    source: resolved.source,
    connectorId,
    providerEndpoint,
    targetId: model,
    timeoutMs,
  });
  const callOptions = {
    ...routeCallOptions,
    signal: input.signal,
  };
  const requestId = normalizeText(deps.createRequestIdImpl?.()) || createVoiceTranscribeRequestId();
  const response = await runNimiRuntimeSpeechTranscription({
    runtime: { ai: (deps.getRuntimeImpl || getDesktopRuntime)().ai },
    head: {
      appId: (deps.getAppIdImpl || getDesktopAppId)(),
      modelId: model,
      routePolicy: toGenerationRoutePolicy(resolved.source),
      connectorId,
      timeoutMs,
    },
    audio: { type: 'bytes', bytes: input.audioBytes },
    mimeType,
    language: normalizeText(input.language) || undefined,
    requestId,
    idempotencyKey: requestId,
    callOptions,
    signal: input.signal,
  });
  const text = normalizeText(response.text);
  return {
    text,
    traceId: normalizeText(response.traceId) || normalizeText(callOptions.metadata?.traceId),
  };
}

function normalizePositiveTimeoutMs(value: unknown): number {
  const normalized = Number(value ?? 120_000);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 120_000;
}

function toGenerationRoutePolicy(source: string): NimiRuntimeGenerationRoutePolicy {
  if (source === 'local-runtime') return 'local';
  if (source === 'cloud-connector') return 'cloud';
  return 'unspecified';
}

function createVoiceTranscribeRequestId(): string {
  const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoLike?.randomUUID === 'function') {
    return `desktop-agent-voice-transcribe:${cryptoLike.randomUUID()}`;
  }
  return `desktop-agent-voice-transcribe:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}
