import { NIMI_STANDARD_SHELL_CAPABILITY_IDS, NIMI_STANDARD_SHELL_COMMANDS, type NimiStandardShellCapabilityId } from '@nimiplatform/kit/shell/capabilities';
import {
  createElectronRuntimeEndpointUnavailableError,
  isRuntimeAppGrantInvalidLike,
  isRuntimeEndpointUnavailableLike,
  toElectronRuntimeBridgeError,
} from './errors.js';
import { asRecord, normalizeRequiredToken, normalizeText, parseOptionalPositiveNumber } from './paths.js';
import type {
  ElectronRuntimeBridgeAppSession,
  ElectronRuntimeBridgeCommandNames,
  ElectronRuntimeBridgeMetadata,
  ElectronRuntimeBridgeProtectedAccessToken,
  ElectronRuntimeBridgeStreamOpenRequest,
  ElectronRuntimeBridgeStreamOpenResponse,
  ElectronRuntimeBridgeTrustedMetadata,
  ElectronRuntimeBridgeTrustedMetadataProvider,
  ElectronRuntimeBridgeUnaryRequest,
  ElectronRuntimeBridgeUnaryResponse,
  NimiElectronIpcMainInvokeEvent,
  RuntimeGrpcBridgeClient,
  RuntimeGrpcBridgeStream,
  RuntimeGrpcBridgeUnaryResponse,
} from './types.js';
import { NimiElectronShellHostError } from './types.js';

let electronRuntimeBridgeIdempotencyCounter = 1;

function standardCommand(key: keyof typeof NIMI_STANDARD_SHELL_COMMANDS): string {
  return NIMI_STANDARD_SHELL_COMMANDS[key];
}

export function createElectronRuntimeBridgeCommandNames(
  _commandNamespace = '',
): ElectronRuntimeBridgeCommandNames {
  return {
    unary: standardCommand('runtime.unary'),
    stream_open: standardCommand('runtime.streamOpen'),
    stream_close: standardCommand('runtime.streamClose'),
    status: standardCommand('runtime-lifecycle.status'),
    start: standardCommand('runtime-lifecycle.start'),
    stop: standardCommand('runtime-lifecycle.stop'),
    restart: standardCommand('runtime-lifecycle.restart'),
    config_get: standardCommand('config.get'),
    config_set: standardCommand('config.set'),
  };
}
export const ELECTRON_STANDARD_SHELL_CAPABILITY_IDS = NIMI_STANDARD_SHELL_CAPABILITY_IDS;

export function getElectronStandardShellCapabilityIds(): readonly NimiStandardShellCapabilityId[] {
  return ELECTRON_STANDARD_SHELL_CAPABILITY_IDS;
}
export function createElectronRuntimeBridgeEventName(
  streamId: string,
  eventNamespace = DEFAULT_ELECTRON_RUNTIME_EVENT_NAMESPACE,
): string {
  return `${normalizeRequiredToken(eventNamespace, 'eventNamespace')}:stream:${normalizeRequiredToken(streamId, 'streamId')}`;
}
export async function invokeElectronRuntimeUnary(input: {
  readonly client: RuntimeGrpcBridgeClient;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly appId: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly runtimeEndpoint: string;
  readonly command: string;
  readonly trustedRuntimeMetadataProvider?: ElectronRuntimeBridgeTrustedMetadataProvider;
}): Promise<ElectronRuntimeBridgeUnaryResponse> {
  const request = parseElectronRuntimeUnaryRequest(input.payload);
  let trusted = await resolveTrustedRuntimeMetadata({
    provider: input.trustedRuntimeMetadataProvider,
    command: input.command,
    methodId: request.methodId,
    event: input.event,
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
  });
  let response: RuntimeGrpcBridgeUnaryResponse;
  try {
    response = await input.client.unary({
      methodId: request.methodId,
      requestBytes: fromBase64(request.requestBytesBase64),
      metadata: buildElectronRuntimeGrpcMetadata(request, input.appId, trusted),
      timeoutMs: request.timeoutMs,
    });
  } catch (error) {
    if (shouldRefreshTrustedRuntimeMetadata(input.trustedRuntimeMetadataProvider, error)) {
      input.trustedRuntimeMetadataProvider?.invalidate?.('APP_GRANT_INVALID');
      trusted = await resolveTrustedRuntimeMetadata({
        provider: input.trustedRuntimeMetadataProvider,
        command: input.command,
        methodId: request.methodId,
        event: input.event,
        appId: input.appId,
        runtimeEndpoint: input.runtimeEndpoint,
      });
      try {
        response = await input.client.unary({
          methodId: request.methodId,
          requestBytes: fromBase64(request.requestBytesBase64),
          metadata: buildElectronRuntimeGrpcMetadata(request, input.appId, trusted),
          timeoutMs: request.timeoutMs,
        });
      } catch (retryError) {
        throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, retryError);
      }
    } else {
      throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error);
    }
  }
  return {
    responseBytesBase64: toBase64(response.responseBytes),
    responseMetadata: response.responseMetadata,
  };
}

