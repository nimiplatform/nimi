import type {
  Auth2faVerifyDto,
  AuthErrorDto,
  AuthTokensDto,
  AuthUserDto,
  CheckEmailResponseDto,
  EmailOtpResponseDto,
  EmailOtpVerifyDto,
  OAuthLoginDto,
  OAuthLoginResultDto,
  PasswordLoginDto,
  PublicAccountRole,
  RealmTypedCallOptions,
  RealmTypedClient,
  UserPrivateDto,
  WalletChallengeDto,
  WalletChallengeResponseDto,
  WalletLoginDto,
} from '../core-generated/realm-typed-client';
import {
  AccountStatusValues,
  GenderValues,
  OAuthProviderValues,
  PublicAccountRoleValues,
} from '../core-generated/realm-typed-client';
import { ReasonCode, createNimiError, type JsonObject } from '../types';
import { NIMI_REALM_OAUTH_LOGIN_STATE } from './oauth';

export type NimiRealmAuthUserRecord = JsonObject &
  Pick<UserPrivateDto, 'createdAt' | 'displayName' | 'handle' | 'id' | 'role'> & {
  readonly hasPassword?: boolean;
};

export type NimiRealmAuthTokens = AuthTokensDto;

export type NimiRealmOAuthLoginResult = OAuthLoginResultDto;

export type NimiRealmCheckEmailResponse = CheckEmailResponseDto;
export type NimiRealmEmailOtpRequestResult = EmailOtpResponseDto;
export type NimiRealmWalletChallengeInput = WalletChallengeDto;
export type NimiRealmWalletLoginInput = WalletLoginDto;
export type NimiRealmWalletChallengeResult = WalletChallengeResponseDto;
export type NimiRealmOAuthLoginInput = OAuthLoginDto;

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
const EXPECTED_ANONYMOUS_REASON_CODES = new Set<AuthErrorDto['reasonCode']>([
  'AUTH_REQUIRED',
  'AUTH_TOKEN_EXPIRED',
]);

export function toNimiRealmAuthUserRecord(value: unknown): NimiRealmAuthUserRecord | null {
  const record = toRecord(value);
  if (
    !record
    || !isOptionalNullableString(record.avatarUrl)
    || !isOptionalNullableString(record.bio)
    || !isOptionalNullableFiniteNumber(record.birthYear)
    || !isOptionalNullableString(record.city)
    || !isOptionalNullableString(record.countryCode)
    || typeof record.createdAt !== 'string'
    || typeof record.displayName !== 'string'
    || !isOptionalString(record.email)
    || (
      record.gender !== undefined
      && record.gender !== null
      && (
        typeof record.gender !== 'string'
        || !GenderValues.includes(record.gender as (typeof GenderValues)[number])
      )
    )
    || typeof record.handle !== 'string'
    || typeof record.id !== 'string'
    || typeof record.role !== 'string'
    || !PublicAccountRoleValues.includes(record.role as PublicAccountRole)
  ) {
    return null;
  }
  return record as NimiRealmAuthUserRecord;
}

