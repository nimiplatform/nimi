import type { FormEvent } from 'react';
import { NIMI_REALM_OAUTH_LOGIN_STATE } from '@nimiplatform/kit/core/sdk-contract';
import type { WebAccountAuthAdapter } from '../platform/web-account-auth-adapter.js';
import {
  AUTH_COPY,
  toAuthUiErrorMessage,
} from './auth-copy.js';
import type { AuthMenuSetters } from './auth-menu-handlers.js';
import { completeBrowserSession, handleLoginResult } from './auth-menu-handlers.js';

// ---------------------------------------------------------------------------
// handleRequestEmailOtp
// ---------------------------------------------------------------------------

export async function handleRequestEmailOtp(
  event: FormEvent,
  email: string,
  setters: AuthMenuSetters,
  adapter: WebAccountAuthAdapter,
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
  adapter: WebAccountAuthAdapter,
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
    if (result.tokens != null) {
      throw new Error('Realm browser-session authentication returned forbidden bearer material.');
    }
    if (result.loginState === NIMI_REALM_OAUTH_LOGIN_STATE.NEEDS_ONBOARDING) {
      setters.setPendingPasswordSetup(true);
      setters.setOtpCode('');
      setters.setView('email_set_password');
      return;
    }
    await handleLoginResult(
      result,
      AUTH_COPY.otpVerifySuccess,
      setters,
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
  adapter: WebAccountAuthAdapter,
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
  adapter: WebAccountAuthAdapter,
): Promise<void> {
  event.preventDefault();
  if (!tempToken || twoFactorCode.length !== 6) {
    setters.setLoginError(AUTH_COPY.twoFactorCodeRequired);
    return;
  }

  setters.setPending(true);
  setters.setLoginError(null);
  try {
    await adapter.verifyTwoFactor(tempToken, twoFactorCode);
    await completeBrowserSession(AUTH_COPY.twoFactorSuccess, setters, adapter);
  } catch (error) {
    setters.setLoginError(toAuthUiErrorMessage(error, AUTH_COPY.twoFactorFailed));
  } finally {
    setters.setPending(false);
  }
}
