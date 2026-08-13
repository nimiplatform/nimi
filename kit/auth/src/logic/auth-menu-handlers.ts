import type { FormEvent } from 'react';
import {
  NIMI_REALM_OAUTH_LOGIN_STATE,
  toNimiRealmAuthUserRecord,
  type NimiRealmOAuthLoginResult,
} from '@nimiplatform/kit/core/sdk-contract';
import type { SocialOauthProvider } from './social-oauth.js';
import type { AuthView } from '../types/auth-types.js';
import type { WebAccountAuthAdapter } from '../platform/web-account-auth-adapter.js';
import {
  AUTH_COPY,
  formatProviderLoginFailureMessage,
  formatProviderLoginSuccessMessage,
  toAuthUiErrorMessage,
} from './auth-copy.js';
import { saveRememberedLogin, clearRememberedLogin } from './remember-login.js';
import { getGoogleClientId, requestGoogleIdToken } from './google-helpers.js';

type OAuthLoginResultDto = NimiRealmOAuthLoginResult;

// ---------------------------------------------------------------------------
// State setter interface — passed by the AuthMenu component
// ---------------------------------------------------------------------------

export type AuthMenuSetters = {
  setView: (view: AuthView) => void;
  setPending: (pending: boolean) => void;
  setLoginError: (error: string | null) => void;
  setPendingPasswordSetup: (pending: boolean) => void;
  setOtpCode: (code: string) => void;
  setOtpResendCountdown: (countdown: number) => void;
  setTempToken: (token: string) => void;
  setTwoFactorCode: (code: string) => void;
  setTwoFactorReturnView: (view: AuthView) => void;
  setStatusBanner: (banner: { kind: string; message: string } | null) => void;
  setAuthSession: (user: Record<string, unknown> | null) => void;
};

// ---------------------------------------------------------------------------
// Browser-session completion never receives or persists bearer material.
// ---------------------------------------------------------------------------

export async function completeBrowserSession(
  successMessage: string,
  setters: AuthMenuSetters,
  adapter: WebAccountAuthAdapter,
): Promise<void> {
  const user = toNimiRealmAuthUserRecord(await adapter.completeBrowserSessionLogin());
  if (!user) throw new Error(AUTH_COPY.loginMissingTokenPayload);
  setters.setAuthSession(user);

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
  adapter: WebAccountAuthAdapter,
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

  if (result.tokens != null) {
    throw new Error('Realm browser-session authentication returned forbidden bearer material.');
  }
  await completeBrowserSession(successMessage, setters, adapter);

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
  adapter: WebAccountAuthAdapter,
): Promise<void> {
  const googleClientId = getGoogleClientId();
  setters.setLoginError(null);
  if (!googleClientId) {
    setters.setLoginError(AUTH_COPY.googleClientIdMissing);
    return;
  }

  setters.setPending(true);
  try {
    const idToken = await requestGoogleIdToken(googleClientId);
    const result = await adapter.oauthLogin({ provider: 'GOOGLE', idToken });
    await handleLoginResult(
      result,
      formatProviderLoginSuccessMessage('Google'),
      setters,
      adapter,
    );
  } catch (error) {
    setters.setLoginError(toAuthUiErrorMessage(error, AUTH_COPY.googleInitFailed));
  } finally {
    setters.setPending(false);
  }
}

// ---------------------------------------------------------------------------
// handleSocialLogin
// ---------------------------------------------------------------------------

export async function handleSocialLogin(
  provider: SocialOauthProvider,
  setters: AuthMenuSetters,
  adapter: WebAccountAuthAdapter,
): Promise<void> {
  const providerLabel = 'TikTok';
  setters.setLoginError(null);
  setters.setPending(true);
  try {
    if (!adapter.beginSocialOAuth) {
      throw new Error(AUTH_COPY.socialOauthBridgeMissing);
    }
    const oauthResult = await adapter.beginSocialOAuth(provider);
    if (!oauthResult) return;
    const result = await adapter.oauthLogin(oauthResult);
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
  adapter: WebAccountAuthAdapter,
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
  setters: AuthMenuSetters,
  adapter: WebAccountAuthAdapter,
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

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    await adapter.updatePassword(password);
    setters.setPendingPasswordSetup(false);
    await completeBrowserSession(AUTH_COPY.setPasswordSuccess, setters, adapter);
  } catch (error) {
    setters.setLoginError(toAuthUiErrorMessage(error, AUTH_COPY.setPasswordFailed));
  } finally {
    setters.setPending(false);
  }
}
