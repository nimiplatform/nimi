import type {
  LocalRuntimeAuditEvent,
  LocalRuntimeAuditPayload,
  LocalRuntimeAuditQuery,
  LocalRuntimeInferenceAuditPayload,
  LocalRuntimeNodeDescriptor,
  LocalRuntimeNodesCatalogListPayload,
  LocalRuntimeServiceDescriptor,
  LocalRuntimeServicesInstallPayload,
  LocalRuntimeWriteOptions,
} from './types';
import {
  assertLifecycleWriteAllowed,
  parseAuditEvent,
  parseNodeDescriptor,
  parseServiceDescriptor,
} from './parsers';
import { asRecord, requireSdkLocal } from './commands-shared';

export async function listLocalRuntimeServices(): Promise<LocalRuntimeServiceDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listLocalServices({ statusFilter: 0, pageSize: 0, pageToken: '' });
  const raw = asRecord(response);
  const services: unknown[] = Array.isArray(raw.services) ? raw.services : [];
  return services.map((item) => parseServiceDescriptor(item));
}

export async function installLocalRuntimeService(
  payload: LocalRuntimeServicesInstallPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_install', options?.caller);
  const runtime = requireSdkLocal();
  const result = await runtime.installLocalService({
    serviceId: String(payload.serviceId || '').trim(),
    title: String(payload.title || '').trim(),
    engine: String(payload.engine || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    localModelId: String(payload.localAssetId || '').trim(),
  });
  return parseServiceDescriptor(asRecord(result).service);
}

export async function startLocalRuntimeService(
  serviceId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_start', options?.caller);
  const runtime = requireSdkLocal();
  const result = await runtime.startLocalService({ serviceId: String(serviceId || '').trim() });
  return parseServiceDescriptor(asRecord(result).service);
}

export async function stopLocalRuntimeService(
  serviceId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_stop', options?.caller);
  const runtime = requireSdkLocal();
  const result = await runtime.stopLocalService({ serviceId: String(serviceId || '').trim() });
  return parseServiceDescriptor(asRecord(result).service);
}

export async function healthLocalRuntimeServices(serviceId?: string): Promise<LocalRuntimeServiceDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.checkLocalServiceHealth({ serviceId: String(serviceId || '').trim() });
  const raw = asRecord(response);
  const services: unknown[] = Array.isArray(raw.services) ? raw.services : [];
  return services.map((item) => parseServiceDescriptor(item));
}

export async function removeLocalRuntimeService(
  serviceId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_remove', options?.caller);
  const runtime = requireSdkLocal();
  const result = await runtime.removeLocalService({ serviceId: String(serviceId || '').trim() });
  return parseServiceDescriptor(asRecord(result).service);
}

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
    modId: String(query?.modId || '').trim(),
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
  await runtime.appendInferenceAudit({
    eventType: payload.eventType,
    modId: payload.modId,
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
    extra: undefined,
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
