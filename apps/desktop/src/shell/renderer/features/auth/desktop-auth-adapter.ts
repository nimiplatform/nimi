import {
  clearPersistedAccessToken,
  buildDesktopWebAuthLaunchUrl,
  persistAuthSessionMetadata,
  resolveSessionExpiry,
  type AuthPlatformAdapter,
} from '@nimiplatform/nimi-kit/auth';
import type { TauriOAuthBridge } from '@nimiplatform/nimi-kit/core/oauth';
import { isWebShellMode } from '@nimiplatform/nimi-kit/core/shell-mode';
import { OAuthProvider, type RealmModel } from '@nimiplatform/sdk/realm';
import { getPlatformClient } from '@nimiplatform/sdk';
import { dataSync } from '@runtime/data-sync';
import { bootstrapRuntime } from '@renderer/infra/bootstrap/runtime-bootstrap';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { desktopBridge } from '@renderer/bridge';
import { i18n } from '@renderer/i18n';
import {
  isExpectedAnonymousSessionError,
  toAuthTokensDto,
  toAuthUserRecord,
  toCheckEmailResponseDto,
  toOAuthLoginResultDto,
} from './auth-session-utils.js';

export const desktopOAuthBridge: TauriOAuthBridge = {
  hasTauriInvoke: () => desktopBridge.hasTauriInvoke(),
  oauthListenForCode: (payload) => desktopBridge.oauthListenForCode(payload),
  oauthTokenExchange: (payload) => desktopBridge.oauthTokenExchange(payload),
  openExternalUrl: (url) => desktopBridge.openExternalUrl(url),
  focusMainWindow: () => desktopBridge.focusMainWindow(),
};

type AuthTokensDto = RealmModel<'AuthTokensDto'>;
type CheckEmailResponseDto = RealmModel<'CheckEmailResponseDto'>;
type OAuthLoginResultDto = RealmModel<'OAuthLoginResultDto'>;

const desktopRuntimeAccountCaller = {
  appId: 'nimi.desktop',
  appInstanceId: 'nimi.desktop.local-first-party',
  deviceId: 'desktop-shell',
  mode: 2,
  scopes: [],
};

export function createDesktopRuntimeAccountBrowserBroker() {
  return {
    begin: async (input: { callbackUrl: string; baseUrl?: string; timeoutMs: number }) => {
      const response = await getPlatformClient().runtime.account.beginLogin({
        caller: desktopRuntimeAccountCaller,
        redirectUri: input.callbackUrl,
        callbackOrigin: new URL(input.callbackUrl).origin,
        requestedScopes: [],
        ttlSeconds: Math.max(10, Math.ceil(input.timeoutMs / 1000)),
      });
      if (!response.accepted || !response.loginAttemptId || !response.oauthAuthorizationUrl || !response.state || !response.nonce) {
        throw new Error(`Runtime account login could not start: ${String(response.accountReasonCode || response.reasonCode || 'unknown')}`);
      }
      return {
        loginAttemptId: response.loginAttemptId,
        authorizationUrl: buildDesktopWebAuthLaunchUrl({
          callbackUrl: input.callbackUrl,
          state: response.state,
          baseUrl: input.baseUrl,
        }),
        state: response.state,
        nonce: response.nonce,
      };
    },
    complete: async (input: {
      loginAttemptId: string;
      accessToken: string;
      refreshToken: string;
      state: string;
      nonce: string;
      callbackUrl: string;
    }) => {
      const response = await getPlatformClient().runtime.account.completeLogin({
        caller: desktopRuntimeAccountCaller,
        loginAttemptId: input.loginAttemptId,
        code: input.accessToken,
        refreshToken: input.refreshToken,
        state: input.state,
        nonce: input.nonce,
        redirectUri: input.callbackUrl,
        callbackOrigin: new URL(input.callbackUrl).origin,
        uxTraceId: '',
        sealedCompletionTicket: '',
      });
      if (!response.accepted) {
        throw new Error(`Runtime account login could not complete: ${String(response.accountReasonCode || response.reasonCode || 'unknown')}`);
      }
      return {
        user: response.accountProjection?.accountId
          ? {
              id: response.accountProjection.accountId,
              displayName: response.accountProjection.displayName,
              realmEnvironmentId: response.accountProjection.realmEnvironmentId,
            }
          : null,
      };
    },
  };
}

export async function ensureAuthApiReady(): Promise<void> {
  if (dataSync.isApiConfigured()) {
    return;
  }
  await bootstrapRuntime();
  if (!dataSync.isApiConfigured()) {
    throw new Error('API not initialized');
  }
}

