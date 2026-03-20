import type { FormEvent } from 'react';
import type { WalletType } from '../types/auth-types.js';
import type { AuthPlatformAdapter } from '../platform/auth-platform-adapter.js';
import { shouldPromptPasswordSetupAfterEmailOtp } from './auth-email-flow.js';
import { loadPersistedAuthSession, persistAuthSession } from './auth-session-storage.js';
import { buildDesktopCallbackReturnUrl } from './desktop-callback-helpers.js';
import { parseChainId, resolveWalletProvider } from './wallet-helpers.js';
import { toErrorMessage } from './error-helpers.js';
import type { AuthMenuSetters, DesktopCallbackContext } from './auth-menu-handlers.js';
import { applyTokens, handleLoginResult } from './auth-menu-handlers.js';

function isWalletCancellationError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = Number((error as { code?: unknown }).code);
    if (code === 4001) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.trim().toLowerCase();
  return normalized.includes('cancel')
    || normalized.includes('rejected')
    || normalized.includes('denied')
    || normalized.includes('closed');
}

// ---------------------------------------------------------------------------
// handleRequestEmailOtp
// ---------------------------------------------------------------------------

export async function handleRequestEmailOtp(
  event: FormEvent,
  email: string,
  setters: AuthMenuSetters,
  adapter: AuthPlatformAdapter,
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
    const result = await adapter.requestEmailOtp(normalizedEmail);
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
  adapter: AuthPlatformAdapter,
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
    const result = await adapter.verifyEmailOtp(normalizedEmail, otpCode);
    if (result.tokens && shouldPromptPasswordSetupAfterEmailOtp(result)) {
      const accessToken = String(result.tokens.accessToken || '').trim();
      const refreshToken = String(result.tokens.refreshToken || '').trim();
      await adapter.applyToken(accessToken, refreshToken);
      setters.setPendingTokens(result.tokens);
      setters.setOtpCode('');
      setters.setView('email_set_password');
      return;
    }
    await handleLoginResult(result, '验证码登录成功。', setters, desktopCtx, adapter, 'email_otp_verify');
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
  adapter: AuthPlatformAdapter,
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
    const result = await adapter.requestEmailOtp(normalizedEmail);
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
  adapter: AuthPlatformAdapter,
): Promise<void> {
  event.preventDefault();
  if (!tempToken || twoFactorCode.length !== 6) {
    setters.setLoginError('请输入 6 位 2FA 验证码');
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    const tokens = await adapter.verifyTwoFactor(tempToken, twoFactorCode);
    await applyTokens(tokens, '2FA 验证成功，已登录。', setters, desktopCtx, adapter);
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
  adapter: AuthPlatformAdapter,
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
    await adapter.applyToken(accessToken);
    const user = await adapter.loadCurrentUser();
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
  adapter: AuthPlatformAdapter,
): Promise<void> {
  setters.setPending(true);
  setters.setLoginError(null);

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

    const challenge = await adapter.walletChallenge({
      walletAddress,
      chainId,
      walletType,
    });

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

    const result = await adapter.walletLogin({
      walletAddress,
      chainId,
      nonce: challenge.nonce,
      message: challengeMessage,
      signature,
      walletType,
    });

    await handleLoginResult(result, '钱包登录成功。', setters, desktopCtx, adapter);
  } catch (error) {
    if (!isWalletCancellationError(error)) {
      console.warn('[shell-auth] wallet login failed', error);
    }
  } finally {
    window.clearTimeout(timeoutId);
    setters.setPending(false);
  }
}
