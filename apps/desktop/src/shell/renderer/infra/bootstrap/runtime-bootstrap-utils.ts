import { createProviderAdapter } from '@runtime/llm-adapter';
import { DEFAULT_TEMPLATES } from '@runtime/llm-adapter/registry/templates';
import type { ModelProfile } from '@runtime/llm-adapter/types';
import type { ResolvedRuntimeRouteBinding } from '@nimiplatform/sdk/mod/types';
import {
  dedupeStringsV11,
  normalizeEndpointV11,
} from '@renderer/features/runtime-config/state/v11/types';

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

export function isCreatorAgentApiEnabled(): boolean {
  const raw = String(import.meta.env.VITE_NIMI_ENABLE_CREATOR_AGENTS || '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function toRecordArray(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    return input
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as Record<string, unknown>);
  }

  if (!input || typeof input !== 'object') {
    return [];
  }

  const root = input as Record<string, unknown>;
  const items = Array.isArray(root.items) ? root.items : [];
  return items
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as Record<string, unknown>);
}

export function toRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

export const WORLD_DATA_API_CAPABILITIES = {
  runtimeRouteOptions: 'data-api.runtime.route.options',
  accessMe: 'data-api.world.access.me',
  landingResolve: 'data-api.world.landing.resolve',
  draftCreate: 'data-api.world.draft.create',
  draftGet: 'data-api.world.draft.get',
  draftUpdate: 'data-api.world.draft.update',
  draftPublish: 'data-api.world.draft.publish',
  maintenanceGet: 'data-api.world.maintenance.get',
  maintenanceUpdate: 'data-api.world.maintenance.update',
  eventsList: 'data-api.world.events.list',
  eventsBatchUpsert: 'data-api.world.events.batch-upsert',
  eventsDelete: 'data-api.world.events.delete',
  lorebooksList: 'data-api.world.lorebooks.list',
  lorebooksBatchUpsert: 'data-api.world.lorebooks.batch-upsert',
  lorebooksDelete: 'data-api.world.lorebooks.delete',
  draftsList: 'data-api.world.drafts.list',
  worldsMine: 'data-api.world.worlds.mine',
  mutationsList: 'data-api.world.mutations.list',
  creatorAgentsList: 'data-api.creator.agents.list',
  creatorAgentsCreate: 'data-api.creator.agents.create',
  creatorAgentsBatchCreate: 'data-api.creator.agents.batch-create',
} as const;

export const CORE_DATA_API_CAPABILITIES = {
  friendsWithDetailsList: 'data-api.core.social.friends-with-details.list',
  userByIdGet: 'data-api.core.user.by-id.get',
  userByHandleGet: 'data-api.core.user.by-handle.get',
  worldByIdGet: 'data-api.core.world.by-id.get',
  worldviewByIdGet: 'data-api.core.worldview.by-id.get',
  agentMemoryRecallForEntity: 'data-api.core.agent.memory.recall.for-entity',
  agentMemoryCoreList: 'data-api.core.agent.memory.core.list',
  agentMemoryE2EList: 'data-api.core.agent.memory.e2e.list',
  agentMemoryStatsGet: 'data-api.core.agent.memory.stats.get',
} as const;

export const CORE_WORLD_DATA_CAPABILITY_SET = new Set<string>(
  [
    ...Object.values(WORLD_DATA_API_CAPABILITIES),
    ...Object.values(CORE_DATA_API_CAPABILITIES),
  ],
);

export const RUNTIME_ROUTE_RESOLVE_CACHE_TTL_MS = 300_000;
export const runtimeRouteResolveCache = new Map<string, {
  expiresAt: number;
  value: ResolvedRuntimeRouteBinding;
}>();
export const RUNTIME_ROUTE_CONNECTOR_MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
export type RuntimeRouteModelProfilePayload = {
  model: string;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  contextSource: 'provider-api' | 'template' | 'default' | 'unknown';
};
export type RuntimeRouteHydratedModelsPayload = {
  models: string[];
  modelProfiles: RuntimeRouteModelProfilePayload[];
};
const runtimeRouteConnectorModelCache = new Map<string, {
  expiresAt: number;
  value: RuntimeRouteHydratedModelsPayload;
}>();
const runtimeRouteConnectorModelPending = new Map<string, Promise<RuntimeRouteHydratedModelsPayload>>();

export function buildRuntimeRouteResolveCacheKey(input: {
  capability: string;
  modId: string;
  routeOverride: Record<string, unknown> | null;
  runtimeFields: Record<string, unknown>;
}): string {
  return JSON.stringify({
    capability: input.capability,
    modId: input.modId,
    routeOverride: input.routeOverride || null,
    runtimeFields: input.runtimeFields,
  });
}

