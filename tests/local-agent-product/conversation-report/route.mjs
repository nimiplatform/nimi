import { createHash, randomUUID } from 'node:crypto';

import {
  createNimiRuntimeModelCatalogClient,
  withNimiRuntimeIdempotencyMetadata,
} from '../../../sdks/typescript/dist/runtime/index.js';
import {
  ConnectorKind,
  ConnectorOwnerType,
  ConnectorStatus,
} from '../../../sdks/typescript/dist/runtime/wire-types/index.js';

function text(value) {
  return String(value || '').trim();
}

function arrayIncludes(value, item) {
  return Array.isArray(value) && value.includes(item);
}

function providerEnvToken(provider) {
  return text(provider).toUpperCase().replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
}

function credentialForProvider(provider, env) {
  const token = providerEnvToken(provider);
  const key = `NIMI_LIVE_${token}_API_KEY`;
  return text(env[key]) ? key : null;
}

function explicitModelId(provider, env) {
  return text(env[`NIMI_LIVE_${providerEnvToken(provider)}_MODEL_ID`]);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function catalogModelRevisionFingerprint(provider, model) {
  return createHash('sha256').update(JSON.stringify(stable({
    providerId: provider.provider,
    providerVersion: provider.version,
    catalogVersion: provider.catalogVersion,
    modelId: model.modelId,
    capabilities: [...new Set(Array.isArray(model.capabilities) ? model.capabilities.map(text).filter(Boolean) : [])].sort(),
  }))).digest('hex');
}

export function rankCatalogTextModels({ models, explicitModelId: explicit = '', defaultModelId = '' }) {
  const rows = Array.isArray(models) ? models.filter((model) => text(model?.modelId)) : [];
  const recent = rows.slice().sort((left, right) =>
    text(right.updatedAt).localeCompare(text(left.updatedAt))
      || text(left.modelId).localeCompare(text(right.modelId))
  );
  const ordered = [
    rows.find((model) => model.modelId === explicit),
    rows.find((model) => model.modelId === defaultModelId),
    ...recent,
  ].filter(Boolean);
  return [...new Map(ordered.map((model) => [model.modelId, model])).values()];
}

export function parseConversationRouteRef(value) {
  const normalized = text(value);
  if (!normalized) return null;
  const separator = normalized.indexOf('::');
  if (separator <= 0 || separator === normalized.length - 2) {
    throw new Error('conversation report route ref must use <provider>::<model-id>');
  }
  return { provider: normalized.slice(0, separator), modelId: normalized.slice(separator + 2) };
}

export function selectRuntimeManagedConnector(connectors, provider) {
  const normalizedProvider = text(provider).toLowerCase();
  return (Array.isArray(connectors) ? connectors : [])
    .filter((connector) => text(connector?.provider).toLowerCase() === normalizedProvider
      && connector?.ownerType === ConnectorOwnerType.SYSTEM
      && connector?.hasCredential === true
      && text(connector?.connectorId))
    .sort((left, right) => text(left.connectorId).localeCompare(text(right.connectorId)))[0] || null;
}

async function collectCandidates(runtime, env) {
  const catalog = createNimiRuntimeModelCatalogClient({ connectors: runtime.connectors });
  const candidates = [];
  for (const provider of await catalog.listProviders()) {
    if (!provider.provider || provider.provider === 'local') continue;
    const credentialEnvKey = credentialForProvider(provider.provider, env);
    if (!credentialEnvKey) continue;
    const response = await catalog.listProviderModels(provider.provider);
    const ranked = rankCatalogTextModels({
      models: response.models.filter((model) => arrayIncludes(model.capabilities, 'text.generate')),
      explicitModelId: explicitModelId(provider.provider, env),
      defaultModelId: provider.defaultTextModel,
    });
    for (const [preferenceRank, summary] of ranked.entries()) {
      const detail = await catalog.getModelDetail(provider.provider, summary.modelId);
      candidates.push({
        provider,
        model: detail.model,
        credentialEnvKey,
        preferenceRank,
        fingerprint: {
          providerId: provider.provider,
          modelId: detail.model.modelId,
          modelRevisionOrFingerprint: catalogModelRevisionFingerprint(provider, detail.model),
        },
      });
    }
  }
  return candidates.sort((left, right) => left.preferenceRank - right.preferenceRank
    || left.provider.provider.localeCompare(right.provider.provider)
    || left.model.modelId.localeCompare(right.model.modelId));
}

function selectCandidate(candidates, explicit) {
  if (!explicit) return candidates[0] || null;
  return candidates.find((candidate) => candidate.provider.provider === explicit.provider
    && candidate.model.modelId === explicit.modelId) || null;
}

async function listRuntimeManagedConnectors(runtime, provider) {
  const connectors = [];
  let pageToken = '';
  do {
    const response = await runtime.connectors.listConnectors({
      pageSize: 100,
      pageToken,
      kindFilter: ConnectorKind.REMOTE_MANAGED,
      statusFilter: ConnectorStatus.ACTIVE,
      providerFilter: provider,
    });
    connectors.push(...(response.connectors || []));
    pageToken = text(response.nextPageToken);
  } while (pageToken);
  return connectors;
}

async function provisionRoute(runtime, candidate, runId) {
  const connectors = await listRuntimeManagedConnectors(runtime, candidate.provider.provider);
  const connector = selectRuntimeManagedConnector(connectors, candidate.provider.provider);
  const connectorId = text(connector?.connectorId);
  if (!connectorId) throw new Error(`conversation report Runtime connector is unavailable for ${candidate.provider.provider}`);
  const tested = await runtime.connectors.testConnector(
    { connectorId },
    withNimiRuntimeIdempotencyMetadata(undefined, `local-agent-conversation-report:${runId}:test-connector:${randomUUID()}`),
  );
  if (tested.ack?.ok !== true) {
    throw new Error(`conversation report Runtime connector health failed for ${candidate.provider.provider}: ${text(tested.ack?.reasonCode) || 'unknown'}`);
  }
  const models = await runtime.connectors.listConnectorModels({
    connectorId,
    forceRefresh: false,
    pageSize: 500,
    pageToken: '',
  });
  const descriptor = models.models.find((model) => text(model.providerModelId) === candidate.model.modelId
    && arrayIncludes(model.capabilities, 'text.generate')
    && text(model.remoteModelCatalogId));
  if (!descriptor) throw new Error('conversation report Runtime connector did not expose the selected catalog text model');
  const targetRef = {
    kind: 'cloud-connector',
    version: 'v2',
    connectorId,
    remoteModelCatalogId: descriptor.remoteModelCatalogId,
    providerModelId: descriptor.providerModelId,
    provider: candidate.provider.provider,
  };
  return {
    fingerprint: candidate.fingerprint,
    targetRef,
    executionBinding: {
      route: 'cloud',
      modelId: descriptor.providerModelId,
      connectorId,
      targetRef,
    },
    catalogEvidence: {
      providerVersion: candidate.provider.version,
      catalogVersion: candidate.provider.catalogVersion,
      remoteModelCatalogId: descriptor.remoteModelCatalogId,
      capabilities: [...descriptor.capabilities].sort(),
      credentialSource: 'runtime_environment',
    },
    parameters: {
      source: 'runtime_ai_config_default',
      temperature: null,
      maxOutputTokens: null,
      reasoning: null,
    },
  };
}

export async function resolveAndProvisionConversationRoute({ runtime, env = process.env, runId = randomUUID() }) {
  const candidates = await collectCandidates(runtime, env);
  if (candidates.length === 0) {
    throw new Error('conversation report requires one credential-backed Runtime catalog text route');
  }
  const explicit = parseConversationRouteRef(env.NIMI_LOCAL_AGENT_CONVERSATION_ROUTE_REF);
  const selected = selectCandidate(candidates, explicit);
  if (!selected) throw new Error('configured conversation report route is unavailable in the Runtime catalog');
  return provisionRoute(runtime, selected, runId);
}

export function safeConversationRouteSummary(route) {
  return {
    fingerprint: route.fingerprint,
    targetRef: { ...route.targetRef, connectorId: '<runtime-secret-store-ref>' },
    catalogEvidence: route.catalogEvidence,
    parameters: route.parameters,
  };
}
