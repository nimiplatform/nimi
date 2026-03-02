import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buttonBase,
  buttonDefault,
  inputBase,
} from './auth-helpers.js';

// ---------------------------------------------------------------------------
// AuthViewEmailLogin
// ---------------------------------------------------------------------------

export function AuthViewEmailLogin(props: {
  email: string;
  password: string;
  showPassword: boolean;
  rememberMe: boolean;
  pending: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onShowPasswordToggle: () => void;
  onRememberMeChange: (value: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  onSwitchToRegister: () => void;
}) {
  const { t } = useTranslation();
  const {
    email, password, showPassword, rememberMe, pending,
    onEmailChange, onPasswordChange, onShowPasswordToggle, onRememberMeChange,
    onSubmit, onSwitchToRegister,
  } = props;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input
        type="email"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        className={`${inputBase} rounded-xl border-border px-4 py-2.5 h-auto`}
        style={{ color: '#1A1A1A' }}
        placeholder={t('Auth.emailPlaceholder')}
        required
        autoComplete="username"
      />
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          className={`${inputBase} rounded-xl border-border px-4 py-2.5 pr-12 h-auto`}
          style={{ color: '#1A1A1A' }}
          placeholder={t('Auth.passwordPlaceholder')}
          required
          autoComplete="current-password"
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 hover:text-foreground"
          style={{ color: '#999999' }}
          onClick={onShowPasswordToggle}
        >
          {showPassword ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <line x1="2" x2="22" y1="2" y2="22" />
            </svg>
          )}
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#666666' }}>
        <div className="relative">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => onRememberMeChange(event.target.checked)}
            className="peer sr-only"
          />
          <div className="h-4 w-4 rounded border border-border bg-white peer-checked:bg-mint-500 peer-checked:border-mint-500 transition-colors"></div>
          <svg
            className={`absolute inset-0 h-4 w-4 pointer-events-none transition-opacity ${rememberMe ? 'opacity-100' : 'opacity-0'}`}
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M3.5 8L6.5 11L12.5 5"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span>{t('Auth.rememberMe')}</span>
      </label>
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} w-full rounded-xl py-3 text-sm font-semibold mt-4`}
        disabled={pending}
      >
        {pending ? t('Auth.loggingIn') : t('Auth.login')}
      </button>
      <p className="text-center text-xs mt-3" style={{ color: '#666666' }}>
        {t('Auth.noAccount')}{' '}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="text-mint-500 font-semibold hover:underline"
        >
          {t('Auth.signUpLink')}
        </button>
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// AuthViewEmailRegister
// ---------------------------------------------------------------------------

export function AuthViewEmailRegister(props: {
  email: string;
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  pending: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onShowPasswordToggle: () => void;
  onShowConfirmPasswordToggle: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { t } = useTranslation();
  const {
    email, password, confirmPassword, showPassword, showConfirmPassword, pending,
    onEmailChange, onPasswordChange, onConfirmPasswordChange,
    onShowPasswordToggle, onShowConfirmPasswordToggle, onSubmit,
  } = props;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input
        type="email"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        className={`${inputBase} rounded-xl border-border px-4 py-3 h-auto`}
        placeholder={t('Auth.emailPlaceholder')}
        required
      />
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          className={`${inputBase} rounded-xl border-border px-4 py-3 pr-12 h-auto`}
          placeholder={t('Auth.passwordMinChars')}
          required
          minLength={8}
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 hover:text-foreground"
          style={{ color: '#999999' }}
          onClick={onShowPasswordToggle}
        >
          {showPassword ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <line x1="2" x2="22" y1="2" y2="22" />
            </svg>
          )}
        </button>
      </div>
      <div className="relative">
        <input
          type={showConfirmPassword ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(event) => onConfirmPasswordChange(event.target.value)}
          className={`${inputBase} rounded-xl border-border px-4 py-3 pr-12 h-auto`}
          placeholder={t('Auth.confirmPasswordPlaceholder')}
          required
          minLength={8}
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
          onClick={onShowConfirmPasswordToggle}
        >
          {showConfirmPassword ? t('Auth.hidePassword') : t('Auth.showPassword')}
        </button>
      </div>
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} w-full mt-4 rounded-xl py-3 text-sm font-semibold`}
        disabled={pending}
      >
        {pending ? t('Auth.creating') : t('Auth.createAccount')}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// AuthViewEmailOtp — request OTP code