export function createDesktopAuthAdapter(): AuthPlatformAdapter {
  const localFirstPartyBlocked = (route: string): never => {
    throw new Error(`Desktop local first-party ${route} is owned by RuntimeAccountService`);
  };
  return {
    supportsPasswordLogin: isWebShellMode(),
    checkEmail: async (email): Promise<CheckEmailResponseDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('checkEmail');
      }
      await ensureAuthApiReady();
      return toCheckEmailResponseDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.checkEmail({ email }),
          '',
        ),
      );
    },

    passwordLogin: async (identifier, password): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('passwordLogin');
      }
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.passwordLogin({ identifier, password }),
          i18n.t('Auth.passwordLoginFailed', { defaultValue: 'Email sign-in failed' }),
        ),
      );
    },

    requestEmailOtp: async (email) => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('requestEmailOtp');
      }
      await ensureAuthApiReady();
      return dataSync.callApi(
        (realm) => realm.services.AuthService.requestEmailOtp({ email }),
        i18n.t('Auth.requestEmailOtpFailed', { defaultValue: 'Failed to send verification code' }),
      );
    },

    verifyEmailOtp: async (email, code): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('verifyEmailOtp');
      }
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.verifyEmailOtp({ email, code }),
          i18n.t('Auth.verifyEmailOtpFailed', { defaultValue: 'Failed to sign in with email code' }),
        ),
      );
    },

    verifyTwoFactor: async (tempToken, code): Promise<AuthTokensDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('verifyTwoFactor');
      }
      await ensureAuthApiReady();
      return toAuthTokensDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.verifyTwoFactor({ tempToken, code }),
          i18n.t('Auth.verifyTwoFactorFailed', { defaultValue: 'Two-factor verification failed' }),
        ),
      );
    },

    walletChallenge: async (input) => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('walletChallenge');
      }
      await ensureAuthApiReady();
      return dataSync.callApi(
        (realm) => realm.services.AuthService.walletChallenge({
          walletAddress: input.walletAddress,
          chainId: input.chainId,
          walletType: input.walletType,
        }),
        i18n.t('Auth.walletChallengeFailed', { defaultValue: 'Failed to get wallet challenge' }),
      );
    },

    walletLogin: async (input): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('walletLogin');
      }
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.walletLogin({
            walletAddress: input.walletAddress,
            chainId: input.chainId,
            nonce: input.nonce,
            message: input.message,
            signature: input.signature,
            walletType: input.walletType,
          }),
          i18n.t('Auth.walletLoginFailed', { defaultValue: 'Wallet sign-in failed' }),
        ),
      );
    },

    oauthLogin: async (provider, accessToken): Promise<OAuthLoginResultDto> => {
      if (!isWebShellMode()) {
        return localFirstPartyBlocked('oauthLogin');
      }
      await ensureAuthApiReady();
      return toOAuthLoginResultDto(
        await dataSync.callApi(
          (realm) => realm.services.AuthService.oauthLogin({
            provider: provider as OAuthProvider,
            accessToken,
          }),
          i18n.t('Auth.oauthLoginFailed', { defaultValue: 'OAuth sign-in failed' }),
        ),
      );
    },

    updatePassword: async (newPassword) => {
      await ensureAuthApiReady();
      await dataSync.updatePassword({ newPassword });
    },

    loadCurrentUser: async () => {
      if (isWebShellMode()) {
        try {
          const user = await dataSync.loadCurrentUser();
          return toAuthUserRecord(user);
        } catch (error) {
          if (isExpectedAnonymousSessionError(error)) {
            return null;
          }
          throw error;
        }
      }
      await ensureAuthApiReady();
      const response = await getPlatformClient().runtime.account.getAccountSessionStatus({
        caller: {
          appId: 'nimi.desktop',
          appInstanceId: 'nimi.desktop.local-first-party',
          deviceId: 'desktop-shell',
          mode: 2,
          scopes: [],
        },
      });
      const projection = response.accountProjection;
      if (!projection?.accountId) {
        return null;
      }
      return toAuthUserRecord({
        id: projection.accountId,
        displayName: projection.displayName,
        realmEnvironmentId: projection.realmEnvironmentId,
      });
    },

    applyToken: async (accessToken, refreshToken) => {
      if (isWebShellMode()) {
        dataSync.setToken(accessToken);
        if (refreshToken) {
          dataSync.setRefreshToken(refreshToken);
        }
        return;
      }
      dataSync.setToken('');
      dataSync.setRefreshToken('');
    },
    restoreSession: async () => localFirstPartyBlocked('restoreSession'),
    persistSession: async ({ accessToken, user }) => {
      if (isWebShellMode()) {
        const updatedAt = new Date().toISOString();
        persistAuthSessionMetadata({
          user,
          updatedAt,
          expiresAt: resolveSessionExpiry(accessToken, updatedAt),
        });
        return;
      }
    },
    clearPersistedSession: async () => {
      if (isWebShellMode()) {
        clearPersistedAccessToken();
        return;
      }
    },

    oauthBridge: desktopOAuthBridge,
    syncAfterLogin: async () => {
      if (isWebShellMode()) {
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: ['chats'] }),
          queryClient.invalidateQueries({ queryKey: ['contacts'] }),
        ]);
        return;
      }

      // Direct dataSync calls removed — query invalidation triggers
      // React Query refetches which call the dataSync methods once each.
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts'] }),
      ]);
    },
  };
}