function shouldRefreshTrustedRuntimeMetadata(
  provider: ElectronRuntimeBridgeTrustedMetadataProvider | undefined,
  error: unknown,
): boolean {
  return typeof provider?.invalidate === 'function' && isRuntimeAppGrantInvalidLike(error);
}

export async function openElectronRuntimeStream(input: {
  readonly client: RuntimeGrpcBridgeClient;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly command: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly eventNamespace: string;
  readonly eventChannelPrefix: string;
  readonly streams: Map<string, RuntimeGrpcBridgeStream>;
  readonly trustedRuntimeMetadataProvider?: ElectronRuntimeBridgeTrustedMetadataProvider;
}): Promise<ElectronRuntimeBridgeStreamOpenResponse> {
  const request = parseElectronRuntimeStreamOpenRequest(input.payload);
  const trusted = await resolveTrustedRuntimeMetadata({
    provider: input.trustedRuntimeMetadataProvider,
    command: input.command,
    methodId: request.methodId,
    event: input.event,
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
  });
  let stream: RuntimeGrpcBridgeStream;
  try {
    stream = input.client.serverStream({
      methodId: request.methodId,
      requestBytes: fromBase64(request.requestBytesBase64),
      metadata: buildElectronRuntimeGrpcMetadata(request, input.appId, trusted),
      timeoutMs: request.timeoutMs,
    });
  } catch (error) {
    throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error);
  }
  const eventName = createElectronRuntimeBridgeEventName(request.streamId, request.eventNamespace || input.eventNamespace);
  const channel = `${input.eventChannelPrefix}${eventName}`;
  input.streams.set(request.streamId, stream);
  try {
    stream.start({
      onData: (bytes) => {
        input.event.sender?.send?.(channel, {
          streamId: request.streamId,
          eventType: 'next',
          payloadBytesBase64: toBase64(bytes),
        });
      },
      onError: (error) => {
        input.streams.delete(request.streamId);
        input.event.sender?.send?.(channel, {
          streamId: request.streamId,
          eventType: 'error',
          error: toElectronRuntimeBridgeError(createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error)),
        });
      },
      onEnd: () => {
        input.streams.delete(request.streamId);
        input.event.sender?.send?.(channel, {
          streamId: request.streamId,
          eventType: 'completed',
        });
      },
    });
  } catch (error) {
    input.streams.delete(request.streamId);
    throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error);
  }
  return { streamId: request.streamId };
}