// ---------------------------------------------------------------------------

export function AuthViewEmailOtp(props: {
  email: string;
  pending: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { t } = useTranslation();
  const { email, pending, onEmailChange, onSubmit } = props;

  return (
    <form onSubmit={onSubmit} className="space-y-4 flex-1 flex flex-col">
      <p className="text-sm text-muted-foreground">{t('Auth.otpHint')}</p>
      <input
        type="email"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        className={`${inputBase} rounded-xl border-border px-4 py-3 h-auto text-sm`}
        placeholder={t('Auth.emailPlaceholder')}
        required
      />
      <div className="flex-1"></div>
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} w-full rounded-xl py-3 text-sm font-semibold`}
        disabled={pending || !email.trim()}
      >
        {pending ? t('Auth.sending') : t('Auth.continue')}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// AuthViewEmailOtpVerify — enter the 6-digit OTP code
// ---------------------------------------------------------------------------

export function AuthViewEmailOtpVerify(props: {
  email: string;
  otpCode: string;
  otpResendCountdown: number;
  pending: boolean;
  onOtpCodeChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onResendOtp: () => void;
}) {
  const { t } = useTranslation();
  const { email, otpCode, otpResendCountdown, pending, onOtpCodeChange, onSubmit, onResendOtp } = props;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('Auth.otpSentTo')} <span className="font-medium text-foreground">{email}</span>.
      </p>
      <input
        type="text"
        value={otpCode}
        onChange={(event) => onOtpCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        className={`${inputBase} rounded-xl border-border px-4 py-3 h-auto text-center text-xl font-bold tracking-[0.5em] focus-visible:ring-mint-500 focus-visible:border-mint-500`}
        style={{ color: '#1A1A1A' }}
        placeholder="000000"
        required
        pattern="\d{6}"
        inputMode="numeric"
      />
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} w-full rounded-xl py-3 text-sm font-semibold`}
        disabled={pending || otpCode.length !== 6}
      >
        {pending ? t('Auth.verifying') : t('Auth.verifyAndLogin')}
      </button>
      <button
        type="button"
        onClick={() => {
          void onResendOtp();
        }}
        disabled={pending || otpResendCountdown > 0}
        className={`w-full text-center text-xs ${
          otpResendCountdown > 0
            ? 'text-muted-foreground cursor-not-allowed'
            : 'text-mint-500 font-semibold hover:underline'
        }`}
      >
        {otpResendCountdown > 0 ? t('Auth.resendIn', { count: otpResendCountdown }) : t('Auth.resendCode')}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// AuthViewEmail2Fa — two-factor authentication code entry
// ---------------------------------------------------------------------------

export function AuthViewEmail2Fa(props: {
  twoFactorCode: string;
  pending: boolean;
  onTwoFactorCodeChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { t } = useTranslation();
  const { twoFactorCode, pending, onTwoFactorCodeChange, onSubmit } = props;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('Auth.twoFaHint')}</p>
      <input
        type="text"
        value={twoFactorCode}
        onChange={(event) =>
          onTwoFactorCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        className={`${inputBase} rounded-xl border-border px-4 py-3 h-auto text-center text-xl font-bold tracking-[0.5em]`}
        placeholder="123456"
        required
        pattern="\d{6}"
        inputMode="numeric"
      />
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} w-full mt-4 rounded-xl py-6 text-sm font-semibold`}
        disabled={pending || twoFactorCode.length !== 6}
      >
        {pending ? t('Auth.verifying') : t('Auth.verifyAndLogin')}
      </button>
    </form>
  );
}
