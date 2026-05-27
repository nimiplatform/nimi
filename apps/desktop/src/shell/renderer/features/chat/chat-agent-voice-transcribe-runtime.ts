import {
  createNimiError,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  buildRuntimeRequestMetadata,
  getRuntimeClient,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
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
  const resolved = slice.resolvedBinding as AgentRuntimeResolvedBinding;
  const metadata = await (deps.buildRuntimeRequestMetadataImpl || buildRuntimeRequestMetadata)({
    source: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(resolved.endpoint)
      || normalizeText(resolved.localProviderEndpoint)
      || normalizeText(resolved.localOpenAiEndpoint)
      || undefined,
  });
  const response = await (deps.getRuntimeClientImpl || getRuntimeClient)().media.stt.transcribe({
    model: requireValue(
      resolved.modelId || resolved.model || resolved.localModelId,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'agent voice transcribe route model is missing',
    ),
    audio: {
      kind: 'bytes',
      bytes: input.audioBytes,
    },
    mimeType,
    language: normalizeText(input.language) || undefined,
    route: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    metadata,
    signal: input.signal,
  });
  const text = normalizeText(response.text);
  if (!text) {
    throw createNimiError({
      message: 'agent voice transcription returned no transcript text',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_transcription',
      source: 'runtime',
    });
  }
  return {
    text,
    traceId: normalizeText(response.trace?.traceId) || normalizeText(metadata.traceId),
  };
}
