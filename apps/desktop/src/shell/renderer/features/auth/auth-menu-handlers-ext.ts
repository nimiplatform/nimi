import type { FormEvent } from 'react';
import type { WalletType } from './auth-helpers.js';
import {
  buildDesktopCallbackReturnUrl,
  dataSync,
  loadPersistedAuthSession,
  parseChainId,
  persistAuthSession,
  resolveWalletProvider,
  toErrorMessage,
} from './auth-helpers.js';
import { shouldPromptPasswordSetupAfterEmailOtp } from './auth-email-flow.js';
import type { AuthMenuSetters, DesktopCallbackContext } from './auth-menu-handlers.js';
import { applyTokens, handleLoginResult } from './auth-menu-handlers.js';

// ---------------------------------------------------------------------------
// handleRequestEmailOtp
// ---------------------------------------------------------------------------

export async function handleRequestEmailOtp(
  event: FormEvent,
  email: string,
  setters: AuthMenuSetters,
): Promise<void> {
  event.preventDefault();
  const normalizedEmail = email.trim();
  if (!normalizedEmail) {
    setters.setLoginError('请输入邮箱');
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    const result = await dataSync.callApi(
      (realm) => realm.services.AuthService.requestEmailOtp({ email: normalizedEmail }),
      '发送验证码失败',
    );
    if (!result?.success) {
      throw new Error(String(result?.message || '发送验证码失败'));
    }
    setters.setOtpCode('');
    setters.setOtpResendCountdown(60);
    setters.setView('email_otp_verify');
  } catch (error) {
    setters.setLoginError(toErrorMessage(error, '发送验证码失败'));
  } finally {
    setters.setPending(false);
  }
}

// ---------------------------------------------------------------------------
// handleVerifyEmailOtp
// ---------------------------------------------------------------------------

export async function handleVerifyEmailOtp(
  event: FormEvent,
  email: string,
  otpCode: string,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
): Promise<void> {
  event.preventDefault();
  const normalizedEmail = email.trim();
  if (!normalizedEmail || otpCode.length !== 6) {
    setters.setLoginError('请输入 6 位验证码');
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    const result = await dataSync.callApi(
      (realm) => realm.services.AuthService.verifyEmailOtp({
        email: normalizedEmail,
        code: otpCode,
      }),
      '验证码登录失败',
    );
    if (result.tokens && shouldPromptPasswordSetupAfterEmailOtp(result)) {
      const accessToken = String(result.tokens.accessToken || '').trim();
      const refreshToken = String(result.tokens.refreshToken || '').trim();
      dataSync.setToken(accessToken);
      dataSync.setRefreshToken(refreshToken);
      setters.setPendingTokens(result.tokens);
      setters.setOtpCode('');
      setters.setView('email_set_password');
      return;
    }
    await handleLoginResult(result, '验证码登录成功。', setters, desktopCtx, 'email_otp_verify');
  } catch (error) {
    setters.setLoginError(toErrorMessage(error, '验证码登录失败'));
  } finally {
    setters.setPending(false);
  }
}

// ---------------------------------------------------------------------------
// handleResendOtp
// ---------------------------------------------------------------------------

export async function handleResendOtp(
  email: string,
  otpResendCountdown: number,
  setters: AuthMenuSetters,
): Promise<void> {
  if (otpResendCountdown > 0) {
    return;
  }

  const normalizedEmail = email.trim();
  if (!normalizedEmail) {
    setters.setLoginError('请输入邮箱');
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    const result = await dataSync.callApi(
      (realm) => realm.services.AuthService.requestEmailOtp({ email: normalizedEmail }),
      '重新发送验证码失败',
    );
    if (!result?.success) {
      throw new Error(String(result?.message || '重新发送验证码失败'));
    }
    setters.setOtpResendCountdown(60);
    setters.setOtpCode('');
  } catch (error) {
    setters.setLoginError(toErrorMessage(error, '重新发送验证码失败'));
  } finally {
    setters.setPending(false);
  }
}

// ---------------------------------------------------------------------------
// handleVerify2Fa
// ---------------------------------------------------------------------------

export async function handleVerify2Fa(
  event: FormEvent,
  tempToken: string,
  twoFactorCode: string,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
): Promise<void> {
  event.preventDefault();
  if (!tempToken || twoFactorCode.length !== 6) {
    setters.setLoginError('请输入 6 位 2FA 验证码');
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    const tokens = await dataSync.callApi(
      (realm) => realm.services.AuthService.verifyTwoFactor({
        tempToken,
        code: twoFactorCode,
      }),
      '2FA 验证失败',
    );
    await applyTokens(tokens, '2FA 验证成功，已登录。', setters, desktopCtx);
  } catch (error) {
    setters.setLoginError(toErrorMessage(error, '2FA 验证失败'));
  } finally {
    setters.setPending(false);
  }
}

