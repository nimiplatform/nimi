import {
  CONNECTOR_AUTH_ACQUISITION_PROFILES,
  type ConnectorAuthAcquisitionProfileSpec,
} from '@nimiplatform/sdk/runtime';
import {
  NimiElectronShellHostError,
  type NimiElectronCommandHandlerInput,
} from '@nimiplatform/kit/shell/electron/main';

const COMMAND = 'http_request' as const;
const REQUEST_TIMEOUT_MS = 20_000;
const RATE_LIMIT_WINDOW_MS = 5_000;
const RATE_LIMIT_BURST = 32;
const MAX_URL_BYTES = 8 * 1024;
const MAX_HEADER_NAME_BYTES = 128;
const MAX_HEADER_VALUE_BYTES = 8 * 1024;
const MAX_HEADER_TOTAL_BYTES = 32 * 1024;
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 16 * 1024 * 1024;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const PURPOSES = new Set(['device_authorization', 'device_token']);
const RESPONSE_HEADERS_RESTRICTED = new Set(['set-cookie', 'set-cookie2']);
const REQUEST_KEYS = [
  'body',
  'connectorAuthProfileId',
  'connectorAuthPurpose',
  'diagnosticSessionId',
  'headers',
  'method',
  'url',
] as const;
const LOOPBACK_ORIGINS = [
  'http://localhost',
  'http://127.0.0.1',
  'http://[::1]',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'http://[::1]:3002',
] as const;

type ConnectorAuthPurpose = 'device_authorization' | 'device_token';

type HttpRequest = {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body?: string;
  readonly connectorAuthProfileId?: string;
  readonly connectorAuthPurpose?: ConnectorAuthPurpose;
};

export type DesktopElectronHttpResponse = {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
};

export type DesktopElectronHttpHost = {
  readonly commandHandlers: Readonly<Record<
    typeof COMMAND,
    (context: Pick<NimiElectronCommandHandlerInput, 'payload'>) => Promise<DesktopElectronHttpResponse>
  >>;
};

type FetchRequest = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createDesktopElectronHttpHost(input: {
  readonly realmBaseUrl: string;
  readonly fetch?: FetchRequest;
  readonly now?: () => number;
}): DesktopElectronHttpHost {
  const realmOrigins = realmOriginsFor(input.realmBaseUrl);
  const ordinaryOrigins = new Set([...LOOPBACK_ORIGINS, ...realmOrigins]);
  const requestHistory = new Map<string, number[]>();
  const send = input.fetch ?? globalThis.fetch;
  const now = input.now ?? (() => performance.now());

  return {
    commandHandlers: {
      [COMMAND]: async ({ payload }) => {
        if (typeof send !== 'function') {
          throw httpError({
            code: 'capability-unavailable',
            reasonCode: 'DESKTOP_HTTP_FETCH_UNAVAILABLE',
            actionHint: 'use_supported_electron_runtime',
            message: 'Electron main-process fetch is unavailable.',
          });
        }

        const request = parseRequest(payload);
        const origin = request.url.origin;
        const hasConnectorAuthMetadata = request.connectorAuthProfileId !== undefined
          || request.connectorAuthPurpose !== undefined;
        if (hasConnectorAuthMetadata) {
          assertConnectorAuthRequestAllowed(request);
        } else if (!ordinaryOrigins.has(origin)) {
          throw httpError({
            code: 'runtime-permission-denied',
            reasonCode: 'DESKTOP_HTTP_ORIGIN_FORBIDDEN',
            actionHint: 'use_admitted_desktop_http_origin',
            message: 'Desktop HTTP target origin is not admitted.',
            details: { origin },
          });
        }

        enforceRateLimit(requestHistory, origin, now());

        const init: RequestInit = {
          method: request.method,
          headers: request.headers,
          redirect: 'manual',
          credentials: 'omit',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        };
        if (request.method !== 'GET' && request.method !== 'HEAD' && request.body !== undefined) {
          init.body = request.body;
        }

        try {
          const response = await send(request.url, init);
          const body = await readBoundedResponseBody(response);
          return Object.freeze({
            status: response.status,
            ok: response.ok,
            headers: responseHeadersForRenderer(response.headers),
            body,
          });
        } catch (error: unknown) {
          if (error instanceof NimiElectronShellHostError) {
            throw error;
          }
          const realmRequest = realmOrigins.has(origin);
          throw httpError({
            code: realmRequest ? 'runtime-service-unavailable' : 'host-internal-error',
            reasonCode: realmRequest ? 'REALM_UNAVAILABLE' : 'DESKTOP_HTTP_SEND_FAILED',
            actionHint: realmRequest ? 'check_realm_service_status' : 'retry_or_check_network',
            message: realmRequest
              ? 'Realm service is unavailable.'
              : 'Desktop HTTP request could not be sent.',
            details: { origin },
            retryable: true,
          });
        }
      },
    },
  };
}

