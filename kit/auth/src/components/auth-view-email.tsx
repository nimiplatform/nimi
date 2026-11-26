import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Surface } from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';
import { motion, nimiOverlayPanelMotion, useNimiReducedMotion } from '@nimiplatform/kit/ui/motion';
import { buttonBase, buttonDefault, capsuleBar, capsuleBarIconButton, capsuleBarInput, capsuleBarSubmitButton, inputBase } from '../types/auth-types.js';

export type AuthViewEmailTestIds = {
  passwordInput?: string;
  otpButton?: string;
};

function PasswordToggleIcon({ visible }: { visible: boolean }) {
  const Icon = visible ? Eye : EyeOff;
  return <Icon size={18} strokeWidth={1.75} aria-hidden="true" />;
}

export function AuthViewEmailLogin(props: {
  passwordRecoveryLink?: ReactNode;
  email: string;
  password: string;
  pending: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onUseEmailCodeInstead: () => void;
  onBack?: () => void;
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
    onBack,
    testIds,
  } = props;

  const [showOtpConfirm, setShowOtpConfirm] = useState(false);
  const otpTrigger = useRef<HTMLButtonElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const reducedMotion = useNimiReducedMotion();
  const confirmMotion = nimiOverlayPanelMotion({ kind: 'popover', side: 'bottom', reducedMotion });
  const backLabel = t('Common.back', { defaultValue: 'Back' });

  return (
    <div className="relative w-full">
      <p className="mb-3 truncate text-center text-sm text-[var(--nimi-text-muted)]">{email}</p>

      <form
        onSubmit={(event) => {
          setShowOtpConfirm(false);
          onSubmit(event);
        }}
      >
        <div className={`${capsuleBar} nimi-shell-auth-main-capsule`}>
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              disabled={pending}
              aria-label={backLabel}
              title={backLabel}
              className={capsuleBarIconButton}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12.5 8h-9M7.5 4l-4 4 4 4" />
              </svg>
            </button>
          ) : null}

          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            data-testid={testIds?.passwordInput}
            onChange={(event) => onPasswordChange(event.target.value)}
            className={onBack ? capsuleBarInput : `${capsuleBarInput} pl-5`}
            placeholder={t('Auth.passwordPlaceholder')}
            required
            autoFocus
            autoComplete="current-password"
          />

          <div className={`mr-1 flex h-9 w-9 shrink-0 transition-[transform,opacity] duration-[var(--nimi-motion-base,200ms)] ease-[var(--nimi-motion-ease-standard)] ${password ? 'scale-100 opacity-100' : 'scale-75 opacity-0 pointer-events-none'}`}>
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={password ? 0 : -1}
              aria-label={t(showPassword ? 'Auth.hidePassword' : 'Auth.showPassword')}
              aria-pressed={showPassword}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-[var(--nimi-text-muted)] transition-[background-color,color,transform] duration-[var(--nimi-motion-fast,120ms)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] active:scale-[var(--nimi-motion-pressed-scale,0.97)] ${FOCUS_RING_CLASS_NAME}`}
            >
              <PasswordToggleIcon visible={showPassword} />
            </button>
          </div>

          <div className={`mr-2 flex h-9 w-9 shrink-0 transition-[transform,opacity] duration-[var(--nimi-motion-base,200ms)] ease-[var(--nimi-motion-ease-standard)] ${password ? 'scale-100 opacity-100' : 'scale-75 opacity-0 pointer-events-none'}`}>
            <button
              type="submit"
              disabled={pending || !password}
              aria-label={t('Auth.continue', { defaultValue: 'Continue' })}
              className={capsuleBarSubmitButton}
            >
              {pending ? (
                <svg width="16" height="16" viewBox="0 0 16 16" className="animate-spin motion-reduce:animate-none" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3.5 8h9M8.5 4l4 4-4 4" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </form>

      <div className="nimi-shell-auth-secondary-actions">
        <button
          type="button"
          data-testid={testIds?.otpButton}
          ref={otpTrigger}
          aria-expanded={showOtpConfirm}
          onClick={() => setShowOtpConfirm((current) => !current)}
          disabled={pending}
          className="nimi-shell-auth-secondary-action"
        >
          {t('Auth.useEmailCodeInstead')}
        </button>
        {props.passwordRecoveryLink ? (
          <>
            <span aria-hidden="true" className="nimi-shell-auth-secondary-dot">·</span>
            {props.passwordRecoveryLink}
          </>
        ) : null}
      </div>

      {showOtpConfirm ? (
        <motion.div
          className="mt-3"
          initial={confirmMotion.initial}
          animate={confirmMotion.animate}
          transition={confirmMotion.transition}
          style={confirmMotion.style}
        >
          <Surface material="glass-regular" tone="overlay" elevation="floating" padding="none" className="rounded-2xl p-5">
            <p className="mb-4 text-center text-sm text-[var(--nimi-text-primary)]">
              {t('Auth.otpConfirmMessage')}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                autoFocus
                onClick={() => { setShowOtpConfirm(false); otpTrigger.current?.focus(); }}
                className={`${buttonBase} rounded-full border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-5 py-2 text-[var(--nimi-text-muted)] hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-primary)]`}
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
                className={`${buttonBase} rounded-full bg-[var(--nimi-action-primary-bg)] px-5 py-2 text-[var(--nimi-action-primary-text)] hover:bg-[var(--nimi-action-primary-bg-hover)]`}
              >
                {t('Auth.confirmOtp')}
              </button>
            </div>
          </Surface>
        </motion.div>
      ) : null}
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
  onBack?: () => void;
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
    onBack,
  } = props;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-center text-sm text-[var(--nimi-text-muted)]">{t('Auth.setPasswordHint')}</p>
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          className={`${inputBase} min-h-[3.25rem] rounded-2xl border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 pr-12 text-[length:var(--nimi-type-label-size,0.9375rem)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]`}
          placeholder={t('Auth.passwordMinChars')}
          aria-label={t('Auth.passwordMinChars')}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <button
          type="button"
          aria-label={t(showPassword ? 'Auth.hidePassword' : 'Auth.showPassword')}
          aria-pressed={showPassword}
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-2 text-[var(--nimi-text-muted)] transition-[color,background-color,transform] duration-[var(--nimi-motion-fast,120ms)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] active:scale-[var(--nimi-motion-pressed-scale,0.97)] ${FOCUS_RING_CLASS_NAME}`}
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
          className={`${inputBase} min-h-[3.25rem] rounded-2xl border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 pr-12 text-[length:var(--nimi-type-label-size,0.9375rem)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]`}
          placeholder={t('Auth.confirmPasswordPlaceholder')}
          aria-label={t('Auth.confirmPasswordPlaceholder')}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <button
          type="button"
          aria-label={t(showConfirmPassword ? 'Auth.hidePassword' : 'Auth.showPassword')}
          aria-pressed={showConfirmPassword}
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-2 text-[var(--nimi-text-muted)] transition-[color,background-color,transform] duration-[var(--nimi-motion-fast,120ms)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] active:scale-[var(--nimi-motion-pressed-scale,0.97)] ${FOCUS_RING_CLASS_NAME}`}
          onClick={onShowConfirmPasswordToggle}
        >
          <PasswordToggleIcon visible={showConfirmPassword} />
        </button>
      </div>
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} min-h-[3.25rem] w-full rounded-2xl text-sm font-semibold shadow-[var(--nimi-elevation-raised)]`}
        disabled={pending}
      >
        {pending ? t('Auth.settingPassword') : t('Auth.setPasswordButton')}
      </button>
      {onBack ? (
        <div className="nimi-shell-auth-secondary-actions">
          <button
            type="button"
            onClick={onBack}
            disabled={pending}
            className="nimi-shell-auth-secondary-action"
          >
            {t('Common.back', { defaultValue: 'Back' })}
          </button>
        </div>
      ) : null}
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
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const { email, otpCode, otpResendCountdown, pending, onOtpCodeChange, onSubmit, onResendOtp, onBack } = props;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-center text-sm text-[var(--nimi-text-muted)]">
        {t('Auth.otpSentTo')} <span className="font-medium text-[var(--nimi-text-primary)]">{email}</span>.
      </p>
      <input
        type="text"
        value={otpCode}
        onChange={(event) => onOtpCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        className={`${inputBase} min-h-14 rounded-2xl border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 text-center tabular-nums text-xl font-bold tracking-[0.5em] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]`}
        placeholder="000000"
        aria-label={t('Auth.otpSentTo', { defaultValue: 'Verification code' })}
        autoComplete="one-time-code"
        required
        pattern="\d{6}"
        inputMode="numeric"
      />
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} min-h-[3.25rem] w-full rounded-2xl text-sm font-semibold shadow-[var(--nimi-elevation-raised)]`}
        disabled={pending || otpCode.length !== 6}
      >
        {pending ? t('Auth.verifying') : t('Auth.verifyAndContinue')}
      </button>
      <div className="nimi-shell-auth-secondary-actions">
        <button
          type="button"
          onClick={() => {
            void onResendOtp();
          }}
          disabled={pending || otpResendCountdown > 0}
          className={`nimi-shell-auth-secondary-action ${
            otpResendCountdown > 0
              ? 'cursor-not-allowed text-[var(--nimi-text-muted)]'
              : 'font-semibold text-[var(--nimi-action-primary-bg)]'
          }`}
        >
          {otpResendCountdown > 0 ? t('Auth.resendIn', { count: otpResendCountdown }) : t('Auth.resendCode')}
        </button>
        {onBack ? (
          <>
            <span aria-hidden="true" className="nimi-shell-auth-secondary-dot">·</span>
            <button
              type="button"
              onClick={onBack}
              disabled={pending}
              className="nimi-shell-auth-secondary-action"
            >
              {t('Common.back', { defaultValue: 'Back' })}
            </button>
          </>
        ) : null}
      </div>
    </form>
  );
}

export function AuthViewEmail2Fa(props: {
  twoFactorCode: string;
  pending: boolean;
  onTwoFactorCodeChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const { twoFactorCode, pending, onTwoFactorCodeChange, onSubmit, onBack } = props;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-center text-sm text-[var(--nimi-text-muted)]">{t('Auth.twoFaHint')}</p>
      <input
        type="text"
        value={twoFactorCode}
        onChange={(event) =>
          onTwoFactorCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        className={`${inputBase} min-h-14 rounded-2xl border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 text-center tabular-nums text-xl font-bold tracking-[0.5em] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]`}
        placeholder="123456"
        aria-label={t('Auth.twoFaHint', { defaultValue: 'Two-factor authentication code' })}
        autoComplete="one-time-code"
        required
        pattern="\d{6}"
        inputMode="numeric"
      />
      <button
        type="submit"
        className={`${buttonBase} ${buttonDefault} min-h-[3.25rem] w-full rounded-2xl text-sm font-semibold shadow-[var(--nimi-elevation-raised)]`}
        disabled={pending || twoFactorCode.length !== 6}
      >
        {pending ? t('Auth.verifying') : t('Auth.verifyAndLogin')}
      </button>
      {onBack ? (
        <div className="nimi-shell-auth-secondary-actions">
          <button
            type="button"
            onClick={onBack}
            disabled={pending}
            className="nimi-shell-auth-secondary-action"
          >
            {t('Common.back', { defaultValue: 'Back' })}
          </button>
        </div>
      ) : null}
    </form>
  );
}
