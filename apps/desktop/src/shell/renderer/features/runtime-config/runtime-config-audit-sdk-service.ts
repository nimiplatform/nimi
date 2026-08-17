import {
  NIMI_RUNTIME_REASON_CODES,
  createNimiDesktopAuditProjectionClient,
} from '@nimiplatform/sdk/runtime';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import { asNimiError } from '@nimiplatform/sdk/types';
import type {
  ListDesktopAuditEventsRequest,
  ListDesktopAuditEventsResponse,
  ListUsageStatsRequest,
  ListUsageStatsResponse,
  GetRuntimeHealthResponse,
  RuntimeHealthEvent,
} from '@nimiplatform/sdk/runtime/wire-types';
const DEFAULT_DESKTOP_AUDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_DESKTOP_AUDIT_WINDOW_MS = 7 * DEFAULT_DESKTOP_AUDIT_WINDOW_MS;

type DesktopAuditTimestamp = NonNullable<ListDesktopAuditEventsRequest['fromTime']>;
type DesktopAuditListInput = Pick<ListDesktopAuditEventsRequest, 'fromTime' | 'toTime'>
  & Partial<Omit<ListDesktopAuditEventsRequest, 'fromTime' | 'toTime'>>;

export type DesktopAuditTimeRange = {
  fromTime: DesktopAuditTimestamp;
  toTime: DesktopAuditTimestamp;
};

function withAuditError<T>(value: T | Promise<T>): Promise<T> {
  return Promise.resolve(value).catch((error) => {
    throw asNimiError(error, {
      reasonCode: NIMI_RUNTIME_REASON_CODES.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_daemon_health',
      source: 'runtime',
    });
  });
}

type RuntimeAuditClient = ReturnType<DesktopRendererSdkPort['auditAdmin']>;

export function dateToTimestamp(date: Date): { seconds: string; nanos: number } {
  const ms = date.getTime();
  if (!Number.isFinite(ms)) {
    throw new RangeError('audit timestamp must be a valid date');
  }
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms - seconds * 1000) * 1_000_000;
  return { seconds: String(seconds), nanos };
}

export function resolveDesktopAuditTimeRange(
  input: { from?: Date; to?: Date },
  now: Date,
): DesktopAuditTimeRange {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new RangeError('audit window clock must be a valid date');
  }
  const explicitFromMs = input.from?.getTime();
  const explicitToMs = input.to?.getTime();
  if (explicitFromMs !== undefined && !Number.isFinite(explicitFromMs)) {
    throw new RangeError('audit from time must be a valid date');
  }
  if (explicitToMs !== undefined && !Number.isFinite(explicitToMs)) {
    throw new RangeError('audit to time must be a valid date');
  }

  const fromMs = explicitFromMs ?? (explicitToMs !== undefined
    ? explicitToMs - DEFAULT_DESKTOP_AUDIT_WINDOW_MS
    : nowMs - DEFAULT_DESKTOP_AUDIT_WINDOW_MS);
  const toMs = explicitToMs ?? (explicitFromMs !== undefined
    ? explicitFromMs + DEFAULT_DESKTOP_AUDIT_WINDOW_MS
    : nowMs);
  if (fromMs > toMs) {
    throw new RangeError('audit time window must be ordered');
  }
  if (toMs - fromMs > MAX_DESKTOP_AUDIT_WINDOW_MS) {
    throw new RangeError('audit time window cannot exceed seven days');
  }
  return {
    fromTime: dateToTimestamp(new Date(fromMs)),
    toTime: dateToTimestamp(new Date(toMs)),
  };
}

export async function fetchDesktopAuditEvents(
  runtimeAudit: RuntimeAuditClient,
  req: DesktopAuditListInput,
): Promise<ListDesktopAuditEventsResponse> {
  const client = createNimiDesktopAuditProjectionClient({ runtime: runtimeAudit });
  return withAuditError(
    client.listEvents({
      traceId: req.traceId ?? '',
      requestId: req.requestId ?? '',
      appId: req.appId ?? '',
      domain: req.domain ?? '',
      operation: req.operation ?? '',
      reasonCode: req.reasonCode ?? 0,
      callerKind: req.callerKind ?? 0,
      fromTime: req.fromTime,
      toTime: req.toTime,
      pageSize: req.pageSize ?? 100,
      pageToken: req.pageToken ?? '',
    }),
  );
}

export async function fetchUsageStats(
  runtimeAudit: RuntimeAuditClient,
  req: Partial<ListUsageStatsRequest>,
): Promise<ListUsageStatsResponse> {
  return withAuditError(
    runtimeAudit.listUsageStats({
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

export async function fetchRuntimeHealth(runtimeAudit: RuntimeAuditClient): Promise<GetRuntimeHealthResponse> {
  return withAuditError(
    runtimeAudit.getRuntimeHealth({}, { timeoutMs: 5000 }),
  );
}

export async function subscribeRuntimeHealth(runtimeAudit: RuntimeAuditClient): Promise<AsyncIterable<RuntimeHealthEvent>> {
  return withAuditError(runtimeAudit.subscribeRuntimeHealthEvents({}));
}
