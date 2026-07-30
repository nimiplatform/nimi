import { BridgeError, invokeChecked } from './invoke.js';
import { listenShell } from './tauri-api.js';
import { assertRecord, type JsonObject } from './types.js';
import {
  AccountReasonCode,
  AccountSessionState,
  RuntimeReasonCode,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  BeginLoginResponse,
  CompleteLoginResponse,
  GetAccountSessionStatusResponse,
  InvokeRealmUnaryResponse,
  LogoutResponse,
  SwitchAccountResponse,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  isNimiStandardShellErrorEnvelope,
  type NimiStandardShellErrorCode,
  type NimiStandardShellErrorEnvelope,
} from '@nimiplatform/kit/shell/capabilities';

const DESKTOP_ACCOUNT_SESSION_STATUS_COMMAND = 'runtime_account_session_status';
const DESKTOP_ACCOUNT_SESSION_EVENTS_OPEN_COMMAND = 'runtime_account_session_events_open';
const DESKTOP_ACCOUNT_SESSION_EVENTS_CLOSE_COMMAND = 'runtime_account_session_events_close';
const DESKTOP_ACCOUNT_SESSION_EVENTS_EVENT = 'runtime_account_session_events';
const DESKTOP_ACCOUNT_BEGIN_LOGIN_COMMAND = 'runtime_account_begin_login';
const DESKTOP_ACCOUNT_COMPLETE_LOGIN_COMMAND = 'runtime_account_complete_login';
const DESKTOP_ACCOUNT_INVOKE_REALM_UNARY_COMMAND = 'runtime_account_invoke_realm_unary';
const DESKTOP_ACCOUNT_LOGOUT_COMMAND = 'runtime_account_logout';
const DESKTOP_ACCOUNT_SWITCH_COMMAND = 'runtime_account_switch_account';
const MAX_ACCOUNT_EVENT_PREOPEN_BUFFER = 1_024;

export type DesktopAccountSessionState =
  | 'anonymous'
  | 'login-pending'
  | 'authenticated'
  | 'refresh-pending'
  | 'expired'
  | 'reauth-required'
  | 'switching'
  | 'logging-out'
  | 'unavailable';

export type DesktopAccountProjection = {
  accountId: string;
  displayName: string;
  realmEnvironmentId: string;
};

export type DesktopAccountSessionStatus = {
  sequence: string;
  state: DesktopAccountSessionState;
  reasonCode: RuntimeReasonCode;
  accountReasonCode: AccountReasonCode;
  accountProjection?: DesktopAccountProjection;
};

export type DesktopAccountSessionDeliveryKind = 'snapshot' | 'replay' | 'live';

export type DesktopAccountSessionEvent = DesktopAccountSessionStatus & {
  deliveryKind: DesktopAccountSessionDeliveryKind;
  replayTruncated: boolean;
};

const ACCOUNT_STATES = new Set<DesktopAccountSessionState>([
  'anonymous',
  'login-pending',
  'authenticated',
  'refresh-pending',
  'expired',
  'reauth-required',
  'switching',
  'logging-out',
  'unavailable',
]);

function assertExactKeys(record: JsonObject, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains forbidden fields: ${unexpected.join(', ')}`);
  }
}

function parseString(value: unknown, field: string, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label}: ${field} must be a string`);
  }
  return value;
}

function parseExactNonEmptyString(
  value: unknown,
  field: string,
  label: string,
  maxLength = 4_096,
): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > maxLength
    || value !== value.trim()
    || value.includes('\0')) {
    throw new Error(`${label}: ${field} must be an exact non-empty string`);
  }
  return value;
}

function parseBoolean(value: unknown, field: string, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label}: ${field} must be a boolean`);
  }
  return value;
}

function parseInteger(value: unknown, field: string, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label}: ${field} must be an integer`);
  }
  return value;
}

function parseKnownEnumInteger(
  value: unknown,
  field: string,
  label: string,
  enumType: Record<number, string>,
): number {
  const parsed = parseInteger(value, field, label);
  if (parsed === 0 || typeof enumType[parsed] !== 'string') {
    throw new Error(`${label}: ${field} is not an admitted enum value`);
  }
  return parsed;
}