function parseRequest(payload: Readonly<Record<string, unknown>>): HttpRequest {
  const envelope = exactRecord(
    payload,
    ['payload'],
    ['payload'],
    'DESKTOP_HTTP_PAYLOAD_INVALID',
  );
  const request = exactRecord(
    envelope.payload,
    ['url'],
    REQUEST_KEYS,
    'DESKTOP_HTTP_PAYLOAD_INVALID',
  );
  const url = parseHttpUrl(request.url);
  const method = parseMethod(request.method);
  const headers = parseHeaders(request.headers);
  const body = optionalString(request.body, 'DESKTOP_HTTP_PAYLOAD_INVALID');
  if (body !== undefined) {
    assertByteLimit('body', body, MAX_REQUEST_BODY_BYTES);
  }
  optionalDiagnosticSessionId(request.diagnosticSessionId);
  const connectorAuthProfileId = optionalString(
    request.connectorAuthProfileId,
    'DESKTOP_HTTP_PAYLOAD_INVALID',
  );
  const connectorAuthPurpose = optionalConnectorAuthPurpose(request.connectorAuthPurpose);
  return {
    url,
    method,
    headers,
    body,
    connectorAuthProfileId,
    connectorAuthPurpose,
  };
}

function parseHttpUrl(value: unknown): URL {
  if (typeof value !== 'string' || !value) {
    throw httpError({
      code: 'invalid-payload',
      reasonCode: 'DESKTOP_HTTP_URL_REQUIRED',
      actionHint: 'provide_desktop_http_url',
      message: 'Desktop HTTP URL is required.',
    });
  }
  if (value.trim() !== value) {
    throw httpError({
      code: 'invalid-payload',
      reasonCode: 'DESKTOP_HTTP_PAYLOAD_INVALID',
      actionHint: 'provide_exact_desktop_http_payload',
      message: 'Desktop HTTP URL must not contain surrounding whitespace.',
    });
  }
  assertByteLimit('url', value, MAX_URL_BYTES);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw httpError({
      code: 'invalid-payload',
      reasonCode: 'DESKTOP_HTTP_PAYLOAD_INVALID',
      actionHint: 'provide_valid_desktop_http_url',
      message: 'Desktop HTTP URL is invalid.',
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw httpError({
      code: 'invalid-payload',
      reasonCode: 'DESKTOP_HTTP_URL_SCHEME_INVALID',
      actionHint: 'use_http_or_https_url',
      message: 'Desktop HTTP URL must use http or https.',
    });
  }
  if (!url.hostname) {
    throw httpError({
      code: 'invalid-payload',
      reasonCode: 'DESKTOP_HTTP_URL_HOST_MISSING',
      actionHint: 'provide_desktop_http_url_host',
      message: 'Desktop HTTP URL host is required.',
    });
  }
  if (url.username || url.password) {
    throw httpError({
      code: 'runtime-permission-denied',
      reasonCode: 'DESKTOP_HTTP_HEADER_RESTRICTED',
      actionHint: 'remove_renderer_supplied_credentials',
      message: 'Desktop HTTP URL credentials are forbidden.',
    });
  }
  return url;
}

function parseMethod(value: unknown): string {
  if (value === undefined) return 'GET';
  if (typeof value !== 'string' || value.trim() !== value) {
    throw httpError({
      code: 'invalid-payload',
      reasonCode: 'DESKTOP_HTTP_METHOD_INVALID',
      actionHint: 'use_supported_desktop_http_method',
      message: 'Desktop HTTP method is invalid.',
    });
  }
  const method = value.toUpperCase();
  if (!METHODS.has(method)) {
    throw httpError({
      code: 'invalid-payload',
      reasonCode: 'DESKTOP_HTTP_METHOD_INVALID',
      actionHint: 'use_supported_desktop_http_method',
      message: `Desktop HTTP method is not supported: ${method}.`,
    });
  }
  return method;
}

function parseHeaders(value: unknown): Headers {
  if (value === undefined) return new Headers();
  if (!isRecord(value)) {
    throw httpError({
      code: 'invalid-payload',
      reasonCode: 'DESKTOP_HTTP_PAYLOAD_INVALID',
      actionHint: 'provide_exact_desktop_http_payload',
      message: 'Desktop HTTP headers must be an object of string values.',
    });
  }
  const result = new Headers();
  let totalBytes = 0;
  for (const [rawName, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') {
      throw httpError({
        code: 'invalid-payload',
        reasonCode: 'DESKTOP_HTTP_PAYLOAD_INVALID',
        actionHint: 'provide_exact_desktop_http_payload',
        message: 'Desktop HTTP header values must be strings.',
      });
    }
    const normalizedName = rawName.trim().toLowerCase();
    if (
      !normalizedName
      || rawName !== rawName.trim()
      || isRestrictedHeader(normalizedName)
    ) {
      throw httpError({
        code: 'runtime-permission-denied',
        reasonCode: 'DESKTOP_HTTP_HEADER_RESTRICTED',
        actionHint: 'remove_restricted_renderer_http_header',
        message: 'Desktop renderer cannot override restricted HTTP headers.',
        details: { headerName: normalizedName || '[empty]' },
      });
    }
    const nameBytes = utf8ByteLength(rawName);
    const valueBytes = utf8ByteLength(rawValue);
    if (nameBytes > MAX_HEADER_NAME_BYTES) {
      requestTooLarge('headerName', nameBytes, MAX_HEADER_NAME_BYTES);
    }
    if (valueBytes > MAX_HEADER_VALUE_BYTES) {
      requestTooLarge('headerValue', valueBytes, MAX_HEADER_VALUE_BYTES);
    }
    totalBytes += nameBytes + valueBytes + 4;
    if (totalBytes > MAX_HEADER_TOTAL_BYTES) {
      requestTooLarge('headers', totalBytes, MAX_HEADER_TOTAL_BYTES);
    }
    try {
      result.set(rawName, rawValue);
    } catch {
      throw httpError({
        code: 'invalid-payload',
        reasonCode: 'DESKTOP_HTTP_PAYLOAD_INVALID',
        actionHint: 'provide_valid_desktop_http_headers',
        message: 'Desktop HTTP header name or value is invalid.',
      });
    }
  }
  return result;
}

function isRestrictedHeader(name: string): boolean {
  return name === 'authorization'
    || name === 'connection'
    || name === 'content-length'
    || name === 'cookie'
    || name === 'cookie2'
    || name === 'origin'
    || name === 'referer'
    || name === 'forwarded'
    || name === 'host'
    || name === 'proxy-authorization'
    || name === 'te'
    || name === 'trailer'
    || name === 'transfer-encoding'
    || name === 'upgrade'
    || name === 'via'
    || name === 'x-real-ip'
    || name.startsWith('access-control-request-')
    || name === 'proxy'
    || name.startsWith('proxy-')
    || name.startsWith('sec-')
    || name === 'x-forwarded'
    || name.startsWith('x-forwarded-');
}

function optionalString(value: unknown, reasonCode: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw httpError({
      code: 'invalid-payload',
      reasonCode,
      actionHint: 'provide_exact_desktop_http_payload',
      message: 'Desktop HTTP optional string field is invalid.',
    });
  }
  return value;
}