function toNimiRealmAuthTokenUser(value: unknown): AuthUserDto | null {
  const record = toRecord(value);
  if (
    !record
    || !isOptionalNullableString(record.avatarUrl)
    || !isOptionalNullableString(record.bio)
    || !isOptionalNullableFiniteNumber(record.birthYear)
    || !isOptionalNullableString(record.city)
    || !isOptionalNullableString(record.countryCode)
    || typeof record.createdAt !== 'string'
    || typeof record.displayName !== 'string'
    || !isOptionalString(record.email)
    || (
      record.gender !== undefined
      && record.gender !== null
      && (
        typeof record.gender !== 'string'
        || !GenderValues.includes(record.gender as (typeof GenderValues)[number])
      )
    )
    || typeof record.handle !== 'string'
    || typeof record.hasPassword !== 'boolean'
    || typeof record.id !== 'string'
    || typeof record.isTwoFactorEnabled !== 'boolean'
    || !isStringArray(record.languages)
    || !isAuthUserOAuthProviders(record.oauthProviders)
    || !isOptionalString(record.lastHandleChangeAt)
    || !isOptionalNullableString(record.presenceEmoji)
    || !isOptionalNullableString(record.presenceStatus)
    || !isOptionalNullableString(record.presenceText)
    || typeof record.role !== 'string'
    || !PublicAccountRoleValues.includes(record.role as AuthUserDto['role'])
    || !isAuthUserSocialProfiles(record.socialProfiles)
    || typeof record.status !== 'string'
    || !AccountStatusValues.includes(record.status as AuthUserDto['status'])
    || !isStringArray(record.tags)
    || !isAuthUserTiers(record.tiers)
    || typeof record.updatedAt !== 'string'
    || !isAuthUserWallets(record.wallets)
  ) {
    return null;
  }
  return record as unknown as AuthUserDto;
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
  if (
    !record
    || typeof record.accessToken !== 'string'
    || typeof record.expiresIn !== 'number'
    || !Number.isFinite(record.expiresIn)
    || typeof record.tokenType !== 'string'
    || !record.tokenType
  ) {
    throw malformedNimiRealmAuthResponse('Realm auth token response is malformed.');
  }

  const refreshToken = record.refreshToken;
  if (refreshToken !== undefined && refreshToken !== null && typeof refreshToken !== 'string') {
    throw malformedNimiRealmAuthResponse('Realm auth token response refreshToken is malformed.');
  }

  const user = toNimiRealmAuthTokenUser(record.user);
  if (record.user !== undefined && !user) {
    throw malformedNimiRealmAuthResponse('Realm auth token response user is malformed.');
  }

  return {
    accessToken: record.accessToken,
    expiresIn: record.expiresIn,
    tokenType: record.tokenType,
    ...(refreshToken !== undefined ? { refreshToken } : {}),
    ...(user ? { user } : {}),
  };
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalNullableFiniteNumber(value: unknown): boolean {
  return value === undefined || value === null || (
    typeof value === 'number' && Number.isFinite(value)
  );
}

function isAuthUserOAuthProviders(value: unknown): value is AuthUserDto['oauthProviders'] {
  return Array.isArray(value) && value.every((item) =>
    typeof item === 'string'
    && OAuthProviderValues.includes(item as (typeof OAuthProviderValues)[number]));
}

function isAuthUserSocialProfiles(value: unknown): value is AuthUserDto['socialProfiles'] {
  return Array.isArray(value) && value.every((item) => {
    const record = toRecord(item);
    return Boolean(
      record
      && typeof record.handle === 'string'
      && typeof record.platform === 'string'
      && isOptionalFiniteNumber(record.followers)
      && (record.isVerified === undefined || typeof record.isVerified === 'boolean')
      && isOptionalString(record.url)
      && isOptionalString(record.verifiedAt),
    );
  });
}

function isAuthUserTiers(value: unknown): value is AuthUserDto['tiers'] {
  const record = toRecord(value);
  return Boolean(
    record
    && typeof record.assetTier === 'number'
    && Number.isFinite(record.assetTier)
    && typeof record.influenceTier === 'number'
    && Number.isFinite(record.influenceTier)
    && typeof record.interactionTier === 'number'
    && Number.isFinite(record.interactionTier)
    && typeof record.vitalityScore === 'number'
    && Number.isFinite(record.vitalityScore),
  );
}

function isAuthUserWallets(value: unknown): value is AuthUserDto['wallets'] {
  return Array.isArray(value) && value.every((item) => {
    const record = toRecord(item);
    return Boolean(
      record
      && typeof record.address === 'string'
      && isStringArray(record.boundOnChains)
      && isOptionalString(record.chainNamespace)
      && typeof record.createdAt === 'string'
      && typeof record.id === 'string'
      && isOptionalString(record.updatedAt),
    );
  });
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (
    typeof value === 'number' && Number.isFinite(value)
  );
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
    ...(blockedReason !== undefined ? { blockedReason } : {}),
    ...(tempToken !== undefined ? { tempToken } : {}),
    ...(tokens !== undefined ? { tokens: tokens === null ? null : normalizeNimiRealmAuthTokens(tokens) } : {}),
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
  return Boolean(
    reasonCode
    && EXPECTED_ANONYMOUS_REASON_CODES.has(reasonCode as AuthErrorDto['reasonCode']),
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
  input: NimiRealmOAuthLoginInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmOAuthLoginResult> {
  return normalizeNimiRealmOAuthLoginResult(
    await realm.auth.oauthLogin({ path: {}, body: input }, options),
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

function malformedNimiRealmAuthResponse(message: string): Error {
  return createNimiError({
    message,
    reasonCode: ReasonCode.SDK_REALM_AUTH_RESPONSE_INVALID,
    actionHint: 'check_realm_auth_response',
    source: 'sdk',
  });
}
