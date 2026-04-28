import type { FormEvent } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { OAuthLoginState } from '@nimiplatform/sdk/realm';
import {
  startSocialOauth,
  type SocialOauthProvider,
} from './social-oauth.js';
import type { AuthView, DesktopCallbackRequest, ShellAuthWindow } from '../types/auth-types.js';
import type { AuthPlatformAdapter } from '../platform/auth-platform-adapter.js';
import { persistAuthSession } from './auth-session-storage.js';
import {
  AUTH_COPY,
  formatProviderLoginFailureMessage,
  formatProviderLoginSuccessMessage,
  toAuthUiErrorMessage,
} from './auth-copy.js';
import { submitDesktopCallbackResult } from './desktop-callback-helpers.js';
import { saveRememberedLogin, clearRememberedLogin } from './remember-login.js';
import { loadGoogleScript, getGoogleClientId } from './google-helpers.js';

type AuthTokensDto = RealmModel<'AuthTokensDto'>;
type OAuthLoginResultDto = RealmModel<'OAuthLoginResultDto'>;

// ---------------------------------------------------------------------------
// State setter interface — passed by the AuthMenu component
// ---------------------------------------------------------------------------

export type AuthMenuSetters = {
  setView: (view: AuthView) => void;
  setPending: (pending: boolean) => void;
  setLoginError: (error: string | null) => void;
  setPendingTokens: (tokens: AuthTokensDto | null) => void;
  setOtpCode: (code: string) => void;
  setOtpResendCountdown: (countdown: number) => void;
  setTempToken: (token: string) => void;
  setTwoFactorCode: (code: string) => void;
  setTwoFactorReturnView: (view: AuthView) => void;
  setStatusBanner: (banner: { kind: string; message: string } | null) => void;
  setAuthSession: (user: Record<string, unknown> | null, token: string, refreshToken?: string) => void;
};

export type DesktopCallbackContext = {
  desktopCallbackRequest: DesktopCallbackRequest | null;
  desktopCallbackToken: string;
  desktopCallbackUser: Record<string, unknown> | null;
  authToken: string | null;
};

// ---------------------------------------------------------------------------
// applyTokens — finalize login by persisting tokens + syncing data
// ---------------------------------------------------------------------------

export async function applyTokens(
  tokens: AuthTokensDto,
  successMessage: string,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
  adapter: AuthPlatformAdapter,
): Promise<void> {
  const accessToken = String(tokens.accessToken || '').trim();
  if (!accessToken) {
    throw new Error(AUTH_COPY.loginMissingAccessToken);
  }

  const refreshToken =
    typeof tokens.refreshToken === 'string' ? tokens.refreshToken.trim() : '';
  const user = tokens.user && typeof tokens.user === 'object'
    ? (tokens.user as Record<string, unknown>)
    : null;

  await adapter.applyToken(accessToken, refreshToken || undefined);
  setters.setAuthSession(user, accessToken, refreshToken || undefined);
  await adapter.persistSession?.({
    accessToken,
    refreshToken,
    user,
  });
  persistAuthSession({
    accessToken,
    refreshToken,
    user,
  });

  if (desktopCtx.desktopCallbackRequest) {
    submitDesktopCallbackResult({
      request: desktopCtx.desktopCallbackRequest,
      code: accessToken,
      refreshToken,
    });
    return;
  }

  if (adapter.syncAfterLogin) {
    await adapter.syncAfterLogin();
  }

  setters.setStatusBanner({
    kind: 'success',
    message: successMessage,
  });
  setters.setLoginError(null);
  setters.setView('main');
}

// ---------------------------------------------------------------------------
// handleLoginResult — process OAuthLoginResultDto
// ---------------------------------------------------------------------------

export async function handleLoginResult(
  result: OAuthLoginResultDto,
  successMessage: string,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
  adapter: AuthPlatformAdapter,
  twoFactorReturnView: AuthView = 'main',
): Promise<void> {
  if (result.loginState === OAuthLoginState.BLOCKED) {
    setters.setLoginError(String(result.blockedReason || '账号不可用，请联系支持团队。'));
    return;
  }

  if (result.loginState === OAuthLoginState.NEEDS_TWO_FACTOR) {
    setters.setTempToken(String(result.tempToken || ''));
    setters.setTwoFactorCode('');
    setters.setTwoFactorReturnView(twoFactorReturnView);
    setters.setView('email_2fa');
    return;
  }

  if (!result.tokens) {
    throw new Error(AUTH_COPY.loginMissingTokenPayload);
  }

  await applyTokens(result.tokens, successMessage, setters, desktopCtx, adapter);

  if (result.loginState === OAuthLoginState.NEEDS_ONBOARDING) {
    setters.setStatusBanner({
      kind: 'warning',
      message: AUTH_COPY.onboardingPending,
    });
  }
}

// ---------------------------------------------------------------------------
// handleGoogleLogin
// ---------------------------------------------------------------------------