function parseSequence(value: unknown, field: string, label: string): string {
  if (typeof value !== 'string' || value.length > 20 || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${label}: ${field} must be a canonical unsigned decimal string`);
  }
  if (BigInt(value) > 18_446_744_073_709_551_615n) {
    throw new Error(`${label}: ${field} exceeds uint64`);
  }
  return value;
}

function parseStreamId(value: unknown, label: string): string {
  const streamId = parseExactNonEmptyString(value, 'streamId', label, 128);
  if (streamId.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(streamId)) {
    throw new Error(`${label}: streamId is invalid`);
  }
  return streamId;
}

function parseSafeAccountProjection(
  value: unknown,
  label: string,
): DesktopAccountProjection | undefined {
  if (value === undefined || value === null) return undefined;
  const projection = assertRecord(value, `${label} accountProjection is invalid`);
  assertExactKeys(
    projection,
    ['accountId', 'displayName', 'realmEnvironmentId'],
    `${label} accountProjection`,
  );
  return {
    accountId: parseExactNonEmptyString(projection.accountId, 'accountProjection.accountId', label),
    displayName: parseString(projection.displayName, 'accountProjection.displayName', label),
    realmEnvironmentId: parseExactNonEmptyString(
      projection.realmEnvironmentId,
      'accountProjection.realmEnvironmentId',
      label,
    ),
  };
}

function toGeneratedAccountProjection(projection: DesktopAccountProjection | undefined) {
  return projection
    ? {
      ...projection,
      workspaceMemberships: [],
    }
    : undefined;
}

export function parseDesktopAccountSessionStatus(value: unknown): DesktopAccountSessionStatus {
  const record = assertRecord(value, 'runtime_account_session_status returned invalid payload');
  assertExactKeys(record, [
    'sequence',
    'state',
    'reasonCode',
    'accountReasonCode',
    'accountProjection',
  ], 'runtime_account_session_status');
  const sequence = parseSequence(record.sequence, 'sequence', 'runtime_account_session_status');
  const state = parseExactNonEmptyString(
    record.state,
    'state',
    'runtime_account_session_status',
  ) as DesktopAccountSessionState;
  if (!ACCOUNT_STATES.has(state)) {
    throw new Error(`runtime_account_session_status returned unsupported state: ${state}`);
  }
  let accountProjection: DesktopAccountProjection | undefined;
  accountProjection = parseSafeAccountProjection(
    record.accountProjection,
    'runtime_account_session_status',
  );
  if (state === 'authenticated' && !accountProjection) {
    throw new Error('runtime_account_session_status authenticated state requires accountProjection');
  }
  return {
    sequence,
    state,
    reasonCode: parseKnownEnumInteger(
      record.reasonCode,
      'reasonCode',
      'runtime_account_session_status',
      RuntimeReasonCode as unknown as Record<number, string>,
    ) as RuntimeReasonCode,
    accountReasonCode: parseKnownEnumInteger(
      record.accountReasonCode,
      'accountReasonCode',
      'runtime_account_session_status',
      AccountReasonCode as unknown as Record<number, string>,
    ) as AccountReasonCode,
    ...(accountProjection ? { accountProjection } : {}),
  };
}

export function parseDesktopAccountSessionEvent(value: unknown): DesktopAccountSessionEvent {
  const label = 'runtime_account_session_events';
  const record = assertRecord(value, `${label} returned invalid event`);
  assertExactKeys(record, [
    'sequence',
    'deliveryKind',
    'state',
    'reasonCode',
    'accountReasonCode',
    'accountProjection',
    'replayTruncated',
  ], label);
  const deliveryKind = parseExactNonEmptyString(
    record.deliveryKind,
    'deliveryKind',
    label,
    32,
  ) as DesktopAccountSessionDeliveryKind;
  if (!['snapshot', 'replay', 'live'].includes(deliveryKind)) {
    throw new Error(`${label} returned unsupported deliveryKind: ${deliveryKind}`);
  }
  const status = parseDesktopAccountSessionStatus({
    sequence: record.sequence,
    state: record.state,
    reasonCode: record.reasonCode,
    accountReasonCode: record.accountReasonCode,
    accountProjection: record.accountProjection,
  });
  return {
    ...status,
    deliveryKind,
    replayTruncated: parseBoolean(record.replayTruncated, 'replayTruncated', label),
  };
}

export async function getRuntimeAccountSessionStatus(): Promise<DesktopAccountSessionStatus> {
  return invokeChecked(
    DESKTOP_ACCOUNT_SESSION_STATUS_COMMAND,
    {},
    parseDesktopAccountSessionStatus,
  );
}

export type DesktopAccountSessionSubscriptionHandlers = {
  onEvent: (event: DesktopAccountSessionEvent) => void;
  onError: (error: unknown) => void;
  onCompleted?: () => void;
};

export async function subscribeRuntimeAccountSessionEvents(
  afterSequence: string,
  handlers: DesktopAccountSessionSubscriptionHandlers,
): Promise<() => void> {
  const sequence = parseSequence(afterSequence, 'afterSequence', DESKTOP_ACCOUNT_SESSION_EVENTS_OPEN_COMMAND);
  let streamId = '';
  let closed = false;
  const pendingPayloads: unknown[] = [];
  let preOpenError: Error | null = null;
  let unlisten: () => void = () => undefined;
  const closeNative = async () => {
    if (!streamId) return;
    await invokeChecked(
      DESKTOP_ACCOUNT_SESSION_EVENTS_CLOSE_COMMAND,
      { streamId },
      (value) => {
        const record = assertRecord(value, 'runtime account event close result is invalid');
        assertExactKeys(record, [], DESKTOP_ACCOUNT_SESSION_EVENTS_CLOSE_COMMAND);
        return record;
      },
    );
  };
  const terminateWithError = (error: unknown) => {
    if (closed) return;
    closed = true;
    unlisten();
    void closeNative().catch(() => undefined);
    try {
      handlers.onError(error);
    } catch {
      // Consumer failures cannot retain a native stream or global listener.
    }
  };
  const terminateCompleted = () => {
    if (closed) return;
    closed = true;
    unlisten();
    void closeNative().catch(() => undefined);
    try {
      handlers.onCompleted?.();
    } catch {
      // Consumer failures cannot retain a native stream or global listener.
    }
  };
  const handlePayload = (payload: unknown) => {
    if (closed) return;
    try {
      const envelope = assertRecord(payload, 'runtime account event envelope is invalid');
      if (Object.keys(envelope).some((key) => !['streamId', 'eventType', 'event', 'error'].includes(key))) {
        throw new Error('runtime account event envelope contains forbidden fields');
      }
      const envelopeStreamId = parseStreamId(envelope.streamId, 'runtime account event envelope');
      if (!streamId || envelopeStreamId !== streamId) return;
      const eventType = parseExactNonEmptyString(
        envelope.eventType,
        'eventType',
        'runtime account event envelope',
        16,
      );
      if (eventType === 'next') {
        if (envelope.error != null) throw new Error('runtime account next envelope contains an error');
        handlers.onEvent(parseDesktopAccountSessionEvent(envelope.event));
      } else if (eventType === 'error') {
        if (envelope.event != null) throw new Error('runtime account error envelope contains an event');
        if (envelope.error == null) throw new Error('runtime account error envelope is missing an error');
        terminateWithError(parseAccountStreamError(envelope.error));
      } else if (eventType === 'completed') {
        if (envelope.event != null || envelope.error != null) {
          throw new Error('runtime account completed envelope contains terminal payload data');
        }
        terminateCompleted();
      } else {
        throw new Error(`runtime account event envelope has unsupported eventType: ${eventType}`);
      }
    } catch (error) {
      terminateWithError(error);
    }
  };
  unlisten = await listenShell(DESKTOP_ACCOUNT_SESSION_EVENTS_EVENT, ({ payload }) => {
    if (!streamId) {
      if (preOpenError) return;
      if (pendingPayloads.length >= MAX_ACCOUNT_EVENT_PREOPEN_BUFFER) {
        preOpenError = new Error('runtime account event pre-open buffer exceeded');
        return;
      }
      pendingPayloads.push(payload);
      return;
    }
    handlePayload(payload);
  });
  try {
    const opened = await invokeChecked(
      DESKTOP_ACCOUNT_SESSION_EVENTS_OPEN_COMMAND,
      { afterSequence: sequence },
      (value) => {
        const record = assertRecord(value, 'runtime account event open result is invalid');
        assertExactKeys(record, ['streamId'], DESKTOP_ACCOUNT_SESSION_EVENTS_OPEN_COMMAND);
        return { streamId: parseStreamId(record.streamId, DESKTOP_ACCOUNT_SESSION_EVENTS_OPEN_COMMAND) };
      },
    );
    streamId = opened.streamId;
    if (preOpenError) {
      await closeNative().catch(() => undefined);
      throw preOpenError;
    }
    for (const payload of pendingPayloads.splice(0)) {
      handlePayload(payload);
    }
  } catch (error) {
    unlisten();
    throw error;
  }
  return () => {
    if (closed) return;
    closed = true;
    unlisten();
    void closeNative().catch(() => undefined);
  };
}

function parseAccountStreamError(value: unknown): BridgeError {
  const command = DESKTOP_ACCOUNT_SESSION_EVENTS_OPEN_COMMAND;
  const record = assertRecord(value, 'runtime account event error is invalid');
  if (Object.hasOwn(record, 'code')) {
    assertExactKeys(record, ['code', 'reasonCode', 'actionHint', 'source', 'details'], 'runtime account event error');
    if (!isNimiStandardShellErrorEnvelope(record)) {
      throw new Error('runtime account event error is not a standard shell envelope');
    }
    parseReasonCode(record.reasonCode, 'runtime account event error');
    parseExactNonEmptyString(record.actionHint, 'actionHint', 'runtime account event error', 256);
    const details = assertRecord(record.details, 'runtime account event error details are invalid');
    assertExactKeys(
      details,
      ['command', 'retryable', ...(details.reasonMetadata === undefined ? [] : ['reasonMetadata'])],
      'runtime account event error details',
    );
    if (details.reasonMetadata !== undefined) {
      parseAccountReasonMetadata(details.reasonMetadata);
    }
    if (details.command !== command || typeof details.retryable !== 'boolean') {
      throw new Error('runtime account event error details violate the protected contract');
    }
    const envelope = record as unknown as NimiStandardShellErrorEnvelope;
    return new BridgeError(envelope.reasonCode, command, envelope);
  }

  assertExactKeys(record, ['reasonCode', 'retryable'], 'runtime account event error');
  const reasonCode = parseReasonCode(record.reasonCode, 'runtime account event error');
  if (typeof record.retryable !== 'boolean') {
    throw new Error('runtime account event error: retryable must be a boolean');
  }
  const envelope: NimiStandardShellErrorEnvelope = {
    code: accountStreamErrorCode(reasonCode),
    reasonCode,
    actionHint: record.retryable
      ? 'retry_protected_desktop_account_operation'
      : 'refresh_runtime_account_projection',
    source: 'runtime',
    details: { command, retryable: record.retryable },
  };
  return new BridgeError(reasonCode, command, envelope);
}

function parseAccountReasonMetadata(value: unknown): Readonly<Record<string, string>> {
  const record = assertRecord(value, 'runtime account reason metadata is invalid');
  for (const [key, entry] of Object.entries(record)) {
    if (!['permission_id', 'permission_reason', 'permission_admission', 'diagnostic_stage',
      'local_development_reason_code', 'grpc_status_code'].includes(key)
      || typeof entry !== 'string'
      || entry.length === 0
      || entry.length > 2048
      || entry.trim() !== entry
      || /[\u0000-\u001f\u007f]/u.test(entry)) {
      throw new Error('runtime account reason metadata is invalid');
    }
  }
  return record as Readonly<Record<string, string>>;
}

function parseReasonCode(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 128
    || !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(value)) {
    throw new Error(`${label}: reasonCode is invalid`);
  }
  return value;
}

function accountStreamErrorCode(reasonCode: string): NimiStandardShellErrorCode {
  if (reasonCode === 'protected-carrier-required') return 'protected-carrier-required';
  if (reasonCode === 'runtime-service-unavailable') return 'runtime-service-unavailable';
  if (reasonCode === 'runtime-service-repair-required') return 'runtime-service-repair-required';
  if (reasonCode === 'runtime-service-untrusted') return 'runtime-service-untrusted';
  if (reasonCode === 'runtime-service-error-unclassified') return 'runtime-service-error-unclassified';
  return 'runtime-permission-denied';
}

export type DesktopAccountBeginLoginInput = {
  redirectUri: string;
  callbackOrigin: string;
  requestedScopes: string[];
  ttlSeconds: number;
};

export type DesktopAccountCompleteLoginInput = {
  loginAttemptId: string;
  code: string;
  state: string;
  nonce: string;
  redirectUri: string;
  callbackOrigin: string;
};

export type DesktopAccountRealmUnaryInput = {
  methodId: string;
  requestJson: string;
  timeoutMs: number;
  idempotencyKey?: string;
};

export function parseDesktopAccountBeginLoginResponse(value: unknown): BeginLoginResponse {
  const label = DESKTOP_ACCOUNT_BEGIN_LOGIN_COMMAND;
  const record = assertRecord(value, `${label} returned invalid payload`);
  assertExactKeys(record, [
    'accepted',
    'loginAttemptId',
    'oauthAuthorizationUrl',
    'callbackOrigin',
    'state',
    'nonce',
    'reasonCode',
    'accountReasonCode',
    'productionInert',
  ], label);
  const accepted = parseBoolean(record.accepted, 'accepted', label);
  const loginAttemptId = parseString(record.loginAttemptId, 'loginAttemptId', label);
  const oauthAuthorizationUrl = parseString(record.oauthAuthorizationUrl, 'oauthAuthorizationUrl', label);
  const callbackOrigin = parseString(record.callbackOrigin, 'callbackOrigin', label);
  const state = parseString(record.state, 'state', label);
  const nonce = parseString(record.nonce, 'nonce', label);
  const reasonCode = parseKnownEnumInteger(
    record.reasonCode,
    'reasonCode',
    label,
    RuntimeReasonCode as unknown as Record<number, string>,
  ) as RuntimeReasonCode;
  const accountReasonCode = parseKnownEnumInteger(
    record.accountReasonCode,
    'accountReasonCode',
    label,
    AccountReasonCode as unknown as Record<number, string>,
  ) as AccountReasonCode;
  const productionInert = parseBoolean(record.productionInert, 'productionInert', label);
  if (accepted) {
    parseExactNonEmptyString(loginAttemptId, 'loginAttemptId', label, 256);
    parseExactNonEmptyString(state, 'state', label, 512);
    parseExactNonEmptyString(nonce, 'nonce', label, 512);
    parseExactNonEmptyString(oauthAuthorizationUrl, 'oauthAuthorizationUrl', label, 4_096);
    parseExactNonEmptyString(callbackOrigin, 'callbackOrigin', label, 2_048);
    let authorizationUrl: URL;
    let callbackUrl: URL;
    try {
      authorizationUrl = new URL(oauthAuthorizationUrl);
      callbackUrl = new URL(callbackOrigin);
    } catch {
      throw new Error(`${label}: accepted login URL is invalid`);
    }
    const callbackHost = callbackUrl.hostname.toLowerCase();
    const callbackPort = Number(callbackUrl.port);
    const redirectUri = `${callbackUrl.origin}/oauth/callback`;
    if (callbackOrigin !== callbackUrl.origin
      || reasonCode !== RuntimeReasonCode.ACTION_EXECUTED
      || accountReasonCode !== AccountReasonCode.ACTION_EXECUTED
      || productionInert
      || !['http:', 'https:'].includes(authorizationUrl.protocol)
      || authorizationUrl.username !== ''
      || authorizationUrl.password !== ''
      || authorizationUrl.hostname === ''
      || authorizationUrl.hash !== ''
      || callbackUrl.protocol !== 'http:'
      || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(callbackHost)
      || callbackUrl.username !== ''
      || callbackUrl.password !== ''
      || !Number.isInteger(callbackPort)
      || callbackPort < 1_024
      || callbackPort > 49_151
      || callbackUrl.pathname !== '/'
      || callbackUrl.search !== ''
      || callbackUrl.hash !== ''
      || authorizationUrl.searchParams.getAll('state').length !== 1
      || authorizationUrl.searchParams.get('state') !== state
      || authorizationUrl.searchParams.getAll('redirect_uri').length !== 1
      || authorizationUrl.searchParams.get('redirect_uri') !== redirectUri) {
      throw new Error(`${label}: accepted login response violates the protected contract`);
    }
  } else if (loginAttemptId !== ''
    || oauthAuthorizationUrl !== ''
    || callbackOrigin !== ''
    || state !== ''
    || nonce !== '') {
    throw new Error(`${label}: rejected login response contains authorization material`);
  }
  return {
    accepted,
    loginAttemptId,
    oauthAuthorizationUrl,
    callbackOrigin,
    state,
    nonce,
    pkceChallenge: '',
    reasonCode,
    accountReasonCode,
    productionInert,
  };
}

function parseDesktopAccountMutationResponse(
  value: unknown,
  label: string,
  acceptedState: AccountSessionState,
  acceptedProjection: 'required' | 'forbidden',
): CompleteLoginResponse | SwitchAccountResponse {
  const record = assertRecord(value, `${label} returned invalid payload`);
  assertExactKeys(record, [
    'accepted',
    'state',
    'accountProjection',
    'reasonCode',
    'accountReasonCode',
    'productionInert',
  ], label);
  const accepted = parseBoolean(record.accepted, 'accepted', label);
  const state = parseKnownEnumInteger(
    record.state,
    'state',
    label,
    AccountSessionState as unknown as Record<number, string>,
  ) as AccountSessionState;
  const accountProjection = toGeneratedAccountProjection(
    parseSafeAccountProjection(record.accountProjection, label),
  );
  const reasonCode = parseKnownEnumInteger(
    record.reasonCode,
    'reasonCode',
    label,
    RuntimeReasonCode as unknown as Record<number, string>,
  ) as RuntimeReasonCode;
  const accountReasonCode = parseKnownEnumInteger(
    record.accountReasonCode,
    'accountReasonCode',
    label,
    AccountReasonCode as unknown as Record<number, string>,
  ) as AccountReasonCode;
  const productionInert = parseBoolean(record.productionInert, 'productionInert', label);
  if (accepted && (reasonCode !== RuntimeReasonCode.ACTION_EXECUTED
    || accountReasonCode !== AccountReasonCode.ACTION_EXECUTED
    || productionInert
    || state !== acceptedState
    || (acceptedProjection === 'required' && !accountProjection)
    || (acceptedProjection === 'forbidden' && Boolean(accountProjection)))) {
    throw new Error(`${label}: accepted mutation response violates the protected contract`);
  }
  return {
    accepted,
    state,
    accountProjection,
    reasonCode,
    accountReasonCode,
    productionInert,
  };
}

export function parseDesktopAccountRealmUnaryResponse(value: unknown): InvokeRealmUnaryResponse {
  const label = DESKTOP_ACCOUNT_INVOKE_REALM_UNARY_COMMAND;
  const record = assertRecord(value, `${label} returned invalid payload`);
  assertExactKeys(record, [
    'accepted',
    'responseJson',
    'reasonCode',
    'accountReasonCode',
    'productionInert',
    'httpStatus',
    'errorMessage',
  ], label);
  const accepted = parseBoolean(record.accepted, 'accepted', label);
  const responseJson = parseString(record.responseJson, 'responseJson', label);
  const reasonCode = parseKnownEnumInteger(
    record.reasonCode,
    'reasonCode',
    label,
    RuntimeReasonCode as unknown as Record<number, string>,
  ) as RuntimeReasonCode;
  const accountReasonCode = parseKnownEnumInteger(
    record.accountReasonCode,
    'accountReasonCode',
    label,
    AccountReasonCode as unknown as Record<number, string>,
  ) as AccountReasonCode;
  const productionInert = parseBoolean(record.productionInert, 'productionInert', label);
  const httpStatus = parseInteger(record.httpStatus, 'httpStatus', label);
  const errorMessage = parseString(record.errorMessage, 'errorMessage', label);
  if (accepted) {
    try {
      JSON.parse(responseJson);
    } catch {
      throw new Error(`${label}: accepted responseJson is invalid`);
    }
    if (reasonCode !== RuntimeReasonCode.ACTION_EXECUTED
      || accountReasonCode !== AccountReasonCode.ACTION_EXECUTED
      || productionInert
      || httpStatus < 200
      || httpStatus >= 300
      || errorMessage !== '') {
      throw new Error(`${label}: accepted Realm response violates the protected contract`);
    }
  } else if (responseJson !== '') {
    throw new Error(`${label}: rejected Realm response contains responseJson`);
  }
  return {
    accepted,
    responseJson,
    reasonCode,
    accountReasonCode,
    productionInert,
    httpStatus,
    errorMessage,
  };
}

export async function beginRuntimeAccountLogin(
  input: DesktopAccountBeginLoginInput,
): Promise<BeginLoginResponse> {
  return invokeChecked(
    DESKTOP_ACCOUNT_BEGIN_LOGIN_COMMAND,
    { payload: input },
    parseDesktopAccountBeginLoginResponse,
  );
}

export async function completeRuntimeAccountLogin(
  input: DesktopAccountCompleteLoginInput,
): Promise<CompleteLoginResponse> {
  return invokeChecked(
    DESKTOP_ACCOUNT_COMPLETE_LOGIN_COMMAND,
    { payload: input },
    (value) => parseDesktopAccountMutationResponse(
      value,
      DESKTOP_ACCOUNT_COMPLETE_LOGIN_COMMAND,
      AccountSessionState.AUTHENTICATED,
      'required',
    ),
  );
}

export async function invokeRuntimeAccountRealmUnary(
  input: DesktopAccountRealmUnaryInput,
): Promise<InvokeRealmUnaryResponse> {
  return invokeChecked(
    DESKTOP_ACCOUNT_INVOKE_REALM_UNARY_COMMAND,
    { payload: input },
    parseDesktopAccountRealmUnaryResponse,
  );
}

export async function logoutRuntimeAccount(reason: string): Promise<LogoutResponse> {
  const response = await invokeChecked(
    DESKTOP_ACCOUNT_LOGOUT_COMMAND,
    { payload: { reason } },
    (value) => parseDesktopAccountMutationResponse(
      value,
      DESKTOP_ACCOUNT_LOGOUT_COMMAND,
      AccountSessionState.ANONYMOUS,
      'forbidden',
    ),
  );
  return {
    accepted: response.accepted,
    state: response.state,
    reasonCode: response.reasonCode,
    accountReasonCode: response.accountReasonCode,
    productionInert: response.productionInert,
  };
}

export async function switchRuntimeAccount(reason: string): Promise<SwitchAccountResponse> {
  return invokeChecked(
    DESKTOP_ACCOUNT_SWITCH_COMMAND,
    { payload: { reason } },
    (value) => parseDesktopAccountMutationResponse(
      value,
      DESKTOP_ACCOUNT_SWITCH_COMMAND,
      AccountSessionState.ANONYMOUS,
      'forbidden',
    ),
  );
}

const ACCOUNT_SESSION_STATE_BY_NAME: Readonly<Record<DesktopAccountSessionState, AccountSessionState>> = {
  anonymous: AccountSessionState.ANONYMOUS,
  'login-pending': AccountSessionState.LOGIN_PENDING,
  authenticated: AccountSessionState.AUTHENTICATED,
  'refresh-pending': AccountSessionState.REFRESH_PENDING,
  expired: AccountSessionState.EXPIRED,
  'reauth-required': AccountSessionState.REAUTH_REQUIRED,
  switching: AccountSessionState.SWITCHING,
  'logging-out': AccountSessionState.LOGGING_OUT,
  unavailable: AccountSessionState.UNAVAILABLE,
};

export async function getRuntimeAccountSessionStatusResponse(): Promise<GetAccountSessionStatusResponse> {
  const status = await getRuntimeAccountSessionStatus();
  return {
    reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
    accountReasonCode: AccountReasonCode.ACTION_EXECUTED,
    accepted: true,
    snapshot: {
      sequence: status.sequence,
      state: ACCOUNT_SESSION_STATE_BY_NAME[status.state],
      reasonCode: status.reasonCode,
      accountReasonCode: status.accountReasonCode,
      accountProjection: toGeneratedAccountProjection(status.accountProjection),
    },
  };
}
