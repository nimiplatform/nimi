import { resolveRuntimeCapabilityConfigFromV11 } from '@renderer/features/runtime-config/state/runtime-route-resolver-v11';
import {
  normalizeCapabilityV11,
  type SourceIdV11,
} from '@renderer/features/runtime-config/state/v11/types';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import {
  buildRuntimeRouteResolveCacheKey,
  RUNTIME_ROUTE_RESOLVE_CACHE_TTL_MS,
  runtimeRouteResolveCache,
  safeErrorMessage,
} from './runtime-bootstrap-utils';
import type {
  ResolvedRuntimeRouteBinding,
  RuntimeRouteHint,
  RuntimeRouteOverride,
} from '@nimiplatform/mod-sdk/types';
import { RuntimeRouteResolutionError } from '@renderer/features/runtime-config/state/runtime-route-resolver-v11';
import { localAiRuntime } from '@runtime/local-ai-runtime';

type RuntimeFields = {
  provider: string;
  runtimeModelType: string;
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  localOpenAiApiKey: string;
};

function normalizeRouteOverrideSource(value: unknown): SourceIdV11 | undefined {
  return value === 'token-api' ? 'token-api' : value === 'local-runtime' ? 'local-runtime' : undefined;
}

function toResolvedRuntimeRouteBinding(
  resolved: ReturnType<typeof resolveRuntimeCapabilityConfigFromV11>,
): ResolvedRuntimeRouteBinding {
  if (resolved.source === 'local-runtime') {
    return {
      source: 'local-runtime',
      runtimeModelType: resolved.runtimeModelType,
      provider: resolved.provider,
      localModelId: resolved.localModelId,
      engine: resolved.engine,
      adapter: resolved.adapter,
      providerHints: resolved.providerHints,
      model: resolved.model,
      endpoint: resolved.endpoint,
      localProviderEndpoint: resolved.localProviderEndpoint,
      localProviderModel: resolved.localProviderModel,
      localOpenAiEndpoint: resolved.localOpenAiEndpoint,
      localOpenAiApiKey: resolved.localOpenAiApiKey,
      connectorId: '',
    };
  }

  return {
    source: 'token-api',
    runtimeModelType: resolved.runtimeModelType,
    provider: resolved.provider,
    adapter: resolved.adapter,
    providerHints: resolved.providerHints,
    connectorId: resolved.connectorId,
    model: resolved.model,
    endpoint: resolved.endpoint,
    localOpenAiEndpoint: resolved.localOpenAiEndpoint,
    localOpenAiApiKey: resolved.localOpenAiApiKey,
  };
}

function resolveRouteReasonCode(error: unknown): string {
  if (error instanceof RuntimeRouteResolutionError) {
    return error.code;
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code || '').trim();
    if (code) return code;
  }
  return 'RUNTIME_ROUTE_RESOLVE_FAILED';
}

function resolveRoutePolicyGate(error: unknown): unknown {
  if (error instanceof RuntimeRouteResolutionError) {
    return (error.metadata && typeof error.metadata === 'object')
      ? (error.metadata as Record<string, unknown>).policyGate
      : undefined;
  }
  if (error && typeof error === 'object' && 'metadata' in error) {
    const metadata = (error as { metadata?: unknown }).metadata;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return (metadata as Record<string, unknown>).policyGate;
    }
  }
  return undefined;
}

function mapRouteReasonToLocalAiReasonCode(reasonCode: string): string {
  switch (reasonCode) {
    case 'RUNTIME_ROUTE_MODEL_MISSING':
    case 'RUNTIME_ROUTE_CAPABILITY_MISSING':
    case 'RUNTIME_ROUTE_CAPABILITY_MISMATCH':
      return 'LOCAL_AI_CAPABILITY_MISSING';
    case 'RUNTIME_ROUTE_CONNECTOR_TOKEN_MISSING':
      return 'LOCAL_AI_AUTH_FAILED';
    case 'RUNTIME_ROUTE_CONNECTOR_MISSING':
    case 'RUNTIME_ROUTE_RESOLVE_FAILED':
      return 'LOCAL_AI_SERVICE_UNREACHABLE';
    default:
      return 'LOCAL_AI_PROVIDER_INTERNAL_ERROR';
  }
}

