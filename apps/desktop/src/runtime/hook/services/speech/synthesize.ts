import { emitInferenceAudit } from '../../../llm-adapter/execution/inference-audit';
import { createHookError } from '../../contracts/errors.js';
import { createHookRecord } from '../utils.js';
import {
  asRuntimeInvokeError,
  buildRuntimeRequestMetadata,
  extractRuntimeReasonCode,
  getRuntimeClient,
  toLocalAiReasonCode,
} from '../../../llm-adapter/execution/runtime-ai-bridge';
import { toBase64 } from '../../../util/encoding.js';
import type {
  SpeechServiceInput,
  SpeechSynthesizeInput,
  SpeechSynthesizeResultPayload,
} from './types.js';
import { ReasonCode } from '@nimiplatform/sdk/types';

const DESKTOP_CONNECTOR_OWNER_ID = 'desktop';

function normalizeModelRoot(model: string): string {
  const normalized = String(model || '').trim();
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (lower.startsWith('cloud/')) return normalized.slice('cloud/'.length).trim();
  if (lower.startsWith('local/')) return normalized.slice('local/'.length).trim();
  if (lower.startsWith('token/')) return normalized.slice('token/'.length).trim();
  return normalized;
}

function ensureTokenApiModelId(model: string): string {
  const root = normalizeModelRoot(model);
  return root ? `cloud/${root}` : '';
}

function hasTtsCapability(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  const normalized = input.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'tts' || normalized.includes('speech') || normalized.includes('audio');
}

async function resolveFallbackTtsModel(input: {
  runtime: ReturnType<typeof getRuntimeClient>;
  connectorId: string;
  currentModel: string;
  metadata: Record<string, string>;
}): Promise<string> {
  const connectorId = String(input.connectorId || '').trim();
  if (!connectorId) return '';
  const currentRoot = normalizeModelRoot(input.currentModel).toLowerCase();
  const response = await input.runtime.connector.listConnectorModels(
    {
      connectorId,
      ownerId: DESKTOP_CONNECTOR_OWNER_ID,
      forceRefresh: true,
    },
    {
      timeoutMs: 5000,
      metadata: input.metadata,
    },
  );

  const models = Array.isArray(response.models) ? response.models : [];
  const availableModels = models.filter((item) => Boolean(item?.available));
  const ttsCandidates = availableModels.filter((item) => (
    Array.isArray(item?.capabilities) && item.capabilities.some((capability) => hasTtsCapability(capability))
  ));
  const ordered = ttsCandidates.length > 0 ? ttsCandidates : availableModels;
  for (const descriptor of ordered) {
    const modelId = ensureTokenApiModelId(String(descriptor?.modelId || '').trim());
    if (!modelId) continue;
    if (normalizeModelRoot(modelId).toLowerCase() === currentRoot) continue;
    return modelId;
  }
  return '';
}

async function resolveFallbackConnectorIds(input: {
  runtime: ReturnType<typeof getRuntimeClient>;
  connectorId: string;
  metadata: Record<string, string>;
}): Promise<string[]> {
  const preferred = String(input.connectorId || '').trim();
  if (preferred) return [preferred];

  const response = await input.runtime.connector.listConnectors(
    {
      ownerId: DESKTOP_CONNECTOR_OWNER_ID,
      pageSize: 50,
      pageToken: '',
      kindFilter: 0,
      statusFilter: 0,
      providerFilter: '',
    },
    {
      timeoutMs: 5000,
      metadata: input.metadata,
    },
  );
  const connectors = Array.isArray(response.connectors) ? response.connectors : [];
  const activeConnectorIds = connectors
    .filter((item) => Number(item?.status) !== 2)
    .map((item) => String(item?.connectorId || '').trim())
    .filter(Boolean);
  const fallbackConnectorIds = connectors
    .map((item) => String(item?.connectorId || '').trim())
    .filter(Boolean);

  return Array.from(new Set(activeConnectorIds.length > 0 ? activeConnectorIds : fallbackConnectorIds));
}

