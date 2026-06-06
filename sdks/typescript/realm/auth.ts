import type {
  Auth2faVerifyDto,
  CheckEmailResponseDto,
  EmailOtpResponseDto,
  EmailOtpVerifyDto,
  OAuthLoginResultDto,
  OAuthProvider,
  PasswordLoginDto,
  RealmTypedCallOptions,
  RealmTypedClient,
  WalletChallengeDto,
  WalletChallengeResponseDto,
  WalletLoginDto,
} from '../core-generated/realm-typed-client';
import { ReasonCode, createNimiError, type JsonObject } from '../types';
import { NIMI_REALM_OAUTH_LOGIN_STATE } from './oauth';

export type NimiRealmAuthUserRecord = JsonObject & {
  readonly hasPassword?: boolean;
};

export interface NimiRealmAuthTokens {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken?: string;
  readonly tokenType: string;
  readonly generatedTokenId?: string;
  readonly generatedTokenType?: string;
  readonly user?: NimiRealmAuthUserRecord;
}

export type NimiRealmOAuthLoginResult = Omit<OAuthLoginResultDto, 'tokens'> & {
  readonly tokens?: NimiRealmAuthTokens;
};

export type NimiRealmCheckEmailResponse = CheckEmailResponseDto;
export type NimiRealmEmailOtpRequestResult = EmailOtpResponseDto;
export type NimiRealmWalletChallengeInput = WalletChallengeDto;
export type NimiRealmWalletLoginInput = WalletLoginDto;
export type NimiRealmWalletChallengeResult = WalletChallengeResponseDto;

export interface NimiRealmAuthApi {
  readonly auth: Pick<
    RealmTypedClient,
    | 'checkEmail'
    | 'oauthLogin'
    | 'passwordLogin'
    | 'requestEmailOtp'
    | 'verify2Fa'
    | 'verifyEmailOtp'
    | 'walletChallenge'
    | 'walletLogin'
  >;
}

const OAUTH_LOGIN_STATES = new Set<OAuthLoginResultDto['loginState']>([
  NIMI_REALM_OAUTH_LOGIN_STATE.OK,
  NIMI_REALM_OAUTH_LOGIN_STATE.NEEDS_ONBOARDING,
  NIMI_REALM_OAUTH_LOGIN_STATE.NEEDS_TWO_FACTOR,
  NIMI_REALM_OAUTH_LOGIN_STATE.BLOCKED,
]);
const CHECK_EMAIL_ENTRY_ROUTES = new Set<CheckEmailResponseDto['entryRoute']>([
  'register_with_otp',
  'login_with_otp',
  'login_with_password',
]);
const EXPECTED_ANONYMOUS_REASON_CODES = new Set<string>([
  ReasonCode.AUTH_DENIED,
  ReasonCode.AUTH_TOKEN_INVALID,
  ReasonCode.SESSION_EXPIRED,
]);

export function toNimiRealmAuthUserRecord(value: unknown): NimiRealmAuthUserRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as NimiRealmAuthUserRecord;
}

export function normalizeNimiRealmCheckEmailResponse(value: unknown): NimiRealmCheckEmailResponse {
  const record = toRecord(value);
  if (
    !record
    || typeof record.available !== 'boolean'
    || typeof record.entryRoute !== 'string'
    || !CHECK_EMAIL_ENTRY_ROUTES.has(record.entryRoute as CheckEmailResponseDto['entryRoute'])
  ) {
    throw malformedNimiRealmAuthResponse('Realm check-email response is malformed.');
  }
  return {
    available: record.available,
    entryRoute: record.entryRoute as CheckEmailResponseDto['entryRoute'],
  };
}

export function normalizeNimiRealmEmailOtpRequestResult(value: unknown): NimiRealmEmailOtpRequestResult {
  const record = toRecord(value);
  if (!record || typeof record.success !== 'boolean') {
    throw malformedNimiRealmAuthResponse('Realm email OTP response is malformed.');
  }
  const message = record.message;
  if (message != null && typeof message !== 'string') {
    throw malformedNimiRealmAuthResponse('Realm email OTP response message is malformed.');
  }
  return {
    success: record.success,
    message: typeof message === 'string' ? message : '',
  };
}

export function normalizeNimiRealmWalletChallengeResult(value: unknown): NimiRealmWalletChallengeResult {
  const record = toRecord(value);
  if (
    !record
    || typeof record.message !== 'string'
    || typeof record.nonce !== 'string'
    || typeof record.walletAddress !== 'string'
    || typeof record.expiresAt !== 'string'
  ) {
    throw malformedNimiRealmAuthResponse('Realm wallet challenge response is malformed.');
  }
  return {
    expiresAt: record.expiresAt,
    message: record.message,
    nonce: record.nonce,
    walletAddress: record.walletAddress,
  };
}

export function normalizeNimiRealmAuthTokens(value: unknown): NimiRealmAuthTokens {
  const record = toRecord(value);
  const tokenType = typeof record?.tokenType === 'string'
    ? record.tokenType
    : typeof record?.type === 'string'
      ? record.type
      : '';
  if (
    !record
    || typeof record.accessToken !== 'string'
    || typeof record.expiresIn !== 'number'
    || !Number.isFinite(record.expiresIn)
    || !tokenType
  ) {
    throw malformedNimiRealmAuthResponse('Realm auth token response is malformed.');
  }

  const refreshToken = record.refreshToken;
  if (refreshToken != null && typeof refreshToken !== 'string') {
    throw malformedNimiRealmAuthResponse('Realm auth token response refreshToken is malformed.');
  }

  const user = toNimiRealmAuthUserRecord(record.user);
  if (record.user != null && !user) {
    throw malformedNimiRealmAuthResponse('Realm auth token response user is malformed.');
  }

  return {
    accessToken: record.accessToken,
    expiresIn: record.expiresIn,
    tokenType,
    ...(typeof refreshToken === 'string' ? { refreshToken } : {}),
    ...(typeof record.id === 'string' ? { generatedTokenId: record.id } : {}),
    ...(typeof record.type === 'string' ? { generatedTokenType: record.type } : {}),
    ...(user ? { user } : {}),
  };
}

