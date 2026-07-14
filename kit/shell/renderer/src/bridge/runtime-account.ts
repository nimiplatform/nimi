import { invokeChecked } from './invoke.js';
import { assertRecord, parseOptionalString, parseRequiredString, type JsonObject } from './types.js';
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

const DESKTOP_ACCOUNT_SESSION_STATUS_COMMAND = 'runtime_account_session_status';
const DESKTOP_ACCOUNT_BEGIN_LOGIN_COMMAND = 'runtime_account_begin_login';
const DESKTOP_ACCOUNT_COMPLETE_LOGIN_COMMAND = 'runtime_account_complete_login';
const DESKTOP_ACCOUNT_INVOKE_REALM_UNARY_COMMAND = 'runtime_account_invoke_realm_unary';
const DESKTOP_ACCOUNT_LOGOUT_COMMAND = 'runtime_account_logout';
const DESKTOP_ACCOUNT_SWITCH_COMMAND = 'runtime_account_switch_account';

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
  state: DesktopAccountSessionState;
  accountProjection?: DesktopAccountProjection;
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
    accountId: parseRequiredString(projection.accountId, 'accountProjection.accountId', label),
    displayName: parseOptionalString(projection.displayName) ?? '',
    realmEnvironmentId: parseOptionalString(projection.realmEnvironmentId) ?? '',
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
  assertExactKeys(record, ['state', 'accountProjection'], 'runtime_account_session_status');
  const state = parseRequiredString(
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
    state,
    ...(accountProjection ? { accountProjection } : {}),
  };
}

export async function getRuntimeAccountSessionStatus(): Promise<DesktopAccountSessionStatus> {
  return invokeChecked(
    DESKTOP_ACCOUNT_SESSION_STATUS_COMMAND,
    {},
    parseDesktopAccountSessionStatus,
  );
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
  return {
    accepted: parseBoolean(record.accepted, 'accepted', label),
    loginAttemptId: parseString(record.loginAttemptId, 'loginAttemptId', label),
    oauthAuthorizationUrl: parseString(record.oauthAuthorizationUrl, 'oauthAuthorizationUrl', label),
    callbackOrigin: parseString(record.callbackOrigin, 'callbackOrigin', label),
    state: parseString(record.state, 'state', label),
    nonce: parseString(record.nonce, 'nonce', label),
    pkceChallenge: '',
    reasonCode: parseInteger(record.reasonCode, 'reasonCode', label) as RuntimeReasonCode,
    accountReasonCode: parseInteger(record.accountReasonCode, 'accountReasonCode', label) as AccountReasonCode,
    productionInert: parseBoolean(record.productionInert, 'productionInert', label),
  };
}

function parseDesktopAccountMutationResponse(
  value: unknown,
  label: string,
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
  return {
    accepted: parseBoolean(record.accepted, 'accepted', label),
    state: parseInteger(record.state, 'state', label) as AccountSessionState,
    accountProjection: toGeneratedAccountProjection(
      parseSafeAccountProjection(record.accountProjection, label),
    ),
    reasonCode: parseInteger(record.reasonCode, 'reasonCode', label) as RuntimeReasonCode,
    accountReasonCode: parseInteger(record.accountReasonCode, 'accountReasonCode', label) as AccountReasonCode,
    productionInert: parseBoolean(record.productionInert, 'productionInert', label),
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
  return {
    accepted: parseBoolean(record.accepted, 'accepted', label),
    responseJson: parseString(record.responseJson, 'responseJson', label),
    reasonCode: parseInteger(record.reasonCode, 'reasonCode', label) as RuntimeReasonCode,
    accountReasonCode: parseInteger(record.accountReasonCode, 'accountReasonCode', label) as AccountReasonCode,
    productionInert: parseBoolean(record.productionInert, 'productionInert', label),
    httpStatus: parseInteger(record.httpStatus, 'httpStatus', label),
    errorMessage: parseString(record.errorMessage, 'errorMessage', label),
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
    (value) => parseDesktopAccountMutationResponse(value, DESKTOP_ACCOUNT_COMPLETE_LOGIN_COMMAND),
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
    (value) => parseDesktopAccountMutationResponse(value, DESKTOP_ACCOUNT_LOGOUT_COMMAND),
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
    (value) => parseDesktopAccountMutationResponse(value, DESKTOP_ACCOUNT_SWITCH_COMMAND),
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
    state: ACCOUNT_SESSION_STATE_BY_NAME[status.state],
    accountProjection: toGeneratedAccountProjection(status.accountProjection),
    reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
    accountReasonCode: AccountReasonCode.ACTION_EXECUTED,
    productionInert: false,
  };
}