// ---------------------------------------------------------------------------
// handleConfirmDesktopAuthorization
// ---------------------------------------------------------------------------

export async function handleConfirmDesktopAuthorization(
  event: FormEvent,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
): Promise<void> {
  event.preventDefault();
  if (!desktopCtx.desktopCallbackRequest) {
    setters.setLoginError('无效的桌面授权请求，请重试。');
    setters.setView('main');
    return;
  }

  const latestPersistedAuthSession = loadPersistedAuthSession();
  const accessToken = String(
    latestPersistedAuthSession?.accessToken
    || desktopCtx.authToken
    || desktopCtx.desktopCallbackToken
    || '',
  ).trim();
  if (!accessToken) {
    setters.setLoginError('当前未检测到已登录会话，请先登录后再授权。');
    setters.setView('main');
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    dataSync.setToken(accessToken);
    const user = await dataSync.loadCurrentUser();
    const normalizedUser = user && typeof user === 'object'
      ? (user as Record<string, unknown>)
      : null;

    setters.setAuthSession(
      normalizedUser,
      accessToken,
      latestPersistedAuthSession?.refreshToken || undefined,
    );
    persistAuthSession({
      accessToken,
      refreshToken: latestPersistedAuthSession?.refreshToken || '',
      user: normalizedUser ?? desktopCtx.desktopCallbackUser,
    });

    const callbackReturnUrl = buildDesktopCallbackReturnUrl({
      request: desktopCtx.desktopCallbackRequest,
      accessToken,
    });
    window.location.replace(callbackReturnUrl);
  } catch (error) {
    const message = toErrorMessage(error, '当前登录态已失效，请重新登录后再授权。');
    const normalized = message.toUpperCase();
    setters.setLoginError(
      normalized.includes('HTTP_401') || normalized.includes('UNAUTHORIZED')
        ? '当前登录态已过期，请重新登录后再授权。'
        : message,
    );
    setters.setView('main');
  } finally {
    setters.setPending(false);
  }
}

// ---------------------------------------------------------------------------
// handleWalletLogin
// ---------------------------------------------------------------------------

export async function handleWalletLogin(
  walletType: WalletType,
  setters: AuthMenuSetters,
  desktopCtx: DesktopCallbackContext,
): Promise<void> {
  setters.setPending(true);
  setters.setLoginError(null);

  // 设置超时保护，30秒后自动重置状态
  const timeoutId = window.setTimeout(() => {
    setters.setPending(false);
  }, 30000);

  try {
    const provider = resolveWalletProvider(walletType);
    if (!provider) {
      throw new Error(
        walletType === 'metamask'
          ? '未检测到 MetaMask 钱包'
          : walletType === 'okx'
            ? '未检测到 OKX 钱包'
            : '未检测到 Binance 钱包',
      );
    }

    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    }) as string[];
    const walletAddress = String(accounts?.[0] || '').trim();
    if (!walletAddress) {
      throw new Error('钱包未返回地址');
    }

    const chainIdRaw = await provider.request({
      method: 'eth_chainId',
    });
    const chainId = parseChainId(chainIdRaw);

    const challenge = await dataSync.callApi(
      (realm) => realm.services.AuthService.walletChallenge({
        walletAddress,
        chainId,
        walletType,
      }),
      '获取钱包签名挑战失败',
    );

    const challengeMessage = String(challenge?.message || '').trim();
    if (!challengeMessage) {
      throw new Error('无效的钱包签名挑战');
    }

    const signature = await provider.request({
      method: 'personal_sign',
      params: [challengeMessage, walletAddress],
    }) as string;
    if (!signature) {
      throw new Error('钱包签名失败');
    }

    const result = await dataSync.callApi(
      (realm) => realm.services.AuthService.walletLogin({
        walletAddress,
        chainId,
        nonce: challenge.nonce,
        message: challengeMessage,
        signature,
        walletType,
      }),
      '钱包登录失败',
    );

    await handleLoginResult(result, '钱包登录成功。', setters, desktopCtx);
  } catch (_error) {
    // 用户取消操作或其他错误，不显示错误提示
  } finally {
    window.clearTimeout(timeoutId);
    setters.setPending(false);
  }
}
