import type { FormEvent } from 'react';
import {
  NIMI_REALM_OAUTH_LOGIN_STATE,
  readNimiRealmOAuthLoginTokens,
  toNimiRealmAuthUserRecord,
  type NimiRealmAuthTokens,
  type NimiRealmOAuthLoginResult,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  startSocialOauth,
  type SocialOauthProvider,
} from './social-oauth.js';
import type { AuthView, ShellAuthWindow } from '../types/auth-types.js';
import type { AuthPlatformAdapter } from '../platform/auth-platform-adapter.js';
import { persistAuthSession } from './auth-session-storage.js';
import {
  AUTH_COPY,
  formatProviderLoginFailureMessage,
  formatProviderLoginSuccessMessage,
  toAuthUiErrorMessage,
} from './auth-copy.js';
import { saveRememberedLogin, clearRememberedLogin } from './remember-login.js';
import { loadGoogleScript, getGoogleClientId } from './google-helpers.js';

type AuthTokensDto = NimiRealmAuthTokens;
type OAuthLoginResultDto = NimiRealmOAuthLoginResult;

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
  setAuthSession: (user: Record<string, unknown> | null, token: string) => void;
};

// ---------------------------------------------------------------------------
// applyTokens — finalize login by persisting tokens + syncing data
// ---------------------------------------------------------------------------

export async function applyTokens(
  tokens: AuthTokensDto,
  successMessage: string,
  setters: AuthMenuSetters,
  adapter: AuthPlatformAdapter,
): Promise<void> {
  const accessToken = String(tokens.accessToken || '').trim();
  if (!accessToken) {
    throw new Error(AUTH_COPY.loginMissingAccessToken);
  }

  const refreshToken =
    typeof tokens.refreshToken === 'string' ? tokens.refreshToken.trim() : '';
  const user = toNimiRealmAuthUserRecord(tokens.user);

  await adapter.applyToken(accessToken, refreshToken || undefined);
  setters.setAuthSession(user, accessToken);
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
  adapter: AuthPlatformAdapter,
  twoFactorReturnView: AuthView = 'main',
): Promise<void> {
  if (result.loginState === NIMI_REALM_OAUTH_LOGIN_STATE.BLOCKED) {
    setters.setLoginError(String(result.blockedReason || '账号不可用，请联系支持团队。'));
    return;
  }

  if (result.loginState === NIMI_REALM_OAUTH_LOGIN_STATE.NEEDS_TWO_FACTOR) {
    setters.setTempToken(String(result.tempToken || ''));
    setters.setTwoFactorCode('');
    setters.setTwoFactorReturnView(twoFactorReturnView);
    setters.setView('email_2fa');
    return;
  }

  const tokens = readNimiRealmOAuthLoginTokens(result);
  if (!tokens) {
    throw new Error(AUTH_COPY.loginMissingTokenPayload);
  }

  await applyTokens(tokens, successMessage, setters, adapter);

  if (result.loginState === NIMI_REALM_OAUTH_LOGIN_STATE.NEEDS_ONBOARDING) {
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

    await handleLoginResult(result, AUTH_COPY.emailLoginSuccess, setters, adapter, 'main');
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
    let latestUserRecord: Record<string, unknown> | null = null;
    try {
      const latestUser = await adapter.loadCurrentUser();
      latestUserRecord = toNimiRealmAuthUserRecord(latestUser);
    } catch {
      latestUserRecord = null;
    }

    const pendingUserRecord = toNimiRealmAuthUserRecord(pendingTokens.user);
    const finalizedUser = pendingUserRecord || latestUserRecord
      ? {
          ...(pendingUserRecord || {}),
          ...(latestUserRecord || {}),
          hasPassword: true,
        }
      : null;

    const finalizedTokens: AuthTokensDto = finalizedUser
      ? {
          ...pendingTokens,
          user: finalizedUser,
        }
      : pendingTokens;

    setters.setPendingTokens(null);
    try {
      await applyTokens(finalizedTokens, AUTH_COPY.setPasswordSuccess, setters, adapter);
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
