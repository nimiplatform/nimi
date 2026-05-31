import { createNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';
import type { RealmAuthOptions } from './client-types.js';

function createRealmAuthModeError(message: string, actionHint: string): Error {
  return createNimiError({
    message,
    reasonCode: ReasonCode.SDK_REALM_CONFIG_INVALID,
    actionHint,
    source: 'sdk',
  });
}

export function assertRealmAuthCustodyMode(auth: RealmAuthOptions): void {
  if (auth.mode !== 'runtime_account' && auth.mode !== 'external_principal') {
    throw createRealmAuthModeError(
      'realm auth mode is required',
      'set_realm_auth_mode_runtime_account_or_external_principal',
    );
  }

  if (!auth.accessToken) {
    throw createNimiError({
      message: 'realm token is required (set auth explicitly to null or undefined for unauthenticated access)',
      reasonCode: ReasonCode.SDK_REALM_TOKEN_REQUIRED,
      actionHint: 'set_realm_auth_access_token',
      source: 'sdk',
    });
  }

  if (auth.mode !== 'runtime_account') {
    return;
  }
  if (typeof auth.accessToken !== 'function') {
    throw createRealmAuthModeError(
      'runtime_account realm auth requires a RuntimeAccountService-backed access token provider',
      'provide_runtime_account_service_access_token_provider',
    );
  }
  if (auth.refreshToken || auth.onTokenRefreshed || auth.onRefreshFailed) {
    throw createRealmAuthModeError(
      'runtime_account realm auth must not own refresh token custody',
      'remove_sdk_refresh_token_custody_from_runtime_account_mode',
    );
  }
}

export function assertExternalPrincipalRefreshMode(mode: unknown): void {
  if (mode !== 'external_principal') {
    throw createRealmAuthModeError(
      'realm refresh token custody requires external_principal auth mode',
      'set_external_principal_mode_for_realm_refresh',
    );
  }
}
