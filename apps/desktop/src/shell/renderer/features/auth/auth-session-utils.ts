import type { RealmModel } from '@nimiplatform/sdk/realm';
import { ReasonCode } from '@nimiplatform/sdk/types';

type AuthTokensDto = RealmModel<'AuthTokensDto'>;
type CheckEmailResponseDto = RealmModel<'CheckEmailResponseDto'>;
type OAuthLoginResultDto = RealmModel<'OAuthLoginResultDto'>;

const EXPECTED_ANONYMOUS_REASON_CODES = new Set<string>([
  ReasonCode.AUTH_DENIED,
  ReasonCode.AUTH_TOKEN_INVALID,
  ReasonCode.SESSION_EXPIRED,
]);

const OAUTH_LOGIN_STATES = new Set<OAuthLoginResultDto['loginState']>([
  'ok',
  'needs_onboarding',
  'needs_2fa',
  'blocked',
]);

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function toAuthUserRecord(value: unknown): Record<string, unknown> | null {
  return toRecord(value);
}

export function toCheckEmailResponseDto(value: unknown): CheckEmailResponseDto {
  const record = toRecord(value);
  if (!record || typeof record.available !== 'boolean') {
    throw new Error('Malformed check-email response');
  }

  const hasPassword = record.hasPassword;
  if (hasPassword != null && typeof hasPassword !== 'boolean') {
    throw new Error('Malformed check-email response');
  }

  return {
    available: record.available,
    hasPassword: typeof hasPassword === 'boolean' ? hasPassword : undefined,
  };
}

export function toAuthTokensDto(value: unknown): AuthTokensDto {
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

  const user = toAuthUserRecord(record.user);
  if (record.user != null && !user) {
    throw new Error('Malformed auth token response');
  }

  return {
    accessToken: record.accessToken,
    expiresIn: record.expiresIn,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : refreshToken ?? undefined,
    tokenType: record.tokenType,
    user: user as AuthTokensDto['user'],
  };
}

export function toOAuthLoginResultDto(value: unknown): OAuthLoginResultDto {
  const record = toRecord(value);
  if (!record || typeof record.loginState !== 'string' || !OAUTH_LOGIN_STATES.has(record.loginState as OAuthLoginResultDto['loginState'])) {
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
    loginState: record.loginState as OAuthLoginResultDto['loginState'],
    blockedReason: typeof blockedReason === 'string' ? blockedReason : blockedReason ?? undefined,
    tempToken: typeof tempToken === 'string' ? tempToken : tempToken ?? undefined,
    tokens: tokens == null ? tokens ?? undefined : toAuthTokensDto(tokens),
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

export function isExpectedAnonymousSessionError(error: unknown): boolean {
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
