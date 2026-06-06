import {
  REALM_OPERATIONS,
  type RealmOperationDescriptor,
} from '../core-generated/realm-client';
import type { CoreTransport } from '../core-client';
import { createNimiError, type CoreMetadata, type CoreStreamRequest, type CoreUnaryRequest, type JsonObject, type JsonValue } from '../types';

export interface RealmFetchTransportOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly headers?: CoreMetadata | (() => CoreMetadata | Promise<CoreMetadata>);
  readonly credentials?: RequestCredentials;
}

const REALM_OPERATION_BY_ID = new Map<string, RealmOperationDescriptor>(
  REALM_OPERATIONS.map((operation) => [operation.operationId, operation]),
);

export function createRealmFetchTransport(options: RealmFetchTransportOptions): CoreTransport {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (typeof fetchImpl !== 'function') {
    throw createNimiError({
      message: 'Realm fetch transport requires a fetch implementation.',
      reasonCode: 'SDK_REALM_FETCH_UNAVAILABLE',
      actionHint: 'provide_realm_fetch_transport_fetch',
      source: 'sdk',
    });
  }

  return {
    async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
      const descriptor = describeRealmOperation(request.methodId);
      const requestBody = asRealmFetchRequestBody(request.body);
      const url = createRealmFetchUrl(baseUrl, descriptor, requestBody);
      const headers = await createRealmFetchHeaders(options.headers, request.metadata, requestBody.headers);
      const body = createRealmFetchBody(descriptor, requestBody, headers);
      const response = await fetchImpl(url, {
        method: descriptor.method,
        headers,
        body,
        credentials: options.credentials,
        signal: request.signal,
      });
      request.responseMetadataObserver?.(readRealmFetchResponseMetadata(response));
      return readRealmFetchResponse<Response>(response, descriptor);
    },
    async *serverStream<Response = unknown, Body = unknown>(
      request: CoreStreamRequest<Body>,
    ): AsyncIterable<Response> {
      throw createNimiError({
        message: `Realm fetch transport does not support server streams: ${request.methodId}`,
        reasonCode: 'SDK_REALM_FETCH_STREAM_UNSUPPORTED',
        actionHint: 'use_unary_realm_operation',
        source: 'sdk',
      });
    },
  };
}

function normalizeBaseUrl(value: unknown): string {
  const text = String(value || '').trim().replace(/\/+$/u, '');
  if (!text) {
    throw createNimiError({
      message: 'Realm fetch transport requires a baseUrl.',
      reasonCode: 'SDK_REALM_BASE_URL_REQUIRED',
      actionHint: 'provide_realm_base_url',
      source: 'sdk',
    });
  }
  return text;
}

function describeRealmOperation(operationId: string): RealmOperationDescriptor {
  const descriptor = REALM_OPERATION_BY_ID.get(operationId);
  if (!descriptor || !descriptor.path) {
    throw createNimiError({
      message: `Unknown Realm operation: ${operationId}`,
      reasonCode: 'SDK_REALM_OPERATION_UNKNOWN',
      actionHint: 'regenerate_realm_sdk',
      source: 'sdk',
      details: { operationId },
    });
  }
  return descriptor;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asRealmFetchRequestBody(value: unknown): {
  readonly path: JsonObject;
  readonly query: JsonObject;
  readonly headers: JsonObject;
  readonly body: unknown;
} {
  const record = asRecord(value);
  return {
    path: asRecord(record.path) as JsonObject,
    query: asRecord(record.query) as JsonObject,
    headers: asRecord(record.headers) as JsonObject,
    body: record.body,
  };
}

function createRealmFetchUrl(
  baseUrl: string,
  descriptor: RealmOperationDescriptor,
  request: ReturnType<typeof asRealmFetchRequestBody>,
): string {
  const path = descriptor.path!.replace(/\{([^}]+)\}/gu, (_match, key: string) => {
    const value = request.path[key];
    if (value === undefined || value === null || String(value).length === 0) {
      throw createNimiError({
        message: `Realm operation ${descriptor.operationId} missing path parameter ${key}.`,
        reasonCode: 'SDK_REALM_PATH_PARAMETER_REQUIRED',
        actionHint: 'provide_realm_operation_path_parameter',
        source: 'sdk',
        details: { operationId: descriptor.operationId, parameter: key },
      });
    }
    return encodeURIComponent(String(value));
  });
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(request.query)) {
    appendQueryValue(url, key, value);
  }
  return url.toString();
}

function appendQueryValue(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      appendQueryValue(url, key, item);
    }
    return;
  }
  url.searchParams.append(key, String(value));
}

async function createRealmFetchHeaders(
  baseHeaders: RealmFetchTransportOptions['headers'],
  metadata: CoreMetadata | undefined,
  requestHeaders: Record<string, unknown>,
): Promise<Headers> {
  const headers = new Headers();
  const resolvedBaseHeaders = typeof baseHeaders === 'function' ? await baseHeaders() : baseHeaders;
  appendHeaders(headers, resolvedBaseHeaders);
  appendHeaders(headers, metadata);
  appendHeaders(headers, requestHeaders);
  return headers;
}

function appendHeaders(headers: Headers, values: Record<string, unknown> | undefined): void {
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value !== undefined && value !== null) {
      headers.set(key, String(value));
    }
  }
}

function createRealmFetchBody(
  descriptor: RealmOperationDescriptor,
  request: ReturnType<typeof asRealmFetchRequestBody>,
  headers: Headers,
): string | undefined {
  if (descriptor.method === 'GET' || descriptor.method === 'HEAD') {
    return undefined;
  }
  if (request.body === undefined) {
    return undefined;
  }
  headers.set('content-type', headers.get('content-type') ?? 'application/json');
  return JSON.stringify(request.body);
}

function readRealmFetchResponseMetadata(response: Response): CoreMetadata {
  const metadata: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    metadata[key] = value;
  });
  metadata.status = String(response.status);
  return metadata;
}

async function readRealmFetchResponse<Result>(
  response: Response,
  descriptor: RealmOperationDescriptor,
): Promise<Result> {
  const text = await response.text();
  const payload = text ? parseRealmFetchJson(text, descriptor.operationId) : {};
  if (!response.ok) {
    const errorRecord = asRecord(payload);
    throw createNimiError({
      message: readErrorMessage(errorRecord) || `Realm operation ${descriptor.operationId} failed with HTTP ${response.status}.`,
      reasonCode: readErrorReasonCode(errorRecord) || 'SDK_REALM_HTTP_REQUEST_FAILED',
      actionHint: readErrorActionHint(errorRecord) || 'inspect_realm_http_response',
      source: 'realm',
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      details: {
        operationId: descriptor.operationId,
        status: response.status,
        payload: payload as JsonValue,
      },
    });
  }
  return payload as Result;
}

function parseRealmFetchJson(text: string, operationId: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw createNimiError({
      message: `Realm operation ${operationId} returned invalid JSON.`,
      reasonCode: 'SDK_REALM_RESPONSE_DECODE_FAILED',
      actionHint: 'inspect_realm_http_response',
      source: 'realm',
      details: { operationId },
    });
  }
}

function readErrorMessage(record: Record<string, unknown>): string {
  return String(record.message || record.error || '').trim();
}

function readErrorReasonCode(record: Record<string, unknown>): string {
  return String(record.reasonCode || record.reason_code || record.code || '').trim();
}

function readErrorActionHint(record: Record<string, unknown>): string {
  return String(record.actionHint || record.action_hint || '').trim();
}
