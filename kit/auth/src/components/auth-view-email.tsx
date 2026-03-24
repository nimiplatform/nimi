import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonBase, buttonDefault, inputBase } from '../types/auth-types.js';

export type AuthViewEmailTestIds = {
  passwordInput?: string;
  otpButton?: string;
};

function PasswordToggleIcon({ visible }: { visible: boolean }) {
  return visible ? (
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
  );
}

export function AuthViewEmailLogin(props: {
  email: string;
  password: string;
  pending: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onUseEmailCodeInstead: () => void;
  testIds?: AuthViewEmailTestIds;
}) {
  const { t } = useTranslation();
  const {
    email,
    password,
    pending,
    onPasswordChange,
    onSubmit,
    onUseEmailCodeInstead,
    testIds,
  } = props;

  const [showOtpConfirm, setShowOtpConfirm] = useState(false);

  return (
    <div className="relative w-full">
      <p className="mb-3 text-center text-sm text-[var(--nimi-text-muted)]">{email}</p>

      <form onSubmit={onSubmit}>
        <div className="flex items-center h-[52px] rounded-full border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] shadow-[var(--nimi-elevation-base)]">
          <button
            type="button"
            data-testid={testIds?.otpButton}
            onClick={() => setShowOtpConfirm(true)}
            disabled={pending}
            aria-label={t('Auth.useEmailCodeInstead')}
            className="ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--nimi-text-muted)] transition hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </button>

          <input
            type="password"
            value={password}
            data-testid={testIds?.passwordInput}
            onChange={(event) => onPasswordChange(event.target.value)}
            className="flex-1 min-w-0 bg-transparent px-3 text-[15px] text-[var(--nimi-text-primary)] placeholder:text-[var(--nimi-text-muted)] outline-none"
            placeholder={t('Auth.passwordPlaceholder')}
            required
            autoFocus
            autoComplete="current-password"
          />

          <div className={`mr-2 flex h-9 w-9 shrink-0 transition-all duration-200 ease-out ${password ? 'scale-100 opacity-100' : 'scale-75 opacity-0 pointer-events-none'}`}>
            <button
              type="submit"
              disabled={pending || !password}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] transition hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? (
                <svg width="16" height="16" viewBox="0 0 16 16" className="animate-spin">
                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8h9M8.5 4l4 4-4 4" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </form>

      <div className={`absolute left-0 right-0 z-20 mt-3 origin-top rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-5 shadow-[var(--nimi-elevation-floating)] backdrop-blur transition-all duration-200 ease-out ${
        showOtpConfirm
          ? 'scale-100 opacity-100'
          : 'scale-95 opacity-0 pointer-events-none'
      }`}>
        <p className="mb-4 text-center text-sm text-[var(--nimi-text-primary)]">
          {t('Auth.otpConfirmMessage')}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setShowOtpConfirm(false)}
            className="rounded-full border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-5 py-2 text-sm font-medium text-[var(--nimi-text-muted)] transition hover:border-[var(--nimi-border-subtle)]"
          >
            {t('Auth.cancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowOtpConfirm(false);
              onUseEmailCodeInstead();
            }}
            disabled={pending}
            className="rounded-full bg-[var(--nimi-action-primary-bg)] px-5 py-2 text-sm font-medium text-[var(--nimi-action-primary-text)] transition hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
          >
            {t('Auth.confirmOtp')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AuthViewEmailSetPassword(props: {
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  pending: boolean;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onShowPasswordToggle: () => void;
  onShowConfirmPasswordToggle: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { t } = useTranslation();
  const {
    password,
    confirmPassword,
    showPassword,
    showConfirmPassword,
    pending,
    onPasswordChange,
    onConfirmPasswordChange,
    onShowPasswordToggle,
    onShowConfirmPasswordToggle,
    onSubmit,
  } = props;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-[var(--nimi-text-muted)]">{t('Auth.setPasswordHint')}</p>
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          className={`${inputBase} h-[52px] rounded-2xl border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 pr-12 text-[15px] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]`}
          placeholder={t('Auth.passwordMinChars')}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <button
          type="button"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--nimi-text-muted)] transition hover:text-[var(--nimi-text-primary)]"
          onClick={onShowPasswordToggle}
        >
          <PasswordToggleIcon visible={showPassword} />
        </button>
      </div>
      <div className="relative">
        <input
          type={showConfirmPassword ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(event) => onConfirmPasswordChange(event.target.value)}
          className={`${inputBase} h-[52px] rounded-2xl border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 pr-12 text-[15px] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]`}
          placeholder={t('Auth.confirmPasswordPlaceholder')}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <button
          type="button"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--nimi-text-muted)] transition hover:text-[var(--nimi-text-primary)]"
          onClick={onShowConfirmPasswordToggle}
        >
          <PasswordToggleIcon visible={showConfirmPassword} />
        </button>
      </div>
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} h-[52px] w-full rounded-2xl text-sm font-semibold shadow-[var(--nimi-elevation-raised)]`}
        disabled={pending}
      >
        {pending ? t('Auth.settingPassword') : t('Auth.setPasswordButton')}
      </button>
    </form>
  );
}

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
      <p className="text-sm text-[var(--nimi-text-muted)]">
        {t('Auth.otpSentTo')} <span className="font-medium text-[var(--nimi-text-primary)]">{email}</span>.
      </p>
      <input
        type="text"
        value={otpCode}
        onChange={(event) => onOtpCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        className={`${inputBase} h-[56px] rounded-2xl border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 text-center text-xl font-bold tracking-[0.5em] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]`}
        placeholder="000000"
        required
        pattern="\d{6}"
        inputMode="numeric"
      />
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} h-[52px] w-full rounded-2xl text-sm font-semibold shadow-[var(--nimi-elevation-raised)]`}
        disabled={pending || otpCode.length !== 6}
      >
        {pending ? t('Auth.verifying') : t('Auth.verifyAndContinue')}
      </button>
      <button
        type="button"
        onClick={() => {
          void onResendOtp();
        }}
        disabled={pending || otpResendCountdown > 0}
        className={`w-full text-center text-xs ${
          otpResendCountdown > 0
            ? 'cursor-not-allowed text-[var(--nimi-text-secondary)]'
            : 'font-semibold text-[var(--nimi-action-primary-bg)] hover:underline'
        }`}
      >
        {otpResendCountdown > 0 ? t('Auth.resendIn', { count: otpResendCountdown }) : t('Auth.resendCode')}
      </button>
    </form>
  );
}

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
      <p className="text-sm text-[var(--nimi-text-muted)]">{t('Auth.twoFaHint')}</p>
      <input
        type="text"
        value={twoFactorCode}
        onChange={(event) =>
          onTwoFactorCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        className={`${inputBase} h-[56px] rounded-2xl border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 text-center text-xl font-bold tracking-[0.5em] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]`}
        placeholder="123456"
        required
        pattern="\d{6}"
        inputMode="numeric"
      />
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} h-[52px] w-full rounded-2xl text-sm font-semibold shadow-[var(--nimi-elevation-raised)]`}
        disabled={pending || twoFactorCode.length !== 6}
      >
        {pending ? t('Auth.verifying') : t('Auth.verifyAndLogin')}
      </button>
    </form>
  );
}