function buildConnectorModelCacheKey(input: {
  connectorId: string;
  vendor: string;
  endpoint: string;
  tokenApiKey: string;
}): string {
  const token = String(input.tokenApiKey || '').trim();
  return JSON.stringify({
    connectorId: input.connectorId,
    vendor: String(input.vendor || '').trim(),
    endpoint: String(input.endpoint || '').trim(),
    tokenHint: token ? `${token.length}:${token.slice(-8)}` : 'none',
  });
}

function toPositiveInt(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const rounded = Math.floor(numeric);
  return rounded > 0 ? rounded : undefined;
}

function contextSourcePriority(source: RuntimeRouteModelProfilePayload['contextSource']): number {
  if (source === 'provider-api') return 4;
  if (source === 'template') return 3;
  if (source === 'default') return 2;
  return 1;
}

function resolveTemplateContextTokens(model: string): number | undefined {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) return undefined;
  const tail = normalized.split('/').filter(Boolean).pop() || normalized;
  const matched = DEFAULT_TEMPLATES.find((template) => (
    normalized.startsWith(template.prefix.toLowerCase())
    || tail.startsWith(template.prefix.toLowerCase())
  ));
  return toPositiveInt(matched?.patch?.constraints?.maxContextTokens);
}

function normalizeContextSource(value: unknown): RuntimeRouteModelProfilePayload['contextSource'] {
  const source = String(value || '').trim();
  if (source === 'provider-api' || source === 'template' || source === 'default') {
    return source;
  }
  return 'unknown';
}

function dedupeModelProfiles(
  profiles: RuntimeRouteModelProfilePayload[],
): RuntimeRouteModelProfilePayload[] {
  const merged = new Map<string, RuntimeRouteModelProfilePayload>();
  for (const profile of profiles) {
    const model = String(profile.model || '').trim();
    if (!model) continue;
    const key = model.toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        model,
        ...(typeof profile.maxContextTokens === 'number' ? { maxContextTokens: profile.maxContextTokens } : {}),
        ...(typeof profile.maxOutputTokens === 'number' ? { maxOutputTokens: profile.maxOutputTokens } : {}),
        contextSource: normalizeContextSource(profile.contextSource),
      });
      continue;
    }

    const existingSource = normalizeContextSource(existing.contextSource);
    const nextSource = normalizeContextSource(profile.contextSource);
    const shouldUpgradeSource = contextSourcePriority(nextSource) > contextSourcePriority(existingSource);
    const nextContext = typeof profile.maxContextTokens === 'number' ? profile.maxContextTokens : undefined;
    const existingContext = typeof existing.maxContextTokens === 'number' ? existing.maxContextTokens : undefined;
    const maxContextTokens = (() => {
      if (typeof nextContext !== 'number') return existingContext;
      if (typeof existingContext !== 'number') return nextContext;
      if (shouldUpgradeSource) return nextContext;
      return Math.max(existingContext, nextContext);
    })();

    const nextOutput = typeof profile.maxOutputTokens === 'number' ? profile.maxOutputTokens : undefined;
    const existingOutput = typeof existing.maxOutputTokens === 'number' ? existing.maxOutputTokens : undefined;
    const maxOutputTokens = (() => {
      if (typeof nextOutput !== 'number') return existingOutput;
      if (typeof existingOutput !== 'number') return nextOutput;
      return shouldUpgradeSource ? nextOutput : Math.max(existingOutput, nextOutput);
    })();

    merged.set(key, {
      model,
      ...(typeof maxContextTokens === 'number' ? { maxContextTokens } : {}),
      ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
      contextSource: shouldUpgradeSource ? nextSource : existingSource,
    });
  }
  return Array.from(merged.values());
}

function toProfileFromModelName(
  model: string,
  source: RuntimeRouteModelProfilePayload['contextSource'] = 'unknown',
): RuntimeRouteModelProfilePayload {
  const normalizedModel = String(model || '').trim();
  const inferredContext = resolveTemplateContextTokens(normalizedModel);
  const contextSource = typeof inferredContext === 'number' ? 'template' : source;
  return {
    model: normalizedModel,
    ...(typeof inferredContext === 'number' ? { maxContextTokens: inferredContext } : {}),
    contextSource,
  };
}

function toProfilesFromModelNames(
  models: string[],
  source: RuntimeRouteModelProfilePayload['contextSource'] = 'unknown',
): RuntimeRouteModelProfilePayload[] {
  return dedupeModelProfiles(
    dedupeStringsV11(models).map((model) => toProfileFromModelName(model, source)),
  );
}

