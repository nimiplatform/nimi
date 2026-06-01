import type { Realm } from '../client.js';
import type { RealmModel, RealmServiceArgs } from '../generated/type-helpers.js';
import { ReasonCode } from '../../types/index.js';

export type RealmAuthApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
export type RealmAuthTokensDto = RealmModel<'AuthTokensDto'>;
export type RealmCheckEmailResponseDto = RealmModel<'CheckEmailResponseDto'>;
export type RealmOAuthLoginResultDto = RealmModel<'OAuthLoginResultDto'>;
export type RealmOAuthProvider = RealmModel<'OAuthProvider'>;
export type RealmWalletChallengeInput = RealmServiceArgs<'AuthService', 'walletChallenge'>[0];
export type RealmWalletLoginInput = RealmServiceArgs<'AuthService', 'walletLogin'>[0];
export type RealmEmailOtpRequestResult = {
  success: boolean;
  message?: string;
};
export type RealmWalletChallengeResult = {
  message: string;
  nonce: string;
};

const EXPECTED_ANONYMOUS_REASON_CODES = new Set<string>([
  ReasonCode.AUTH_DENIED,
  ReasonCode.AUTH_TOKEN_INVALID,
  ReasonCode.SESSION_EXPIRED,
]);

const OAUTH_LOGIN_STATES = new Set<RealmOAuthLoginResultDto['loginState']>([
  'ok',
  'needs_onboarding',
  'needs_2fa',
  'blocked',
]);

const CHECK_EMAIL_ENTRY_ROUTES = new Set<RealmCheckEmailResponseDto['entryRoute']>([
  'register_with_otp',
  'login_with_otp',
  'login_with_password',
]);

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function toRealmAuthUserRecord(value: unknown): Record<string, unknown> | null {
  return toRecord(value);
}

export function toRealmCheckEmailResponseDto(value: unknown): RealmCheckEmailResponseDto {
  const record = toRecord(value);
  if (
    !record
    || typeof record.available !== 'boolean'
    || typeof record.entryRoute !== 'string'
    || !CHECK_EMAIL_ENTRY_ROUTES.has(record.entryRoute as RealmCheckEmailResponseDto['entryRoute'])
  ) {
    throw new Error('Malformed check-email response');
  }

  return {
    available: record.available,
    entryRoute: record.entryRoute as RealmCheckEmailResponseDto['entryRoute'],
  };
}

export function toRealmEmailOtpRequestResult(value: unknown): RealmEmailOtpRequestResult {
  const record = toRecord(value);
  if (!record || typeof record.success !== 'boolean') {
    throw new Error('Malformed email OTP request response');
  }
  const message = record.message;
  if (message != null && typeof message !== 'string') {
    throw new Error('Malformed email OTP request response');
  }
  return {
    success: record.success,
    message: typeof message === 'string' ? message : message ?? undefined,
  };
}

export function toRealmWalletChallengeResult(value: unknown): RealmWalletChallengeResult {
  const record = toRecord(value);
  if (!record || typeof record.message !== 'string' || typeof record.nonce !== 'string') {
    throw new Error('Malformed wallet challenge response');
  }
  return {
    message: record.message,
    nonce: record.nonce,
  };
}

export function toRealmAuthTokensDto(value: unknown): RealmAuthTokensDto {
  const record = toRecord(value);
  if (
    !record
    || typeof record.accessToken !== 'string'
    || typeof record.expiresIn !== 'number'
    || typeof record.tokenType !== 'string'
  ) {
    throw new Error('Malformed auth token response');
  }

  const refreshToken = record.refreshToken;
  if (refreshToken != null && typeof refreshToken !== 'string') {
    throw new Error('Malformed auth token response');
  }

  const user = toRealmAuthUserRecord(record.user);
  if (record.user != null && !user) {
    throw new Error('Malformed auth token response');
  }

  return {
    accessToken: record.accessToken,
    expiresIn: record.expiresIn,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : refreshToken ?? undefined,
    tokenType: record.tokenType,
    user: user as RealmAuthTokensDto['user'],
  };
}