export function createResolveRouteBinding(getRuntimeFields: () => RuntimeFields) {
  return async ({ routeHint, modId, routeOverride }: {
    routeHint: RuntimeRouteHint;
    modId?: string;
    routeOverride?: RuntimeRouteOverride;
  }): Promise<ResolvedRuntimeRouteBinding> => {
    const normalizedRouteHint = String(routeHint || 'chat/default').trim().toLowerCase();
    const capability = normalizeCapabilityV11(
      normalizedRouteHint.startsWith('image/')
        ? 'image'
        : normalizedRouteHint.startsWith('video/')
          ? 'video'
          : normalizedRouteHint.startsWith('tts/')
            ? 'tts'
            : normalizedRouteHint.startsWith('stt/')
              ? 'stt'
              : normalizedRouteHint.startsWith('embedding/')
                ? 'embedding'
                : 'chat',
    );

    const routeFlowId = createRendererFlowId('runtime-route-resolve');
    const runtimeFieldsForCache = getRuntimeFields();
    const routeOverrideRecord = routeOverride
      ? {
        source: routeOverride.source || null,
        connectorId: routeOverride.connectorId || null,
        model: routeOverride.model || null,
        localModelId: routeOverride.localModelId || null,
        engine: routeOverride.engine || null,
      }
      : null;
    const normalizedOverrideSource = normalizeRouteOverrideSource(routeOverride?.source);
    const normalizedRouteOverride = routeOverride
      ? {
        source: normalizedOverrideSource,
        connectorId: routeOverride.connectorId || undefined,
        model: routeOverride.model || undefined,
        localModelId: routeOverride.localModelId || undefined,
        engine: routeOverride.engine || undefined,
      }
      : undefined;
    const cacheKey = buildRuntimeRouteResolveCacheKey({
      capability,
      modId: modId || '',
      routeOverride: routeOverrideRecord,
      runtimeFields: runtimeFieldsForCache,
    });

    const now = Date.now();
    const cached = runtimeRouteResolveCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    if (cached && cached.expiresAt <= now) {
      runtimeRouteResolveCache.delete(cacheKey);
    }

    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'runtime-route:resolve:start',
      flowId: routeFlowId,
      details: {
        capability,
        modId: modId || null,
        overrideSource: routeOverride?.source || null,
        overrideConnectorId: routeOverride?.connectorId || null,
        overrideModel: routeOverride?.model || null,
      },
    });

    try {
      const resolved = resolveRuntimeCapabilityConfigFromV11(
        runtimeFieldsForCache,
        capability,
        { modId, routeOverride: normalizedRouteOverride },
      );
      const binding = toResolvedRuntimeRouteBinding(resolved);
      logRendererEvent({
        level: 'info',
        area: 'renderer-bootstrap',
        message: 'runtime-route:resolve:done',
        flowId: routeFlowId,
        details: {
          capability,
          modId: modId || null,
          source: resolved.source,
          connectorId: resolved.connectorId || null,
          model: resolved.model,
        },
      });
      runtimeRouteResolveCache.set(cacheKey, {
        expiresAt: now + RUNTIME_ROUTE_RESOLVE_CACHE_TTL_MS,
        value: binding,
      });
      return binding;
    } catch (error) {
      const reasonCode = resolveRouteReasonCode(error);
      const localAiReasonCode = mapRouteReasonToLocalAiReasonCode(reasonCode);
      const policyGate = resolveRoutePolicyGate(error);
      const shouldFallbackToTokenApi = normalizedOverrideSource !== 'token-api'
        && (
          reasonCode === 'RUNTIME_ROUTE_MODEL_MISSING'
          || reasonCode === 'RUNTIME_ROUTE_CAPABILITY_MISSING'
        );

      if (shouldFallbackToTokenApi) {
        try {
          const fallbackResolved = resolveRuntimeCapabilityConfigFromV11(
            runtimeFieldsForCache,
            capability,
            {
              modId,
              routeOverride: {
                ...(normalizedRouteOverride || {}),
                source: 'token-api',
                model: normalizedRouteOverride?.model || '',
                localModelId: '',
                engine: '',
              },
            },
          );
          const fallbackBinding = toResolvedRuntimeRouteBinding(fallbackResolved);
          logRendererEvent({
            level: 'warn',
            area: 'renderer-bootstrap',
            message: 'runtime-route:resolve:fallback-to-token-api',
            flowId: routeFlowId,
            details: {
              capability,
              modId: modId || null,
              reasonCode,
              localAiReasonCode,
              policyGate: policyGate || null,
              originalError: safeErrorMessage(error),
              fallbackSource: 'token-api',
              source: fallbackResolved.source,
              connectorId: fallbackResolved.connectorId || null,
              model: fallbackResolved.model,
            },
          });
          // Audit stream marker for local-runtime -> token-api fallback.
          logRendererEvent({
            level: 'warn',
            area: 'local-ai-runtime-audit',
            message: 'fallback_to_token_api',
            flowId: routeFlowId,
            details: {
              reasonCode,
              localAiReasonCode,
              policyGate: policyGate || null,
              capability,
              modId: modId || null,
              adapter: fallbackResolved.adapter,
              connectorId: fallbackResolved.connectorId || null,
              model: fallbackResolved.model,
            },
          });
          void localAiRuntime.appendInferenceAudit({
            eventType: 'fallback_to_token_api',
            modId: modId || 'core.runtime-route',
            source: 'token-api',
            provider: fallbackResolved.provider,
            modality: capability,
            adapter: fallbackResolved.adapter,
            model: fallbackResolved.model,
            endpoint: fallbackResolved.endpoint,
            reasonCode: localAiReasonCode,
            detail: safeErrorMessage(error),
            policyGate: (typeof policyGate === 'string' || (policyGate && typeof policyGate === 'object'))
              ? policyGate as string | Record<string, unknown>
              : undefined,
            extra: {
              capability,
              adapter: fallbackResolved.adapter,
              connectorId: fallbackResolved.connectorId || null,
              routeReasonCode: reasonCode,
              fallbackSource: 'token-api',
              policyGate: policyGate || null,
            },
          }).catch((auditError) => {
            logRendererEvent({
              level: 'warn',
              area: 'local-ai-runtime-audit',
              message: 'fallback_to_token_api_persist_failed',
              flowId: routeFlowId,
              details: {
                reasonCode: 'LOCAL_AI_AUDIT_WRITE_FAILED',
                detail: safeErrorMessage(auditError),
              },
            });
          });
          runtimeRouteResolveCache.set(cacheKey, {
            expiresAt: now + RUNTIME_ROUTE_RESOLVE_CACHE_TTL_MS,
            value: fallbackBinding,
          });
          return fallbackBinding;
        } catch (fallbackError) {
          logRendererEvent({
            level: 'error',
            area: 'renderer-bootstrap',
            message: 'runtime-route:resolve:fallback-failed',
            flowId: routeFlowId,
            details: {
              capability,
              modId: modId || null,
              reasonCode,
              originalError: safeErrorMessage(error),
              fallbackError: safeErrorMessage(fallbackError),
            },
          });
        }
      }
      logRendererEvent({
        level: 'error',
        area: 'renderer-bootstrap',
        message: 'runtime-route:resolve:failed',
        flowId: routeFlowId,
        details: {
          capability,
          modId: modId || null,
          reasonCode,
          error: safeErrorMessage(error),
        },
      });
      throw error;
    }
  };
}

