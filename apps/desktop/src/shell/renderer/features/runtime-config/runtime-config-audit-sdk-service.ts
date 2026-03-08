import { getPlatformClient } from '@runtime/platform-client';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  ListAuditEventsRequest,
  ListAuditEventsResponse,
  ExportAuditEventsRequest,
  AuditExportChunk,
  ListUsageStatsRequest,
  ListUsageStatsResponse,
  GetRuntimeHealthResponse,
  ListAIProviderHealthResponse,
  RuntimeHealthEvent,
  AIProviderHealthEvent,
} from '@nimiplatform/sdk/runtime';

function withAuditError<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error) => {
    throw asNimiError(error, {
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_daemon_health',
      source: 'runtime',
    });
  });
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
  const runtime = getPlatformClient().runtime;
  return withAuditError(
    runtime.audit.listAuditEvents({
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
  const runtime = getPlatformClient().runtime;
  return withAuditError(
    runtime.audit.exportAuditEvents({
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
  const runtime = getPlatformClient().runtime;
  return withAuditError(
    runtime.audit.listUsageStats({
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
  const runtime = getPlatformClient().runtime;
  return withAuditError(
    runtime.audit.getRuntimeHealth({}, { timeoutMs: 5000 }),
  );
}

export async function fetchProviderHealth(): Promise<ListAIProviderHealthResponse> {
  const runtime = getPlatformClient().runtime;
  return withAuditError(
    runtime.audit.listAIProviderHealth({}, { timeoutMs: 5000 }),
  );
}

export async function subscribeRuntimeHealth(): Promise<AsyncIterable<RuntimeHealthEvent>> {
  const runtime = getPlatformClient().runtime;
  return withAuditError(runtime.healthEvents({}));
}

export async function subscribeProviderHealth(): Promise<AsyncIterable<AIProviderHealthEvent>> {
  const runtime = getPlatformClient().runtime;
  return withAuditError(runtime.providerHealthEvents({}));
}
