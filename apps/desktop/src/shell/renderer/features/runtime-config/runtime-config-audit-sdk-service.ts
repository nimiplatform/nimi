import { NIMI_RUNTIME_REASON_CODES } from '@nimiplatform/sdk/runtime';
import { asNimiError } from '@nimiplatform/sdk/types';
import type { ListAuditEventsRequest, ListAuditEventsResponse, ExportAuditEventsRequest, AuditExportChunk, ListUsageStatsRequest, ListUsageStatsResponse, GetRuntimeHealthResponse, ListAIProviderHealthResponse, RuntimeHealthEvent, AIProviderHealthEvent } from '@nimiplatform/sdk/runtime/generated';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';

function withAuditError<T>(value: T | Promise<T>): Promise<T> {
  return Promise.resolve(value).catch((error) => {
    throw asNimiError(error, {
      reasonCode: NIMI_RUNTIME_REASON_CODES.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_daemon_health',
      source: 'runtime',
    });
  });
}

function runtimeAdmin() {
  return getDesktopRuntime().audit;
}

export function dateToTimestamp(date: Date): { seconds: string; nanos: number } {
  const ms = date.getTime();
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms % 1000) * 1_000_000;
  return { seconds: String(seconds), nanos };
}

export async function fetchGlobalAuditEvents(
  req: Partial<ListAuditEventsRequest>,
): Promise<ListAuditEventsResponse> {
  return withAuditError(
    runtimeAdmin().listAuditEvents({
      appId: '',
      subjectUserId: '',
      domain: req.domain ?? '',
      reasonCode: req.reasonCode ?? 0,
      fromTime: req.fromTime,
      toTime: req.toTime,
      pageSize: req.pageSize ?? 100,
      pageToken: req.pageToken ?? '',
      callerKind: req.callerKind ?? 0,
      callerId: req.callerId ?? '',
    }),
  );
}

export async function startAuditExport(
  req: Partial<ExportAuditEventsRequest>,
): Promise<AsyncIterable<AuditExportChunk>> {
  return withAuditError(
    runtimeAdmin().exportAuditEvents({
      appId: req.appId ?? '',
      subjectUserId: req.subjectUserId ?? '',
      format: req.format ?? 'json',
      fromTime: req.fromTime,
      toTime: req.toTime,
      compress: req.compress ?? false,
    }),
  );
}

export async function fetchUsageStats(
  req: Partial<ListUsageStatsRequest>,
): Promise<ListUsageStatsResponse> {
  return withAuditError(
    runtimeAdmin().listUsageStats({
      appId: '',
      subjectUserId: '',
      callerKind: req.callerKind ?? 0,
      callerId: req.callerId ?? '',
      capability: req.capability ?? '',
      modelId: req.modelId ?? '',
      window: req.window ?? 0,
      fromTime: req.fromTime,
      toTime: req.toTime,
      pageSize: req.pageSize ?? 100,
      pageToken: req.pageToken ?? '',
    }),
  );
}

export async function fetchRuntimeHealth(): Promise<GetRuntimeHealthResponse> {
  return withAuditError(
    runtimeAdmin().getRuntimeHealth({}, { timeoutMs: 5000 }),
  );
}

export async function fetchProviderHealth(): Promise<ListAIProviderHealthResponse> {
  return withAuditError(
    runtimeAdmin().listAIProviderHealth({}, { timeoutMs: 5000 }),
  );
}

export async function subscribeRuntimeHealth(): Promise<AsyncIterable<RuntimeHealthEvent>> {
  return withAuditError(runtimeAdmin().subscribeRuntimeHealthEvents({}));
}

export async function subscribeProviderHealth(): Promise<AsyncIterable<AIProviderHealthEvent>> {
  return withAuditError(runtimeAdmin().subscribeAIProviderHealthEvents({}));
}