export function toRealmOAuthLoginResultDto(value: unknown): RealmOAuthLoginResultDto {
  const record = toRecord(value);
  if (!record || typeof record.loginState !== 'string' || !OAUTH_LOGIN_STATES.has(record.loginState as RealmOAuthLoginResultDto['loginState'])) {
    throw new Error('Malformed OAuth login response');
  }

  const blockedReason = record.blockedReason;
  const tempToken = record.tempToken;
  const tokens = record.tokens;
  if (blockedReason != null && typeof blockedReason !== 'string') {
    throw new Error('Malformed OAuth login response');
  }
  if (tempToken != null && typeof tempToken !== 'string') {
    throw new Error('Malformed OAuth login response');
  }
  if (tokens != null && !toRecord(tokens)) {
    throw new Error('Malformed OAuth login response');
  }

  return {
    loginState: record.loginState as RealmOAuthLoginResultDto['loginState'],
    blockedReason: typeof blockedReason === 'string' ? blockedReason : blockedReason ?? undefined,
    tempToken: typeof tempToken === 'string' ? tempToken : tempToken ?? undefined,
    tokens: tokens == null ? tokens ?? undefined : toRealmAuthTokensDto(tokens),
  };
}

function readReasonCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const rawValue = (error as { reasonCode?: unknown }).reasonCode;
  return typeof rawValue === 'string' ? rawValue.trim().toUpperCase() : '';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

export function isExpectedAnonymousRealmSessionError(error: unknown): boolean {
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

export async function checkRealmAuthEmail(
  callApi: RealmAuthApiCaller,
  email: string,
): Promise<RealmCheckEmailResponseDto> {
  return toRealmCheckEmailResponseDto(
    await callApi(
      (realm) => realm.services.AuthService.checkEmail({ email }),
      '',
    ),
  );
}

export async function loginRealmAuthPassword(
  callApi: RealmAuthApiCaller,
  identifier: string,
  password: string,
  fallbackMessage: string,
): Promise<RealmOAuthLoginResultDto> {
  return toRealmOAuthLoginResultDto(
    await callApi(
      (realm) => realm.services.AuthService.passwordLogin({ identifier, password }),
      fallbackMessage,
    ),
  );
}

export async function requestRealmEmailOtp(
  callApi: RealmAuthApiCaller,
  email: string,
  fallbackMessage: string,
): Promise<RealmEmailOtpRequestResult> {
  return toRealmEmailOtpRequestResult(
    await callApi(
      (realm) => realm.services.AuthService.requestEmailOtp({ email }),
      fallbackMessage,
    ),
  );
}

export async function verifyRealmEmailOtp(
  callApi: RealmAuthApiCaller,
  email: string,
  code: string,
  fallbackMessage: string,
): Promise<RealmOAuthLoginResultDto> {
  return toRealmOAuthLoginResultDto(
    await callApi(
      (realm) => realm.services.AuthService.verifyEmailOtp({ email, code }),
      fallbackMessage,
    ),
  );
}

export async function verifyRealmTwoFactor(
  callApi: RealmAuthApiCaller,
  tempToken: string,
  code: string,
  fallbackMessage: string,
): Promise<RealmAuthTokensDto> {
  return toRealmAuthTokensDto(
    await callApi(
      (realm) => realm.services.AuthService.verifyTwoFactor({ tempToken, code }),
      fallbackMessage,
    ),
  );
}

export async function createRealmWalletChallenge(
  callApi: RealmAuthApiCaller,
  input: RealmWalletChallengeInput,
  fallbackMessage: string,
): Promise<RealmWalletChallengeResult> {
  return toRealmWalletChallengeResult(
    await callApi(
      (realm) => realm.services.AuthService.walletChallenge({
        walletAddress: input.walletAddress,
        chainId: input.chainId,
        walletType: input.walletType,
      }),
      fallbackMessage,
    ),
  );
}

export async function loginRealmWallet(
  callApi: RealmAuthApiCaller,
  input: RealmWalletLoginInput,
  fallbackMessage: string,
): Promise<RealmOAuthLoginResultDto> {
  return toRealmOAuthLoginResultDto(
    await callApi(
      (realm) => realm.services.AuthService.walletLogin({
        walletAddress: input.walletAddress,
        chainId: input.chainId,
        nonce: input.nonce,
        message: input.message,
        signature: input.signature,
        walletType: input.walletType,
      }),
      fallbackMessage,
    ),
  );
}

export async function loginRealmOAuth(
  callApi: RealmAuthApiCaller,
  provider: RealmOAuthProvider,
  accessToken: string,
  fallbackMessage: string,
): Promise<RealmOAuthLoginResultDto> {
  return toRealmOAuthLoginResultDto(
    await callApi(
      (realm) => realm.services.AuthService.oauthLogin({
        provider,
        accessToken,
      }),
      fallbackMessage,
    ),
  );
}
