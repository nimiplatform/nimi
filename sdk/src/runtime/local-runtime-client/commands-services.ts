import { toProtoStruct } from '../runtime-proto-struct-codec.js';
import { parseNodeDescriptor } from '../local-node-service.js';
import type {
  LocalRuntimeAuditEvent,
  LocalRuntimeAuditPayload,
  LocalRuntimeAuditQuery,
  LocalRuntimeInferenceAuditPayload,
  LocalRuntimeNodeDescriptor,
  LocalRuntimeNodesCatalogListPayload,
} from './types.js';
import { parseAuditEvent } from './parsers.js';
import { asRecord, requireSdkLocal } from './commands-shared.js';

export async function listLocalRuntimeNodesCatalog(
  payload?: LocalRuntimeNodesCatalogListPayload,
): Promise<LocalRuntimeNodeDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listNodeCatalog({
    capability: String(payload?.capability || '').trim(),
    serviceId: String(payload?.serviceId || '').trim(),
    provider: String(payload?.provider || '').trim(),
    typeFilter: '',
    pageSize: 0,
    pageToken: '',
  });
  const raw = asRecord(response);
  const nodes: unknown[] = Array.isArray(raw.nodes) ? raw.nodes : [];
  return nodes.map((item) => parseNodeDescriptor(item));
}

export async function listLocalRuntimeAudits(
  query?: LocalRuntimeAuditQuery,
): Promise<LocalRuntimeAuditEvent[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listLocalAudits({
    eventType: String(query?.eventType || '').trim(),
    eventTypes: Array.isArray(query?.eventTypes) ? query?.eventTypes : [],
    source: String(query?.source || '').trim(),
    modality: String(query?.modality || '').trim(),
    localModelId: String(query?.localModelId || '').trim(),
    targetId: String(query?.targetId || '').trim(),
    reasonCode: String(query?.reasonCode || '').trim(),
    timeRange: query?.timeRange ? { from: String(query.timeRange.from || ''), to: String(query.timeRange.to || '') } : undefined,
    pageSize: Number(query?.limit || 0),
    pageToken: '',
    appId: '',
    subjectUserId: '',
  });
  const raw = asRecord(response);
  const events: unknown[] = Array.isArray(raw.events) ? raw.events : [];
  return events.map((item) => parseAuditEvent(item));
}

export async function appendLocalRuntimeInferenceAudit(
  payload: LocalRuntimeInferenceAuditPayload,
): Promise<void> {
  const runtime = requireSdkLocal();
  const extra = {
    ...(payload.extra || {}),
    routeSource: payload.routeSource || payload.source,
    traceId: String(payload.traceId || ''),
  };
  await runtime.appendInferenceAudit({
    eventType: payload.eventType,
    targetId: payload.targetId,
    source: payload.source,
    provider: payload.provider,
    modality: payload.modality,
    adapter: String(payload.adapter || ''),
    model: String(payload.model || ''),
    localModelId: String(payload.localModelId || ''),
    endpoint: String(payload.endpoint || ''),
    reasonCode: String(payload.reasonCode || ''),
    detail: String(payload.detail || ''),
    policyGate: undefined,
    extra: toProtoStruct(extra),
  });
}

export async function appendLocalRuntimeAudit(payload: LocalRuntimeAuditPayload): Promise<void> {
  const runtime = requireSdkLocal();
  await runtime.appendRuntimeAudit({
    eventType: payload.eventType,
    modelId: String(payload.assetId || ''),
    localModelId: String(payload.localAssetId || ''),
    payload: payload.payload as never,
  });
}
