import {
  CallerKind,
  ReasonCode,
  type DesktopAuditEventProjection,
  type ListDesktopAuditEventsRequest,
  type ListDesktopAuditEventsResponse,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';

const MAX_WINDOW_NANOS = 7n * 24n * 60n * 60n * 1_000_000_000n;
const MAX_PAGE_SIZE = 100;
const FILTER_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/u;
const REQUEST_KEYS = new Set([
  'traceId',
  'requestId',
  'appId',
  'domain',
  'operation',
  'reasonCode',
  'callerKind',
  'fromTime',
  'toTime',
  'pageSize',
  'pageToken',
]);
const RESPONSE_KEYS = new Set(['events', 'nextPageToken']);
const EVENT_KEYS = new Set([
  'auditId',
  'requestId',
  'appId',
  'domain',
  'operation',
  'reasonCode',
  'traceId',
  'timestamp',
  'callerKind',
]);
const CALLER_KINDS = new Set<number>([
  CallerKind.UNSPECIFIED,
  CallerKind.DESKTOP_CORE,
  CallerKind.THIRD_PARTY_APP,
  CallerKind.THIRD_PARTY_SERVICE,
]);

export type NimiDesktopAuditProjectionRuntime = {
  readonly listDesktopAuditEvents: (
    request: ListDesktopAuditEventsRequest,
    options?: RuntimeTypedCallOptions,
  ) => Promise<ListDesktopAuditEventsResponse>;
};

export type NimiDesktopAuditProjectionClient = {
  readonly listEvents: (
    request: ListDesktopAuditEventsRequest,
    options?: RuntimeTypedCallOptions,
  ) => Promise<ListDesktopAuditEventsResponse>;
};

export class NimiDesktopAuditProjectionContractError extends Error {
  readonly code = 'SDK_RUNTIME_DESKTOP_AUDIT_PROJECTION_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'NimiDesktopAuditProjectionContractError';
  }
}

export function createNimiDesktopAuditProjectionClient(input: {
  readonly runtime: NimiDesktopAuditProjectionRuntime;
}): NimiDesktopAuditProjectionClient {
  if (!input?.runtime || typeof input.runtime.listDesktopAuditEvents !== 'function') {
    throw invalidProjection('listDesktopAuditEvents runtime method is required');
  }
  return {
    async listEvents(request, options = {}) {
      const exactRequest = validateDesktopAuditRequest(request);
      const response = await input.runtime.listDesktopAuditEvents(exactRequest, options);
      return validateDesktopAuditResponse(response);
    },
  };
}

function validateDesktopAuditRequest(request: ListDesktopAuditEventsRequest): ListDesktopAuditEventsRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw invalidProjection('request must be an object');
  }
  assertExactKeys(request as unknown as Record<string, unknown>, REQUEST_KEYS, 'request');
  if (!request.fromTime || !request.toTime) {
    throw invalidProjection('fromTime and toTime are required');
  }
  const fromNanos = timestampNanos(request.fromTime, 'fromTime');
  const toNanos = timestampNanos(request.toTime, 'toTime');
  if (fromNanos > toNanos || toNanos - fromNanos > MAX_WINDOW_NANOS) {
    throw invalidProjection('audit time window must be ordered and no longer than seven days');
  }
  if (!Number.isInteger(request.pageSize) || request.pageSize < 0 || request.pageSize > MAX_PAGE_SIZE) {
    throw invalidProjection('pageSize must be an integer from 0 through 100');
  }
  if (!Number.isInteger(request.reasonCode) || ReasonCode[request.reasonCode] === undefined) {
    throw invalidProjection('reasonCode is not admitted');
  }
  if (!Number.isInteger(request.callerKind) || !CALLER_KINDS.has(request.callerKind)) {
    throw invalidProjection('callerKind is not admitted');
  }
  for (const [name, value] of [
    ['traceId', request.traceId],
    ['requestId', request.requestId],
    ['appId', request.appId],
    ['domain', request.domain],
    ['operation', request.operation],
  ] as const) {
    if (value !== '' && !FILTER_PATTERN.test(value)) {
      throw invalidProjection(`${name} must be an exact bounded identifier`);
    }
  }
  if (typeof request.pageToken !== 'string' || request.pageToken.length > 1024) {
    throw invalidProjection('pageToken is invalid');
  }
  return {
    traceId: request.traceId,
    requestId: request.requestId,
    appId: request.appId,
    domain: request.domain,
    operation: request.operation,
    reasonCode: request.reasonCode,
    callerKind: request.callerKind,
    fromTime: { seconds: request.fromTime.seconds, nanos: request.fromTime.nanos },
    toTime: { seconds: request.toTime.seconds, nanos: request.toTime.nanos },
    pageSize: request.pageSize,
    pageToken: request.pageToken,
  };
}