export function closeElectronRuntimeStream(
  payload: Readonly<Record<string, unknown>>,
  streams: Map<string, RuntimeGrpcBridgeStream>,
): Record<string, never> {
  const streamId = normalizeRequiredToken(payload.streamId, 'streamId');
  const stream = streams.get(streamId);
  if (stream) {
    stream.cancel();
    streams.delete(streamId);
  }
  return {};
}
export function electronRuntimeCommandPayload(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Readonly<Record<string, unknown>> {
  if ('payload' in payload && !('methodId' in payload) && !('streamId' in payload)) {
    return asRecord(payload.payload ?? {}, `Electron Runtime bridge command ${command} nested payload must be an object`);
  }
  return payload;
}
export function parseElectronRuntimeUnaryRequest(payload: Readonly<Record<string, unknown>>): ElectronRuntimeBridgeUnaryRequest {
  assertNoRendererSensitiveRuntimeBridgePayload(payload);
  return {
    methodId: normalizeGrpcMethodId(payload.methodId),
    requestBytesBase64: normalizeBase64Text(payload.requestBytesBase64, 'requestBytesBase64'),
    metadata: parseRuntimeBridgeMetadata(payload.metadata),
    timeoutMs: parseOptionalPositiveNumber(payload.timeoutMs),
  };
}
export function parseElectronRuntimeStreamOpenRequest(
  payload: Readonly<Record<string, unknown>>,
): ElectronRuntimeBridgeStreamOpenRequest {
  return {
    ...parseElectronRuntimeUnaryRequest(payload),
    streamId: normalizeRequiredToken(payload.streamId, 'streamId'),
    eventNamespace: normalizeText(payload.eventNamespace) || undefined,
  };
}
export function buildElectronRuntimeGrpcMetadata(
  request: ElectronRuntimeBridgeUnaryRequest,
  fallbackAppId: string,
  trusted?: ElectronRuntimeBridgeTrustedMetadata,
): Record<string, string> {
  const metadata: Record<string, string> = {};
  addMetadata(metadata, 'x-nimi-protocol-version', request.metadata?.protocolVersion || trusted?.metadata?.protocolVersion || '1.0.0');
  addMetadata(metadata, 'x-nimi-participant-protocol-version', request.metadata?.participantProtocolVersion || trusted?.metadata?.participantProtocolVersion || '1.0.0');
  addMetadata(metadata, 'x-nimi-participant-id', trusted?.metadata?.participantId || fallbackAppId);
  addMetadata(metadata, 'x-nimi-domain', request.metadata?.domain || trusted?.metadata?.domain || 'runtime.rpc');
  addMetadata(metadata, 'x-nimi-app-id', fallbackAppId);
  addMetadata(metadata, 'x-nimi-trace-id', request.metadata?.traceId);
  addMetadata(
    metadata,
    'x-nimi-idempotency-key',
    request.metadata?.idempotencyKey || createElectronRuntimeBridgeIdempotencyKey(request.methodId),
  );
  addMetadata(metadata, 'x-nimi-caller-kind', trusted?.metadata?.callerKind || 'third-party-app');
  addMetadata(metadata, 'x-nimi-caller-id', trusted?.metadata?.callerId || fallbackAppId);
  addMetadata(metadata, 'x-nimi-surface-id', trusted?.metadata?.surfaceId || request.metadata?.surfaceId);
  addMetadata(metadata, 'x-nimi-key-source', request.metadata?.keySource);
  addMetadata(metadata, 'x-nimi-provider-type', request.metadata?.providerType);
  addMetadata(metadata, 'x-nimi-client-id', request.metadata?.clientId);
  addMetadata(metadata, 'x-nimi-provider-endpoint', request.metadata?.providerEndpoint);
  addMetadata(metadata, 'authorization', trusted?.authorization);
  addMetadata(metadata, 'x-nimi-access-token-id', trusted?.protectedAccessToken?.tokenId);
  addMetadata(metadata, 'x-nimi-access-token-secret', trusted?.protectedAccessToken?.secret);
  addMetadata(metadata, 'x-nimi-session-id', trusted?.appSession?.sessionId);
  addMetadata(metadata, 'x-nimi-session-token', trusted?.appSession?.sessionToken);
  for (const [key, value] of Object.entries(trusted?.metadata?.extra ?? {})) {
    const normalizedKey = normalizeText(key).toLowerCase();
    if (!normalizedKey.startsWith('x-nimi-')) {
      throw new NimiElectronShellHostError({
        code: 'invalid-payload',
        message: `Electron trusted Runtime metadata key is not allowed: ${key}`,
        reasonCode: 'electron-trusted-runtime-metadata-key-not-allowed',
        actionHint: 'use_x_nimi_host_metadata_key',
        details: { key },
      });
    }
    addMetadata(metadata, normalizedKey, value);
  }
  for (const [key, value] of Object.entries(request.metadata?.extra ?? {})) {
    assertRendererMetadataKeyAllowed(key);
    const normalizedKey = normalizeText(key).toLowerCase();
    if (!normalizedKey.startsWith('x-nimi-') || RESERVED_METADATA_KEYS.has(normalizedKey)) {
      throw new NimiElectronShellHostError({
        code: 'invalid-payload',
        message: `Electron Runtime bridge metadata extra key is not allowed: ${key}`,
        reasonCode: 'electron-runtime-metadata-extra-key-not-allowed',
        actionHint: 'use_supported_runtime_metadata_field',
        details: { key },
      });
    }
    addMetadata(metadata, normalizedKey, value);
  }
  return metadata;
}

function createElectronRuntimeBridgeIdempotencyKey(methodId: string): string {
  const counter = electronRuntimeBridgeIdempotencyCounter++;
  return `bridge-${methodId.replaceAll('/', '_')}-${Date.now()}-${counter}`;
}

export async function resolveTrustedRuntimeMetadata(input: {
  readonly provider: ElectronRuntimeBridgeTrustedMetadataProvider | undefined;
  readonly command: string;
  readonly methodId: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
}): Promise<ElectronRuntimeBridgeTrustedMetadata | undefined> {
  try {
    return await input.provider?.({
      command: input.command,
      methodId: input.methodId,
      event: input.event,
      appId: input.appId,
      runtimeEndpoint: input.runtimeEndpoint,
    });
  } catch (error) {
    if (isRuntimeEndpointUnavailableLike(error)) {
      throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error);
    }
    throw error;
  }
}
export async function probeElectronRuntimeStatus(input: {
  readonly client: RuntimeGrpcBridgeClient;
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly command: string;
}): Promise<Record<string, unknown>> {
  try {
    const response = await input.client.unary({
      methodId: ELECTRON_RUNTIME_STATUS_METHOD_ID,
      requestBytes: new Uint8Array(),
      metadata: buildElectronRuntimeGrpcMetadata({
        methodId: ELECTRON_RUNTIME_STATUS_METHOD_ID,
        requestBytesBase64: '',
      }, input.appId),
      timeoutMs: ELECTRON_RUNTIME_STATUS_TIMEOUT_MS,
    });
    return {
      running: true,
      managed: false,
      launchMode: 'RUNTIME',
      grpcAddr: input.runtimeEndpoint,
      version: response.responseMetadata?.['x-nimi-runtime-version'],
    };
  } catch (error) {
    throw createElectronRuntimeEndpointUnavailableError(input.command, input.runtimeEndpoint, error);
  }
}
export function resolveElectronRuntimeDefaults(): Record<string, unknown> {
  const realmBaseUrl = normalizeLoopbackHttpUrl(
    electronEnvValue('NIMI_REALM_URL', 'http://localhost:3002'),
    3002,
    true,
  );
  const realmDefaultPort = resolveRealmDefaultPort(realmBaseUrl);
  const normalizedRealmBaseUrl = trimTrailingSlash(realmBaseUrl);
  const defaultJwksUrl = normalizedRealmBaseUrl
    ? `${normalizedRealmBaseUrl}/api/auth/jwks`
    : 'http://localhost:3002/api/auth/jwks';
  const defaultRevocationUrl = normalizedRealmBaseUrl
    ? `${normalizedRealmBaseUrl}/api/auth/sessions/introspect`
    : 'http://localhost:3002/api/auth/sessions/introspect';

  return {
    realm: {
      realmBaseUrl,
      realtimeUrl: electronEnvValue('NIMI_REALTIME_URL', ''),
      accessToken: electronEnvValue('NIMI_ACCESS_TOKEN', ''),
      jwksUrl: normalizeLoopbackHttpUrl(
        electronEnvValue('NIMI_REALM_JWKS_URL', defaultJwksUrl),
        realmDefaultPort,
        true,
      ),
      revocationUrl: normalizeLoopbackHttpUrl(
        electronEnvValue('NIMI_REALM_REVOCATION_URL', defaultRevocationUrl),
        realmDefaultPort,
        true,
      ),
      jwtIssuer: normalizeLoopbackHttpUrl(
        electronEnvValue('NIMI_REALM_JWT_ISSUER', realmBaseUrl),
        realmDefaultPort,
        true,
      ),
      jwtAudience: electronEnvValue('NIMI_REALM_JWT_AUDIENCE', 'nimi-runtime'),
    },
    runtime: {
      targetType: electronEnvValue('NIMI_TARGET_TYPE', ''),
      targetAccountId: electronEnvValue('NIMI_TARGET_ACCOUNT_ID', ''),
      agentId: electronEnvValue('NIMI_AGENT_ID', ''),
      worldId: electronEnvValue('NIMI_WORLD_ID', ''),
      userConfirmedUpload: electronEnvValue('NIMI_USER_CONFIRMED_UPLOAD', '') === '1',
    },
  };
}
function electronEnvValue(key: string, fallback: string): string {
  return normalizeText(process.env[key]) || fallback;
}
function normalizeLoopbackHttpUrl(raw: string, defaultPort: number, trimTrailing: boolean): string {
  const value = normalizeText(raw);
  if (!value) {
    return '';
  }
  let normalized = value;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const isLoopbackHttp = parsed.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1');
    if (isLoopbackHttp && !parsed.port) {
      parsed.port = String(defaultPort);
    }
    normalized = parsed.toString();
  } catch {
    normalized = value;
  }
  return trimTrailing ? trimTrailingSlash(normalized) : normalized;
}
function resolveRealmDefaultPort(realmBaseUrl: string): number {
  try {
    const parsed = new URL(realmBaseUrl);
    if (parsed.port) {
      return Number(parsed.port);
    }
    if (parsed.protocol === 'http:') {
      return 80;
    }
    if (parsed.protocol === 'https:') {
      return 443;
    }
  } catch {
    return 3002;
  }
  return 3002;
}
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '');
}
const RESERVED_METADATA_KEYS = new Set([
  'authorization',
  'x-nimi-protocol-version',
  'x-nimi-participant-protocol-version',
  'x-nimi-participant-id',
  'x-nimi-domain',
  'x-nimi-app-id',
  'x-nimi-trace-id',
  'x-nimi-idempotency-key',
  'x-nimi-caller-kind',
  'x-nimi-caller-id',
  'x-nimi-surface-id',
  'x-nimi-key-source',
  'x-nimi-provider-type',
  'x-nimi-client-id',
  'x-nimi-provider-endpoint',
  'x-nimi-provider-api-key',
  'x-nimi-access-token-id',
  'x-nimi-access-token-secret',
  'x-nimi-session-id',
  'x-nimi-session-token',
  'x-nimi-source-host',
  'x-nimi-app-instance-id',
  'x-nimi-device-id',
  'x-nimi-launch-host-id',
  'x-nimi-launch-nonce',
  'x-nimi-release-descriptor-ref',
  'x-nimi-capability-set-ref',
]);
function normalizeGrpcMethodId(value: unknown): string {
  const methodId = normalizeRequiredToken(value, 'methodId');
  if (!methodId.startsWith('/')) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Runtime gRPC method id must be absolute: ${methodId}`,
      reasonCode: 'electron-runtime-method-id-not-absolute',
      actionHint: 'use_generated_runtime_method_id',
      details: { methodId },
    });
  }
  return methodId;
}
function normalizeBase64Text(value: unknown, field: string): string {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  if (!BASE64_PATTERN.test(text)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `${field} must be base64`,
      reasonCode: 'electron-runtime-bytes-not-base64',
      actionHint: 'encode_runtime_bridge_bytes_as_base64',
      details: { field },
    });
  }
  return text;
}
function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}
function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}
function parseRuntimeBridgeMetadata(value: unknown): ElectronRuntimeBridgeMetadata | undefined {
  if (value == null) {
    return undefined;
  }
  const record = asRecord(value, 'Electron Runtime bridge metadata must be an object');
  assertNoRendererSensitiveMetadata(record);
  const extraRecord = record.extra == null
    ? undefined
    : asRecord(record.extra, 'Electron Runtime bridge metadata extra must be an object');
  return {
    protocolVersion: normalizeText(record.protocolVersion) || undefined,
    participantProtocolVersion: normalizeText(record.participantProtocolVersion) || undefined,
    domain: normalizeText(record.domain) || undefined,
    traceId: normalizeText(record.traceId) || undefined,
    idempotencyKey: normalizeText(record.idempotencyKey) || undefined,
    surfaceId: normalizeText(record.surfaceId) || undefined,
    keySource: normalizeText(record.keySource) || undefined,
    providerType: normalizeText(record.providerType) || undefined,
    clientId: normalizeText(record.clientId) || undefined,
    providerEndpoint: normalizeText(record.providerEndpoint) || undefined,
    extra: extraRecord ? normalizeMetadataExtra(extraRecord) : undefined,
  };
}
function normalizeMetadataExtra(record: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  assertNoRendererSensitiveMetadataExtra(record);
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const normalizedValue = normalizeText(value);
    if (normalizedValue) {
      extra[key] = normalizedValue;
    }
  }
  return extra;
}
function parseProtectedAccessToken(value: unknown): ElectronRuntimeBridgeProtectedAccessToken | undefined {
  if (value == null) {
    return undefined;
  }
  const record = asRecord(value, 'Electron Runtime bridge protected access token must be an object');
  const tokenId = normalizeText(record.tokenId);
  const secret = normalizeText(record.secret);
  return tokenId && secret ? { tokenId, secret } : undefined;
}
function parseAppSession(value: unknown): ElectronRuntimeBridgeAppSession | undefined {
  if (value == null) {
    return undefined;
  }
  const record = asRecord(value, 'Electron Runtime bridge app session must be an object');
  const sessionId = normalizeText(record.sessionId);
  const sessionToken = normalizeText(record.sessionToken);
  return sessionId && sessionToken ? { sessionId, sessionToken } : undefined;
}
function addMetadata(target: Record<string, string>, key: string, value: unknown): void {
  const normalized = normalizeText(value);
  if (normalized) {
    target[key] = normalized;
  }
}
export function assertNoRendererSensitiveRuntimeBridgePayload(payload: Readonly<Record<string, unknown>>): void {
  for (const key of ['authorization', 'protectedAccessToken', 'appSession']) {
    if (payload[key] !== undefined && payload[key] !== null) {
      throw new NimiElectronShellHostError({
        code: 'forbidden-renderer-access',
        message: `Electron Runtime bridge renderer payload cannot provide sensitive field: ${key}`,
        reasonCode: 'electron-renderer-sensitive-runtime-field-forbidden',
        actionHint: 'provide_sensitive_runtime_metadata_from_electron_host',
        details: { field: key },
      });
    }
  }
}
export function assertNoRendererLocalAgentCallerPayload(payload: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(payload)) {
    const normalized = key.toLowerCase().replace(/[-_]/gu, '');
    const forbiddenKind = rendererForbiddenMetadataKind(normalized);
    if (!forbiddenKind) {
      continue;
    }
    throw new NimiElectronShellHostError({
      code: 'forbidden-renderer-access',
      message: `Electron local-agent renderer payload cannot provide host-owned ${forbiddenKind} field: ${key}`,
      reasonCode: 'electron-renderer-local-agent-caller-field-forbidden',
      actionHint: forbiddenKind === 'identity'
        ? 'derive_runtime_trusted_caller_from_electron_host'
        : 'provide_sensitive_runtime_metadata_from_electron_host',
      details: { field: key },
    });
  }
}
export function assertNoRendererSensitiveMetadata(record: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(record)) {
    if (key === 'extra') {
      continue;
    }
    assertRendererMetadataKeyAllowed(key);
  }
}
function assertNoRendererSensitiveMetadataExtra(record: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(record)) {
    assertRendererMetadataKeyAllowed(key);
  }
}
function assertRendererMetadataKeyAllowed(key: string): void {
  const normalized = key.toLowerCase().replace(/[-_]/gu, '');
  const forbiddenKind = rendererForbiddenMetadataKind(normalized);
  if (!forbiddenKind) {
    return;
  }
  throw new NimiElectronShellHostError({
    code: 'forbidden-renderer-access',
    message: `Electron Runtime bridge renderer metadata cannot provide host-owned ${forbiddenKind} field: ${key}`,
    reasonCode: `electron-renderer-host-owned-${forbiddenKind}-metadata-forbidden`,
    actionHint: forbiddenKind === 'identity'
      ? 'provide_identity_metadata_from_electron_host'
      : 'provide_sensitive_runtime_metadata_from_electron_host',
    details: { field: key },
  });
}
function rendererForbiddenMetadataKind(key: string): 'auth' | 'identity' | undefined {
  if (RENDERER_FORBIDDEN_IDENTITY_METADATA_KEYS.has(key)) {
    return 'identity';
  }
  if (
    RENDERER_FORBIDDEN_AUTH_METADATA_KEYS.has(key)
    || key.includes('authorization')
    || key.includes('accesstoken')
    || key.includes('session')
    || key.includes('providerapikey')
    || key.includes('secret')
  ) {
    return 'auth';
  }
  return undefined;
}
const ELECTRON_RUNTIME_STATUS_METHOD_ID = '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth';
const ELECTRON_RUNTIME_STATUS_TIMEOUT_MS = 1_000;
const DEFAULT_ELECTRON_RUNTIME_EVENT_NAMESPACE = 'nimi.shell.runtime';
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const RENDERER_FORBIDDEN_IDENTITY_METADATA_KEYS = new Set([
  'appid',
  'participantid',
  'callerkind',
  'callerid',
  'xnimiappid',
  'xnimiparticipantid',
  'xnimicallerkind',
  'xnimicallerid',
  'xnimisourcehost',
  'xnimiappinstanceid',
  'xnimideviceid',
  'xnimilaunchhostid',
  'xnimilaunchnonce',
  'xnimireleasedescriptorref',
  'xnimicapabilitysetref',
]);
const RENDERER_FORBIDDEN_AUTH_METADATA_KEYS = new Set([
  'authorization',
  'protectedaccesstoken',
  'appsession',
  'accesstokenid',
  'accesstokensecret',
  'sessionid',
  'sessiontoken',
  'providerapikey',
  'xnimiauthorization',
  'xnimiprotectedaccesstoken',
  'xnimiappsession',
  'xnimiaccesstokenid',
  'xnimiaccesstokensecret',
  'xnimisessionid',
  'xnimisessiontoken',
  'xnimiproviderapikey',
]);
