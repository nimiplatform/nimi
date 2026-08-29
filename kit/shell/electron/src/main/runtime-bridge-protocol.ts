import { runtimeRpcAuthPosture } from '@nimiplatform/sdk/runtime/generated';
import { asRecord, normalizeRequiredToken, normalizeText, parseOptionalPositiveNumber } from './paths.js';
import type {
  ElectronRuntimeBridgeAppSession,
  ElectronRuntimeBridgeMetadata,
  ElectronRuntimeBridgeStreamOpenRequest,
  ElectronRuntimeBridgeTrustedMetadata,
  ElectronRuntimeBridgeUnaryRequest,
} from './types.js';
import { NimiElectronShellHostError } from './types.js';

let electronRuntimeBridgeIdempotencyCounter = 1;

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
  if ('cancel' in payload) {
    throw invalidUnaryCancellationPayload();
  }
  return {
    methodId: normalizeGrpcMethodId(payload.methodId),
    requestId: parseOptionalRuntimeUnaryRequestId(payload.requestId),
    requestBytesBase64: normalizeBase64Text(payload.requestBytesBase64, 'requestBytesBase64'),
    productIntent: normalizeText(payload.productIntent) || undefined,
    metadata: parseRuntimeBridgeMetadata(payload.metadata),
    timeoutMs: parseOptionalPositiveNumber(payload.timeoutMs),
  };
}

export function parseElectronRuntimeUnaryCancelRequest(
  payload: Readonly<Record<string, unknown>>,
): { readonly requestId: string } {
  if (payload.cancel !== true
    || Object.keys(payload).length !== 2
    || !Object.prototype.hasOwnProperty.call(payload, 'requestId')) {
    throw invalidUnaryCancellationPayload();
  }
  const requestId = parseOptionalRuntimeUnaryRequestId(payload.requestId);
  if (!requestId) {
    throw invalidUnaryCancellationPayload();
  }
  return { requestId };
}

function parseOptionalRuntimeUnaryRequestId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const requestId = normalizeRequiredToken(value, 'requestId');
  if (requestId.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(requestId)) {
    throw invalidUnaryCancellationPayload();
  }
  return requestId;
}

function invalidUnaryCancellationPayload(): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'invalid-payload',
    message: 'Electron Runtime unary cancellation requires an exact bounded request identity',
    reasonCode: 'electron-runtime-unary-cancellation-invalid',
    actionHint: 'use_original_runtime_unary_request_id',
  });
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
  addMetadata(metadata, 'x-nimi-client-id', request.metadata?.clientId);
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
    if (isRetiredCallerAIInputMetadataKey(normalizedKey)) {
      throw new NimiElectronShellHostError({
        code: 'invalid-payload',
        message: `Electron trusted Runtime metadata key is retired: ${key}`,
        reasonCode: 'electron-runtime-caller-ai-input-metadata-retired',
        actionHint: 'remove_caller_selected_ai_execution_metadata',
        details: { key },
      });
    }
    if (TRUSTED_RUNTIME_PORTABLE_CREDENTIAL_METADATA_KEYS.has(normalizedKey)) {
      throw new NimiElectronShellHostError({
        code: 'invalid-payload',
        message: `Electron trusted Runtime metadata key is not allowed: ${key}`,
        reasonCode: 'electron-trusted-runtime-metadata-key-not-allowed',
        actionHint: 'use_runtime_owned_protected_carrier',
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

export function assertElectronGenericRuntimeMethodAllowed(methodId: string): void {
  const posture = runtimeRpcAuthPosture(methodId);
  if (!posture || !GENERIC_BRIDGE_BLOCKED_RPC_POSTURES.has(posture)) {
    return;
  }
  throw new NimiElectronShellHostError({
    code: 'forbidden-renderer-access',
    message: `Electron generic Runtime bridge cannot carry ${posture} method: ${methodId}`,
    reasonCode: 'electron-runtime-method-requires-protected-carrier',
    actionHint: 'use_protected_desktop_control_carrier',
    details: { methodId, posture },
  });
}

export function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

export function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
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

export function assertNoRendererSensitiveMetadata(record: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(record)) {
    if (key === 'extra') {
      continue;
    }
    assertRendererMetadataKeyAllowed(key);
  }
}

function createElectronRuntimeBridgeIdempotencyKey(methodId: string): string {
  const counter = electronRuntimeBridgeIdempotencyCounter++;
  return `bridge-${methodId.replaceAll('/', '_')}-${Date.now()}-${counter}`;
}

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
  if (!isStrictBase64Text(text)) {
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

function isStrictBase64Text(value: string): boolean {
  if (value.length % 4 !== 0) {
    return false;
  }
  let payloadLength = value.length;
  if (value.endsWith('==')) {
    payloadLength -= 2;
  } else if (value.endsWith('=')) {
    payloadLength -= 1;
  }
  for (let index = 0; index < payloadLength; index += 1) {
    const code = value.charCodeAt(index);
    if (
      (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || code === 43
      || code === 47
    ) {
      continue;
    }
    return false;
  }
  for (let index = payloadLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) {
      return false;
    }
  }
  return true;
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
    clientId: normalizeText(record.clientId) || undefined,
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

function assertNoRendererSensitiveMetadataExtra(record: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(record)) {
    assertRendererMetadataKeyAllowed(key);
  }
}

function assertRendererMetadataKeyAllowed(key: string): void {
  if (isRetiredCallerAIInputMetadataKey(key)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Electron Runtime bridge caller AI input metadata is retired: ${key}`,
      reasonCode: 'electron-runtime-caller-ai-input-metadata-retired',
      actionHint: 'remove_caller_selected_ai_execution_metadata',
      details: { field: key },
    });
  }
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

const RETIRED_CALLER_AI_INPUT_METADATA_KEYS = new Set([
  'keysource',
  'providertype',
  'providerendpoint',
  'providerapikey',
]);

function isRetiredCallerAIInputMetadataKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  const suffix = normalized.startsWith('x-nimi-') ? normalized.slice('x-nimi-'.length) : normalized;
  return RETIRED_CALLER_AI_INPUT_METADATA_KEYS.has(suffix.replace(/[-_]/gu, ''));
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
  'x-nimi-client-id',
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
const TRUSTED_RUNTIME_PORTABLE_CREDENTIAL_METADATA_KEYS = new Set([
  'x-nimi-access-token-id',
  'x-nimi-access-token-secret',
]);
const GENERIC_BRIDGE_BLOCKED_RPC_POSTURES = new Set([
  'protected_origin_required',
  'blocked_pending_authority',
  'deny_all_tombstone',
]);
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
