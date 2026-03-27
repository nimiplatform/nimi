import type { FormEvent } from 'react';
import type { WalletType } from '../types/auth-types.js';
import type { AuthPlatformAdapter } from '../platform/auth-platform-adapter.js';
import { shouldPromptPasswordSetupAfterEmailOtp } from './auth-email-flow.js';
import { persistAuthSession } from './auth-session-storage.js';
import {
  AUTH_COPY,
  toAuthUiErrorMessage,
  walletUnavailableMessage,
} from './auth-copy.js';
import { submitDesktopCallbackResult } from './desktop-callback-helpers.js';
import { parseChainId, resolveWalletProvider } from './wallet-helpers.js';
import type { AuthMenuSetters, DesktopCallbackContext } from './auth-menu-handlers.js';
import { applyTokens, handleLoginResult } from './auth-menu-handlers.js';

const WALLET_LOGIN_TIMEOUT_MS = 30000;
const WALLET_LOGIN_TIMEOUT_MESSAGE = AUTH_COPY.walletLoginTimeout;

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

function isWalletTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.trim() === WALLET_LOGIN_TIMEOUT_MESSAGE;
}

function firstStringEntry(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      return entry.trim();
    }
  }
  return '';
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
    setters.setLoginError(AUTH_COPY.emailRequired);
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    const result = await adapter.requestEmailOtp(normalizedEmail);
    if (!result?.success) {
      throw new Error(String(result?.message || AUTH_COPY.requestOtpFailed));
    }
    setters.setOtpCode('');
    setters.setOtpResendCountdown(60);
    setters.setView('email_otp_verify');
  } catch (error) {
    setters.setLoginError(toAuthUiErrorMessage(error, AUTH_COPY.requestOtpFailed));
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
    setters.setLoginError(AUTH_COPY.otpCodeRequired);
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
    await handleLoginResult(
      result,
      AUTH_COPY.otpVerifySuccess,
      setters,
      desktopCtx,
      adapter,
      'email_otp_verify',
    );
  } catch (error) {
    setters.setLoginError(toAuthUiErrorMessage(error, AUTH_COPY.otpVerifyFailed));
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
    setters.setLoginError(AUTH_COPY.emailRequired);
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    const result = await adapter.requestEmailOtp(normalizedEmail);
    if (!result?.success) {
      throw new Error(String(result?.message || AUTH_COPY.resendOtpFailed));
    }
    setters.setOtpResendCountdown(60);
    setters.setOtpCode('');
  } catch (error) {
    setters.setLoginError(toAuthUiErrorMessage(error, AUTH_COPY.resendOtpFailed));
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
    setters.setLoginError(AUTH_COPY.twoFactorCodeRequired);
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    const tokens = await adapter.verifyTwoFactor(tempToken, twoFactorCode);
    await applyTokens(tokens, AUTH_COPY.twoFactorSuccess, setters, desktopCtx, adapter);
  } catch (error) {
    setters.setLoginError(toAuthUiErrorMessage(error, AUTH_COPY.twoFactorFailed));
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
    setters.setLoginError(AUTH_COPY.desktopRequestInvalid);
    setters.setView('main');
    return;
  }

  const accessToken = String(
    desktopCtx.authToken
    || desktopCtx.desktopCallbackToken
    || '',
  ).trim();
  if (!accessToken) {
    setters.setLoginError(AUTH_COPY.desktopSessionMissing);
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
      undefined,
    );
    persistAuthSession({
      accessToken,
      user: normalizedUser ?? desktopCtx.desktopCallbackUser,
    });

    submitDesktopCallbackResult({
      request: desktopCtx.desktopCallbackRequest,
      code: accessToken,
    });
  } catch (error) {
    setters.setLoginError(
      toAuthUiErrorMessage(error, AUTH_COPY.desktopSessionInvalid, {
        expiredMessage: AUTH_COPY.desktopSessionExpired,
        forbiddenMessage: AUTH_COPY.desktopPermissionDenied,
      }),
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

  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    setters.setPending(false);
    setters.setLoginError(AUTH_COPY.walletLoginTimeout);
  }, WALLET_LOGIN_TIMEOUT_MS);

  const throwIfTimedOut = (): void => {
    if (timedOut) {
      throw new Error(WALLET_LOGIN_TIMEOUT_MESSAGE);
    }
  };

  try {
    const provider = resolveWalletProvider(walletType);
    if (!provider) {
      throw new Error(
        walletType === 'metamask'
          ? walletUnavailableMessage('MetaMask')
          : walletType === 'okx'
            ? walletUnavailableMessage('OKX')
            : walletUnavailableMessage('Binance'),
      );
    }

    const accounts = await provider.request({
      method: 'eth_requestAccounts',
    });
    throwIfTimedOut();
    const walletAddress = firstStringEntry(accounts);
    if (!walletAddress) {
      throw new Error(AUTH_COPY.walletAddressMissing);
    }

    const chainIdRaw = await provider.request({
      method: 'eth_chainId',
    });
    throwIfTimedOut();
    const chainId = parseChainId(chainIdRaw);

    const challenge = await adapter.walletChallenge({
      walletAddress,
      chainId,
      walletType,
    });
    throwIfTimedOut();

    const challengeMessage = String(challenge?.message || '').trim();
    if (!challengeMessage) {
      throw new Error(AUTH_COPY.walletChallengeInvalid);
    }

    const signatureResult = await provider.request({
      method: 'personal_sign',
      params: [challengeMessage, walletAddress],
    });
    throwIfTimedOut();
    const signature = typeof signatureResult === 'string' ? signatureResult.trim() : '';
    if (!signature) {
      throw new Error(AUTH_COPY.walletSignatureFailed);
    }

    const result = await adapter.walletLogin({
      walletAddress,
      chainId,
      nonce: challenge.nonce,
      message: challengeMessage,
      signature,
      walletType,
    });
    throwIfTimedOut();

    await handleLoginResult(result, AUTH_COPY.walletLoginSuccess, setters, desktopCtx, adapter);
  } catch (error) {
    if (!isWalletCancellationError(error)) {
      if (!isWalletTimeoutError(error)) {
        setters.setLoginError(toAuthUiErrorMessage(error, AUTH_COPY.walletLoginFailed));
      }
    }
  } finally {
    window.clearTimeout(timeoutId);
    if (!timedOut) {
      setters.setPending(false);
    }
  }
}