function optionalDiagnosticSessionId(value: unknown): void {
  if (value === undefined) return;
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > 256
  ) {
    throw httpError({
      code: 'invalid-payload',
      reasonCode: 'DESKTOP_HTTP_PAYLOAD_INVALID',
      actionHint: 'provide_exact_desktop_http_payload',
      message: 'Desktop HTTP diagnostic session ID is invalid.',
    });
  }
}

function optionalConnectorAuthPurpose(value: unknown): ConnectorAuthPurpose | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !PURPOSES.has(value)) {
    throw httpError({
      code: 'invalid-payload',
      reasonCode: 'DESKTOP_HTTP_PAYLOAD_INVALID',
      actionHint: 'provide_exact_desktop_http_payload',
      message: 'Desktop connector-auth acquisition purpose is invalid.',
    });
  }
  return value as ConnectorAuthPurpose;
}

function assertConnectorAuthRequestAllowed(request: HttpRequest): void {
  const profileId = request.connectorAuthProfileId;
  const purpose = request.connectorAuthPurpose;
  const profile = profileId && Object.hasOwn(CONNECTOR_AUTH_ACQUISITION_PROFILES, profileId)
    ? CONNECTOR_AUTH_ACQUISITION_PROFILES[profileId]
    : undefined;
  if (!profile || !purpose || request.method !== 'POST') {
    connectorAuthDenied(profileId, purpose);
  }
  const expectedUrl = acquisitionUrl(profile, purpose);
  if (request.url.href !== new URL(expectedUrl).href) {
    connectorAuthDenied(profileId, purpose);
  }
}

function acquisitionUrl(
  profile: ConnectorAuthAcquisitionProfileSpec,
  purpose: ConnectorAuthPurpose,
): string {
  return purpose === 'device_authorization'
    ? profile.deviceAuthorizationUrl
    : profile.deviceTokenUrl;
}