export function createSpeechRouteResolver(getRuntimeFields: () => RuntimeFields) {
  type ParsedSpeechProviderId = {
    valid: boolean;
    inferredSource?: 'local-runtime' | 'token-api';
    requiredSource?: 'local-runtime' | 'token-api';
    engine?: string;
  };

  const parseSpeechProviderId = (value: string | undefined): ParsedSpeechProviderId => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw || raw === 'auto') return { valid: true };

    if (
      raw === 'local-runtime'
      || raw.startsWith('local-runtime:')
      || raw === 'token-api'
      || raw.startsWith('token-api:')
    ) {
      return { valid: false };
    }

    if (raw === 'localai' || raw === 'localai-native') {
      return {
        valid: true,
        inferredSource: 'local-runtime',
        requiredSource: 'local-runtime',
        engine: 'localai',
      };
    }
    if (raw === 'nexa') {
      return {
        valid: true,
        inferredSource: 'local-runtime',
        requiredSource: 'local-runtime',
        engine: 'nexa',
      };
    }
    if (raw === 'openrouter' || raw.startsWith('openrouter:')) {
      return {
        valid: true,
        inferredSource: 'token-api',
        requiredSource: 'token-api',
      };
    }
    if (
      raw === 'openai-compatible'
      || raw === 'dashscope-compatible'
      || raw === 'volcengine-compatible'
    ) {
      return { valid: true };
    }

    return { valid: false };
  };

  return async ({
    modId,
    providerId,
    routeSource,
    connectorId,
    model: explicitModel,
  }: {
    modId?: string;
    providerId?: string;
    routeSource?: 'auto' | 'local-runtime' | 'token-api';
    connectorId?: string;
    model?: string;
  }) => {
    const parsedProviderId = parseSpeechProviderId(providerId);
    if (!parsedProviderId.valid) {
      throw new Error(`HOOK_LLM_SPEECH_PROVIDER_UNAVAILABLE: unsupported providerId ${providerId}`);
    }
    const normalizedRouteSource = routeSource === 'local-runtime' || routeSource === 'token-api'
      ? routeSource
      : undefined;
    if (
      normalizedRouteSource
      && parsedProviderId.requiredSource
      && parsedProviderId.requiredSource !== normalizedRouteSource
    ) {
      throw new Error(`HOOK_LLM_SPEECH_PROVIDER_UNAVAILABLE: providerId source mismatch ${providerId}`);
    }
    const hasExplicitRouteSource = normalizedRouteSource !== undefined;
    let inferredSource: 'local-runtime' | 'token-api' | undefined = normalizedRouteSource;
    if (!inferredSource) {
      inferredSource = parsedProviderId.inferredSource;
    }

    const normalizedConnectorId = String(connectorId || '').trim();
    const normalizedExplicitModel = String(explicitModel || '').trim();
    const routeOverride = inferredSource
      ? (
        hasExplicitRouteSource
          ? (
            inferredSource === 'token-api'
              ? {
                  source: inferredSource,
                  connectorId: normalizedConnectorId,
                  model: normalizedExplicitModel || '',
                  localModelId: '',
                  engine: '',
                }
              : {
                  source: inferredSource,
                  connectorId: normalizedConnectorId,
                  model: normalizedExplicitModel || '',
                  localModelId: '',
                  engine: parsedProviderId.engine || '',
                }
          )
          : {
              source: inferredSource,
              ...(normalizedConnectorId ? { connectorId: normalizedConnectorId } : {}),
              ...(normalizedExplicitModel ? { model: normalizedExplicitModel } : {}),
              ...(inferredSource === 'local-runtime' && parsedProviderId.engine
                ? { engine: parsedProviderId.engine }
                : {}),
            }
      )
      : normalizedConnectorId
        ? { connectorId: normalizedConnectorId, ...(normalizedExplicitModel ? { model: normalizedExplicitModel } : {}) }
        : normalizedExplicitModel
          ? { model: normalizedExplicitModel }
          : undefined;

    const resolved = resolveRuntimeCapabilityConfigFromV11(
      getRuntimeFields(),
      'tts',
      { modId, routeOverride },
    );

    return {
      source: resolved.source,
      provider: resolved.provider,
      adapter: resolved.adapter,
      localProviderEndpoint: resolved.localProviderEndpoint,
      localOpenAiEndpoint: resolved.localOpenAiEndpoint,
      localOpenAiApiKey: resolved.localOpenAiApiKey,
      model: resolved.model,
      engine: resolved.source === 'local-runtime' ? resolved.engine : undefined,
    };
  };
}