export async function synthesizeModSpeech(
  context: SpeechServiceInput,
  input: SpeechSynthesizeInput,
): Promise<SpeechSynthesizeResultPayload> {
  const startedAt = Date.now();
  const permission = context.evaluatePermission({
    modId: input.modId,
    sourceType: input.sourceType,
    hookType: 'llm',
    target: 'llm.speech.synthesize',
    capabilityKey: 'llm.speech.synthesize',
    startedAt,
  });

  const resolved = await context.resolveRoute({
    modId: input.modId,
    providerId: input.providerId,
    routeSource: input.routeSource,
    connectorId: input.connectorId,
    model: input.model,
  });
  const source = String(resolved?.source || '').trim() as 'local-runtime' | 'token-api';
  let model = String(resolved?.model || '').trim();
  const connectorId = String(resolved?.connectorId || '').trim();
  let runtimeConnectorId = connectorId;
  const endpoint = String(resolved?.localProviderEndpoint || resolved?.localOpenAiEndpoint || '').trim();

  const providerParams: Record<string, unknown> = {
    pitch: input.pitch,
    targetId: input.targetId,
    sessionId: input.sessionId,
  };
  if (String(input.language || '').trim()) {
    providerParams.language = String(input.language || '').trim();
  }
  if (String(input.stylePrompt || '').trim()) {
    providerParams.instruct = String(input.stylePrompt || '').trim();
  }
  emitInferenceAudit({
    eventType: 'inference_invoked',
    modId: input.modId,
    source,
    provider: resolved?.provider || 'openai-compatible',
    modality: 'tts',
    adapter: resolved?.adapter || 'openai_compat_adapter',
    model,
    endpoint,
    extra: { connectorId: runtimeConnectorId },
  });

  const runtime = getRuntimeClient();
  const metadata = await buildRuntimeRequestMetadata({
    source,
    connectorId,
    providerEndpoint: endpoint,
  });
  let audioUri = '';
  let mimeType = 'audio/mpeg';
  let providerTraceId = '';
  const synthesizeWithModel = async (
    modelId: string,
    connectorOverride = runtimeConnectorId,
  ) => runtime.media.tts.synthesize({
    subjectUserId: String(input.modId || '').trim() || 'mod:unknown',
    model: modelId,
    text: input.text,
    voice: input.voiceId,
    audioFormat: input.format,
    sampleRateHz: input.sampleRateHz,
    speed: input.speakingRate,
    pitch: input.pitch,
    language: input.language,
    route: source,
    fallback: 'deny',
    timeoutMs: 60000,
    connectorId: connectorOverride,
    metadata,
    providerOptions: providerParams,
  });
  try {
    const generated = await synthesizeWithModel(model);
    if (!generated) {
      throw new Error('speech provider returned empty response');
    }
    const artifact = generated.artifacts[0];
    if (!artifact || !(artifact.bytes instanceof Uint8Array)) {
      throw new Error('speech provider returned empty artifact');
    }
    mimeType = String(artifact.mimeType || '').trim() || 'audio/mpeg';
    const base64 = toBase64(artifact.bytes);
    audioUri = base64 ? `data:${mimeType};base64,${base64}` : '';
    providerTraceId = String(generated.trace.traceId || '').trim();
  } catch (error) {
    const firstError = asRuntimeInvokeError(error, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_or_check_runtime_status',
    });
    const firstReasonCode = extractRuntimeReasonCode(firstError)
      || firstError.reasonCode
      || ReasonCode.RUNTIME_CALL_FAILED;
    if (source === 'token-api' && firstReasonCode === ReasonCode.AI_MODEL_NOT_FOUND) {
      try {
        const fallbackConnectorIds = await resolveFallbackConnectorIds({
          runtime,
          connectorId: runtimeConnectorId,
          metadata,
        });
        let fallbackModel = '';
        let fallbackConnectorId = '';
        for (const candidateConnectorId of fallbackConnectorIds) {
          const candidateModel = await resolveFallbackTtsModel({
            runtime,
            connectorId: candidateConnectorId,
            currentModel: model,
            metadata,
          });
          if (!candidateModel) continue;
          fallbackModel = candidateModel;
          fallbackConnectorId = candidateConnectorId;
          break;
        }
        if (fallbackModel && fallbackConnectorId) {
          emitInferenceAudit({
            eventType: 'fallback_to_token_api',
            modId: input.modId,
            source,
            provider: resolved?.provider || 'openai-compatible',
            modality: 'tts',
            adapter: resolved?.adapter || 'openai_compat_adapter',
            model: fallbackModel,
            endpoint,
            reasonCode: firstReasonCode,
            detail: firstError.message,
            extra: {
              connectorId: fallbackConnectorId,
              connectorFallbackFrom: runtimeConnectorId || null,
              connectorFallbackTo: fallbackConnectorId,
              modelFallbackFrom: model,
              modelFallbackTo: fallbackModel,
            },
          });
          const generated = await synthesizeWithModel(fallbackModel, fallbackConnectorId);
          const artifact = generated.artifacts[0];
          if (!artifact || !(artifact.bytes instanceof Uint8Array)) {
            throw new Error('speech provider returned empty artifact');
          }
          model = fallbackModel;
          runtimeConnectorId = fallbackConnectorId;
          mimeType = String(artifact.mimeType || '').trim() || 'audio/mpeg';
          const base64 = toBase64(artifact.bytes);
          audioUri = base64 ? `data:${mimeType};base64,${base64}` : '';
          providerTraceId = String(generated.trace.traceId || '').trim();
        } else {
          throw firstError;
        }
      } catch (retryError) {
        const normalizedError = asRuntimeInvokeError(retryError, {
          reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
          actionHint: 'retry_or_check_runtime_status',
        });
        const runtimeReasonCode = extractRuntimeReasonCode(normalizedError)
          || normalizedError.reasonCode
          || ReasonCode.RUNTIME_CALL_FAILED;
        const localReasonCode = toLocalAiReasonCode(normalizedError) || undefined;
        emitInferenceAudit({
          eventType: 'inference_failed',
          modId: input.modId,
          source,
          provider: resolved?.provider || 'openai-compatible',
          modality: 'tts',
          adapter: resolved?.adapter || 'openai_compat_adapter',
          model,
          endpoint,
          reasonCode: runtimeReasonCode,
          detail: normalizedError.message,
          extra: {
            ...(localReasonCode ? { localReasonCode } : {}),
            connectorId: runtimeConnectorId,
          },
        });
        throw normalizedError;
      }
    } else {
      const runtimeReasonCode = firstReasonCode;
      const localReasonCode = toLocalAiReasonCode(firstError) || undefined;
      emitInferenceAudit({
        eventType: 'inference_failed',
        modId: input.modId,
        source,
        provider: resolved?.provider || 'openai-compatible',
        modality: 'tts',
        adapter: resolved?.adapter || 'openai_compat_adapter',
        model,
        endpoint,
        reasonCode: runtimeReasonCode,
        detail: firstError.message,
        extra: {
          ...(localReasonCode ? { localReasonCode } : {}),
          connectorId: runtimeConnectorId,
        },
      });
      throw firstError;
    }
  }

  if (!String(audioUri || '').trim()) {
    emitInferenceAudit({
      eventType: 'inference_failed',
      modId: input.modId,
      source,
      provider: resolved?.provider || 'openai-compatible',
      modality: 'tts',
      adapter: resolved?.adapter || 'openai_compat_adapter',
      model,
      endpoint,
      reasonCode: ReasonCode.PLAY_PROVIDER_UNAVAILABLE,
      detail: 'speech provider returned empty audioUri',
      extra: { connectorId: runtimeConnectorId },
    });
    throw createHookError(
      'HOOK_LLM_SPEECH_PROVIDER_UNAVAILABLE',
      'speech provider returned empty audioUri',
      { modId: input.modId },
    );
  }

  context.audit.append(createHookRecord({
    modId: input.modId,
    hookType: 'llm',
    target: 'llm.speech.synthesize',
    decision: 'ALLOW',
    reasonCodes: permission.reasonCodes,
    startedAt,
  }));

  return {
    audioUri,
    mimeType,
    durationMs: undefined,
    sampleRateHz: input.sampleRateHz,
    providerTraceId: providerTraceId || `speech:${Date.now().toString(36)}`,
    cacheKey: undefined,
  };
}
