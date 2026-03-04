import type { FormEvent } from 'react';
import type { AuthTokensDto, AuthView, DesktopCallbackRequest, GoogleWindow, OAuthLoginResultDto } from './auth-helpers.js';
import type { StatusBanner } from '@renderer/app-shell/providers/store-types';
import {
  OAuthLoginState,
  OAuthProvider,
  buildDesktopCallbackReturnUrl,
  clearRememberedLogin,
  dataSync,
  loadGoogleScript,
  persistAuthSession,
  queryClient,
  saveRememberedLogin,
  toErrorMessage,
} from './auth-helpers.js';
import { startSocialOauth, toOauthProvider, type SocialOauthProvider } from './social-oauth.js';

// ---------------------------------------------------------------------------
// State setter interface — passed by the AuthMenu component
// ---------------------------------------------------------------------------

export type AuthMenuSetters = {
  setView: (view: AuthView) => void;
  setPending: (pending: boolean) => void;
  setLoginError: (error: string | null) => void;
  setShowLoginModal: (show: boolean) => void;
  setOtpCode: (code: string) => void;
  setOtpResendCountdown: (countdown: number) => void;
  setTempToken: (token: string) => void;
  setTwoFactorCode: (code: string) => void;
  setStatusBanner: (banner: StatusBanner | null) => void;
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

  dataSync.setToken(accessToken);
  if (refreshToken) {
    dataSync.setRefreshToken(refreshToken);
  }
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

  await Promise.allSettled([
    dataSync.loadChats(),
    dataSync.loadContacts(),
    queryClient.invalidateQueries({ queryKey: ['chats'] }),
    queryClient.invalidateQueries({ queryKey: ['contacts'] }),
  ]);

  setters.setStatusBanner({
    kind: 'success',
    message: successMessage,
  });
  setters.setLoginError(null);
  setters.setShowLoginModal(false);
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
): Promise<void> {
  if (result.loginState === OAuthLoginState.BLOCKED) {
    setters.setLoginError(String(result.blockedReason || '账号不可用，请联系支持团队。'));
    return;
  }

  if (result.loginState === OAuthLoginState.NEEDS_TWO_FACTOR) {
    setters.setTempToken(String(result.tempToken || ''));
    setters.setTwoFactorCode('');
    setters.setView('email_2fa');
    return;
  }

  if (!result.tokens) {
    throw new Error('登录返回缺少 tokens');
  }

  await applyTokens(result.tokens, successMessage, setters, desktopCtx);

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
  googleClientId: string | null,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
): Promise<void> {
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
            const result = await dataSync.callApi(
              (realm) => realm.services.AuthService.oauthLogin({
                provider: OAuthProvider.GOOGLE,
                accessToken,
              }),
              'Google 登录失败',
            );
            await handleLoginResult(result, 'Google 登录成功。', setters, desktopCtx);
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

export async function handleSocialLogin(
  provider: SocialOauthProvider,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
): Promise<void> {
  const providerLabel = provider === 'TWITTER' ? 'Twitter' : 'TikTok';
  setters.setLoginError(null);
  setters.setPending(true);
  try {
    const oauthResult = await startSocialOauth(provider);
    const result = await dataSync.callApi(
      (realm) => realm.services.AuthService.oauthLogin({
        provider: toOauthProvider(oauthResult.provider),
        accessToken: oauthResult.accessToken,
      }),
      `${providerLabel} 登录失败`,
    );
    await handleLoginResult(result, `${providerLabel} 登录成功。`, setters, desktopCtx);
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
    const result = await dataSync.callApi(
      (realm) => realm.services.AuthService.passwordLogin({
        identifier,
        password,
      }),
      '邮箱登录失败',
    );

    // 保存或清除记住的登录凭据
    if (rememberMe) {
      saveRememberedLogin({ email: identifier, password, rememberMe: true });
    } else {
      clearRememberedLogin();
    }

    await handleLoginResult(result, '登录成功。', setters, desktopCtx);
  } catch (error) {
    setters.setLoginError(toErrorMessage(error, '邮箱登录失败'));
  } finally {
    setters.setPending(false);
  }
}

// ---------------------------------------------------------------------------
// handleEmailRegister
// ---------------------------------------------------------------------------

export async function handleEmailRegister(
  event: FormEvent,
  email: string,
  password: string,
  confirmPassword: string,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
): Promise<void> {
  event.preventDefault();
  const normalizedEmail = email.trim();
  if (!normalizedEmail) {
    setters.setLoginError('请输入邮箱');
    return;
  }

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
    const result = await dataSync.callApi(
      (realm) => realm.services.AuthService.passwordRegister({
        email: normalizedEmail,
        password,
      }),
      '邮箱注册失败',
    );
    await handleLoginResult(result, '注册并登录成功。', setters, desktopCtx);
  } catch (error) {
    setters.setLoginError(toErrorMessage(error, '邮箱注册失败'));
  } finally {
    setters.setPending(false);
  }
}