function validateDesktopAuditResponse(response: ListDesktopAuditEventsResponse): ListDesktopAuditEventsResponse {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw invalidProjection('response must be an object');
  }
  assertExactKeys(response as unknown as Record<string, unknown>, RESPONSE_KEYS, 'response');
  if (!Array.isArray(response.events) || response.events.length > MAX_PAGE_SIZE) {
    throw invalidProjection('response events exceed the projection bound');
  }
  if (typeof response.nextPageToken !== 'string' || response.nextPageToken.length > 1024) {
    throw invalidProjection('response nextPageToken is invalid');
  }
  return {
    events: response.events.map(validateDesktopAuditEvent),
    nextPageToken: response.nextPageToken,
  };
}

function validateDesktopAuditEvent(event: DesktopAuditEventProjection): DesktopAuditEventProjection {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw invalidProjection('event must be an object');
  }
  assertExactKeys(event as unknown as Record<string, unknown>, EVENT_KEYS, 'event');
  for (const [name, value] of [
    ['auditId', event.auditId],
    ['requestId', event.requestId],
    ['appId', event.appId],
    ['domain', event.domain],
    ['operation', event.operation],
    ['traceId', event.traceId],
  ] as const) {
    if (typeof value !== 'string' || (value !== '' && !FILTER_PATTERN.test(value))) {
      throw invalidProjection(`event ${name} is invalid`);
    }
  }
  if (!event.auditId || !event.appId || !event.domain || !event.operation || !event.traceId || !event.timestamp) {
    throw invalidProjection('event is missing a required audit field');
  }
  timestampNanos(event.timestamp, 'event.timestamp');
  if (!Number.isInteger(event.reasonCode) || ReasonCode[event.reasonCode] === undefined) {
    throw invalidProjection('event reasonCode is invalid');
  }
  if (!Number.isInteger(event.callerKind) || !CALLER_KINDS.has(event.callerKind)) {
    throw invalidProjection('event callerKind is invalid');
  }
  return {
    auditId: event.auditId,
    requestId: event.requestId,
    appId: event.appId,
    domain: event.domain,
    operation: event.operation,
    reasonCode: event.reasonCode,
    traceId: event.traceId,
    timestamp: { seconds: event.timestamp.seconds, nanos: event.timestamp.nanos },
    callerKind: event.callerKind,
  };
}

function timestampNanos(timestamp: { readonly seconds: string; readonly nanos: number }, name: string): bigint {
  if (!/^-?\d+$/u.test(timestamp.seconds) || !Number.isInteger(timestamp.nanos) || timestamp.nanos < 0 || timestamp.nanos > 999_999_999) {
    throw invalidProjection(`${name} is not a valid timestamp`);
  }
  return BigInt(timestamp.seconds) * 1_000_000_000n + BigInt(timestamp.nanos);
}

function assertExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, name: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw invalidProjection(`${name} contains forbidden fields: ${unknown.join(', ')}`);
  }
}

function invalidProjection(message: string): NimiDesktopAuditProjectionContractError {
  return new NimiDesktopAuditProjectionContractError(message);
}
