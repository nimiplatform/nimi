import type { FormEvent } from 'react';
import type { AuthTokensDto, OAuthLoginResultDto } from '@nimiplatform/sdk/realm';
import { OAuthLoginState } from '@nimiplatform/sdk/realm';
import {
  startSocialOauth,
  toOauthProvider,
  type SocialOauthProvider,
} from '@nimiplatform/shell-core/oauth';
import type { AuthView, DesktopCallbackRequest, GoogleWindow } from '../types/auth-types.js';
import type { AuthPlatformAdapter } from '../platform/auth-platform-adapter.js';
import { persistAuthSession } from './auth-session-storage.js';
import { buildDesktopCallbackReturnUrl } from './desktop-callback-helpers.js';
import { saveRememberedLogin, clearRememberedLogin } from './remember-login.js';
import { loadGoogleScript, getGoogleClientId } from './google-helpers.js';
import { toErrorMessage } from './error-helpers.js';

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
    throw new Error('登录返回缺少 access token');
  }

  const refreshToken =
    typeof tokens.refreshToken === 'string' ? tokens.refreshToken.trim() : '';
  const user = tokens.user && typeof tokens.user === 'object'
    ? (tokens.user as Record<string, unknown>)
    : null;

  await adapter.applyToken(accessToken, refreshToken || undefined);
  setters.setAuthSession(user, accessToken, refreshToken || undefined);
  persistAuthSession({
    accessToken,
    refreshToken,
    user,
  });

  if (desktopCtx.desktopCallbackRequest) {
    const callbackReturnUrl = buildDesktopCallbackReturnUrl({
      request: desktopCtx.desktopCallbackRequest,
      accessToken,
    });
    window.location.replace(callbackReturnUrl);
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
    throw new Error('登录返回缺少 tokens');
  }

  await applyTokens(result.tokens, successMessage, setters, desktopCtx, adapter);

  if (result.loginState === OAuthLoginState.NEEDS_ONBOARDING) {
    setters.setStatusBanner({
      kind: 'warning',
      message: '已登录，请完成资料设置。',
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
    setters.setLoginError('缺少 Google Client ID（VITE_NIMI_GOOGLE_CLIENT_ID）');
    return;
  }

  setters.setPending(true);
  try {
    await loadGoogleScript();
    const win = window as GoogleWindow;
    const initTokenClient = win.google?.accounts?.oauth2?.initTokenClient;
    if (!initTokenClient) {
      throw new Error('Google OAuth 初始化失败');
    }

    const tokenClient = initTokenClient({
      client_id: googleClientId,
      scope: 'email profile openid',
      callback: (tokenResponse) => {
        const accessToken = String(tokenResponse?.access_token || '').trim();
        if (!accessToken) {
          setters.setLoginError('Google 没有返回 access token');
          setters.setPending(false);
          return;
        }

        void (async () => {
          try {
            const result = await adapter.oauthLogin('GOOGLE', accessToken);
            await handleLoginResult(result, 'Google 登录成功。', setters, desktopCtx, adapter);
          } catch (error) {
            setters.setLoginError(toErrorMessage(error, 'Google 登录失败'));
          } finally {
            setters.setPending(false);
          }
        })();
      },
    });

    tokenClient.requestAccessToken();
  } catch (error) {
    setters.setLoginError(toErrorMessage(error, 'Google 初始化失败'));
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
      toOauthProvider(oauthResult.provider),
      oauthResult.accessToken,
    );
    await handleLoginResult(result, `${providerLabel} 登录成功。`, setters, desktopCtx, adapter);
  } catch (error) {
    setters.setLoginError(toErrorMessage(error, `${providerLabel} 登录失败`));
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
    setters.setLoginError('请输入邮箱和密码');
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    const result = await adapter.passwordLogin(identifier, password);

    if (rememberMe) {
      saveRememberedLogin({ email: identifier, password, rememberMe: true });
    } else {
      clearRememberedLogin();
    }

    await handleLoginResult(result, '登录成功。', setters, desktopCtx, adapter, 'main');
  } catch (error) {
    setters.setLoginError(toErrorMessage(error, '邮箱登录失败'));
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
    setters.setLoginError('密码至少 8 位');
    return;
  }

  if (password !== confirmPassword) {
    setters.setLoginError('两次输入的密码不一致');
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    await adapter.updatePassword(password);

    const latestUser = await adapter.loadCurrentUser().catch(() => null);
    const latestUserRecord = latestUser && typeof latestUser === 'object'
      ? (latestUser as AuthTokensDto['user'])
      : null;
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
    await applyTokens(finalizedTokens, '注册成功。', setters, desktopCtx, adapter);
  } catch (error) {
    setters.setLoginError(toErrorMessage(error, '设置密码失败'));
  } finally {
    setters.setPending(false);
  }
}