export async function handleGoogleLogin(
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
  adapter: AuthPlatformAdapter,
): Promise<void> {
  const googleClientId = getGoogleClientId();
  setters.setLoginError(null);
  if (!googleClientId) {
    setters.setLoginError(AUTH_COPY.googleClientIdMissing);
    return;
  }

  setters.setPending(true);
  try {
    await loadGoogleScript();
    const win = window as ShellAuthWindow;
    const initTokenClient = win.google?.accounts?.oauth2?.initTokenClient;
    if (!initTokenClient) {
      throw new Error(AUTH_COPY.googleOAuthInitFailed);
    }

    const tokenClient = initTokenClient({
      client_id: googleClientId,
      scope: 'email profile openid',
      callback: (tokenResponse) => {
        const accessToken = String(tokenResponse?.access_token || '').trim();
        if (!accessToken) {
          setters.setLoginError(AUTH_COPY.googleAccessTokenMissing);
          setters.setPending(false);
          return;
        }

        void (async () => {
          try {
            const result = await adapter.oauthLogin('GOOGLE', accessToken);
            await handleLoginResult(
              result,
              formatProviderLoginSuccessMessage('Google'),
              setters,
              desktopCtx,
              adapter,
            );
          } catch (error) {
            setters.setLoginError(
              toAuthUiErrorMessage(error, formatProviderLoginFailureMessage('Google')),
            );
          } finally {
            setters.setPending(false);
          }
        })();
      },
    });

    tokenClient.requestAccessToken();
  } catch (error) {
    setters.setLoginError(toAuthUiErrorMessage(error, AUTH_COPY.googleInitFailed));
    setters.setPending(false);
  }
}

// ---------------------------------------------------------------------------
// handleSocialLogin
// ---------------------------------------------------------------------------

export async function handleSocialLogin(
  provider: SocialOauthProvider,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
  adapter: AuthPlatformAdapter,
): Promise<void> {
  const providerLabel = provider === 'TWITTER' ? 'Twitter' : 'TikTok';
  setters.setLoginError(null);
  setters.setPending(true);
  try {
    const oauthResult = await startSocialOauth(provider, adapter.oauthBridge);
    const result = await adapter.oauthLogin(
      oauthResult.provider,
      oauthResult.accessToken,
    );
    await handleLoginResult(
      result,
      formatProviderLoginSuccessMessage(providerLabel),
      setters,
      desktopCtx,
      adapter,
    );
  } catch (error) {
    setters.setLoginError(
      toAuthUiErrorMessage(error, formatProviderLoginFailureMessage(providerLabel)),
    );
  } finally {
    setters.setPending(false);
  }
}

// ---------------------------------------------------------------------------
// handleEmailLogin
// ---------------------------------------------------------------------------

export async function handleEmailLogin(
  event: FormEvent,
  email: string,
  password: string,
  rememberMe: boolean,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
  adapter: AuthPlatformAdapter,
): Promise<void> {
  event.preventDefault();
  const identifier = email.trim();
  if (!identifier || !password) {
    setters.setLoginError(AUTH_COPY.emailAndPasswordRequired);
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    if (typeof adapter.passwordLogin !== 'function') {
      throw new Error(AUTH_COPY.passwordLoginUnsupported);
    }
    const result = await adapter.passwordLogin(identifier, password);

    if (rememberMe) {
      saveRememberedLogin({ email: identifier, rememberMe: true });
    } else {
      clearRememberedLogin();
    }

    await handleLoginResult(result, AUTH_COPY.emailLoginSuccess, setters, desktopCtx, adapter, 'main');
  } catch (error) {
    setters.setLoginError(toAuthUiErrorMessage(error, AUTH_COPY.emailLoginFailed));
  } finally {
    setters.setPending(false);
  }
}

// ---------------------------------------------------------------------------
// handleSetPasswordAfterOtp
// ---------------------------------------------------------------------------

export async function handleSetPasswordAfterOtp(
  event: FormEvent,
  password: string,
  confirmPassword: string,
  pendingTokens: AuthTokensDto,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
  adapter: AuthPlatformAdapter,
): Promise<void> {
  event.preventDefault();
  if (password.length < 8) {
    setters.setLoginError(AUTH_COPY.passwordTooShort);
    return;
  }

  if (password !== confirmPassword) {
    setters.setLoginError(AUTH_COPY.passwordMismatch);
    return;
  }

  const finalizePendingTokens = async (): Promise<void> => {
    let latestUserRecord: AuthTokensDto['user'] | null = null;
    try {
      const latestUser = await adapter.loadCurrentUser();
      latestUserRecord = latestUser && typeof latestUser === 'object'
        ? (latestUser as AuthTokensDto['user'])
        : null;
    } catch {
      latestUserRecord = null;
    }

    const finalizedTokens: AuthTokensDto = latestUserRecord
      ? {
          ...pendingTokens,
          user: pendingTokens.user && typeof pendingTokens.user === 'object'
            ? {
                ...pendingTokens.user,
                ...latestUserRecord,
                hasPassword: true,
              }
            : {
                ...latestUserRecord,
                hasPassword: true,
              },
        }
      : pendingTokens.user && typeof pendingTokens.user === 'object'
        ? {
            ...pendingTokens,
            user: {
              ...pendingTokens.user,
              hasPassword: true,
            },
          }
        : pendingTokens;

    setters.setPendingTokens(null);
    try {
      await applyTokens(finalizedTokens, AUTH_COPY.setPasswordSuccess, setters, desktopCtx, adapter);
    } catch (error) {
      await adapter.applyToken('');
      setters.setView('main');
      setters.setLoginError(
        toAuthUiErrorMessage(error, AUTH_COPY.setPasswordFinalizeFailed),
      );
    }
  };

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    await adapter.updatePassword(password);
    await finalizePendingTokens();
  } catch (error) {
    setters.setLoginError(toAuthUiErrorMessage(error, AUTH_COPY.setPasswordFailed));
  } finally {
    setters.setPending(false);
  }
}