export function normalizeNimiRealmOAuthLoginResult(value: unknown): NimiRealmOAuthLoginResult {
  const record = toRecord(value);
  if (
    !record
    || typeof record.loginState !== 'string'
    || !OAUTH_LOGIN_STATES.has(record.loginState as OAuthLoginResultDto['loginState'])
  ) {
    throw malformedNimiRealmAuthResponse('Realm OAuth login response is malformed.');
  }

  const blockedReason = record.blockedReason;
  const tempToken = record.tempToken;
  const tokens = record.tokens;
  if (blockedReason != null && typeof blockedReason !== 'string') {
    throw malformedNimiRealmAuthResponse('Realm OAuth login response blockedReason is malformed.');
  }
  if (tempToken != null && typeof tempToken !== 'string') {
    throw malformedNimiRealmAuthResponse('Realm OAuth login response tempToken is malformed.');
  }

  return {
    loginState: record.loginState as OAuthLoginResultDto['loginState'],
    blockedReason: typeof blockedReason === 'string' ? blockedReason : blockedReason ?? undefined,
    tempToken: typeof tempToken === 'string' ? tempToken : tempToken ?? undefined,
    tokens: tokens == null ? tokens ?? undefined : normalizeNimiRealmAuthTokens(tokens),
  };
}

export function readNimiRealmOAuthLoginTokens(
  value: Pick<OAuthLoginResultDto, 'tokens'> | { readonly tokens?: unknown },
): NimiRealmAuthTokens | null {
  const tokens = value.tokens;
  return tokens == null ? null : normalizeNimiRealmAuthTokens(tokens);
}

export function isNimiRealmExpectedAnonymousSessionError(error: unknown): boolean {
  const reasonCode = readReasonCode(error);
  if (reasonCode && EXPECTED_ANONYMOUS_REASON_CODES.has(reasonCode)) {
    return true;
  }

  const message = readErrorMessage(error).toUpperCase();
  return (
    message.includes('HTTP_401')
    || message.includes('UNAUTHORIZED')
    || message.includes('AUTH_TOKEN_INVALID')
    || message.includes('SESSION_EXPIRED')
  );
}

export async function checkNimiRealmAuthEmail(
  realm: NimiRealmAuthApi,
  email: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmCheckEmailResponse> {
  return normalizeNimiRealmCheckEmailResponse(
    await realm.auth.checkEmail({ path: {}, body: { email } }, options),
  );
}

export async function loginNimiRealmAuthPassword(
  realm: NimiRealmAuthApi,
  identifier: string,
  password: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmOAuthLoginResult> {
  const body: PasswordLoginDto = { identifier, password };
  return normalizeNimiRealmOAuthLoginResult(
    await realm.auth.passwordLogin({ path: {}, body }, options),
  );
}

export async function requestNimiRealmEmailOtp(
  realm: NimiRealmAuthApi,
  email: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmEmailOtpRequestResult> {
  return normalizeNimiRealmEmailOtpRequestResult(
    await realm.auth.requestEmailOtp({ path: {}, body: { email } }, options),
  );
}

export async function verifyNimiRealmEmailOtp(
  realm: NimiRealmAuthApi,
  email: string,
  code: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmOAuthLoginResult> {
  const body: EmailOtpVerifyDto = { email, code };
  return normalizeNimiRealmOAuthLoginResult(
    await realm.auth.verifyEmailOtp({ path: {}, body }, options),
  );
}

export async function verifyNimiRealmTwoFactor(
  realm: NimiRealmAuthApi,
  tempToken: string,
  code: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmAuthTokens> {
  const body: Auth2faVerifyDto = { tempToken, code };
  return normalizeNimiRealmAuthTokens(
    await realm.auth.verify2Fa({ path: {}, body }, options),
  );
}

export async function createNimiRealmWalletChallenge(
  realm: NimiRealmAuthApi,
  input: NimiRealmWalletChallengeInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWalletChallengeResult> {
  return normalizeNimiRealmWalletChallengeResult(
    await realm.auth.walletChallenge({ path: {}, body: input }, options),
  );
}

export async function loginNimiRealmWallet(
  realm: NimiRealmAuthApi,
  input: NimiRealmWalletLoginInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmOAuthLoginResult> {
  return normalizeNimiRealmOAuthLoginResult(
    await realm.auth.walletLogin({ path: {}, body: input }, options),
  );
}

export async function loginNimiRealmOAuth(
  realm: NimiRealmAuthApi,
  provider: OAuthProvider,
  accessToken: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmOAuthLoginResult> {
  return normalizeNimiRealmOAuthLoginResult(
    await realm.auth.oauthLogin({ path: {}, body: { provider, accessToken } }, options),
  );
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readReasonCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const rawValue = (error as { readonly reasonCode?: unknown }).reasonCode;
  return typeof rawValue === 'string' ? rawValue.trim().toUpperCase() : '';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

function malformedNimiRealmAuthResponse(message: string): Error {
  return createNimiError({
    message,
    reasonCode: 'SDK_REALM_AUTH_RESPONSE_INVALID',
    actionHint: 'check_realm_auth_response',
    source: 'sdk',
  });
}
