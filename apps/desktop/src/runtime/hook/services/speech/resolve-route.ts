import { createHookError } from '../../contracts/errors.js';
import {
  inferProviderTypeFromPrefix,
  normalizeLocalRuntimeProviderRef,
  normalizeSpeechAdapter,
} from './types.js';
import type { ResolvedRoute, SpeechServiceInput } from './types.js';

export async function resolveSpeechRoute(
  context: SpeechServiceInput,
  input: {
    modId: string;
    providerId?: string;
    routeSource?: 'auto' | 'local-runtime' | 'token-api';
    connectorId?: string;
    model?: string;
  },
): Promise<ResolvedRoute> {
  const resolved = await context.resolveRoute({
    modId: input.modId,
    providerId: input.providerId,
    routeSource: input.routeSource,
    connectorId: input.connectorId,
    model: input.model,
  });

  const source = String(resolved?.source || '').trim();
  if (source !== 'local-runtime' && source !== 'token-api') {
    throw createHookError(
      'HOOK_LLM_SPEECH_PROVIDER_UNAVAILABLE',
      `unsupported speech route source: ${source || 'unknown'}`,
      { modId: input.modId, providerId: input.providerId || null },
    );
  }

  if (source === 'local-runtime') {
    const model = String(resolved.model || '').trim();
    const adapter = normalizeSpeechAdapter(resolved.adapter);
    return {
      source,
      provider: normalizeLocalRuntimeProviderRef({
        provider: resolved.provider,
        engine: resolved.engine,
        adapter,
        model,
      }),
      adapter,
      providerType: 'OPENAI_COMPATIBLE',
      endpoint: String(resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || '').trim(),
      connectorId: resolved.connectorId,
      model,
    };
  }

  const model = String(resolved.model || '').trim();
  const providerStr = String(resolved.provider || '').trim();
  const prefix = providerStr.includes(':') ? String(providerStr.split(':')[0] || '') : 'openai-compatible';
  const providerType = inferProviderTypeFromPrefix(prefix);
  return {
    source,
    provider: providerStr || `openai-compatible:${model}`,
    adapter: normalizeSpeechAdapter(resolved.adapter),
    providerType,
    endpoint: String(resolved.localOpenAiEndpoint || '').trim(),
    connectorId: resolved.connectorId,
    model,
  };
}