function connectorAuthDenied(
  profileId: string | undefined,
  purpose: ConnectorAuthPurpose | undefined,
): never {
  throw httpError({
    code: 'runtime-permission-denied',
    reasonCode: 'DESKTOP_HTTP_CONNECTOR_AUTH_NOT_ADMITTED',
    actionHint: 'use_exact_connector_auth_acquisition_profile',
    message: 'Desktop connector-auth acquisition request is not admitted.',
    details: {
      profileId: profileId ?? '',
      purpose: purpose ?? '',
    },
  });
}

function realmOriginsFor(realmBaseUrl: string): Set<string> {
  const realm = parseHttpUrl(realmBaseUrl);
  const origins = new Set([realm.origin]);
  if (realm.hostname === 'localhost') {
    realm.hostname = '127.0.0.1';
    origins.add(realm.origin);
  } else if (realm.hostname === '127.0.0.1') {
    realm.hostname = 'localhost';
    origins.add(realm.origin);
  }
  return origins;
}

function enforceRateLimit(
  histories: Map<string, number[]>,
  origin: string,
  now: number,
): void {
  if (!Number.isFinite(now) || now < 0) {
    throw httpError({
      code: 'host-internal-error',
      reasonCode: 'DESKTOP_HTTP_CLOCK_INVALID',
      actionHint: 'restart_desktop',
      message: 'Desktop HTTP rate-limit clock is invalid.',
    });
  }
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const previous = histories.get(origin) ?? [];
  const lastTimestamp = previous.at(-1);
  const current = lastTimestamp !== undefined && now < lastTimestamp
    ? []
    : previous.filter((timestamp) => timestamp > cutoff);
  if (current.length >= RATE_LIMIT_BURST) {
    histories.set(origin, current);
    throw httpError({
      code: 'resource-exhausted',
      reasonCode: 'DESKTOP_HTTP_RATE_LIMITED',
      actionHint: 'retry_after_rate_limit_window',
      message: 'Desktop HTTP request rate limit exceeded.',
      details: {
        origin,
        windowMilliseconds: RATE_LIMIT_WINDOW_MS,
        burst: RATE_LIMIT_BURST,
      },
      retryable: true,
    });
  }
  current.push(now);
  histories.set(origin, current);
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let receivedBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      receivedBytes += next.value.byteLength;
      if (receivedBytes > MAX_RESPONSE_BODY_BYTES) {
        responseTooLarge(receivedBytes);
      }
      body += decoder.decode(next.value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } catch (error: unknown) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function responseHeadersForRenderer(headers: Headers): Readonly<Record<string, string>> {
  const admitted: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    if (!RESPONSE_HEADERS_RESTRICTED.has(name.trim().toLowerCase())) {
      admitted[name] = value;
    }
  }
  return Object.freeze(admitted);
}

function assertByteLimit(field: string, value: string, limitBytes: number): void {
  const actualBytes = utf8ByteLength(value);
  if (actualBytes > limitBytes) {
    requestTooLarge(field, actualBytes, limitBytes);
  }
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function requestTooLarge(field: string, actualBytes: number, limitBytes: number): never {
  throw httpError({
    code: 'resource-exhausted',
    reasonCode: 'DESKTOP_HTTP_REQUEST_TOO_LARGE',
    actionHint: 'reduce_desktop_http_request_size',
    message: 'Desktop HTTP request exceeds a fixed size boundary.',
    details: { field, actualBytes, limitBytes },
    retryable: false,
  });
}

function responseTooLarge(actualBytes: number): never {
  throw httpError({
    code: 'resource-exhausted',
    reasonCode: 'DESKTOP_HTTP_RESPONSE_TOO_LARGE',
    actionHint: 'use_bounded_desktop_http_response',
    message: 'Desktop HTTP response exceeds the fixed body size boundary.',
    details: {
      actualBytes,
      limitBytes: MAX_RESPONSE_BODY_BYTES,
    },
    retryable: false,
  });
}

function exactRecord(
  value: unknown,
  requiredKeys: readonly string[],
  allowedKeys: readonly string[],
  reasonCode: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    invalidRecord(reasonCode);
  }
  const allowed = new Set(allowedKeys);
  const keys = Object.keys(value);
  if (
    requiredKeys.some((key) => !Object.hasOwn(value, key))
    || keys.some((key) => !allowed.has(key))
  ) {
    invalidRecord(reasonCode);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidRecord(reasonCode: string): never {
  throw httpError({
    code: 'invalid-payload',
    reasonCode,
    actionHint: 'provide_exact_desktop_http_payload',
    message: 'Desktop HTTP payload is invalid.',
  });
}

type HttpErrorInput = ConstructorParameters<typeof NimiElectronShellHostError>[0] & {
  readonly retryable?: boolean;
};

function httpError(input: HttpErrorInput): NimiElectronShellHostError {
  const error = new NimiElectronShellHostError(input);
  if (input.retryable !== undefined) {
    Object.assign(error, { retryable: input.retryable });
  }
  return error;
}