function toProfileFromModelProfile(profile: ModelProfile): RuntimeRouteModelProfilePayload | null {
  const model = String(profile.model || '').trim();
  if (!model) return null;
  const directContext = toPositiveInt(profile.constraints.maxContextTokens ?? profile.fingerprint?.maxInputTokens);
  const templateContext = resolveTemplateContextTokens(model);
  const maxContextTokens = directContext ?? templateContext;
  const maxOutputTokens = toPositiveInt(profile.constraints.maxOutputTokens);
  const discoveredFrom = normalizeContextSource(profile.fingerprint?.discoveredFrom);
  const contextSource = (() => {
    if (typeof directContext === 'number') {
      return discoveredFrom === 'provider-api' || discoveredFrom === 'template'
        ? discoveredFrom
        : 'provider-api';
    }
    if (typeof templateContext === 'number') return 'template';
    return 'unknown';
  })();
  return {
    model,
    ...(typeof maxContextTokens === 'number' ? { maxContextTokens } : {}),
    ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
    contextSource,
  };
}

function buildHydratedPayload(
  models: string[],
  profiles: RuntimeRouteModelProfilePayload[],
): RuntimeRouteHydratedModelsPayload {
  const normalizedModels = dedupeStringsV11(models);
  const normalizedProfiles = dedupeModelProfiles([
    ...toProfilesFromModelNames(normalizedModels),
    ...profiles,
  ]);
  return {
    models: normalizedModels,
    modelProfiles: normalizedProfiles,
  };
}

function mergeHydratedPayloads(
  left: RuntimeRouteHydratedModelsPayload,
  right: RuntimeRouteHydratedModelsPayload,
): RuntimeRouteHydratedModelsPayload {
  return buildHydratedPayload(
    [...left.models, ...right.models],
    [...left.modelProfiles, ...right.modelProfiles],
  );
}

export function hydrateModelProfilesByTemplate(models: string[]): RuntimeRouteModelProfilePayload[] {
  return toProfilesFromModelNames(models);
}

export async function hydrateConnectorModels(input: {
  connectorId: string;
  vendor: string;
  endpoint: string;
  tokenApiKey: string;
  models: string[];
}): Promise<RuntimeRouteHydratedModelsPayload> {
  const current = dedupeStringsV11([...(Array.isArray(input.models) ? input.models : [])]);
  const currentPayload = buildHydratedPayload(current, toProfilesFromModelNames(current));
  const vendor = String(input.vendor || '').trim();
  if (vendor !== 'openrouter') return currentPayload;

  const tokenApiKey = String(input.tokenApiKey || '').trim();
  if (!tokenApiKey) return currentPayload;

  const endpoint = normalizeEndpointV11(String(input.endpoint || '').trim(), '');
  if (!endpoint) return currentPayload;

  const cacheKey = buildConnectorModelCacheKey({
    connectorId: input.connectorId,
    vendor,
    endpoint,
    tokenApiKey,
  });
  const now = Date.now();
  const cached = runtimeRouteConnectorModelCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return mergeHydratedPayloads(currentPayload, cached.value);
  }

  const pending = runtimeRouteConnectorModelPending.get(cacheKey);
  if (pending) {
    const payload = await pending;
    return mergeHydratedPayloads(currentPayload, payload);
  }

  const task = (async () => {
    try {
      const adapter = createProviderAdapter('OPENAI_COMPATIBLE', {
        name: `runtime-route-options:${input.connectorId}`,
        endpoint,
        headers: {
          Authorization: `Bearer ${tokenApiKey}`,
        },
      });
      const listed = await adapter.listModels();
      const discoveredProfiles = dedupeModelProfiles(
        listed
          .map((profile) => toProfileFromModelProfile(profile))
          .filter((profile): profile is RuntimeRouteModelProfilePayload => Boolean(profile)),
      );
      const discovered = buildHydratedPayload(
        [...current, ...listed.map((profile) => String(profile.model || '').trim())],
        discoveredProfiles,
      );
      runtimeRouteConnectorModelCache.set(cacheKey, {
        expiresAt: now + RUNTIME_ROUTE_CONNECTOR_MODEL_CACHE_TTL_MS,
        value: discovered,
      });
      return discovered;
    } catch {
      return currentPayload;
    } finally {
      runtimeRouteConnectorModelPending.delete(cacheKey);
    }
  })();

  runtimeRouteConnectorModelPending.set(cacheKey, task);
  const hydrated = await task;
  return mergeHydratedPayloads(currentPayload, hydrated);
}
